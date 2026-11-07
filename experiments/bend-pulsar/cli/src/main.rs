mod cache;
mod catalog;
mod coverage;
mod delta;
mod driver;
mod engine;
mod facts;
mod finding;
mod git;
mod history;
mod lang;
mod packs;
mod policy;
mod rename;
mod sql;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "usage:
  pulsar facts <repo> [-o file] [--coverage path]   write facts (and <file>.paths, <file>.fns when -o is given)
  pulsar delta <base> <head> [--repo dir] [--json] [--coverage file|dir]   findings added and removed between two shas (exit 1 if any added)
  pulsar catalog [check <file>... | list [--repo dir] | --help]   class data (see `pulsar catalog --help`)
  pulsar policy [--repo dir]        print the effective policy, its parts and fingerprint
  pulsar history <repo>             print the git-history fact counts (H, C, A, CF, CFN)
  pulsar cycles <repo> [--facts-out file]   run facts, then the engine, and print cycles";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let r = match args.first().map(String::as_str) {
        Some("facts") => cmd_facts(&args[1..]).map(|()| 0),
        Some("cycles") => cmd_cycles(&args[1..]).map(|()| 0),
        Some("catalog") => cmd_catalog(&args[1..]).map(|()| 0),
        Some("policy") => cmd_policy(&args[1..]).map(|()| 0),
        Some("history") => cmd_history(&args[1..]).map(|()| 0),
        Some("delta") => delta::parse(&args[1..]).and_then(|a| delta::run(&a)),
        _ => Err(USAGE.to_string()),
    };
    match r {
        Ok(code) => ExitCode::from(code),
        Err(e) => {
            eprintln!("pulsar: {e}");
            ExitCode::from(2)
        }
    }
}

struct Opts {
    repo: PathBuf,
    out: Option<PathBuf>,
    coverage: Option<PathBuf>,
}

fn parse_flags(args: &[String], flag: &str) -> Result<Opts, String> {
    let mut repo = None;
    let mut out = None;
    let mut coverage = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--coverage" {
            coverage = Some(PathBuf::from(it.next().ok_or("--coverage needs a value".to_string())?));
        } else if a == flag || (flag == "-o" && a == "--out") {
            out = Some(PathBuf::from(it.next().ok_or(format!("{flag} needs a value"))?));
        } else if a.starts_with('-') {
            return Err(format!("unknown flag {a}\n{USAGE}"));
        } else if repo.is_none() {
            repo = Some(PathBuf::from(a));
        } else {
            return Err(format!("unexpected argument {a}\n{USAGE}"));
        }
    }
    Ok(Opts { repo: repo.ok_or(USAGE.to_string())?, out, coverage })
}

fn print_stats(st: &driver::Stats) {
    eprintln!(
        "pulsar: files={} prod={} I={} U={} fatal_parse={} unreadable={}",
        st.files, st.prod, st.i_facts, st.u_facts, st.fatal, st.unreadable
    );
    for d in &st.degraded {
        eprintln!("pulsar: DEGRADED INPUT {}: {}", d.lane, d.cause);
    }
}

/// Run every lane on `repo`, write canonical facts to `out`, and return the file set, side tables
/// and history stats.
fn build_facts(repo: &Path, coverage: Option<&Path>, out: &mut dyn Write) -> Result<(driver::FactSet, facts::SideTables, history::Stats), String> {
    let eff = policy_for(repo)?;
    let mut w = facts::FactWriter::new();
    let mut tables = facts::SideTables::default();
    let (set, st) = driver::build_repo(repo, &eff.policy.lanes, &eff.active_rules(), &mut w, &mut tables)?;
    let hist = &eff.policy.history;
    let hs = history::emit(
        repo,
        &history::Config { since_days: Some(hist.since_days), max_commits: hist.max_commits },
        &tables,
        &set.fn_keys,
        &mut w,
    )?;
    let _ = coverage::emit(repo, coverage, &tables, &mut w)?;
    w.write_to(out)?;
    print_stats(&st);
    Ok((set, tables, hs))
}

fn cmd_facts(args: &[String]) -> Result<(), String> {
    let Opts { repo, out, coverage } = parse_flags(args, "-o")?;
    match out {
        Some(path) => {
            let mut f = std::fs::File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let (_, tables, _) = build_facts(&repo, coverage.as_deref(), &mut f)?;
            tables.write(&path)?;
        }
        None => {
            let stdout = std::io::stdout();
            let mut lock = stdout.lock();
            build_facts(&repo, coverage.as_deref(), &mut lock)?;
            lock.flush().ok();
        }
    }
    Ok(())
}

