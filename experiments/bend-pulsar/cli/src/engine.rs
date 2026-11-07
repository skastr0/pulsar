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
    /// `FM`: per function id, `[cyclomatic, nesting, npath, length, cognitive]`. Empty when the run had no
    /// functions.
    pub fm: Vec<[u64; 5]>,
    /// `FX`: metric findings, in engine order.
    pub fx: Vec<Fx>,
    /// `RCX`: class-in-context findings, sorted by (rule, site).
    pub rcx: Vec<Rcx>,
    /// The `pulsar-layers 0` section, when the facts had an `E` row.
    pub layers: Option<Layers>,
}

/// `LUNP r l s x walk..`: at root `root`, reachable layer `layer` requires `svc`, which no layer
/// provides; `walk` is the `LP` path from root layer `via` to `layer`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unp {
    pub root: u32,
    pub layer: u32,
    pub svc: u32,
    pub via: u32,
    pub walk: Vec<u32>,
}

/// `LDUP s a b w na wa.. wb..`: layers `a` < `b` both build `svc` and are both reachable from `w`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dup {
    pub svc: u32,
    pub a: u32,
    pub b: u32,
    pub w: u32,
    pub wa: Vec<u32>,
    pub wb: Vec<u32>,
}

/// `LHUB s k a b`: service `svc` has fan-in `k` = `a` layers + `b` functions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hub {
    pub svc: u32,
    pub k: u32,
    pub a: u32,
    pub b: u32,
}

/// The Effect layer-graph section of the engine output (FACTS.md "Effect pack").
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Layers {
    pub cycles: Vec<Vec<u32>>,
    /// `LCERT`: 1 when the cycle list is certified complete.
    pub cert: Option<bool>,
    pub unp: Vec<Unp>,
    /// `LOPQ r l`: root `r` reaches opaque layer `l`.
    pub opq: Vec<(u32, u32)>,
    pub dups: Vec<Dup>,
    pub hubs: Vec<Hub>,
    /// The hub threshold in force, from `LS`.
    pub hub_min: u32,
}

/// One class-in-context finding: call site `site` in function `fn_id` calls `callee`, a symbol of
/// the class that active rule `rule` (an `RL` id) forbids in that context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rcx {
    pub rule: u32,
    pub site: u32,
    pub fn_id: u32,
    pub callee: u32,
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

/// Where an engine may sit relative to the CLI binary `exe`: next to its `bin/` (an install), or
/// below a Cargo `target/` directory. `exe` is canonicalised first, so a symlink such as
/// `~/.local/bin/pulsar` finds the engine installed beside the file it points to.
fn candidates(exe: &Path) -> Vec<PathBuf> {
    let exe = std::fs::canonicalize(exe).unwrap_or_else(|_| exe.to_path_buf());
    let mut tried = Vec::new();
    if let Some(dir) = exe.parent() {
        tried.push(dir.join("../engine/pulsar-engine"));
        // Cargo layout: <project>/cli/target/release/pulsar sits below <project>/engine/.
        for anc in dir.ancestors().skip(1).take(4) {
            tried.push(anc.join("engine/pulsar-engine"));
        }
    }
    tried
}

pub fn locate() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("PULSAR_ENGINE") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!("PULSAR_ENGINE={} does not exist", p.display()));
    }
    let mut tried = std::env::current_exe().map(|exe| candidates(&exe)).unwrap_or_default();
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
    parse(&run_raw(engine, facts)?)
}

