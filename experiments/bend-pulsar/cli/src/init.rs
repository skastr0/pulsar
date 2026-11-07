//! `pulsar init`: a starter `.pulsar/policy.toml` written from what the repo shows, every choice
//! commented with the evidence behind it.
//!
//! The file only states choices the evidence supports: which lanes cover which directories (from
//! tsconfig.json and Cargo.toml), which directories are test or support code although the default
//! path rule calls them production (from directory names, with file counts), and the history
//! window. Packs switch on by evidence by themselves, so they are reported in comments, not
//! listed. Opt-in rules and the Effect scope lists change which findings appear, so they stay as
//! commented suggestions: init never turns a rule on for you.

use crate::{catalog, git, policy};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

const USAGE: &str = "usage: pulsar init [--repo dir] [--force] [--print]   write .pulsar/policy.toml from evidence (--print: to stdout, write nothing)";

/// Directory names that conventionally hold code that is not the product. Each match is listed
/// with its file count so the reader can strike it.
/// How many Effect directories the suggestion lists before it says how many more qualify.
const EFFECT_DIRS_SHOWN: usize = 20;

const SUPPORT_DIRS: &[&str] = &[
    "__mocks__", "bench", "benchmark", "benchmarks", "cypress", "e2e", "mocks", "perf", "playground",
    "playgrounds", "scripts", "stories", "tooling", "tools",
];

/// What the repo shows. Everything `render` writes comes from here.
pub struct Inputs {
    pub tracked: Vec<String>,
    /// Dependencies by the repo-relative directory of each tracked `package.json` (`""` is the root).
    pub pkg_deps: BTreeMap<String, BTreeSet<String>>,
    /// The `include` patterns of each tracked `tsconfig.json` that declares a non-empty one, by its
    /// directory. A tsconfig missing here covers its whole directory.
    pub tsconfig_include: BTreeMap<String, Vec<String>>,
    /// Every non-test TypeScript file and whether it imports `effect` (or an `@effect/` package).
    pub effect_files: Vec<(String, bool)>,
    /// Commits in the history window, or None when git could not count them.
    pub commits: Option<u64>,
    pub shallow: bool,
}

fn dir_of(path: &str) -> &str {
    path.rfind('/').map_or("", |i| &path[..i])
}

fn base_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn is_ts(p: &str) -> bool {
    [".ts", ".tsx", ".mts", ".cts"].iter().any(|s| p.ends_with(s))
}

/// Directories (with a trailing `/`) of every tracked file named `name`, minus the ones another
/// of them contains. `None` when the root has one: the lane then covers the whole repo.
fn manifest_dirs(tracked: &[String], name: &str) -> Option<Vec<String>> {
    let dirs: BTreeSet<&str> = tracked.iter().filter(|p| base_of(p) == name).map(|p| dir_of(p)).collect();
    if dirs.is_empty() || dirs.contains("") {
        return None;
    }
    Some(
        dirs.iter()
            .filter(|d| !dirs.iter().any(|o| o != *d && d.starts_with(&format!("{o}/"))))
            .map(|d| format!("{d}/"))
            .collect(),
    )
}

fn join(base: &str, rel: &str) -> String {
    if base.is_empty() { rel.to_string() } else { format!("{base}/{rel}") }
}

/// Does `prefix` (a directory ending in `/`, or an exact file) contain `path`, as in the lane scopes?
fn under(prefix: &str, path: &str) -> bool {
    if prefix.ends_with('/') { path.starts_with(prefix) } else { path == prefix }
}

/// The path prefix one tsconfig `include` pattern names, relative to the repo root: the leading
/// directories before the first glob segment, or the exact file when the pattern is one tracked
/// file. `None` when the pattern reaches the whole of `base` (`**/*`, `*.ts`, `.`).
fn include_prefix(base: &str, pat: &str, tracked: &BTreeSet<&str>) -> Option<String> {
    let pat = pat.trim_start_matches("./").trim_end_matches('/');
    let glob = |seg: &str| seg.contains(['*', '?', '[', '{']);
    let segs: Vec<&str> = pat.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    let lead: Vec<&str> = segs.iter().take_while(|s| !glob(s)).copied().collect();
    if lead.is_empty() {
        return None;
    }
    let path = join(base, &lead.join("/"));
    if lead.len() == segs.len() && tracked.contains(path.as_str()) {
        return Some(path);
    }
    Some(format!("{path}/"))
}

