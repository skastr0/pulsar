mod coverage;
mod engine;
mod facts;
mod git;
mod history;
mod lang;
mod packs;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "usage:
  pulsar facts <repo> [-o file] [--coverage path]   write facts (and <file>.paths, <file>.fns when -o is given)
  pulsar cycles <repo> [--facts-out file]   run facts, then the engine, and print cycles";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let r = match args.first().map(String::as_str) {
        Some("facts") => cmd_facts(&args[1..]),
        Some("cycles") => cmd_cycles(&args[1..]),
        _ => Err(USAGE.to_string()),
    };
    match r {
        Ok(()) => ExitCode::SUCCESS,
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

fn print_stats(st: &lang::ts::Stats) {
    eprintln!(
        "pulsar: files={} prod={} I={} U={} fatal_parse={} unreadable={}",
        st.files, st.prod, st.i_facts, st.u_facts, st.fatal, st.unreadable
    );
}

/// Run every lane on `repo`, write canonical facts to `out`, and return the file set and side tables.
fn build_facts(repo: &Path, coverage: Option<&Path>, out: &mut dyn Write) -> Result<(lang::ts::FactSet, facts::SideTables), String> {
    let mut w = facts::FactWriter::new();
    let mut tables = facts::SideTables::default();
    let (set, st) = lang::ts::collect(repo, &mut w, &mut tables)?;
    coverage::emit(repo, coverage, &tables, &mut w)?;
    w.write_to(out)?;
    print_stats(&st);
    Ok((set, tables))
}

fn cmd_facts(args: &[String]) -> Result<(), String> {
    let Opts { repo, out, coverage } = parse_flags(args, "-o")?;
    match out {
        Some(path) => {
            let mut f = std::fs::File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let (_, tables) = build_facts(&repo, coverage.as_deref(), &mut f)?;
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
        let (set, _) = build_facts(&repo, coverage.as_deref(), &mut f)?;
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
