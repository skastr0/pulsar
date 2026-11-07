//! `pulsar delta <base> <head>`: the findings a change added and removed, and how measured values
//! moved.
//!
//! What was added, allowed, removed, needs coverage, worsened and improved is decided by the
//! engine's proven delta section (`delta_engine`, FACTS.md "Delta"); this file evaluates the two
//! shas, follows renames, and renders.
//!
//! Each sha is evaluated from a private checkout: a temporary index plus `git checkout-index`
//! materialises the tree, so the repository's own index, worktree list and refs are never
//! written (many agents share one checkout). The checkout is deleted when evaluation ends.
//!
//! Limit: file subjects key on the path, so renaming a file or directory removes its findings and
//! adds them again under the new path (FACTS.md: keys never use lines, and rename tracking is not
//! part of a path key).

use crate::cache::{self, Cache};
use crate::compfind;
use crate::coverage;
use crate::infrafind;
use crate::delta_engine::{self, Rows};
use crate::driver;
use crate::engine::{self, Findings};
use crate::facts::{stable_key, FactWriter, SideTables};
use crate::finding::{catalog_rule, hex, metric_rule, needs_coverage, off_by_default, Finding, Subject, IMPORT_CYCLE};
use crate::lang::Degraded;
use crate::policy::{self, Effective};
use crate::layers;
use crate::sqlfind;
use crate::rename::{self, Renames};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

pub const USAGE: &str = "usage: pulsar delta <base> <head> [--repo dir] [--json] [--coverage file|dir] [--trend] [--no-cache]
  exit 0 = no finding added, 1 = at least one added, 2 = error
  --coverage reads a coverage report from the worktree and applies it to HEAD only (it describes the
    checked-out tree, so use it when <head> is what you have checked out and tested). Without it, a
    report at the repo root (coverage/coverage-final.json, coverage/lcov.info, ...) is found the same way. Findings that
    need coverage (core.crap) are listed under `?` and never count toward exit 1.
  --trend lists every function whose measured values moved (default: only functions that have a
    metric finding in base or head). Trend lines (`~ worsened`, `~ improved`) show old -> new values;
    they are measurements, never findings, and never count toward exit 1.
  --no-cache recomputes both shas instead of reading ~/.pulsar/cache (a cached sha skips checkout and parsing).
  --json prints JSON lines (one per finding, then a summary line) instead of text";

pub struct Args {
    base: String,
    head: String,
    repo: PathBuf,
    json: bool,
    coverage: Option<PathBuf>,
    trend: bool,
    no_cache: bool,
}

pub fn parse(args: &[String]) -> Result<Args, String> {
    let mut pos = Vec::new();
    let mut repo = PathBuf::from(".");
    let (mut json, mut trend, mut no_cache) = (false, false, false);
    let mut coverage = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "--trend" => trend = true,
            "--no-cache" => no_cache = true,
            "--coverage" => coverage = Some(PathBuf::from(it.next().ok_or("--coverage needs a value")?)),
            "--repo" => repo = PathBuf::from(it.next().ok_or("--repo needs a value")?),
            f if f.starts_with('-') => return Err(format!("unknown flag {f}\n{USAGE}")),
            _ => pos.push(a.clone()),
        }
    }
    let [base, head] = <[String; 2]>::try_from(pos).map_err(|_| USAGE.to_string())?;
    Ok(Args { base, head, repo, json, coverage, trend, no_cache })
}