/// Where the TypeScript lane should look, with the evidence for each prefix, or `None` for the whole
/// repo (a root tsconfig with no narrowing `include`, or no tsconfig to narrow by).
fn ts_coverage(inp: &Inputs) -> Option<Vec<(String, String)>> {
    let tracked: BTreeSet<&str> = inp.tracked.iter().map(String::as_str).collect();
    let dirs: BTreeSet<&str> = inp.tracked.iter().filter(|p| base_of(p) == "tsconfig.json").map(|p| dir_of(p)).collect();
    if dirs.is_empty() {
        return None;
    }
    let mut cov: BTreeMap<String, String> = BTreeMap::new();
    for d in dirs {
        let file = join(d, "tsconfig.json");
        let pats = inp.tsconfig_include.get(d).filter(|p| !p.is_empty());
        let Some(pats) = pats else {
            if d.is_empty() {
                return None;
            }
            cov.insert(format!("{d}/"), file);
            continue;
        };
        for pat in pats {
            match include_prefix(d, pat, &tracked) {
                Some(prefix) => cov.insert(prefix, format!("{file} include {pat}")),
                None if d.is_empty() => return None,
                None => cov.insert(format!("{d}/"), format!("{file} include {pat}")),
            };
        }
    }
    let keys: Vec<String> = cov.keys().cloned().collect();
    cov.retain(|k, _| !keys.iter().any(|o| o != k && o.ends_with('/') && k.starts_with(o.as_str())));
    Some(cov.into_iter().collect())
}

/// Directories where most non-test files import effect, as (prefix, importing, total). A directory
/// is listed whole only when every subdirectory with two or more files also has most of its files
/// importing effect; otherwise the subdirectories are looked at one by one, so a majority never
/// drags a non-Effect sibling in. A directory whose files all sit in one subdirectory yields that
/// subdirectory. A directory needs at least two files.
fn effect_dirs(files: &[(String, bool)]) -> Vec<(String, usize, usize)> {
    let mut by: DirCounts = BTreeMap::new();
    for (f, imports) in files {
        let mut prefix = String::new();
        for seg in dir_of(f).split('/').filter(|s| !s.is_empty()) {
            prefix = format!("{prefix}{seg}/");
            let e = by.entry(prefix.clone()).or_default();
            e.0 += 1;
            e.1 += usize::from(*imports);
        }
    }
    let mut out = Vec::new();
    walk_effect_dirs("", &by, &mut out);
    out
}

type DirCounts = BTreeMap<String, (usize, usize)>;

fn is_majority(by: &DirCounts, d: &str) -> bool {
    by.get(d).is_some_and(|(t, i)| *t >= 2 && i * 2 > *t)
}

fn child_dirs<'a>(by: &'a DirCounts, d: &str) -> Vec<&'a str> {
    let depth = d.matches('/').count() + 1;
    by.keys().filter(|k| k.starts_with(d) && k.matches('/').count() == depth).map(String::as_str).collect()
}

fn walk_effect_dirs(d: &str, by: &DirCounts, out: &mut Vec<(String, usize, usize)>) {
    let kids = child_dirs(by, d);
    if !d.is_empty() && is_majority(by, d) {
        let total = by[d].0;
        if let [only] = kids.as_slice() {
            if by[*only].0 == total {
                return walk_effect_dirs(only, by, out);
            }
        }
        if kids.iter().all(|k| by[*k].0 < 2 || is_majority(by, k)) {
            out.push((d.to_string(), by[d].1, total));
            return;
        }
    }
    for k in kids {
        walk_effect_dirs(k, by, out);
    }
}

/// The support directories under which the default rule still says production, with the count of
/// such files. A directory inside an already listed one is not listed again.
fn support_dirs(files: &[&String], lanes: &policy::Lanes) -> BTreeMap<String, usize> {
    let mut found: BTreeMap<String, usize> = BTreeMap::new();
    for f in files.iter().filter(|f| lanes.is_prod(f, None)) {
        let segs: Vec<&str> = f.split('/').collect();
        if let Some(i) = segs[..segs.len() - 1].iter().position(|s| SUPPORT_DIRS.contains(s)) {
            *found.entry(format!("{}/", segs[..=i].join("/"))).or_default() += 1;
        }
    }
    let keys: Vec<String> = found.keys().cloned().collect();
    found.retain(|k, _| !keys.iter().any(|o| o != k && k.starts_with(o.as_str())));
    found
}

fn list_items(out: &mut String, items: impl IntoIterator<Item = (String, String)>) {
    for (item, why) in items {
        let _ = writeln!(out, "  \"{item}\",  # {why}");
    }
}

