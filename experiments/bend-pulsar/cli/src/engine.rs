//! Run the Bend engine and parse its numeric findings (FACTS.md "Engine output (v0)").

use std::path::{Path, PathBuf};
use std::process::Command;

pub struct Findings {
    /// Each cycle is a list of file ids, ascending.
    pub cycles: Vec<Vec<u32>>,
    pub cert: Option<bool>,
    pub files: u64,
    pub edges: u64,
    pub cycle_count: u64,
}

pub fn locate() -> Result<PathBuf, String> {
    let mut tried = Vec::new();
    if let Ok(p) = std::env::var("PULSAR_ENGINE") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!("PULSAR_ENGINE={} does not exist", p.display()));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            tried.push(dir.join("../engine/pulsar-engine"));
            // Cargo layout: <project>/cli/target/release/pulsar sits below <project>/engine/.
            for anc in dir.ancestors().skip(1).take(4) {
                tried.push(anc.join("engine/pulsar-engine"));
            }
        }
    }
    tried.push(PathBuf::from("experiments/bend-pulsar/engine/pulsar-engine"));
    for t in &tried {
        if t.is_file() {
            return Ok(t.clone());
        }
    }
    Err(format!(
        "engine binary not found (set PULSAR_ENGINE, or build it at one of: {})",
        tried.iter().map(|t| t.display().to_string()).collect::<Vec<_>>().join(", ")
    ))
}

pub fn run(engine: &Path, facts: &Path) -> Result<Findings, String> {
    let out = Command::new(engine)
        .arg(facts)
        .output()
        .map_err(|e| format!("cannot run engine {}: {e}", engine.display()))?;
    if !out.status.success() {
        return Err(format!(
            "engine exited with {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    parse(&String::from_utf8_lossy(&out.stdout))
}

pub fn parse(text: &str) -> Result<Findings, String> {
    let mut f = Findings { cycles: vec![], cert: None, files: 0, edges: 0, cycle_count: 0 };
    let mut header = false;
    let num = |s: &str| s.parse::<u64>().map_err(|_| format!("bad number {s:?} in engine output"));
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut it = line.split_whitespace();
        match it.next().unwrap() {
            "pulsar-findings" => header = true,
            "CYC" => {
                let size = num(it.next().ok_or("CYC without size")?)? as usize;
                let ids = it.map(|s| num(s).map(|v| v as u32)).collect::<Result<Vec<_>, _>>()?;
                if ids.len() != size {
                    return Err(format!("CYC size {size} but {} members", ids.len()));
                }
                f.cycles.push(ids);
            }
            "CERT" => f.cert = Some(it.next() == Some("1")),
            "S" => {
                f.files = num(it.next().ok_or("S missing files")?)?;
                f.edges = num(it.next().ok_or("S missing edges")?)?;
                f.cycle_count = num(it.next().ok_or("S missing cycles")?)?;
            }
            other => return Err(format!("unknown engine line tag {other:?}")),
        }
    }
    if !header {
        return Err("engine output lacks the `pulsar-findings 0` header".into());
    }
    Ok(f)
}
