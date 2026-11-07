//! `pulsar delta <base> <head>`: the findings a change added and removed.
//!
//! Each sha is evaluated from a private checkout: a temporary index plus `git checkout-index`
//! materialises the tree, so the repository's own index, worktree list and refs are never
//! written (many agents share one checkout). The checkout is deleted when evaluation ends.
//!
//! Limit: file subjects key on the path, so renaming a file or directory removes its findings and
//! adds them again under the new path (FACTS.md: keys never use lines, and rename tracking is not
//! part of a path key).

use crate::engine;
use crate::facts::{stable_key, FactWriter, SideTables};
use crate::coverage;
use crate::finding::{hex, metric_rule, needs_coverage, Finding, Subject, IMPORT_CYCLE};
use crate::driver;
use crate::lang::Degraded;
use crate::policy::{self, Effective};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

pub const USAGE: &str = "usage: pulsar delta <base> <head> [--repo dir] [--json] [--coverage file|dir]
  exit 0 = no finding added, 1 = at least one added, 2 = error
  --coverage reads a coverage report from the worktree and applies it to HEAD only (it describes the
    checked-out tree, so use it when <head> is what you have checked out and tested). Findings that
    need coverage (core.crap) are listed under `?` and never count toward exit 1.
  --json prints JSON lines (one per finding, then a summary line) instead of text";

pub struct Args {
    base: String,
    head: String,
    repo: PathBuf,
    json: bool,
    coverage: Option<PathBuf>,
}

pub fn parse(args: &[String]) -> Result<Args, String> {
    let mut pos = Vec::new();
    let mut repo = PathBuf::from(".");
    let mut json = false;
    let mut coverage = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "--coverage" => coverage = Some(PathBuf::from(it.next().ok_or("--coverage needs a value")?)),
            "--repo" => repo = PathBuf::from(it.next().ok_or("--repo needs a value")?),
            f if f.starts_with('-') => return Err(format!("unknown flag {f}\n{USAGE}")),
            _ => pos.push(a.clone()),
        }
    }
    let [base, head] = <[String; 2]>::try_from(pos).map_err(|_| USAGE.to_string())?;
    Ok(Args { base, head, repo, json, coverage })
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
}

/// All findings of one commit, keyed by finding key. A key collision between two distinct
/// findings is an error: delta must never merge them silently.
fn evaluate(repo: &Path, sha: &str, tag: &str, coverage: Option<&Path>) -> Result<(BTreeMap<u64, Finding>, Timing, Effective, Vec<Degraded>), String> {
    let mut t = Timing::default();
    let scratch = Scratch::new(tag)?;
    let tree = scratch.0.join("tree");
    let index = scratch.0.join("index");

    let t0 = Instant::now();
    git(repo, &["read-tree", sha], &[("GIT_INDEX_FILE", &index)])?;
    std::fs::create_dir_all(&tree).map_err(|e| format!("{}: {e}", tree.display()))?;
    // `--work-tree` points git at the scratch tree, so this also works in a bare repository
    // and never touches the repository's own work tree.
    git(
        repo,
        &["--work-tree", &tree.to_string_lossy(), "checkout-index", "-a", "-f"],
        &[("GIT_INDEX_FILE", &index)],
    )?;
    let listing = git(repo, &["ls-tree", "-r", "-z", "--name-only", sha], &[])?;
    let tracked: Vec<String> = listing
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect();
    t.checkout_ms = t0.elapsed().as_millis();
    // The policy is the one committed in this sha, so a decision counts only once it is in the tree.
    let ev = policy::gather_evidence(&tree, &tracked);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let eff = policy::load(&tree, home.as_deref(), &ev)?;

    let t1 = Instant::now();
    let mut w = FactWriter::new();
    let mut tables = SideTables::default();
    let (set, dstats) = driver::build(&tree, tracked, &eff.policy.lanes, &mut w, &mut tables)?;
    if let Some(c) = coverage {
        // The report is read from the worktree at `repo`, never from the scratch checkout.
        coverage::emit(repo, Some(c), &tables, &mut w)?;
    }
    let facts_path = scratch.0.join("facts.txt");
    let mut f = std::fs::File::create(&facts_path).map_err(|e| format!("{}: {e}", facts_path.display()))?;
    w.write_to(&mut f)?;
    drop(f);
    t.facts_ms = t1.elapsed().as_millis();

    let t2 = Instant::now();
    let found = engine::run(&engine::locate()?, &facts_path)?;
    if found.cert == Some(false) {
        return Err(format!("engine certificate check failed at {sha}"));
    }
    t.engine_ms = t2.elapsed().as_millis();

    let mut out: BTreeMap<u64, Finding> = BTreeMap::new();
    let insert = |out: &mut BTreeMap<u64, Finding>, finding: Finding, sha: &str| -> Result<(), String> {
        let key = finding.key();
        match out.insert(key, finding) {
            Some(prev) => Err(format!("finding key {} collides for two findings at {sha}: {}", hex(key), prev.evidence_text)),
            None => Ok(()),
        }
    };
    let cycles_on = !eff.policy.rules.disable.iter().any(|r| r == IMPORT_CYCLE.id);
    for members in found.cycles.iter().filter(|_| cycles_on) {
        let mut paths: Vec<&str> = members.iter().map(|&i| set.files[i as usize].as_str()).collect();
        paths.sort_unstable();
        let subjects = paths.iter().map(|p| Subject::File { key: stable_key(p), path: (*p).to_string() }).collect();
        let finding = Finding::new(
            IMPORT_CYCLE,
            subjects,
            paths[0].to_string(),
            None,
            format!("cycle of {} files: {}", paths.len(), paths.join(", ")),
            json!({ "size": paths.len(), "members": paths }),
        );
        insert(&mut out, finding, sha)?;
    }
    for x in &found.fx {
        let rule = metric_rule(&x.rule)?;
        if eff.policy.rules.disable.iter().any(|r| r == rule.id) {
            continue;
        }
        let entry = tables.fns.get(x.fn_id as usize).ok_or_else(|| format!("FX names function {} but only {} exist", x.fn_id, tables.fns.len()))?;
        let key = *set.fn_keys.get(x.fn_id as usize).ok_or("FX function has no FK key")?;
        let path = set.files[entry.file as usize].clone();
        let fm = found.fm.get(x.fn_id as usize).copied().unwrap_or_default();
        let finding = Finding::new(
            rule,
            vec![Subject::Function { key, path: path.clone(), chain: entry.chain.clone() }],
            path,
            Some(entry.chain.clone()),
            format!(
                "{} {}{} > {} [cyclomatic {} nesting {} npath {} length {}]",
                rule.id.trim_start_matches("core."),
                x.value,
                if x.rule == "core.npath" && x.value >= 16_777_215 { "+ (at least the cap)" } else { "" },
                x.threshold, fm[0], fm[1], fm[2], fm[3]
            ),
            json!({ "value": x.value, "threshold": x.threshold,
                    "metrics": { "cyclomatic": fm[0], "nesting": fm[1], "npath": fm[2], "length": fm[3] },
                    "lines": [entry.start_line, entry.end_line] }),
        );
        insert(&mut out, finding.at_line(entry.start_line), sha)?;
    }
    Ok((out, t, eff, dstats.degraded))
}

