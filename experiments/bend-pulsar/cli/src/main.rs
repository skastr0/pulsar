mod engine;
mod extract;
mod facts;
mod resolve;
mod scope;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "usage:
  pulsar facts <repo> [-o file]     write FACTS v0 (and <file>.paths when -o is given)
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

fn parse_flags(args: &[String], flag: &str) -> Result<(PathBuf, Option<PathBuf>), String> {
    let mut repo = None;
    let mut out = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == flag || (flag == "-o" && a == "--out") {
            out = Some(PathBuf::from(it.next().ok_or(format!("{flag} needs a value"))?));
        } else if a.starts_with('-') {
            return Err(format!("unknown flag {a}\n{USAGE}"));
        } else if repo.is_none() {
            repo = Some(PathBuf::from(a));
        } else {
            return Err(format!("unexpected argument {a}\n{USAGE}"));
        }
    }
    Ok((repo.ok_or(USAGE.to_string())?, out))
}

fn print_stats(st: &facts::Stats) {
    eprintln!(
        "pulsar: files={} prod={} I={} U={} fatal_parse={} unreadable={}",
        st.files, st.prod, st.i_facts, st.u_facts, st.fatal, st.unreadable
    );
}

fn cmd_facts(args: &[String]) -> Result<(), String> {
    let (repo, out) = parse_flags(args, "-o")?;
    match out {
        Some(path) => {
            let mut f = std::fs::File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let (set, st) = facts::build(&repo, &mut f)?;
            let mut paths = path.clone().into_os_string();
            paths.push(".paths");
            facts::write_paths(&set.files, Path::new(&paths))?;
            print_stats(&st);
        }
        None => {
            let stdout = std::io::stdout();
            let mut lock = stdout.lock();
            let (_, st) = facts::build(&repo, &mut lock)?;
            lock.flush().ok();
            print_stats(&st);
        }
    }
    Ok(())
}

fn cmd_cycles(args: &[String]) -> Result<(), String> {
    let (repo, facts_out) = parse_flags(args, "--facts-out")?;
    let engine_path = engine::locate()?;
    let facts_path = facts_out.clone().unwrap_or_else(|| {
        std::env::temp_dir().join(format!("pulsar-facts-{}.txt", std::process::id()))
    });
    let set = {
        let mut f = std::fs::File::create(&facts_path).map_err(|e| format!("{}: {e}", facts_path.display()))?;
        let (set, st) = facts::build(&repo, &mut f)?;
        print_stats(&st);
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