fn git(repo: &Path, args: &[&str], envs: &[(&str, &Path)]) -> Result<Vec<u8>, String> {
    let mut c = Command::new("git");
    c.arg("-C").arg(repo).args(args);
    for (k, v) in envs {
        c.env(k, v);
    }
    let out = c.output().map_err(|e| format!("cannot run git: {e}"))?;
    if !out.status.success() {
        return Err(format!("git {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(out.stdout)
}

fn resolve(repo: &Path, rev: &str) -> Result<String, String> {
    let spec = format!("{rev}^{{commit}}");
    let out = git(repo, &["rev-parse", "--verify", "--end-of-options", &spec], &[])?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}

/// A scratch directory removed on drop.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Result<Self, String> {
        let p = std::env::temp_dir().join(format!("pulsar-delta-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        Ok(Scratch(p))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Timing of one evaluation, for the stderr line.
#[derive(Default)]
struct Timing {
    checkout_ms: u128,
    facts_ms: u128,
    engine_ms: u128,
    cache: &'static str,
}

/// One function's measured values (`FM`), keyed by its `FK` key, for trend lines.
#[derive(Clone)]
struct Measure {
    path: String,
    chain: String,
    line: u32,
    /// cyclomatic, nesting, npath, length
    m: [u64; 5],
}

const METRICS: [&str; 5] = ["cyclomatic", "nesting", "npath", "length", "cognitive"];

/// Everything one commit contributes to a delta.
struct Eval {
    findings: BTreeMap<u64, Finding>,
    measures: BTreeMap<u64, Measure>,
    timing: Timing,
    policy: Effective,
    degraded: Vec<Degraded>,
    coverage_reroot: Option<String>,
    /// Per active class rule, its number of call-site findings (`RCXN`, 0 when it has no line):
    /// a metric per sha, never a score.
    counts: BTreeMap<String, u64>,
}

/// The files of `sha`, repo-relative, from its tree object (no checkout).
fn list_tracked(repo: &Path, sha: &str) -> Result<Vec<String>, String> {
    let listing = git(repo, &["ls-tree", "-r", "-z", "--name-only", sha], &[])?;
    Ok(listing
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect())
}

/// Materialise all of `sha` into `tree` through a private index.
fn checkout(repo: &Path, sha: &str, scratch: &Scratch, tree: &Path) -> Result<(), String> {
    let index = scratch.0.join("index");
    git(repo, &["read-tree", sha], &[("GIT_INDEX_FILE", &index)])?;
    std::fs::create_dir_all(tree).map_err(|e| format!("{}: {e}", tree.display()))?;
    // `--work-tree` points git at the scratch tree, so this also works in a bare repository
    // and never touches the repository's own work tree.
    git(repo, &["--work-tree", &tree.to_string_lossy(), "checkout-index", "-a", "-f"], &[("GIT_INDEX_FILE", &index)])?;
    Ok(())
}

/// The files that decide policy and pack activation: `.pulsar/` policy, decisions and catalogs, and
/// every `package.json`. Reading these alone is enough to load the policy of a sha.
fn policy_paths(tracked: &[String]) -> Vec<&String> {
    tracked
        .iter()
        .filter(|p| {
            p.as_str() == ".pulsar/policy.toml"
                || p.as_str() == ".pulsar/decisions.toml"
                || (p.starts_with(".pulsar/catalogs/") && p.ends_with(".toml"))
                || p.as_str() == "package.json"
                || p.ends_with("/package.json")
        })
        .collect()
}

/// Write the policy files of `sha` into `tree`, read in one `git cat-file --batch` call.
fn write_policy_files(repo: &Path, sha: &str, tracked: &[String], tree: &Path) -> Result<(), String> {
    use std::io::{BufRead, Read, Write};
    let paths = policy_paths(tracked);
    if paths.is_empty() {
        return Ok(());
    }
    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["cat-file", "--batch"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run git: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("git cat-file has no stdin")?;
    let wanted: Vec<String> = paths.iter().map(|p| format!("{sha}:{p}\n")).collect();
    // A separate thread feeds the requests so a full pipe in either direction cannot deadlock.
    let feeder = std::thread::spawn(move || wanted.iter().try_for_each(|l| stdin.write_all(l.as_bytes())));
    let mut out = std::io::BufReader::new(child.stdout.take().ok_or("git cat-file has no stdout")?);
    for p in &paths {
        let mut head = String::new();
        out.read_line(&mut head).map_err(|e| format!("git cat-file: {e}"))?;
        let size: usize = head.split_whitespace().nth(2).and_then(|s| s.parse().ok()).ok_or_else(|| format!("{sha}:{p}: {}", head.trim()))?;
        let mut body = vec![0u8; size + 1];
        out.read_exact(&mut body).map_err(|e| format!("git cat-file: {e}"))?;
        body.pop();
        let dest = tree.join(p);
        std::fs::create_dir_all(dest.parent().unwrap_or(tree)).map_err(|e| format!("{}: {e}", dest.display()))?;
        std::fs::write(&dest, body).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    drop(out);
    let _ = feeder.join();
    let _ = child.wait();
    Ok(())
}

/// What the lanes produced for one sha: the file set and side tables, plus the lanes that ran on
/// weaker input. The facts text lives in a file beside it.
struct Built {
    set: driver::FactSet,
    tables: SideTables,
    degraded: Vec<Degraded>,
    /// The prefix coverage re-rooted report paths from, when a report came from another tree.
    coverage_reroot: Option<String>,
}

fn to_meta(b: &Built) -> cache::Meta {
    cache::Meta {
        files: b.set.files.clone(),
        prod: b.set.prod,
        fn_keys: b.set.fn_keys.clone(),
        fns: b.tables.fns.iter().map(|f| (f.file, f.start_line, f.end_line, f.parent, f.kind, f.chain.clone())).collect(),
        syms: b.tables.syms.clone(),
        rules: b.tables.rules.clone(),
        laws: b.tables.laws.clone(),
        effect: b.tables.effect.clone(),
        sql_names: b.tables.sql_names.clone(),
        sql_indexes: b.tables.sql_indexes.clone(),
        sql_sites: b.tables.sql_sites.clone(),
        degraded: b.degraded.iter().map(|d| (d.lane.to_string(), d.cause.clone())).collect(),
    }
}

fn from_meta(m: cache::Meta) -> Built {
    let lane = |l: &str| -> &'static str {
        match l {
            "rust" => "rust",
            "ts" => "ts",
            "bend" => "bend",
            other => Box::leak(other.to_string().into_boxed_str()),
        }
    };
    let mut tables = SideTables { paths: m.files.clone(), syms: m.syms, rules: m.rules, laws: m.laws, effect: m.effect, sql_names: m.sql_names, sql_indexes: m.sql_indexes, sql_sites: m.sql_sites, ..SideTables::default() };
    tables.fns = m
        .fns
        .into_iter()
        .map(|(file, start_line, end_line, parent, kind, chain)| crate::facts::FnEntry { file, start_line, end_line, parent, kind, chain })
        .collect();
    Built {
        set: driver::FactSet { files: m.files, prod: m.prod, fn_keys: m.fn_keys },
        tables,
        degraded: m.degraded.into_iter().map(|(l, cause)| Degraded { lane: lane(&l), cause }).collect(),
        // A cache entry never carries coverage: a run with `--coverage` is never cached.
        coverage_reroot: None,
    }
}

/// A cached derived entry: its facts go to `facts_path`, its tables come back.
fn load_entry(cache: &Cache, rel: &str, facts_path: &Path) -> Option<Built> {
    let bytes = cache.get(rel)?;
    let (meta, facts) = cache::decode(&bytes)?;
    std::fs::write(facts_path, facts).ok()?;
    Some(from_meta(meta))
}

/// Run the lanes on a full checkout of `sha` and write the facts to `facts_path`.
fn build_fresh(
    repo: &Path,
    sha: &str,
    scratch: &Scratch,
    tree: &Path,
    tracked: Vec<String>,
    eff: &Effective,
    coverage: Option<&Path>,
    discover: bool,
    facts_path: &Path,
) -> Result<Built, String> {
    checkout(repo, sha, scratch, tree)?;
    let mut w = FactWriter::new();
    let mut tables = SideTables {
        sql_rules: eff.sql_rule_codes(),
        binding_rules: eff.binding_rule_codes(),
        composites: eff.composites(),
        untested: eff.untested_on(),
        ..SideTables::default()
    };
    let (set, dstats) = driver::build(tree, tracked, &eff.policy.lanes, &eff.active_rules(), &mut w, &mut tables)?;
    let mut coverage_reroot = None;
    if coverage.is_some() || discover {
        // The report is read from the worktree at `repo`, never from the scratch checkout. With no
        // explicit path, `discover` looks for one at the repo root, as `pulsar facts` does.
        let stats = coverage::emit(repo, coverage, &tables, &mut w)?;
        coverage_reroot = stats.rerooted_prefix;
        if stats.reports > 0 {
            eprintln!("pulsar: coverage read {}", stats.report_paths.join(", "));
        }
    }
    let mut f = std::fs::File::create(facts_path).map_err(|e| format!("{}: {e}", facts_path.display()))?;
    w.write_to(&mut f)?;
    Ok(Built { set, tables, degraded: dstats.degraded, coverage_reroot })
}

/// Add a finding; a key collision between two distinct findings is an error, never a silent merge.
fn insert(out: &mut BTreeMap<u64, Finding>, finding: Finding, sha: &str) -> Result<(), String> {
    let key = finding.key();
    match out.insert(key, finding) {
        Some(prev) => Err(format!("finding key {} collides for two findings at {sha}: {}", hex(key), prev.evidence_text)),
        None => Ok(()),
    }
}

fn cycle_findings(found: &Findings, files: &[String]) -> Vec<Finding> {
    found
        .cycles
        .iter()
        .map(|members| {
            let mut paths: Vec<&str> = members.iter().map(|&i| files[i as usize].as_str()).collect();
            paths.sort_unstable();
            let subjects = paths.iter().map(|p| Subject::File { key: stable_key(p), path: (*p).to_string() }).collect();
            Finding::new(
                IMPORT_CYCLE,
                subjects,
                paths[0].to_string(),
                None,
                format!("cycle of {} files: {}", paths.len(), paths.join(", ")),
                json!({ "size": paths.len(), "members": paths }),
            )
        })
        .collect()
}

/// One function's measured values and where it lives, from the engine's `FM` and the `.fns` table.
/// The second value counts the functions that could not be looked up (no `FM` row, no head key or
/// an unknown file), so the caller can report them instead of dropping them silently.
fn measures(found: &Findings, files: &[String], tables: &SideTables, keys: &[u64]) -> (BTreeMap<u64, Measure>, usize) {
    let mut out = BTreeMap::new();
    let mut missing = 0;
    for (i, entry) in tables.fns.iter().enumerate() {
        let (Some(m), Some(key), Some(path)) = (found.fm.get(i), keys.get(i), files.get(entry.file as usize)) else {
            missing += 1;
            continue;
        };
        out.insert(*key, Measure { path: path.clone(), chain: entry.chain.clone(), line: entry.start_line, m: *m });
    }
    (out, missing)
}

fn metric_findings(
    found: &Findings,
    measures: &BTreeMap<u64, Measure>,
    tables: &SideTables,
    keys: &[u64],
    disabled: &[String],
    enabled: &[String],
) -> Result<Vec<Finding>, String> {
    let mut out = Vec::new();
    for x in &found.fx {
        let rule = metric_rule(&x.rule)?;
        if disabled.iter().any(|r| r == rule.id) || (off_by_default(&rule) && !enabled.iter().any(|r| r == rule.id)) {
            continue;
        }
        let entry = tables.fns.get(x.fn_id as usize).ok_or_else(|| format!("FX names function {} but only {} exist", x.fn_id, tables.fns.len()))?;
        let key = *keys.get(x.fn_id as usize).ok_or("FX function has no FK key")?;
        let me = measures.get(&key).ok_or("FX function has no FM row")?;
        let [cc, nest, npath, len, cog] = me.m;
        let cap = if x.rule == "core.npath" && x.value >= 16_777_215 { "+ (at least the cap)" } else { "" };
        let tail: String = x.extra.iter().map(|(k, v)| format!(" {k}={v}")).collect();
        let extra: serde_json::Map<String, Value> = x.extra.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
        let finding = Finding::new(
            rule,
            vec![Subject::Function { key, path: me.path.clone(), chain: me.chain.clone() }],
            me.path.clone(),
            Some(me.chain.clone()),
            format!(
                "{} {}{cap} > {} [cyclomatic {cc} nesting {nest} npath {npath} length {len} cognitive {cog}]{tail}",
                rule.id.trim_start_matches("core."),
                x.value,
                x.threshold
            ),
            json!({ "value": x.value, "threshold": x.threshold, "extra": extra,
                    "metrics": { "cyclomatic": cc, "nesting": nest, "npath": npath, "length": len, "cognitive": cog },
                    "lines": [entry.start_line, entry.end_line] }),
        );
        out.push(finding.at_line(me.line));
    }
    Ok(out)
}

/// The `RCXN` count of every active class rule, by rule id; a rule without a line has none.
fn rule_counts(found: &Findings, rules: &[crate::policy::ActiveRule]) -> BTreeMap<String, u64> {
    let mut out: BTreeMap<String, u64> = rules.iter().map(|r| (r.id.clone(), 0)).collect();
    for &(rule_id, n) in &found.rcxn {
        if let Some(r) = rules.get(rule_id as usize) {
            out.insert(r.id.clone(), n);
        }
    }
    out
}

/// One metric line per active class rule: its call-site count at base and at head (`off` when the
/// rule was not on at base). A measurement, never a finding, and never part of the exit code.
fn render_counts(before: &Eval, after: &Eval, as_json: bool) -> String {
    let mut out = String::new();
    for (rule, &h) in &after.counts {
        let b = before.counts.get(rule).copied();
        if as_json {
            out.push_str(&format!("{}\n", json!({"type":"metric","rule":rule,"what":"call sites","base":b,"head":h})));
        } else {
            let base = b.map_or("off".to_string(), |n| n.to_string());
            out.push_str(&format!("# metric {rule} call sites: base={base} head={h}\n"));
        }
    }
    out
}

/// Class-in-context findings: a function that calls a symbol of a class an active rule forbids in
/// that context. One finding per (rule, function, callee): several call sites of the same callee in
/// one function are one finding with a count, so the key never depends on a per-run site id.
fn class_context_findings(
    found: &Findings,
    measures: &BTreeMap<u64, Measure>,
    tables: &SideTables,
    keys: &[u64],
    rules: &[crate::policy::ActiveRule],
) -> (Vec<Finding>, usize) {
    let mut groups: BTreeMap<(u32, u32, u32), usize> = BTreeMap::new();
    for x in &found.rcx {
        *groups.entry((x.rule, x.fn_id, x.callee)).or_default() += 1;
    }
    let (mut out, mut dropped) = (Vec::new(), 0);
    for ((rule_id, fn_id, callee), sites) in groups {
        let looked_up = (rules.get(rule_id as usize), keys.get(fn_id as usize), tables.syms.get(callee as usize));
        let (Some(rule), Some(&fn_key), Some(name)) = looked_up else {
            dropped += 1;
            continue;
        };
        let Some(me) = measures.get(&fn_key) else {
            dropped += 1;
            continue;
        };
        let sym_key = crate::lang::functions::fnv_parts(&[name.as_bytes()]);
        let finding = Finding::new(
            catalog_rule(&rule.id, rule.version),
            vec![
                Subject::Function { key: fn_key, path: me.path.clone(), chain: me.chain.clone() },
                Subject::Symbol { key: sym_key, name: name.clone() },
            ],
            me.path.clone(),
            Some(me.chain.clone()),
            format!("{}: {name} (x{sites})", rule.says),
            json!({ "callee": name, "sites": sites, "says": rule.says }),
        );
        out.push(finding.at_line(me.line));
    }
    (out, dropped)
}

/// The `tag` rows of a facts file as numbers (at least `arity` of them), and how many rows of that
/// tag did not parse. A file that cannot be read is an error the caller reports.
fn read_tagged(facts_path: &Path, tag: &str, arity: usize) -> Result<(Vec<Vec<u32>>, usize), String> {
    let text = std::fs::read_to_string(facts_path).map_err(|e| format!("{}: {e}", facts_path.display()))?;
    let prefix = format!("{tag} ");
    let (mut rows, mut bad) = (Vec::new(), 0);
    for r in text.lines().filter_map(|l| l.strip_prefix(prefix.as_str())) {
        match r.split(' ').map(|t| t.parse::<u32>()).collect::<Result<Vec<_>, _>>() {
            Ok(n) if n.len() >= arity => rows.push(n),
            _ => bad += 1,
        }
    }
    Ok((rows, bad))
}

/// The lookup a section needs, or nothing plus a degraded notice saying which lookup failed. Never
/// silent: the section's findings are then built on less than the facts hold.
fn lookup<T: Default>(what: &'static str, lane: &'static str, r: Result<(T, usize), String>, degraded: &mut Vec<Degraded>) -> T {
    match r {
        Ok((v, 0)) => v,
        Ok((v, bad)) => {
            degraded.push(Degraded { lane, cause: format!("{bad} {what} row(s) in the facts did not parse and were skipped") });
            v
        }
        Err(e) => {
            degraded.push(Degraded { lane, cause: format!("{what} rows could not be read ({e}); findings that need them are not reported") });
            T::default()
        }
    }
}

/// `DT table file flags` rows of a facts file: table name id -> file id of its definition.
fn read_table_defs(facts_path: &Path) -> Result<(BTreeMap<u32, u32>, usize), String> {
    let (rows, bad) = read_tagged(facts_path, "DT", 2)?;
    Ok((rows.iter().map(|n| (n[0], n[1])).collect(), bad))
}

/// `QS site file fn node kind flags` rows of a facts file: query site -> function id (sites in a
/// `.sql` file have none and are left out).
fn read_query_fns(facts_path: &Path) -> Result<(BTreeMap<u32, u32>, usize), String> {
    let (rows, bad) = read_tagged(facts_path, "QS", 6)?;
    Ok((rows.iter().filter(|n| n[2] != u32::MAX).map(|n| (n[0], n[2])).collect(), bad))
}

/// `RT root file fn` rows of a facts file: where each Effect root is built.
fn read_roots(facts_path: &Path) -> Result<(Vec<layers::Root>, usize), String> {
    let (rows, bad) = read_tagged(facts_path, "RT", 3)?;
    Ok((rows.iter().map(|n| layers::Root { root: n[0], file: n[1], fn_id: n[2] }).collect(), bad))
}

/// The engine's findings for a facts file: from the cache when this engine already ran on these
/// facts, otherwise from a run whose output is cached.
fn engine_findings(cache: Option<&Cache>, derived: &str, facts_path: &Path) -> Result<Findings, String> {
    let engine_path = engine::locate()?;
    let rel = Cache::engine_rel(derived, &engine_path);
    if let Some(text) = cache.and_then(|c| c.get(&rel)) {
        if let Ok(found) = engine::parse(&String::from_utf8_lossy(&text)) {
            return Ok(found);
        }
    }
    let text = engine::run_raw(&engine_path, facts_path)?;
    let found = engine::parse(&text)?;
    if let (Some(c), true) = (cache, found.cert != Some(false)) {
        let _ = c.put(&rel, text.as_bytes());
    }
    Ok(found)
}

/// The org policy file, the one policy input that is not part of a sha (for the cache key).
fn org_policy_bytes() -> Option<Vec<u8>> {
    std::fs::read(std::env::var_os("HOME").map(PathBuf::from)?.join(".pulsar/policy.toml")).ok()
}

/// All findings and measures of one commit.
/// Does this evaluation read a coverage report? Explicitly given, or discovered at the repo root
/// (head only) when one is there. Such a run is never cached: a cached entry carries no coverage.
fn reads_coverage(explicit: bool, discover: bool, found: bool) -> bool {
    explicit || (discover && found)
}

fn evaluate(repo: &Path, sha: &str, tag: &str, coverage: Option<&Path>, discover: bool, use_cache: bool) -> Result<Eval, String> {
    let mut timing = Timing::default();
    let scratch = Scratch::new(tag)?;
    let tree = scratch.0.join("tree");
    let t0 = Instant::now();
    let tracked = list_tracked(repo, sha)?;
    // The policy is the one committed in this sha, so a decision counts only once it is in the tree.
    write_policy_files(repo, sha, &tracked, &tree)?;
    let ev = policy::gather_evidence(&tree, &tracked);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let eff = policy::load(&tree, home.as_deref(), &ev)?;
    let active = eff.active_rules();
    timing.checkout_ms = t0.elapsed().as_millis();

    // A report describes one checkout, so a run with coverage is never cached.
    let found = discover && coverage.is_none() && coverage::has_report(repo);
    let reads = reads_coverage(coverage.is_some(), discover, found);
    if discover && coverage.is_none() && !found {
        eprintln!("pulsar: coverage none found at the repo root (pass --coverage <file|dir>)");
    }
    let cache = if use_cache && !reads { Cache::open(repo) } else { None };
    let rel = Cache::derived_rel(sha, org_policy_bytes().as_deref());
    let facts_path = scratch.0.join("facts.txt");
    let t1 = Instant::now();
    let cached = cache.as_ref().and_then(|c| load_entry(c, &rel, &facts_path));
    let hit = cached.is_some();
    let built = match cached {
        Some(b) => b,
        None => {
            let b = build_fresh(repo, sha, &scratch, &tree, tracked, &eff, coverage, discover, &facts_path)?;
            if let Some(c) = &cache {
                let facts = std::fs::read(&facts_path).map_err(|e| format!("{}: {e}", facts_path.display()))?;
                if let Err(e) = c.put(&rel, &cache::encode(&to_meta(&b), &facts)) {
                    eprintln!("pulsar: cache write failed: {e}");
                }
            }
            b
        }
    };
    timing.facts_ms = t1.elapsed().as_millis();
    timing.cache = if cache.is_none() { "off" } else if hit { "hit" } else { "miss" };
    let Built { set, tables, degraded, coverage_reroot } = built;

    let t2 = Instant::now();
    let found = engine_findings(cache.as_ref(), &rel, &facts_path)?;
    // The cycle findings are only complete when the engine certifies it: a missing CERT line refuses.
    if found.cert != Some(true) {
        return Err(format!("engine certificate {} at {sha}", if found.cert.is_none() { "line is missing" } else { "check failed" }));
    }
    timing.engine_ms = t2.elapsed().as_millis();

    let (measures, unmeasured) = measures(&found, &set.files, &tables, &set.fn_keys);
    let disabled = &eff.policy.rules.disable;
    let mut findings = BTreeMap::new();
    if !disabled.iter().any(|r| r == IMPORT_CYCLE.id) {
        for f in cycle_findings(&found, &set.files) {
            insert(&mut findings, f, sha)?;
        }
    }
    let (class_findings, dropped) = class_context_findings(&found, &measures, &tables, &set.fn_keys, &active);
    for f in class_findings {
        insert(&mut findings, f, sha)?;
    }
    let mut degraded = degraded;
    if unmeasured > 0 {
        degraded.push(Degraded {
            lane: "measures",
            cause: format!("{unmeasured} function(s) have no measure row, head key or file; they are missing from trends and metric findings"),
        });
    }
    let (comp_findings, comp_dropped) = compfind::findings(&found, &tables, &set.files, &set.fn_keys, &eff.composites());
    for f in comp_findings {
        insert(&mut findings, f, sha)?;
    }
    let comp = eff.composites();
    let site_fns = if found.gx.is_empty() { BTreeMap::new() } else { lookup("query site (QS)", "composites", read_query_fns(&facts_path), &mut degraded) };
    let (growth_findings, growth_dropped) = compfind::growth(&found, &tables, &set.files, &set.fn_keys, &comp, &site_fns);
    for f in growth_findings {
        insert(&mut findings, f, sha)?;
    }
    if let (Some((_, skipped, false)), false) = (found.grow_schema, comp.growths.is_empty()) {
        degraded.push(Degraded {
            lane: "sql",
            cause: format!("{skipped} DDL statement(s) could not be parsed or are not modelled, so the schema is incomplete; unbounded-growth rules report nothing"),
        });
    }
    let (untested_findings, untested_dropped) = compfind::untested(&found, &tables, &set.files, &set.fn_keys);
    for f in untested_findings {
        insert(&mut findings, f, sha)?;
    }
    let comp_dropped = comp_dropped + growth_dropped + untested_dropped;
    if comp_dropped > 0 {
        degraded.push(Degraded {
            lane: "composites",
            cause: format!("{comp_dropped} fan-out, constant-argument, hot-path, call-edge or module finding(s) named a rule, function, symbol or base finding the CLI could not resolve and are not reported"),
        });
    }
    if dropped > 0 {
        // Never drop silently: a finding the CLI could not name is reported as degraded input.
        degraded.push(Degraded {
            lane: "class-context",
            cause: format!("{dropped} class-in-context finding(s) named a rule, function or symbol the CLI could not resolve and are not reported"),
        });
    }
    if let Some(s) = &found.sql {
        let defs = lookup("table definition (DT)", "sql", read_table_defs(&facts_path), &mut degraded);
        let (sql_findings, notices) = sqlfind::findings(s, &tables, &set.files, &defs, disabled)?;
        for f in sql_findings {
            insert(&mut findings, f, sha)?;
        }
        degraded.extend(notices);
    }
    if let Some(b) = &found.binding {
        let (bf, notices) = infrafind::findings(b, &tables)?;
        for f in bf {
            insert(&mut findings, f, sha)?;
        }
        degraded.extend(notices);
    }
    if let Some(l) = &found.layers {
        if l.cert != Some(true) {
            return Err(format!("engine layer certificate (LCERT) is {} at {sha}", if l.cert.is_none() { "missing" } else { "0" }));
        }
        let names = layers::parse_names(&tables.effect)?;
        let roots = lookup("Effect root (RT)", "effect", read_roots(&facts_path), &mut degraded);
        let ctx = layers::Ctx { names: &names, roots: &roots, files: &set.files, tables: &tables, keys: &set.fn_keys };
        let (layer_findings, notices) = layers::findings(l, &ctx, disabled)?;
        for f in layer_findings {
            insert(&mut findings, f, sha)?;
        }
        degraded.extend(notices);
    }
    for f in metric_findings(&found, &measures, &tables, &set.fn_keys, disabled, &eff.policy.rules.enable)? {
        insert(&mut findings, f, sha)?;
    }
    let counts = rule_counts(&found, &active);
    Ok(Eval { findings, measures, timing, policy: eff, degraded, coverage_reroot, counts })
}

/// The functions `pulsar delta` reports trends for, each as (head key, base measure, head measure):
/// the same key, or the same symbol in a file git renamed. By default only functions with a metric
/// finding on either side; with `all`, every function. Their `MB`/`MH` rows go to the engine under
/// the head key, so a renamed function compares as one.
fn tracked<'a>(before: &'a Eval, after: &'a Eval, renames: &Renames, all: bool) -> Vec<(u64, &'a Measure, &'a Measure)> {
    let flagged = |e: &Eval| -> BTreeSet<u64> {
        e.findings
            .values()
            .filter(|f| f.rule.id.starts_with("core.") && !needs_coverage(&f.rule))
            .flat_map(|f| f.subjects.iter())
            .filter_map(|s| match s {
                Subject::Function { key, .. } => Some(*key),
                Subject::File { .. } | Subject::Symbol { .. } => None,
            })
            .collect()
    };
    let (fb, fa) = (flagged(before), flagged(after));
    // Base functions by (head path, symbol), for the ones whose key changed with a rename. A
    // (path, symbol) that two functions share is ambiguous and not matched.
    let mut by_place: BTreeMap<(&str, &str), Vec<(&u64, &Measure)>> = BTreeMap::new();
    for (k, m) in &before.measures {
        by_place.entry((renames.head_path(&m.path), m.chain.as_str())).or_default().push((k, m));
    }
    let mut out = Vec::new();
    for (key, new) in &after.measures {
        let found = match before.measures.get(key) {
            Some(m) => Some((key, m)),
            None => match by_place.get(&(new.path.as_str(), new.chain.as_str())).map(Vec::as_slice) {
                Some([(k, m)]) if !after.measures.contains_key(*k) => Some((*k, *m)),
                _ => None,
            },
        };
        let Some((base_key, old)) = found else { continue };
        if all || fb.contains(base_key) || fa.contains(key) {
            out.push((*key, old, new));
        }
    }
    out
}

/// The trend lines from the engine's worsened (`KDW`) and improved (`KDI`) measures, one per
/// function in key order: worsened when any of its measures rose, else improved.
fn group_trends(after: &Eval, worse: &[delta_engine::Move], better: &[delta_engine::Move]) -> Result<Vec<Trend>, String> {
    let mut by_fn: BTreeMap<u64, (bool, Vec<(u32, u64, u64)>)> = BTreeMap::new();
    for (moves, w) in [(worse, true), (better, false)] {
        for &(k, m, vb, vh) in moves {
            let e = by_fn.entry(k).or_default();
            e.0 |= w;
            e.1.push((m, vb, vh));
        }
    }
    by_fn
        .into_iter()
        .map(|(key, (worse, mut ch))| {
            ch.sort_unstable();
            let head = after.measures.get(&key).ok_or_else(|| format!("engine delta names function {} that head does not measure", hex(key)))?;
            let changes = ch
                .into_iter()
                .map(|(m, o, n)| METRICS.get(m as usize).map(|name| (*name, o, n)).ok_or_else(|| format!("engine delta names metric {m}")))
                .collect::<Result<_, _>>()?;
            Ok(Trend { key, head: head.clone(), changes, worse })
        })
        .collect()
}

/// A function whose measured values moved between base and head. Measurement only.
struct Trend {
    key: u64,
    head: Measure,
    /// (metric, old, new) for every metric that changed.
    changes: Vec<(&'static str, u64, u64)>,
    worse: bool,
}

impl Trend {
    fn label(&self) -> &'static str {
        if self.worse { "worsened" } else { "improved" }
    }
    fn arrows(&self) -> String {
        self.changes.iter().map(|(m, o, n)| format!("{m} {o} -> {n}")).collect::<Vec<_>>().join(", ")
    }
    fn json(&self) -> Value {
        let metrics: serde_json::Map<String, Value> =
            self.changes.iter().map(|(m, o, n)| ((*m).to_string(), json!({"old": o, "new": n}))).collect();
        json!({"type":"trend","change":self.label(),"key":hex(self.key),"file":self.head.path,
               "line":self.head.line,"symbol":self.head.chain,"metrics":metrics})
    }
}

/// The comparison: what was added, allowed by a decision, removed, or only measured.
struct Diff<'a> {
    added: Vec<&'a Finding>,
    allowed: Vec<&'a Finding>,
    removed: Vec<&'a Finding>,
    coverage: Vec<&'a Finding>,
    unchanged: usize,
    trends: Vec<Trend>,
    degraded: Vec<(&'static str, &'a Degraded)>,
    /// Files git saw renamed between base and head.
    renamed_files: usize,
    /// Findings that moved with a renamed file and were matched, not reported as removed plus added.
    renamed_findings: usize,
    /// Removed plus added pairs that look like one function moved to another file (not followed).
    unmatched_moves: usize,
    /// Rules whose version changed between base and head: (rule, old, new, findings re-keyed).
    rule_version_changed: Vec<(String, u32, u32, usize)>,
}

/// The comparison, decided by the engine's delta section (`engine/Delta.bend`). It runs twice: the
/// first run, on the raw keys, gives the findings on one side only, which are the candidates for
/// git's rename matching; the second, with matched base findings written under their head keys
/// and the tracked functions' measures, gives everything that is printed.
fn compare<'a>(before: &'a Eval, after: &'a Eval, renames: &Renames, trend_all: bool, run: &dyn Fn(&Rows, &str) -> Result<delta_engine::Out, String>) -> Result<Diff<'a>, String> {
    let cls = |f: &Finding| {
        if needs_coverage(&f.rule) {
            delta_engine::COVERAGE
        } else if after.policy.allowed(&hex(f.key())).is_some() {
            delta_engine::ALLOWED
        } else {
            delta_engine::PLAIN
        }
    };
    let rows = |to_head: &BTreeMap<u64, u64>| {
        let mut r = Rows::new();
        for k in before.findings.keys() {
            r.base(*to_head.get(k).unwrap_or(k));
        }
        for (k, f) in &after.findings {
            r.head(*k, cls(f));
        }
        r
    };
    let pick = |side: &'a BTreeMap<u64, Finding>, keys: &[u64]| -> Result<Vec<&'a Finding>, String> {
        keys.iter().map(|k| side.get(k).ok_or_else(|| format!("engine delta names finding {} that is not there", hex(*k)))).collect()
    };
    let one_side = run(&rows(&BTreeMap::new()), "keys.facts")?;
    let gone = pick(&before.findings, &one_side.removed)?;
    let new = pick(&after.findings, &[one_side.added, one_side.allowed].concat())?;
    // A finding whose key changed only because git renamed its file is the same finding.
    let pairs = rename::match_findings(&gone, &new, renames);
    let mut r = rows(&pairs.iter().copied().collect());
    // Only the measures that differ are written: an equal pair yields no KDW or KDI line, so the
    // engine's output is the same, and the rows grow with what the change touched, not with the
    // number of functions in the repo (`--trend` tracks all of them).
    for (k, old, new) in tracked(before, after, renames, trend_all) {
        for (i, (o, n)) in old.m.iter().zip(new.m).enumerate().filter(|(_, (o, n))| **o != *n) {
            r.measure_base(k, i as u32, *o)?;
            r.measure_head(k, i as u32, n)?;
        }
    }
    let o = run(&r, "delta.facts")?;
    let (added, allowed, removed) = (pick(&after.findings, &o.added)?, pick(&after.findings, &o.allowed)?, pick(&before.findings, &o.removed)?);
    let unmatched_moves = rename::unmatched_moves(&removed, &[added.as_slice(), allowed.as_slice()].concat());
    let rule_version_changed = version_changes(&pairs, &before.findings, &after.findings);
    let degraded = before.degraded.iter().map(|d| ("base", d)).chain(after.degraded.iter().map(|d| ("head", d))).collect();
    Ok(Diff {
        added,
        allowed,
        removed,
        coverage: pick(&after.findings, &o.coverage)?,
        unchanged: o.unchanged,
        trends: group_trends(after, &o.worse, &o.better)?,
        degraded,
        renamed_files: renames.count(),
        renamed_findings: pairs.len() - rule_version_changed.iter().map(|v| v.3).sum::<usize>(),
        unmatched_moves,
        rule_version_changed,
    })
}

/// The rules whose version differs between a matched base and head finding, with how many findings
/// were re-keyed by it (so they are neither removed nor added).
fn version_changes(pairs: &[(u64, u64)], before: &BTreeMap<u64, Finding>, after: &BTreeMap<u64, Finding>) -> Vec<(String, u32, u32, usize)> {
    let mut by_rule: BTreeMap<(String, u32, u32), usize> = BTreeMap::new();
    for (b, h) in pairs {
        let (Some(old), Some(new)) = (before.get(b), after.get(h)) else { continue };
        if old.rule.version != new.rule.version {
            *by_rule.entry((old.rule.id.to_string(), old.rule.version, new.rule.version)).or_default() += 1;
        }
    }
    by_rule.into_iter().map(|((rule, old, new), n)| (rule, old, new, n)).collect()
}

impl Diff<'_> {
    fn count(&self, worse: bool) -> usize {
        self.trends.iter().filter(|t| t.worse == worse).count()
    }
}

fn render_text(d: &Diff, after: &Eval, base: &str, head: &str) -> String {
    let reason = |f: &Finding| after.policy.allowed(&hex(f.key())).map(|x| x.reason.clone()).unwrap_or_default();
    let mut out = String::new();
    for (side, g) in &d.degraded {
        out.push_str(&format!("! DEGRADED INPUT ({side}) {}: {}\n", g.lane, g.cause));
    }
    for f in &d.added {
        out.push_str(&format!("+ {}\n", f.text()));
    }
    for f in &d.allowed {
        out.push_str(&format!("~ {}  [allowed: {}]\n", f.text(), reason(f)));
    }
    for f in &d.removed {
        out.push_str(&format!("- {}\n", f.text()));
    }
    for f in &d.coverage {
        out.push_str(&format!("? {}  [head only, needs coverage]\n", f.text()));
    }
    for t in &d.trends {
        out.push_str(&format!(
            "~ {} {} {}:{} {}  {}\n",
            t.label(),
            hex(t.key),
            t.head.path,
            t.head.line,
            t.head.chain,
            t.arrows()
        ));
    }
    out.push_str(&format!(
        "# base={} head={} added={} allowed={} removed={} unchanged={} worsened={} improved={} degraded={} coverage={} renamed_files={} renamed_findings={} unmatched_moves={}{}\n",
        &base[..12],
        &head[..12],
        d.added.len(),
        d.allowed.len(),
        d.removed.len(),
        d.unchanged,
        d.count(true),
        d.count(false),
        d.degraded.len(),
        d.coverage.len(),
        d.renamed_files,
        d.renamed_findings,
        d.unmatched_moves,
        d.rule_version_changed.iter().map(|(r, o, n, k)| format!(" rule_version_changed={r} {o}->{n} rekeyed={k}")).collect::<String>()
    ));
    out
}

fn render_json(d: &Diff, after: &Eval, base: &str, head: &str) -> String {
    let mut lines: Vec<Value> = Vec::new();
    for (side, g) in &d.degraded {
        lines.push(json!({"type":"degraded","side":side,"lane":g.lane,"cause":g.cause}));
    }
    lines.extend(d.added.iter().map(|f| f.json("added")));
    for f in &d.allowed {
        let mut v = f.json("allowed");
        v["reason"] = json!(after.policy.allowed(&hex(f.key())).map(|x| x.reason.clone()).unwrap_or_default());
        lines.push(v);
    }
    lines.extend(d.removed.iter().map(|f| f.json("removed")));
    lines.extend(d.coverage.iter().map(|f| f.json("coverage")));
    lines.extend(d.trends.iter().map(Trend::json));
    lines.push(json!({"type":"summary","base":base,"head":head,"added":d.added.len(),"allowed":d.allowed.len(),
        "removed":d.removed.len(),"unchanged":d.unchanged,"worsened":d.count(true),"improved":d.count(false),
        "degraded":d.degraded.len(),"coverage":d.coverage.len(),"coverage_reroot":after.coverage_reroot,
        "renamed_files":d.renamed_files,"renamed_findings":d.renamed_findings,"unmatched_moves":d.unmatched_moves,
        "rule_version_changed":d.rule_version_changed.iter().map(|(r, o, n, k)| json!({"rule":r,"old":o,"new":n,"rekeyed":k})).collect::<Vec<_>>(),
        "policy":after.policy.fingerprint}));
    lines.iter().map(|l| format!("{l}\n")).collect()
}

/// Returns the process exit code: 0 none added, 1 added.
pub fn run(a: &Args) -> Result<u8, String> {
    let base = resolve(&a.repo, &a.base)?;
    let head = resolve(&a.repo, &a.head)?;
    let before = evaluate(&a.repo, &base, "base", None, false, !a.no_cache)?;
    let after = evaluate(&a.repo, &head, "head", a.coverage.as_deref(), true, !a.no_cache)?;
    eprintln!("pulsar: {}", after.policy.summary());
    for (name, sha, e) in [("base", &base, &before), ("head", &head, &after)] {
        let t = &e.timing;
        eprintln!("pulsar: {name} {} cache={} policy={}ms facts={}ms engine={}ms", &sha[..12], t.cache, t.checkout_ms, t.facts_ms, t.engine_ms);
    }
    let renames = rename::detect(&a.repo, &base, &head)?;
    let engine = engine::locate()?;
    let scratch = Scratch::new("engine")?;
    let diff = compare(&before, &after, &renames, a.trend, &|rows, name| delta_engine::run(&engine, rows, &scratch.0, name))?;
    let body = if a.json { render_json(&diff, &after, &base, &head) } else { render_text(&diff, &after, &base, &head) };
    print!("{}{body}", render_counts(&before, &after, a.json));
    Ok(if diff.added.is_empty() { 0 } else { 1 })
}

#[cfg(test)]
mod version_tests {
    use super::*;
    use crate::finding::{Rule, CYCLOMATIC, NESTING};

    fn f(rule: Rule, chain: &str) -> Finding {
        Finding::new(
            rule,
            vec![Subject::Function { key: 1, path: "a.ts".into(), chain: chain.into() }],
            "a.ts".into(),
            Some(chain.into()),
            String::new(),
            json!({}),
        )
    }

    #[test]
    fn a_rule_version_bump_is_reported_per_rule_with_the_number_of_rekeyed_findings() {
        let (v1, v2) = (Rule { version: 1, ..CYCLOMATIC }, Rule { version: 2, ..CYCLOMATIC });
        let (b1, b2, b3) = (f(v1, "f"), f(v1, "g"), f(NESTING, "h"));
        let (h1, h2, h3) = (f(v2, "f"), f(v2, "g"), f(NESTING, "h"));
        let pairs = vec![(b1.key(), h1.key()), (b2.key(), h2.key()), (b3.key(), h3.key())];
        let before: BTreeMap<u64, Finding> = [b1, b2, b3].into_iter().map(|x| (x.key(), x)).collect();
        let after: BTreeMap<u64, Finding> = [h1, h2, h3].into_iter().map(|x| (x.key(), x)).collect();
        assert_eq!(version_changes(&pairs, &before, &after), vec![("core.cyclomatic".to_string(), 1, 2, 2)]);
        assert!(version_changes(&[], &before, &after).is_empty());
    }
}

#[cfg(test)]
mod lookup_tests {
    use super::*;

    fn facts(text: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("pulsar-lookup-test-{}-{}", std::process::id(), text.len()));
        std::fs::write(&p, text).unwrap();
        p
    }

    #[test]
    fn a_row_that_does_not_parse_is_counted_and_shown_as_degraded() {
        let p = facts("DT 1 2 0\nDT x 2 0\nDT 3\nRT 1 2 3\n");
        let mut d = Vec::new();
        let defs = lookup("table definition (DT)", "sql", read_table_defs(&p), &mut d);
        assert_eq!(defs.get(&1), Some(&2));
        assert_eq!(defs.len(), 1);
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].lane, d[0].cause.starts_with("2 table definition (DT) row(s)")), ("sql", true), "{d:?}");
        let mut d = Vec::new();
        assert_eq!(lookup("Effect root (RT)", "effect", read_roots(&p), &mut d).len(), 1);
        assert!(d.is_empty(), "clean rows add no notice");
    }

    #[test]
    fn an_unreadable_facts_file_is_degraded_not_empty_and_silent() {
        let mut d = Vec::new();
        let roots = lookup("Effect root (RT)", "effect", read_roots(Path::new("/nonexistent/pulsar.facts")), &mut d);
        assert!(roots.is_empty());
        assert_eq!(d.len(), 1);
        assert!(d[0].cause.contains("could not be read"), "{d:?}");
    }
}

