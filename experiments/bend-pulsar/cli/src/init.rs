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
const SUPPORT_DIRS: &[&str] = &[
    "__mocks__", "bench", "benchmark", "benchmarks", "cypress", "e2e", "mocks", "perf", "playground",
    "playgrounds", "scripts", "stories", "tooling", "tools",
];

/// What the repo shows. Everything `render` writes comes from here.
pub struct Inputs {
    pub tracked: Vec<String>,
    /// Dependencies by the repo-relative directory of each tracked `package.json` (`""` is the root).
    pub pkg_deps: BTreeMap<String, BTreeSet<String>>,
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
fn lane(out: &mut String, key: &str, label: &str, files: &[&String], manifests: Option<(&str, Vec<String>)>, outside: usize, support: BTreeMap<String, usize>) {
    if files.is_empty() {
        let _ = writeln!(out, "# lanes.{key}: no {label} files are tracked, so the lane is idle and needs no table.\n");
        return;
    }
    let prod = files.iter().filter(|f| policy::Lanes::default().is_prod(f, None)).count();
    let _ = writeln!(out, "# {label}: {} tracked files, {prod} production under the default path rules (tests, fixtures, examples,", files.len());
    let _ = writeln!(out, "# docs, generated and config files are not production by default).");
    let mut body = String::new();
    match &manifests {
        Some((name, dirs)) => {
            let _ = writeln!(out, "# Coverage: no {name} at the repo root, so the lane covers only the directories that have one.");
            if outside > 0 {
                let _ = writeln!(out, "# {outside} {label} files sit outside them and are not checked; delete `include` to check the whole repo.");
            }
            let _ = writeln!(body, "include = [");
            list_items(&mut body, dirs.iter().map(|d| (d.clone(), format!("{d}{name}"))));
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

fn pack_report(out: &mut String, inp: &Inputs, ev: &policy::Evidence) -> Vec<String> {
    let _ = writeln!(out, "# Packs switch on by evidence on their own; nothing here lists them. They are named, framework-specific,");
    let _ = writeln!(out, "# and never change the generic rules. What this repo shows:");
    let mut effect_on = Vec::new();
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
                if *id == "effect" {
                    effect_on = inp
                        .pkg_deps
                        .iter()
                        .filter(|(d, deps)| !d.is_empty() && deps.contains("effect"))
                        .map(|(d, _)| format!("{d}/"))
                        .collect();
                }
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
    let ts_dirs = manifest_dirs(&inp.tracked, "tsconfig.json");
    let rs_dirs = manifest_dirs(&inp.tracked, "Cargo.toml");
    let outside = |files: &[&String], dirs: &Option<Vec<String>>| match dirs {
        Some(ds) => files.iter().filter(|f| !ds.iter().any(|d| f.starts_with(d.as_str()))).count(),
        None => 0,
    };
    let ts_outside = outside(&ts, &ts_dirs);
    let rs_outside = outside(&rs, &rs_dirs);
    let ts_support = support_dirs(&ts, &policy::Lanes::default());
    let rs_support = support_dirs(&rs, &policy::Lanes::default());
    lane(&mut out, "ts", "TypeScript", &ts, ts_dirs.map(|d| ("tsconfig.json", d)), ts_outside, ts_support);
    lane(&mut out, "rust", "Rust", &rs, rs_dirs.map(|d| ("Cargo.toml", d)), rs_outside, rs_support);
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
    let effect_dirs = pack_report(&mut out, inp, &ev);
    if !effect_dirs.is_empty() {
        let _ = writeln!(out, "#\n# Effect scope is not set: its scope rules fire only on paths you list, which changes findings, so it is yours to choose.");
        let _ = writeln!(out, "# Packages that depend on effect, as a starting point:");
        let _ = writeln!(out, "# [packs.effect]\n# effect_only = [");
        for d in &effect_dirs {
            let _ = writeln!(out, "#   \"{d}\",");
        }
        let _ = writeln!(out, "# ]");
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
    let git = |args: &[&str]| std::process::Command::new("git").arg("-C").arg(root).args(args).output().ok().filter(|o| o.status.success());
    let h = policy::History::default();
    let since = format!("--since={}.days.ago", h.since_days);
    let commits = git(&["rev-list", "--count", "--no-merges", &since, "HEAD"])
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok());
    let shallow = git(&["rev-parse", "--is-shallow-repository"]).is_some_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "true");
    Ok(Inputs { tracked, pkg_deps, commits, shallow })
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
        assert!(t.contains("1 TypeScript files sit outside them"), "{t}");
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
        let i = inputs(
            &["package.json", "packages/core/package.json", "apps/api/wrangler.jsonc", "src/a.ts", "tsconfig.json"],
            &[("packages/core", &["effect"]), ("", &["typescript"])],
        );
        let (t, p) = parsed(&i);
        assert!(t.contains("effect: ON, evidence dep:effect in packages/core/package.json"), "{t}");
        assert!(t.contains("cloudflare-workers: ON, evidence file:wrangler.jsonc at apps/api/wrangler.jsonc"), "{t}");
        assert!(t.contains("# effect_only = [\n#   \"packages/core/\","), "{t}");
        assert!(p.lanes.effect.effect_only.is_empty(), "scope lists change findings, so init leaves them to the reader");
        assert!(p.rules.enable.is_empty());
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