/// Returns the process exit code: 0 none added, 1 added.
pub fn run(a: &Args) -> Result<u8, String> {
    let base = resolve(&a.repo, &a.base)?;
    let head = resolve(&a.repo, &a.head)?;
    let (before, tb, _, deg_base) = evaluate(&a.repo, &base, "base", None)?;
    let (after, th, eff, deg_head) = evaluate(&a.repo, &head, "head", a.coverage.as_deref())?;
    eprintln!("pulsar: {}", eff.summary());
    for (name, sha, t) in [("base", &base, &tb), ("head", &head, &th)] {
        eprintln!(
            "pulsar: {name} {} checkout={}ms facts={}ms engine={}ms",
            &sha[..12],
            t.checkout_ms,
            t.facts_ms,
            t.engine_ms
        );
    }
    // Coverage-dependent findings (head only) are listed apart: base has no coverage to compare.
    let (cov_found, after_plain): (Vec<&Finding>, Vec<(&u64, &Finding)>) = {
        let (c, p): (Vec<_>, Vec<_>) = after.iter().partition(|(_, f)| needs_coverage(&f.rule));
        (c.into_iter().map(|(_, f)| f).collect(), p)
    };
    let new: Vec<&Finding> = after_plain.iter().filter(|(k, _)| !before.contains_key(*k)).map(|(_, f)| *f).collect();
    // A decision committed in head allows a new finding with a reason; it does not count as added.
    let (allowed, added): (Vec<&Finding>, Vec<&Finding>) =
        new.into_iter().partition(|f| eff.allowed(&hex(f.key())).is_some());
    let removed: Vec<&Finding> = before.iter().filter(|(k, _)| !after.contains_key(k)).map(|(_, f)| f).collect();
    let unchanged = after_plain.len() - added.len() - allowed.len();
    let reason = |f: &Finding| eff.allowed(&hex(f.key())).map(|d| d.reason.clone()).unwrap_or_default();

    let degraded: Vec<(&str, &Degraded)> = deg_base
        .iter()
        .map(|d| ("base", d))
        .chain(deg_head.iter().map(|d| ("head", d)))
        .collect();
    let mut out = String::new();
    if a.json {
        for (side, d) in &degraded {
            out.push_str(&json!({"type":"degraded","side":side,"lane":d.lane,"cause":d.cause}).to_string());
            out.push('\n');
        }
        for f in &added {
            out.push_str(&f.json("added").to_string());
            out.push('\n');
        }
        for f in &allowed {
            let mut v = f.json("allowed");
            v["reason"] = json!(reason(f));
            out.push_str(&v.to_string());
            out.push('\n');
        }
        for f in &removed {
            out.push_str(&f.json("removed").to_string());
            out.push('\n');
        }
        for f in &cov_found {
            out.push_str(&f.json("coverage").to_string());
            out.push('\n');
        }
        out.push_str(
            &json!({"type":"summary","base":base,"head":head,"added":added.len(),"allowed":allowed.len(),"removed":removed.len(),"unchanged":unchanged,"degraded":degraded.len(),"coverage":cov_found.len(),"policy":eff.fingerprint})
                .to_string(),
        );
        out.push('\n');
    } else {
        for (side, d) in &degraded {
            out.push_str(&format!("! DEGRADED INPUT ({side}) {}: {}\n", d.lane, d.cause));
        }
        for f in &added {
            out.push_str(&format!("+ {}\n", f.text()));
        }
        for f in &allowed {
            out.push_str(&format!("~ {}  [allowed: {}]\n", f.text(), reason(f)));
        }
        for f in &removed {
            out.push_str(&format!("- {}\n", f.text()));
        }
        for f in &cov_found {
            out.push_str(&format!("? {}  [head only, needs coverage]\n", f.text()));
        }
        out.push_str(&format!(
            "# base={} head={} added={} allowed={} removed={} unchanged={} degraded={} coverage={}\n",
            &base[..12],
            &head[..12],
            added.len(),
            allowed.len(),
            removed.len(),
            unchanged,
            degraded.len(),
            cov_found.len()
        ));
    }
    print!("{out}");
    Ok(if added.is_empty() { 0 } else { 1 })
}
