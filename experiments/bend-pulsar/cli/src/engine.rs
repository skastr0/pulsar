//! Run the Bend engine and parse its numeric findings (FACTS.md "Engine output (v0)").

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug)]
pub struct Findings {
    /// Each cycle is a list of file ids, ascending.
    pub cycles: Vec<Vec<u32>>,
    pub cert: Option<bool>,
    pub files: u64,
    pub edges: u64,
    pub cycle_count: u64,
    /// `FM`: per function id, `[cyclomatic, nesting, npath, length]`. Empty when the run had no
    /// functions.
    pub fm: Vec<[u64; 4]>,
    /// `FX`: metric findings, in engine order.
    pub fx: Vec<Fx>,
}

/// One metric finding: `value` is strictly over `threshold`. Both are evidence, not identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fx {
    pub rule: String,
    pub fn_id: u32,
    pub value: u64,
    pub threshold: u64,
    /// The `key=value` evidence tail after the fourth field (composites and CRAP), in order.
    pub extra: Vec<(String, String)>,
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
    let mut f = Findings { cycles: vec![], cert: None, files: 0, edges: 0, cycle_count: 0, fm: vec![], fx: vec![] };
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
            "FM" => {
                let id = num(it.next().ok_or("FM without fn")?)? as usize;
                if id != f.fm.len() {
                    return Err(format!("FM {id} out of order: expected {}", f.fm.len()));
                }
                let mut v = [0u64; 4];
                for slot in &mut v {
                    *slot = num(it.next().ok_or("FM needs cyclomatic nesting npath length")?)?;
                }
                f.fm.push(v);
            }
            "FX" => {
                let rule = it.next().ok_or("FX without rule")?.to_string();
                let fn_id = num(it.next().ok_or("FX without fn")?)? as u32;
                let value = num(it.next().ok_or("FX without value")?)?;
                let threshold = num(it.next().ok_or("FX without threshold")?)?;
                let extra = it
                    .map(|t| t.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())).ok_or(format!("FX evidence {t:?} is not key=value")))
                    .collect::<Result<Vec<_>, _>>()?;
                f.fx.push(Fx { rule, fn_id, value, threshold, extra });
            }
            other => return Err(format!("unknown engine line tag {other:?}")),
        }
    }
    if !header {
        return Err("engine output lacks the `pulsar-findings 0` header".into());
    }
    Ok(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cycles_metrics_and_findings() {
        let t = "pulsar-findings 0\nCYC 2 0 1\nCERT 1\nS 2 1 1\nFM 0 3 1 4 9\nFM 1 12 4 300 70\nFX core.cyclomatic 1 12 10\nFX core.nesting 1 4 3\n";
        let f = parse(t).unwrap();
        assert_eq!(f.cycles, vec![vec![0, 1]]);
        assert_eq!(f.fm, vec![[3, 1, 4, 9], [12, 4, 300, 70]]);
        assert_eq!(f.fx[1], Fx { rule: "core.nesting".into(), fn_id: 1, value: 4, threshold: 3, extra: vec![] });
    }

    #[test]
    fn keeps_the_key_value_evidence_tail_of_composite_findings() {
        let t = "pulsar-findings 0\nFX core.hotspot 0 5 2 churn=5 core.cyclomatic=12/10 core.npath=300/200\nFX core.crap 1 40 30 cyclomatic=9 covered=1 coverable=7\n";
        let f = parse(t).unwrap();
        assert_eq!(f.fx[0].extra, vec![("churn".into(), "5".into()), ("core.cyclomatic".into(), "12/10".into()), ("core.npath".into(), "300/200".into())]);
        assert_eq!(f.fx[1].extra[2], ("coverable".to_string(), "7".to_string()));
        assert!(parse("pulsar-findings 0\nFX core.hotspot 0 5 2 churn\n").unwrap_err().contains("key=value"));
    }

    #[test]
    fn rejects_out_of_order_fm_and_unknown_tags() {
        assert!(parse("pulsar-findings 0\nFM 1 0 0 0 0\n").unwrap_err().contains("out of order"));
        assert!(parse("pulsar-findings 0\nZZ 1\n").unwrap_err().contains("unknown"));
        assert!(parse("pulsar-findings 0\nFX core.nesting 1 4\n").unwrap_err().contains("threshold"));
    }
}
