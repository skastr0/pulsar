mod cache;
mod catalog;
mod compfind;
mod coverage;
mod delta;
mod delta_engine;
mod driver;
mod engine;
mod explain;
mod facts;
mod finding;
mod git;
mod init;
mod history;
mod infra;
mod infrafind;
mod lang;
mod layers;
mod packs;
mod policy;
mod rename;
mod sql;
mod sqlfind;
mod version;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "usage:
  pulsar facts <repo> [-o file] [--coverage path]   write facts (and <file>.paths, <file>.fns when -o is given)
  pulsar delta <base> <head> [--repo dir] [--json] [--coverage file|dir]   findings added and removed between two shas (exit 1 if any added)
  pulsar init [--repo dir] [--force] [--print]   write a starter .pulsar/policy.toml from evidence, each choice commented
  pulsar explain [<rule>]           what a rule means: definition, threshold, laws, example (no rule: list them)
  pulsar version                    CLI sha, engine sha, Bend version and every rule with its version
  pulsar catalog [check <file>... | list [--repo dir] | --help]   class data (see `pulsar catalog --help`)
  pulsar policy [--repo dir]        print the effective policy, its parts and fingerprint
  pulsar history <repo>             print the git-history fact counts (H, C, A, CF, CFN)
  pulsar infra <repo>               print the deployables, their bindings and the reads the lane found
  pulsar cycles <repo> [--facts-out file]   run facts, then the engine, and print cycles";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let r = match args.first().map(String::as_str) {
        Some("facts") => cmd_facts(&args[1..]).map(|()| 0),
        Some("cycles") => cmd_cycles(&args[1..]).map(|()| 0),
        Some("catalog") => cmd_catalog(&args[1..]).map(|()| 0),
        Some("policy") => cmd_policy(&args[1..]).map(|()| 0),
        Some("history") => cmd_history(&args[1..]).map(|()| 0),
        Some("infra") => cmd_infra(&args[1..]).map(|()| 0),
        Some("explain") => explain::run(&args[1..]).map(|()| 0),
        Some("init") => init::run(&args[1..]),
        Some("version") | Some("--version") | Some("-V") => version::run().map(|()| 0),
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
fn build_facts(
    repo: &Path,
    coverage: Option<&Path>,
    out: &mut dyn Write,
) -> Result<(driver::FactSet, facts::SideTables, history::Stats, driver::Stats), String> {
    let eff = policy_for(repo)?;
    let mut w = facts::FactWriter::new();
    let mut tables = facts::SideTables {
        sql_rules: eff.sql_rule_codes(),
        binding_rules: eff.binding_rule_codes(),
        composites: eff.composites(),
        untested: eff.untested_on(),
        ..facts::SideTables::default()
    };
    let (set, st) = driver::build_repo(repo, &eff.policy.lanes, &eff.active_rules(), &mut w, &mut tables)?;
    let hist = &eff.policy.history;
    let hist_rules = eff
        .policy
        .rules
        .enable
        .iter()
        .any(|r| r.starts_with("history."))
        .then(history::Rules::default);
    let hs = history::emit(
        repo,
        &history::Config { since_days: Some(hist.since_days), max_commits: hist.max_commits, rules: hist_rules },
        &tables,
        &set.fn_keys,
        &mut w,
    )?;
    if let Some(d) = &hs.degraded {
        w.note(&format!("degraded history: {d}"));
    }
    let _ = coverage::emit(repo, coverage, &tables, &mut w)?;
    w.write_to(out)?;
    print_stats(&st);
    Ok((set, tables, hs, st))
}