/// One lane's table: its coverage and its support directories, or a comment saying it is absent.
fn lane(out: &mut String, key: &str, label: &str, files: &[&String], coverage: Option<(String, Vec<(String, String)>)>, support: BTreeMap<String, usize>) {
    if files.is_empty() {
        let _ = writeln!(out, "# lanes.{key}: no {label} files are tracked, so the lane is idle and needs no table.\n");
        return;
    }
    let prod = files.iter().filter(|f| policy::Lanes::default().is_prod(f, None)).count();
    let _ = writeln!(out, "# {label}: {} tracked files, {prod} production under the default path rules (tests, fixtures, examples,", files.len());
    let _ = writeln!(out, "# docs, generated and config files are not production by default).");
    let mut body = String::new();
    let support: BTreeMap<String, usize> = match &coverage {
        Some((_, prefixes)) => support.into_iter().filter(|(d, _)| prefixes.iter().any(|(p, _)| under(p, d))).collect(),
        None => support,
    };
    match &coverage {
        Some((why, prefixes)) => {
            let outside = files.iter().filter(|f| !prefixes.iter().any(|(p, _)| under(p, f))).count();
            let _ = writeln!(out, "# Coverage: {why}");
            if outside > 0 {
                let _ = writeln!(out, "# {outside} {label} files sit outside it and are not checked; delete `include` to check the whole repo.");
            }
            let _ = writeln!(body, "include = [");
            list_items(&mut body, prefixes.iter().cloned());
            let _ = writeln!(body, "]");
        }
        None => {
            let _ = writeln!(out, "# Coverage: the whole repo (a root manifest, or none to narrow by).");
        }
    }
    if !support.is_empty() {
        let _ = writeln!(out, "# Support directories: the default rule calls these production; their names say otherwise.");
        let _ = writeln!(out, "# Strike any line that holds shipped code.");
        let _ = writeln!(body, "test = [");
        list_items(&mut body, support.iter().map(|(d, n)| (d.clone(), format!("{n} {label} files; directory name matches a support convention"))));
        let _ = writeln!(body, "]");
    }
    if body.is_empty() {
        let _ = writeln!(out, "# Nothing to set: the defaults already fit what is tracked.\n");
    } else {
        let _ = writeln!(out, "[lanes.{key}]\n{body}");
    }
}

/// Reports each pack; true when the Effect pack is on.
fn pack_report(out: &mut String, inp: &Inputs, ev: &policy::Evidence) -> bool {
    let _ = writeln!(out, "# Packs switch on by evidence on their own; nothing here lists them. They are named, framework-specific,");
    let _ = writeln!(out, "# and never change the generic rules. What this repo shows:");
    let mut effect_on = false;
    for (id, text) in catalog::EMBEDDED {
        let Ok(l) = catalog::load(id, text) else { continue };
        if l.catalog.scope != catalog::Scope::Pack {
            continue;
        }
        let acts = l.catalog.activate.clone().unwrap_or_default();
        match policy::matches(&acts, ev) {
            Some(a) => {
                let wherever = match a.strip_prefix("dep:") {
                    Some(dep) => {
                        let ds: Vec<&str> = inp.pkg_deps.iter().filter(|(_, d)| d.contains(dep)).map(|(d, _)| d.as_str()).take(3).collect();
                        let ds: Vec<String> = ds.iter().map(|d| if d.is_empty() { "package.json".into() } else { format!("{d}/package.json") }).collect();
                        format!("in {}", ds.join(", "))
                    }
                    None => match a.strip_prefix("file:") {
                        Some(f) => format!("at {}", inp.tracked.iter().filter(|p| base_of(p) == f).take(3).cloned().collect::<Vec<_>>().join(", ")),
                        None => String::new(),
                    },
                };
                let _ = writeln!(out, "#   {id}: ON, evidence {a} {wherever}");
                effect_on |= *id == "effect";
            }
            None => {
                let _ = writeln!(out, "#   {id}: off, no evidence (it switches on for {})", acts.join(", "));
            }
        }
    }
    effect_on
}