#[cfg(test)]
mod coverage_discovery_tests {
    use super::*;

    #[test]
    fn head_reads_a_discovered_report_and_base_never_does() {
        assert!(reads_coverage(false, true, true), "head with a report at the root reads it");
        assert!(!reads_coverage(false, true, false), "no report found: nothing to read, the cache stays usable");
        assert!(!reads_coverage(false, false, true), "base never discovers, a report describes the worktree");
        assert!(reads_coverage(true, false, false), "an explicit path always reads");
        assert!(reads_coverage(true, true, true));
    }

    #[test]
    fn a_run_that_reads_coverage_has_no_cache() {
        // evaluate() opens the cache only when `use_cache && !reads`.
        for (explicit, discover, found) in [(true, true, true), (false, true, true), (true, false, false)] {
            assert!(reads_coverage(explicit, discover, found), "{explicit} {discover} {found}");
        }
        let repo = std::env::temp_dir().join(format!("pulsar-covdisc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&repo);
        std::fs::create_dir_all(repo.join("coverage")).unwrap();
        assert!(!coverage::has_report(&repo));
        std::fs::write(repo.join("coverage/lcov.info"), "SF:a.ts\nDA:1,1\nend_of_record\n").unwrap();
        assert!(coverage::has_report(&repo), "has_report sees the repo-root report discovery would read");
        let _ = std::fs::remove_dir_all(&repo);
    }
}