fn cmd_cycles(args: &[String]) -> Result<(), String> {
    let Opts { repo, out: facts_out, coverage } = parse_flags(args, "--facts-out")?;
    let engine_path = engine::locate()?;
    let facts_path = facts_out.clone().unwrap_or_else(|| {
        std::env::temp_dir().join(format!("pulsar-facts-{}.txt", std::process::id()))
    });
    let set = {
        let mut f = std::fs::File::create(&facts_path).map_err(|e| format!("{}: {e}", facts_path.display()))?;
        let (set, _, _) = build_facts(&repo, coverage.as_deref(), &mut f)?;
        set
    };
    let result = engine::run(&engine_path, &facts_path);
    if facts_out.is_none() {
        let _ = std::fs::remove_file(&facts_path);
    }
    let found = result?;
    let mut lines: Vec<String> = found
        .cycles
        .iter()
        .map(|c| {
            let mut names: Vec<&str> = c.iter().map(|&i| set.files[i as usize].as_str()).collect();
            names.sort_unstable();
            names.join(" ")
        })
        .collect();
    lines.sort();
    let mut out = String::new();
    for l in &lines {
        out.push_str(l);
        out.push('\n');
    }
    let cert = match found.cert {
        Some(true) => "pass",
        Some(false) => "FAIL",
        None => "absent",
    };
    out.push_str(&format!(
        "# files={} prod={} edges={} cycles={} cert={}\n",
        found.files, set.prod, found.edges, found.cycle_count, cert
    ));
    print!("{out}");
    if found.cert == Some(false) {
        return Err("engine certificate check failed".into());
    }
    Ok(())
}

/// Load the effective policy of the tree at `root` and print its one-line summary to stderr.
fn policy_for(root: &Path) -> Result<policy::Effective, String> {
    let tracked = git::git_ls_files(root).unwrap_or_default();
    let ev = policy::gather_evidence(root, &tracked);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let eff = policy::load(root, home.as_deref(), &ev)?;
    eprintln!("pulsar: {}", eff.summary());
    Ok(eff)
}

fn cmd_history(args: &[String]) -> Result<(), String> {
    let Opts { repo, .. } = parse_flags(args, "-o")?;
    let mut sink = std::io::sink();
    let (_, _, hs) = build_facts(&repo, None, &mut sink)?;
    println!(
        "commits={} authors={} CF={} CFN={} blobs={} pass1={}ms pass2={}ms",
        hs.commits, hs.authors, hs.cf, hs.cfn, hs.blobs, hs.pass1_ms, hs.pass2_ms
    );
    Ok(())
}

fn cmd_policy(args: &[String]) -> Result<(), String> {
    let repo = repo_flag(args)?;
    let eff = policy_for(&repo)?;
    for p in &eff.parts {
        println!("{}\t{}\tsha256:{}", p.kind, p.name, p.sha256);
    }
    println!("fingerprint\tsha256:{}", eff.fingerprint);
    Ok(())
}

fn repo_flag(args: &[String]) -> Result<PathBuf, String> {
    match args {
        [] => Ok(PathBuf::from(".")),
        [f, v] if f == "--repo" => Ok(PathBuf::from(v)),
        _ => Err(USAGE.to_string()),
    }
}

fn cmd_catalog(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        None | Some("--help") | Some("-h") | Some("help") => {
            print!("{}", catalog::HELP);
            Ok(())
        }
        Some("check") if args.len() > 1 => {
            for f in &args[1..] {
                let text = std::fs::read_to_string(f).map_err(|e| format!("{f}: {e}"))?;
                let l = catalog::load(f, &text)?;
                let c = &l.catalog;
                println!(
                    "ok {f}: id={} scope={:?} classes={} symbols={} handlers={} wrappers={} services={} layers={} rules={} sha256:{}",
                    c.id, c.scope, c.classes.len(), c.symbols.len(), c.handlers.len(), c.wrappers.len(),
                    c.services.len(), c.layers.len(), c.rules.len(), l.sha256
                );
            }
            Ok(())
        }
        Some("list") => {
            let repo = repo_flag(&args[1..])?;
            let eff = policy_for(&repo)?;
            for c in &eff.catalogs {
                println!("{}\t{:?}\t{}\tsha256:{}", c.loaded.catalog.id, c.scope, c.why, c.loaded.sha256);
            }
            let inactive: Vec<&str> = catalog::EMBEDDED
                .iter()
                .map(|(id, _)| *id)
                .filter(|id| !eff.catalogs.iter().any(|c| c.loaded.catalog.id == *id))
                .collect();
            if !inactive.is_empty() {
                println!("# inactive packs (no evidence): {}", inactive.join(", "));
            }
            println!("# evidence: package.json dependencies; import: activators need import evidence, not collected yet");
            Ok(())
        }
        _ => Err(USAGE.to_string()),
    }
}