/// The policy text for `inp`. Pure: the same inputs give the same bytes.
pub fn render(inp: &Inputs) -> String {
    let history = policy::History::default();
    let mut out = String::new();
    out.push_str("# Starter policy written by `pulsar init` from what this repo shows. Commit it: it is the repo's one policy,\n");
    out.push_str("# fingerprinted into every run. Read each comment, strike what is wrong, then run `pulsar policy`.\n");
    out.push_str("# Arrays are sorted, one item per line. Paths are repo-relative prefixes; a prefix ending in `/` is a directory.\n\n");
    let _ = writeln!(out, "format = \"{}\"\n", policy::POLICY_FORMAT);

    // Lanes.
    let ts: Vec<&String> = inp.tracked.iter().filter(|p| is_ts(p)).collect();
    let rs: Vec<&String> = inp.tracked.iter().filter(|p| p.ends_with(".rs")).collect();
    let bend = inp.tracked.iter().filter(|p| p.ends_with(".bend")).count();
    let sql = inp.tracked.iter().filter(|p| p.ends_with(".sql")).count();
    let ts_cov = ts_coverage(inp).map(|c| {
        let why = if inp.tracked.iter().any(|p| p == "tsconfig.json") {
            "the root tsconfig.json include narrows the lane to the paths below."
        } else {
            "no tsconfig.json at the repo root, so the lane covers only what the tsconfigs that exist include."
        };
        (why.to_string(), c)
    });
    let rs_cov = manifest_dirs(&inp.tracked, "Cargo.toml").map(|dirs| {
        let c = dirs.into_iter().map(|d| (d.clone(), format!("{d}Cargo.toml"))).collect();
        ("no Cargo.toml at the repo root, so the lane covers only the directories that have one.".to_string(), c)
    });
    let ts_support = support_dirs(&ts, &policy::Lanes::default());
    let rs_support = support_dirs(&rs, &policy::Lanes::default());
    lane(&mut out, "ts", "TypeScript", &ts, ts_cov, ts_support);
    lane(&mut out, "rust", "Rust", &rs, rs_cov, rs_support);
    if bend > 0 {
        let _ = writeln!(out, "# Bend: {bend} tracked .bend files, covered whole; Bend code is support code unless a main reaches it.\n");
    }

    // History.
    let _ = writeln!(out, "# History window, the default: the newest {} commits of the last {} days, anchored to the head commit.", history.max_commits, history.since_days);
    match (inp.commits, inp.shallow) {
        (_, true) => {
            let _ = writeln!(out, "# Evidence: this clone is shallow, so history facts are cut short whatever the window says.");
        }
        (Some(n), _) if n > u64::from(history.max_commits) => {
            let _ = writeln!(out, "# Evidence: {n} commits fall in the window, more than the cap, so only the newest {} are read.", history.max_commits);
        }
        (Some(n), _) => {
            let _ = writeln!(out, "# Evidence: {n} commits fall in the window, under the cap.");
        }
        (None, _) => {
            let _ = writeln!(out, "# Evidence: git could not count the window (no commits yet?).");
        }
    }
    let _ = writeln!(out, "[history]\nsince_days = {}\nmax_commits = {}\n", history.since_days, history.max_commits);

    // Packs.
    let ev = policy::Evidence {
        deps: inp.pkg_deps.values().flatten().cloned().collect(),
        imports: BTreeSet::new(),
        files: inp.tracked.iter().map(|p| base_of(p).to_string()).collect(),
    };
    if pack_report(&mut out, inp, &ev) {
        let _ = writeln!(out, "#\n# Effect scope is not set: its scope rules fire only on paths you list, which changes findings, so it is yours to choose.");
        let dirs = effect_dirs(&inp.effect_files);
        if dirs.is_empty() {
            let _ = writeln!(out, "# No directory has most of its non-test TypeScript files importing effect, so there is nothing to suggest. Paths are prefixes, not globs:");
            let _ = writeln!(out, "# [packs.effect]\n# effect_only = [\n#   \"src/core/\",\n# ]");
        } else {
            let _ = writeln!(out, "# Directories where most non-test TypeScript files import effect (the counts are the evidence). Paths are prefixes, not globs:");
            let _ = writeln!(out, "# [packs.effect]\n# effect_only = [");
            for (d, imp, total) in dirs.iter().take(EFFECT_DIRS_SHOWN) {
                let _ = writeln!(out, "#   \"{d}\",  # {imp} of {total} non-test files import effect");
            }
            let _ = writeln!(out, "# ]");
            if dirs.len() > EFFECT_DIRS_SHOWN {
                let _ = writeln!(out, "# {} more directories qualify and are not listed; choose parents by hand.", dirs.len() - EFFECT_DIRS_SHOWN);
            }
        }
        let _ = writeln!(out, "# boundary (code that adapts Effect to callers that are not Effect) cannot be read off imports; list it by hand.");
    }
    out.push('\n');

    // Opt-in rules.
    let _ = writeln!(out, "# Opt-in rules, none enabled. `pulsar explain <rule>` says what each does; add ids to [rules] enable to turn them on.");
    if sql > 0 {
        let _ = writeln!(out, "# Evidence for the sql.* rules: {sql} tracked .sql files. Ids: {}.", crate::finding::SQL_RULES.iter().map(|r| r.id).collect::<Vec<_>>().join(", "));
    } else {
        let _ = writeln!(out, "# The sql.* rules have no evidence here: no .sql files are tracked.");
    }
    out
}

