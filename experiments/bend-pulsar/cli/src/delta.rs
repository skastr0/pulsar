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
use crate::finding::{hex, Finding, Subject, IMPORT_CYCLE};
use crate::lang;
use crate::policy::{self, Effective};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

pub const USAGE: &str = "usage: pulsar delta <base> <head> [--repo dir] [--json]
  exit 0 = no finding added, 1 = at least one added, 2 = error
  --json prints JSON lines (one per finding, then a summary line) instead of text";

pub struct Args {
    base: String,
    head: String,
    repo: PathBuf,
    json: bool,
}

pub fn parse(args: &[String]) -> Result<Args, String> {
    let mut pos = Vec::new();
    let mut repo = PathBuf::from(".");
    let mut json = false;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "--repo" => repo = PathBuf::from(it.next().ok_or("--repo needs a value")?),
            f if f.starts_with('-') => return Err(format!("unknown flag {f}\n{USAGE}")),
            _ => pos.push(a.clone()),
        }
    }
    let [base, head] = <[String; 2]>::try_from(pos).map_err(|_| USAGE.to_string())?;
    Ok(Args { base, head, repo, json })
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
fn evaluate(repo: &Path, sha: &str, tag: &str) -> Result<(BTreeMap<u64, Finding>, Timing, Effective), String> {
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
    let (set, _) = lang::ts::collect_tracked(&tree, tracked, &mut w, &mut tables)?;
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
        let key = finding.key();
        if let Some(prev) = out.insert(key, finding) {
            return Err(format!("finding key {} collides for two findings at {sha}: {}", hex(key), prev.evidence_text));
        }
    }
    Ok((out, t, eff))
}

/// Returns the process exit code: 0 none added, 1 added.
pub fn run(a: &Args) -> Result<u8, String> {
    let base = resolve(&a.repo, &a.base)?;
    let head = resolve(&a.repo, &a.head)?;
    let (before, tb, _) = evaluate(&a.repo, &base, "base")?;
    let (after, th, eff) = evaluate(&a.repo, &head, "head")?;
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
    let new: Vec<&Finding> = after.iter().filter(|(k, _)| !before.contains_key(k)).map(|(_, f)| f).collect();
    // A decision committed in head allows a new finding with a reason; it does not count as added.
    let (allowed, added): (Vec<&Finding>, Vec<&Finding>) =
        new.into_iter().partition(|f| eff.allowed(&hex(f.key())).is_some());
    let removed: Vec<&Finding> = before.iter().filter(|(k, _)| !after.contains_key(k)).map(|(_, f)| f).collect();
    let unchanged = after.len() - added.len() - allowed.len();
    let reason = |f: &Finding| eff.allowed(&hex(f.key())).map(|d| d.reason.clone()).unwrap_or_default();

    let mut out = String::new();
    if a.json {
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
        out.push_str(
            &json!({"type":"summary","base":base,"head":head,"added":added.len(),"allowed":allowed.len(),"removed":removed.len(),"unchanged":unchanged,"policy":eff.fingerprint})
                .to_string(),
        );
        out.push('\n');
    } else {
        for f in &added {
            out.push_str(&format!("+ {}\n", f.text()));
        }
        for f in &allowed {
            out.push_str(&format!("~ {}  [allowed: {}]\n", f.text(), reason(f)));
        }
        for f in &removed {
            out.push_str(&format!("- {}\n", f.text()));
        }
        out.push_str(&format!(
            "# base={} head={} added={} allowed={} removed={} unchanged={}\n",
            &base[..12],
            &head[..12],
            added.len(),
            allowed.len(),
            removed.len(),
            unchanged
        ));
    }
    print!("{out}");
    Ok(if added.is_empty() { 0 } else { 1 })
}