fn cmd_facts(args: &[String]) -> Result<(), String> {
    let Opts { repo, out, coverage } = parse_flags(args, "-o")?;
    match out {
        Some(path) => {
            let mut f = std::fs::File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let (_, tables, _, _) = build_facts(&repo, coverage.as_deref(), &mut f)?;
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
        let (set, _, _, _) = build_facts(&repo, coverage.as_deref(), &mut f)?;
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
    if found.cert != Some(true) {
        return Err(format!("engine certificate {}", if found.cert.is_none() { "line is missing" } else { "check failed" }));
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
    let (_, _, hs, _) = build_facts(&repo, None, &mut sink)?;
    println!(
        "commits={} authors={} CF={} CFN={} VN={} VT={} HR={} blobs={} pass1={}ms pass2={}ms degraded={:?}",
        hs.commits, hs.authors, hs.cf, hs.cfn, hs.vn, hs.vt, hs.hr, hs.blobs, hs.pass1_ms,
        hs.pass2_ms, hs.degraded
    );
    Ok(())
}

/// The infra lane's report: what the tree declares, and what the lane read from its entries.
fn cmd_infra(args: &[String]) -> Result<(), String> {
    let Opts { repo, .. } = parse_flags(args, "-o")?;
    let mut sink = std::io::sink();
    let (_, tables, _, st) = build_facts(&repo, None, &mut sink)?;
    let i = &st.infra;
    println!(
        "deployables={} bindings={} entries={} reads={} config_files={} read_files={} infra={}ms",
        i.deployables, i.bindings, i.entries, i.reads, i.config_files, i.read_files, i.ms
    );
    for line in tables.deployables.lines() {
        let f: Vec<&str> = line.split('\t').collect();
        if let [_id, path, ln, name] = f.as_slice() {
            println!("{name}\t{path}:{ln}");
        }
    }
    for d in &i.degraded {
        println!("degraded: {d}");
    }
    Ok(())
}

fn cmd_policy(args: &[String]) -> Result<(), String> {
    let repo = repo_flag(args)?;
    let eff = policy_for(&repo)?;
    for p in &eff.parts {
        println!("{}\t{}\tsha256:{}", p.kind, p.name, p.sha256);
    }
    // The fan-out, constant-argument and hot-path rules that run, with every threshold, and those
    // that stay off with the reason. Their thresholds live in the catalogs the parts above fingerprint.
    let c = eff.composites();
    for r in &c.fanouts {
        println!("rule\t{}\tv{}\tfanout rf={} class={} edges={} none={}", r.id, r.version, c.fanouts.iter().position(|x| x.id == r.id).unwrap_or(0), r.class_id, r.edges, r.none);
    }
    for (n, r) in c.konsts.iter().enumerate() {
        println!("rule\t{}\tv{}\tkonst rk={n} class={} pos={}", r.id, r.version, r.class_id, r.pos);
    }
    for (n, r) in c.hots.iter().enumerate() {
        println!("rule\t{}\tv{}\thot rh={n} lane={} base={} ({}) depth={}", r.id, r.version, r.lane, r.base, r.base_id, r.depth);
    }
    for (n, r) in c.edges.iter().enumerate() {
        let [all, none, ta, tn] = r.masks;
        println!("rule\t{}\tv{}\tedge re={n} all={all} none={none} target_all={ta} target_none={tn}", r.id, r.version);
    }
    for (n, r) in c.modules.iter().enumerate() {
        let [all, none, ba, bn] = r.masks;
        println!("rule\t{}\tv{}\tmodule rm={n} all={all} none={none} also_all={ba} also_none={bn}", r.id, r.version);
    }
    for (id, why) in &c.inert {
        println!("rule-off\t{id}\t{why}");
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
                    "ok {f}: id={} scope={:?} classes={} symbols={} handlers={} wrappers={} services={} layers={} rules={} fanouts={} konsts={} hots={} sha256:{}",
                    c.id, c.scope, c.classes.len(), c.symbols.len(), c.handlers.len(), c.wrappers.len(),
                    c.services.len(), c.layers.len(), c.rules.len(), c.fanouts.len(), c.konsts.len(), c.hots.len(), l.sha256
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