/// `text` as strict JSON: comments and trailing commas removed (tsconfig.json is JSONC), strings
/// left alone.
fn strip_jsonc(text: &str) -> String {
    let c: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < c.len() {
        match c[i] {
            '"' => {
                out.push('"');
                i += 1;
                while i < c.len() {
                    out.push(c[i]);
                    if c[i] == '\\' && i + 1 < c.len() {
                        out.push(c[i + 1]);
                        i += 2;
                        continue;
                    }
                    i += 1;
                    if c[i - 1] == '"' {
                        break;
                    }
                }
            }
            '/' if c.get(i + 1) == Some(&'/') => {
                while i < c.len() && c[i] != '\n' {
                    i += 1;
                }
            }
            '/' if c.get(i + 1) == Some(&'*') => {
                i += 2;
                while i + 1 < c.len() && !(c[i] == '*' && c[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
            }
            ',' => {
                let next = c[i + 1..].iter().find(|ch| !ch.is_whitespace());
                if !matches!(next, Some('}' | ']')) {
                    out.push(',');
                }
                i += 1;
            }
            ch => {
                out.push(ch);
                i += 1;
            }
        }
    }
    out
}

/// Does this TypeScript source import `effect` or an `@effect/` package (`from "effect"`,
/// `import("effect/...")`, `require("@effect/...")`, `import "effect"`)?
fn imports_effect(src: &str) -> bool {
    for q in ['"', '\''] {
        for spec in [format!("{q}effect{q}"), format!("{q}effect/"), format!("{q}@effect/")] {
            for (at, _) in src.match_indices(spec.as_str()) {
                let before = src[..at].trim_end();
                let call = before.strip_suffix('(').map(str::trim_end);
                if before.ends_with("from") || before.ends_with("import") || call.is_some_and(|b| b.ends_with("import") || b.ends_with("require")) {
                    return true;
                }
            }
        }
    }
    false
}

/// Read the repo into `Inputs`.
pub fn gather(root: &Path) -> Result<Inputs, String> {
    let tracked = git::git_ls_files(root)?;
    let mut pkg_deps: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for p in tracked.iter().filter(|p| base_of(p) == "package.json") {
        let Ok(text) = std::fs::read_to_string(root.join(p)) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let deps = pkg_deps.entry(dir_of(p).to_string()).or_default();
        for section in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
            if let Some(o) = v.get(section).and_then(|s| s.as_object()) {
                deps.extend(o.keys().cloned());
            }
        }
    }
    let mut tsconfig_include: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for p in tracked.iter().filter(|p| base_of(p) == "tsconfig.json") {
        let Ok(text) = std::fs::read_to_string(root.join(p)) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&strip_jsonc(&text)) else { continue };
        let pats: Vec<String> = v
            .get("include")
            .and_then(|i| i.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        if !pats.is_empty() {
            tsconfig_include.insert(dir_of(p).to_string(), pats);
        }
    }
    // One file at a time: no source is kept past its own check.
    let effect_files: Vec<(String, bool)> = if pkg_deps.values().any(|d| d.iter().any(|n| n == "effect" || n.starts_with("@effect/"))) {
        tracked
            .iter()
            .filter(|p| is_ts(p) && !p.ends_with(".d.ts") && !crate::lang::scope::is_test(p))
            .filter_map(|p| {
                let meta = std::fs::metadata(root.join(p)).ok()?;
                (meta.len() <= 2_000_000).then_some(())?;
                let text = std::fs::read_to_string(root.join(p)).ok()?;
                Some((p.clone(), imports_effect(&text)))
            })
            .collect()
    } else {
        Vec::new()
    };
    let git = |args: &[&str]| std::process::Command::new("git").arg("-C").arg(root).args(args).output().ok().filter(|o| o.status.success());
    let h = policy::History::default();
    let since = format!("--since={}.days.ago", h.since_days);
    let commits = git(&["rev-list", "--count", "--no-merges", &since, "HEAD"])
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok());
    let shallow = git(&["rev-parse", "--is-shallow-repository"]).is_some_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "true");
    Ok(Inputs { tracked, pkg_deps, tsconfig_include, effect_files, commits, shallow })
}