/// Run the engine and return its stdout, so a caller can cache the text.
pub fn run_raw(engine: &Path, facts: &Path) -> Result<String, String> {
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
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// One line of the layers section, its fields already numbers.
fn parse_layer_line(l: &mut Layers, tag: &str, n: &[u32]) -> Result<(), String> {
    let short = || format!("{tag} line has too few fields");
    match tag {
        "LCYC" => {
            let (size, ids) = n.split_first().ok_or_else(short)?;
            if *size as usize != ids.len() || ids.is_empty() {
                return Err(format!("LCYC size {size} but {} members", ids.len()));
            }
            l.cycles.push(ids.to_vec());
        }
        "LCERT" => l.cert = Some(n.first().ok_or_else(short)? == &1),
        "LUNP" => match n {
            [root, layer, svc, via, walk @ ..] => l.unp.push(Unp { root: *root, layer: *layer, svc: *svc, via: *via, walk: walk.to_vec() }),
            _ => return Err(short()),
        },
        "LOPQ" => match n {
            [r, ly] => l.opq.push((*r, *ly)),
            _ => return Err(short()),
        },
        "LDUP" => match n {
            [svc, a, b, w, na, rest @ ..] if rest.len() >= *na as usize => {
                let (wa, wb) = rest.split_at(*na as usize);
                l.dups.push(Dup { svc: *svc, a: *a, b: *b, w: *w, wa: wa.to_vec(), wb: wb.to_vec() });
            }
            _ => return Err(short()),
        },
        "LHUB" => match n {
            [svc, k, a, b] => l.hubs.push(Hub { svc: *svc, k: *k, a: *a, b: *b }),
            _ => return Err(short()),
        },
        _ => l.hub_min = *n.get(7).ok_or_else(short)?,
    }
    Ok(())
}

pub fn parse(text: &str) -> Result<Findings, String> {
    let mut f = Findings { cycles: vec![], cert: None, files: 0, edges: 0, cycle_count: 0, fm: vec![], fx: vec![], rcx: vec![], layers: None };
    let mut header = false;
    // Rows are parsed only inside the sections this reader consumes; a `pulsar-*`
    // header for any other section switches skipping on until the next header.
    let mut section = "";
    let num = |s: &str| s.parse::<u64>().map_err(|_| format!("bad number {s:?} in engine output"));
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut it = line.split_whitespace();
        let tag = it.next().unwrap();
        if let Some(name) = tag.strip_prefix("pulsar-") {
            section = match name {
                "findings" | "classctx" => name,
                "layers" => name,
                _ => "other",
            };
            if section == "findings" {
                header = true;
            }
            if section == "layers" {
                f.layers.get_or_insert_with(Layers::default);
            }
            continue;
        }
        if section.is_empty() || section == "other" {
            continue;
        }
        match tag {
            "CYC" => {
                let size = num(it.next().ok_or("CYC without size")?)? as usize;
                let ids = it.map(|s| num(s).map(|v| v as u32)).collect::<Result<Vec<_>, _>>()?;
                if ids.len() != size {
                    return Err(format!("CYC size {size} but {} members", ids.len()));
                }
                f.cycles.push(ids);
            }
            "CERT" => f.cert = Some(it.next() == Some("1")),
            tag @ ("LCYC" | "LCERT" | "LUNP" | "LOPQ" | "LDUP" | "LHUB" | "LS") => {
                let l = f.layers.as_mut().ok_or_else(|| format!("{tag} outside the `pulsar-layers 0` section"))?;
                let nums = it.map(|t| num(t).map(|v| v as u32)).collect::<Result<Vec<u32>, _>>()?;
                parse_layer_line(l, tag, &nums)?;
            }
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
                let mut v = [0u64; 5];
                for slot in &mut v {
                    *slot = num(it.next().ok_or("FM needs cyclomatic nesting npath length cognitive")?)?;
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
            "RCX" => {
                let mut n = || num(it.next().ok_or("RCX needs rule site fn callee")?).map(|v| v as u32);
                let (rule, site, fn_id, callee) = (n()?, n()?, n()?, n()?);
                f.rcx.push(Rcx { rule, site, fn_id, callee });
            }
            "RCXS" => {
                let n = num(it.next().ok_or("RCXS without a count")?)?;
                if n as usize != f.rcx.len() {
                    return Err(format!("RCXS says {n} but {} RCX lines came before it", f.rcx.len()));
                }
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

    #[cfg(unix)]
    #[test]
    fn a_symlinked_binary_finds_the_engine_beside_the_real_file() {
        let root = std::env::temp_dir().join(format!("pulsar-locate-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (bin, engine, link_dir) = (root.join("pulsar/bin"), root.join("pulsar/engine"), root.join("local/bin"));
        for d in [&bin, &engine, &link_dir] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(bin.join("pulsar"), b"cli").unwrap();
        std::fs::write(engine.join("pulsar-engine"), b"engine").unwrap();
        std::os::unix::fs::symlink(bin.join("pulsar"), link_dir.join("pulsar")).unwrap();
        let found = candidates(&link_dir.join("pulsar")).into_iter().find(|p| p.is_file());
        let want = std::fs::canonicalize(engine.join("pulsar-engine")).unwrap();
        let got = found.map(|p| std::fs::canonicalize(p).unwrap());
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(got, Some(want), "the engine beside the symlink target");
    }

    #[test]
    fn parses_cycles_metrics_and_findings() {
        let t = "pulsar-findings 0\nCYC 2 0 1\nCERT 1\nS 2 1 1\nFM 0 3 1 4 9 2\nFM 1 12 4 300 70 15\nFX core.cyclomatic 1 12 10\nFX core.nesting 1 4 3\n";
        let f = parse(t).unwrap();
        assert_eq!(f.cycles, vec![vec![0, 1]]);
        assert_eq!(f.fm, vec![[3, 1, 4, 9, 2], [12, 4, 300, 70, 15]]);
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
    fn parses_the_class_in_context_section() {
        let t = "pulsar-findings 0\nS 1 0 0\npulsar-classctx 0\nRCX 0 3 2 7\nRCX 1 4 2 8\nRCXS 2\n";
        let f = parse(t).unwrap();
        assert_eq!(f.rcx, vec![Rcx { rule: 0, site: 3, fn_id: 2, callee: 7 }, Rcx { rule: 1, site: 4, fn_id: 2, callee: 8 }]);
        assert!(parse("pulsar-findings 0\npulsar-classctx 0\nRCX 0 3 2 7\nRCXS 2\n").unwrap_err().contains("RCXS"));
        assert!(parse("pulsar-findings 0\nRCX 0 3 2\n").unwrap_err().contains("RCX needs"));
    }

    #[test]
    fn parses_the_layers_section() {
        let t = "pulsar-findings 0\nCERT 1\npulsar-layers 0\nLCYC 2 0 1\nLCERT 1\nLUNP 0 2 5 4 4 2\nLOPQ 1 3\nLDUP 7 0 1 2 2 2 0 2 1\nLHUB 5 12 9 3\nLS 4 3 2 1 1 1 1 10\n";
        let l = parse(t).unwrap().layers.unwrap();
        assert_eq!(l.cycles, vec![vec![0, 1]]);
        assert_eq!(l.cert, Some(true));
        assert_eq!(l.unp, vec![Unp { root: 0, layer: 2, svc: 5, via: 4, walk: vec![4, 2] }]);
        assert_eq!(l.opq, vec![(1, 3)]);
        assert_eq!(l.dups, vec![Dup { svc: 7, a: 0, b: 1, w: 2, wa: vec![2, 0], wb: vec![2, 1] }]);
        assert_eq!(l.hubs, vec![Hub { svc: 5, k: 12, a: 9, b: 3 }]);
        assert_eq!(l.hub_min, 10);
        assert!(parse("pulsar-findings 0\nLCYC 1 0\n").unwrap_err().contains("outside the"));
        assert!(parse("pulsar-findings 0\npulsar-layers 0\nLCYC 3 0 1\n").unwrap_err().contains("LCYC size"));
        assert!(parse("pulsar-findings 0\npulsar-layers 0\nLUNP 0 1\n").unwrap_err().contains("too few"));
    }

    #[test]
    fn rejects_out_of_order_fm_and_unknown_tags() {
        assert!(parse("pulsar-findings 0\nFM 1 0 0 0 0 0\n").unwrap_err().contains("out of order"));
        assert!(parse("pulsar-findings 0\nZZ 1\n").unwrap_err().contains("unknown"));
        assert!(parse("pulsar-findings 0\nFX core.nesting 1 4\n").unwrap_err().contains("threshold"));
    }
}