pub fn run(args: &[String]) -> Result<u8, String> {
    let (mut repo, mut force, mut print) = (PathBuf::from("."), false, false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--repo" => repo = PathBuf::from(it.next().ok_or("--repo needs a value")?),
            "--force" => force = true,
            "--print" => print = true,
            _ => return Err(USAGE.into()),
        }
    }
    let text = render(&gather(&repo)?);
    // A starter that its own parser rejects is a bug in init, never something to write.
    policy::parse_policy(".pulsar/policy.toml", &text).map_err(|e| format!("init produced an invalid policy (a bug): {e}"))?;
    if print {
        print!("{text}");
        return Ok(0);
    }
    let path = repo.join(".pulsar/policy.toml");
    if path.exists() && !force {
        return Err(format!("{} exists; init never overwrites a committed policy (use --force, or --print to compare)", path.display()));
    }
    std::fs::create_dir_all(repo.join(".pulsar")).map_err(|e| format!("{}: {e}", repo.join(".pulsar").display()))?;
    std::fs::write(&path, &text).map_err(|e| format!("{}: {e}", path.display()))?;
    println!("wrote {}", path.display());
    println!("next: read the comments, strike what is wrong, `pulsar policy`, then commit .pulsar/");
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(tracked: &[&str], deps: &[(&str, &[&str])]) -> Inputs {
        Inputs {
            tracked: tracked.iter().map(|s| s.to_string()).collect(),
            pkg_deps: deps.iter().map(|(d, ds)| (d.to_string(), ds.iter().map(|s| s.to_string()).collect())).collect(),
            tsconfig_include: BTreeMap::new(),
            effect_files: Vec::new(),
            commits: Some(12),
            shallow: false,
        }
    }

    fn parsed(i: &Inputs) -> (String, policy::Policy) {
        let t = render(i);
        let p = policy::parse_policy("init", &t).unwrap_or_else(|e| panic!("{e}\n{t}"));
        (t, p)
    }

    #[test]
    fn a_root_tsconfig_covers_the_whole_repo_and_the_output_parses() {
        let (t, p) = parsed(&inputs(&["tsconfig.json", "src/a.ts", "src/b.test.ts", "package.json"], &[]));
        assert!(p.lanes.ts.include.is_empty());
        assert!(t.contains("TypeScript: 2 tracked files, 1 production"), "{t}");
        assert!(t.contains("no .sql files"), "{t}");
    }

    #[test]
    fn without_a_root_manifest_the_lane_covers_the_manifest_directories() {
        let i = inputs(&["packages/a/tsconfig.json", "packages/a/src/x.ts", "packages/a/sub/tsconfig.json", "tools/y.ts", "Cargo.toml", "src/lib.rs", "crates/z/Cargo.toml"], &[]);
        let (t, p) = parsed(&i);
        assert_eq!(p.lanes.ts.include, ["packages/a/"]);
        assert!(p.lanes.rust.include.is_empty(), "root Cargo.toml covers the repo");
        assert!(t.contains("1 TypeScript files sit outside it"), "{t}");
    }

    #[test]
    fn support_directories_are_listed_with_counts_and_not_when_the_default_already_excludes_them() {
        let i = inputs(
            &["tsconfig.json", "scripts/a.ts", "scripts/deep/b.ts", "packages/p/bench/c.ts", "test/d.ts", "src/e.ts", "Cargo.toml", "tools/f.rs", "src/lib.rs"],
            &[],
        );
        let (t, p) = parsed(&i);
        assert_eq!(p.lanes.ts.test, ["packages/p/bench/", "scripts/"]);
        assert_eq!(p.lanes.rust.test, ["tools/"]);
        assert!(t.contains("\"scripts/\",  # 2 TypeScript files"), "{t}");
        assert!(!t.contains("\"test/\""), "default rule already excludes test/: {t}");
    }

    #[test]
    fn packs_are_reported_by_evidence_and_effect_scope_is_only_suggested() {
        let mut i = inputs(
            &["package.json", "packages/core/package.json", "apps/api/wrangler.jsonc", "src/a.ts", "tsconfig.json"],
            &[("packages/core", &["effect"]), ("", &["typescript"])],
        );
        i.effect_files = [("packages/core/a.ts", true), ("packages/core/b.ts", true), ("packages/core/c.ts", false), ("src/a.ts", false), ("src/b.ts", false)]
            .iter()
            .map(|(f, e)| (f.to_string(), *e))
            .collect();
        let (t, p) = parsed(&i);
        assert!(t.contains("effect: ON, evidence dep:effect in packages/core/package.json"), "{t}");
        assert!(t.contains("cloudflare-workers: ON, evidence file:wrangler.jsonc at apps/api/wrangler.jsonc"), "{t}");
        assert!(t.contains("# effect_only = [\n#   \"packages/core/\",  # 2 of 3 non-test files import effect"), "{t}");
        assert!(!t.contains("\"src/\""), "src/ has no effect imports: {t}");
        assert!(p.lanes.effect.effect_only.is_empty(), "scope lists change findings, so init leaves them to the reader");
        assert!(p.rules.enable.is_empty());
    }

    #[test]
    fn a_root_only_effect_dependency_with_no_importing_directory_gets_the_block_without_a_suggestion() {
        let mut i = inputs(&["package.json", "tsconfig.json", "src/a.ts", "src/b.ts"], &[("", &["effect"])]);
        i.effect_files = vec![("src/a.ts".into(), false), ("src/b.ts".into(), false)];
        let (t, p) = parsed(&i);
        assert!(t.contains("effect: ON, evidence dep:effect in package.json"), "{t}");
        assert!(t.contains("nothing to suggest"), "{t}");
        assert!(t.contains("# [packs.effect]\n# effect_only = ["), "{t}");
        assert!(p.lanes.effect.effect_only.is_empty() && p.lanes.effect.boundary.is_empty());
        let off = render(&inputs(&["package.json", "tsconfig.json", "src/a.ts"], &[("", &["typescript"])]));
        assert!(!off.contains("[packs.effect]"), "no Effect evidence, no block: {off}");
    }

    #[test]
    fn effect_directories_are_the_shallowest_where_most_non_test_files_import_effect() {
        let f = |v: &[(&str, bool)]| v.iter().map(|(p, e)| (p.to_string(), *e)).collect::<Vec<_>>();
        let files = f(&[("src/core/a.ts", true), ("src/core/b.ts", true), ("src/core/adapters/c.ts", true), ("src/cli/d.ts", true), ("src/cli/e.ts", false), ("src/util/f.ts", false), ("src/util/g.ts", false), ("lone/h.ts", true)]);
        // src/ has 4 of 7 importing but src/cli/ does not (1 of 2) and src/util/ does not, so src/ is not
        // listed whole: only src/core/ (3 of 3). lone/ has one file.
        assert_eq!(effect_dirs(&files), vec![("src/core/".to_string(), 3, 3)]);
        // Every subdirectory with most files importing: the parent is listed whole.
        let pure = f(&[("src/a/x.ts", true), ("src/a/y.ts", true), ("src/b/z.ts", true), ("src/b/w.ts", false), ("src/b/v.ts", true)]);
        assert_eq!(effect_dirs(&pure), vec![("src/".to_string(), 4, 5)]);
        // A chain with one child narrows to the child.
        assert_eq!(effect_dirs(&f(&[("packages/core/a.ts", true), ("packages/core/b.ts", true)])), vec![("packages/core/".to_string(), 2, 2)]);
        let files = f(&[("src/core/a.ts", true), ("src/core/b.ts", true), ("src/util/f.ts", false), ("src/util/g.ts", false), ("src/util/h.ts", false), ("src/cli/i.ts", true), ("src/cli/j.ts", true)]);
        assert_eq!(effect_dirs(&files), vec![("src/cli/".to_string(), 2, 2), ("src/core/".to_string(), 2, 2)]);
    }

    #[test]
    fn imports_effect_sees_import_forms_and_ignores_plain_strings() {
        assert!(imports_effect("import { Effect } from \"effect\""));
        assert!(imports_effect("import * as S from 'effect/Schema'"));
        assert!(imports_effect("import { Sql } from \"@effect/sql\"\nexport {}"));
        assert!(imports_effect("const m = await import(\"effect\")"));
        assert!(imports_effect("import \"effect\""));
        assert!(!imports_effect("const label = \"effect\"; log('@effect/x')"));
        assert!(!imports_effect("import { x } from \"effects\""));
    }

    #[test]
    fn a_tsconfig_include_that_narrows_scopes_the_ts_lane_to_it() {
        let mut i = inputs(&["tsconfig.json", "src/a.ts", "src/deep/b.ts", "e2e/c.ts", "scripts/d.ts"], &[]);
        i.tsconfig_include.insert(String::new(), vec!["src/**/*".into()]);
        let (t, p) = parsed(&i);
        assert_eq!(p.lanes.ts.include, ["src/"]);
        assert!(p.lanes.ts.test.is_empty(), "e2e/ and scripts/ are outside the lane, no need to list them as test: {t}");
        assert!(t.contains("root tsconfig.json include narrows the lane"), "{t}");
        assert!(t.contains("\"src/\",  # tsconfig.json include src/**/*"), "{t}");
        assert!(t.contains("2 TypeScript files sit outside it"), "{t}");
    }

    #[test]
    fn include_patterns_map_to_prefixes_files_or_the_whole_repo() {
        let tracked: BTreeSet<&str> = ["src/index.ts", "src/a/b.ts", "pkg/x.ts"].into_iter().collect();
        let pre = |b: &str, p: &str| include_prefix(b, p, &tracked);
        assert_eq!(pre("", "src"), Some("src/".into()));
        assert_eq!(pre("", "./src/"), Some("src/".into()));
        assert_eq!(pre("", "src/index.ts"), Some("src/index.ts".into()), "a tracked file is an exact path");
        assert_eq!(pre("", "src/a/**/*.ts"), Some("src/a/".into()));
        assert_eq!(pre("pkg", "lib/**"), Some("pkg/lib/".into()), "relative to the tsconfig directory");
        assert_eq!(pre("", "**/*"), None);
        assert_eq!(pre("", "*.ts"), None);
        assert_eq!(pre("", "."), None);
        // Whole repo when any pattern reaches it, and a root tsconfig without include covers it all.
        let mut i = inputs(&["tsconfig.json", "src/a.ts"], &[]);
        assert!(ts_coverage(&i).is_none());
        i.tsconfig_include.insert(String::new(), vec!["src".into(), "**/*.ts".into()]);
        assert!(ts_coverage(&i).is_none());
        // A nested tsconfig adds its own directory; a root narrowing keeps both.
        let mut i = inputs(&["tsconfig.json", "src/a.ts", "tools/tsconfig.json", "tools/t.ts"], &[]);
        i.tsconfig_include.insert(String::new(), vec!["src".into()]);
        let c: Vec<String> = ts_coverage(&i).unwrap().into_iter().map(|(p, _)| p).collect();
        assert_eq!(c, ["src/", "tools/"]);
    }

    #[test]
    fn tsconfig_is_read_as_jsonc() {
        let t = "{\n // a comment\n \"include\": [\"src\", /* block */ \"lib/**/*\",], \"x\": \"a//b, ]\",\n}";
        let v: serde_json::Value = serde_json::from_str(&strip_jsonc(t)).unwrap_or_else(|e| panic!("{e}\n{}", strip_jsonc(t)));
        assert_eq!(v["include"], serde_json::json!(["src", "lib/**/*"]));
        assert_eq!(v["x"], "a//b, ]", "strings are left alone");
    }

    #[test]
    fn history_evidence_and_sql_evidence_are_stated() {
        let mut i = inputs(&["db/schema.sql", "src/a.ts", "tsconfig.json"], &[]);
        i.commits = Some(5000);
        let t = render(&i);
        assert!(t.contains("5000 commits fall in the window, more than the cap"), "{t}");
        assert!(t.contains("1 tracked .sql files"), "{t}");
        i.shallow = true;
        assert!(render(&i).contains("shallow"));
    }

    #[test]
    fn render_is_deterministic_and_names_only_known_rules() {
        let i = inputs(&["tsconfig.json", "db/a.sql", "scripts/x.ts"], &[]);
        assert_eq!(render(&i), render(&i));
        for r in crate::finding::SQL_RULES {
            assert!(crate::finding::is_builtin_rule(r.id));
        }
    }

    #[test]
    fn init_writes_once_and_refuses_to_overwrite() {
        let root = std::env::temp_dir().join(format!("pulsar-init-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.ts"), "export const a = 1\n").unwrap();
        std::fs::write(root.join("tsconfig.json"), "{}").unwrap();
        let g = |a: &[&str]| assert!(std::process::Command::new("git").arg("-C").arg(&root).args(a).output().unwrap().status.success());
        g(&["init", "-q"]);
        g(&["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
        g(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"]);
        let r = root.to_string_lossy().into_owned();
        assert_eq!(run(&["--repo".into(), r.clone()]).unwrap(), 0);
        let written = std::fs::read_to_string(root.join(".pulsar/policy.toml")).unwrap();
        assert!(policy::load(&root, None, &policy::Evidence::default()).is_ok());
        assert!(run(&["--repo".into(), r.clone()]).unwrap_err().contains("never overwrites"));
        assert_eq!(std::fs::read_to_string(root.join(".pulsar/policy.toml")).unwrap(), written);
        assert_eq!(run(&["--repo".into(), r, "--force".into()]).unwrap(), 0);
        let _ = std::fs::remove_dir_all(&root);
    }
}
