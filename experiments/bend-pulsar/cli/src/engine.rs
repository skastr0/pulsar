//! Run the Bend engine and parse its numeric findings (FACTS.md "Engine output (v0)").

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Default)]
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
    /// The `pulsar-sql 0` section, when an `SR` row switched SQL rules on.
    pub sql: Option<Sql>,
    /// `NX`: fan-out findings (`pulsar-fanout 0`), in engine order.
    pub nx: Vec<Nx>,
    /// `KX`: constant-argument findings (`pulsar-konst 0`).
    pub kx: Vec<Kx>,
    /// `HX`: hot-path findings (`pulsar-hot 0`).
    pub hx: Vec<Hx>,
    /// `RCXN rule n`: the number of `RCX` findings of each class rule that has any.
    pub rcxn: Vec<(u32, u64)>,
    /// `ECX rule site fn target`: call-edge findings (`pulsar-fnctx 0`); `callee` is the target function.
    pub ecx: Vec<Rcx>,
    /// `FMX rule file`: module findings (`pulsar-fnctx 0`).
    pub fmx: Vec<(u32, u32)>,
    /// `UX`: untested data access (`pulsar-untested 0`).
    pub ux: Vec<Ux>,
    /// `GX`: unbounded growth (`pulsar-grow 0`).
    pub gx: Vec<Gx>,
    /// The `SQD ok skipped complete` line of the `pulsar-grow 0` section, when the section ran.
    pub grow_schema: Option<(u32, u32, bool)>,
    /// The `pulsar-binding 0` section, when the facts had a `BF` row.
    pub binding: Option<Binding>,
}

/// `BFX rule dep bind value thr declared`: deployable `dep` declares `declared` bindings, `value` of
/// them unread; `bind` is one, and `thr` the rule's threshold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bfx {
    pub rule: String,
    pub dep: u32,
    pub bind: u32,
    pub value: u32,
    pub thr: u32,
    pub declared: u32,
}

/// The binding-drift section: the `BFX` lines and `BFS n`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Binding {
    pub xs: Vec<Bfx>,
}

/// `UX rule fn reason`: function `fn_id` runs a query and `reason` is 1 (it has a `core.crap`
/// finding) or 2 (the coverage report has no data for it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ux {
    pub rule: u32,
    pub fn_id: u32,
    pub reason: u32,
}

/// `GX rule rs table ws`: unbounded-growth rule `rule`; the read at `QS` site `rs` has no row bound
/// on `table` (a name id), and the insert at site `ws` is reached from an entry point.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gx {
    pub rule: u32,
    pub rs: u32,
    pub table: u32,
    pub ws: u32,
}

/// `NX rule site fn via kind`: fan-out rule `rule` (an `RF` rule number) at call site `site` of
/// function `fn_id`. `kind` 0: the site calls `via`, a symbol (`SY` id) of the rule's class. `kind` 1:
/// the site calls repo function `via` (a function id) that reaches such a call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Nx {
    pub rule: u32,
    pub site: u32,
    pub fn_id: u32,
    pub via: u32,
    pub kind: u32,
}

/// `KX rule site fn callee pos`: constant-argument rule `rule` (an `RK` rule number) at `site`, a call
/// of symbol `callee` whose argument `pos` is a constant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Kx {
    pub rule: u32,
    pub site: u32,
    pub fn_id: u32,
    pub callee: u32,
    pub pos: u32,
}

/// `HX rule lane base site fn`: hot-path rule `rule` (an `RH` rule number) on a base finding of lane
/// `lane` and rule `base`, at `site`, in function `fn_id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hx {
    pub rule: u32,
    pub lane: u32,
    pub base: u32,
    pub site: u32,
    pub fn_id: u32,
}

/// What an `SQX` line is about: a query site, or a foreign key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlKind {
    Site,
    Fk,
}

/// `SQX <rule> site|fk <id> <table> <col> <detail>`; table and col are 4294967295 when none, and
/// for a foreign key `detail` is the referenced table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sqx {
    pub rule: String,
    pub kind: SqlKind,
    pub id: u32,
    pub table: u32,
    pub col: u32,
    pub detail: u32,
}

/// The SQL rules section: `SQD ok skipped complete`, the `SQX` lines, and `SQS n`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Sql {
    pub ok: u32,
    pub skipped: u32,
    pub complete: bool,
    pub xs: Vec<Sqx>,
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
    let mut f = Findings::default();
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
                "sql" | "fanout" | "konst" | "hot" | "untested" | "grow" | "fnctx" | "binding" => name,
                _ => "other",
            };
            if section == "findings" {
                header = true;
            }
            if section == "layers" {
                f.layers.get_or_insert_with(Layers::default);
            }
            if section == "sql" {
                f.sql.get_or_insert_with(Sql::default);
            }
            if section == "binding" {
                f.binding.get_or_insert_with(Binding::default);
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
            "SQD" if section == "grow" => {
                let n = it.map(|t| num(t).map(|v| v as u32)).collect::<Result<Vec<u32>, _>>()?;
                let [ok, skipped, complete] = n[..] else { return Err("SQD needs ok skipped complete".into()) };
                f.grow_schema = Some((ok, skipped, complete == 1));
            }
            "SQD" | "SQX" | "SQS" if section != "sql" => return Err(format!("{tag} outside the `pulsar-sql 0` section")),
            "SQD" => {
                let n = it.map(|t| num(t).map(|v| v as u32)).collect::<Result<Vec<u32>, _>>()?;
                let [ok, skipped, complete] = n[..] else { return Err("SQD needs ok skipped complete".into()) };
                let s = f.sql.get_or_insert_with(Sql::default);
                (s.ok, s.skipped, s.complete) = (ok, skipped, complete == 1);
            }
            "SQX" => {
                let rule = it.next().ok_or("SQX without a rule")?.to_string();
                let kind = match it.next() {
                    Some("site") => SqlKind::Site,
                    Some("fk") => SqlKind::Fk,
                    other => return Err(format!("SQX kind {other:?} is not site or fk")),
                };
                let n = it.map(|t| num(t).map(|v| v as u32)).collect::<Result<Vec<u32>, _>>()?;
                let [id, table, col, detail] = n[..] else { return Err("SQX needs id table col detail".into()) };
                f.sql.get_or_insert_with(Sql::default).xs.push(Sqx { rule, kind, id, table, col, detail });
            }
            "SQS" => {
                let n = num(it.next().ok_or("SQS without a count")?)? as usize;
                let have = f.sql.as_ref().map_or(0, |s| s.xs.len());
                if n != have {
                    return Err(format!("SQS says {n} but {have} SQX lines came before it"));
                }
            }
            "BFX" if section != "binding" => return Err("BFX outside the `pulsar-binding 0` section".into()),
            "BFX" => {
                let rule = it.next().ok_or("BFX without a rule")?.to_string();
                let mut n = [0u32; 4];
                for slot in &mut n {
                    *slot = num(it.next().ok_or("BFX needs dep bind value thr")?)? as u32;
                }
                let tail = it.next().ok_or("BFX lacks the declared=<d> evidence")?;
                let declared: u32 = tail
                    .strip_prefix("declared=")
                    .and_then(|d| d.parse().ok())
                    .ok_or_else(|| format!("BFX evidence {tail:?} is not declared=<d>"))?;
                let [dep, bind, value, thr] = n;
                f.binding.get_or_insert_with(Binding::default).xs.push(Bfx { rule, dep, bind, value, thr, declared });
            }
            "BFS" => {
                let n = num(it.next().ok_or("BFS without a count")?)? as usize;
                let have = f.binding.as_ref().map_or(0, |b| b.xs.len());
                if n != have {
                    return Err(format!("BFS says {n} but {have} BFX lines came before it"));
                }
            }
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
            "RCXN" => {
                let rule = num(it.next().ok_or("RCXN needs rule n")?)? as u32;
                let n = num(it.next().ok_or("RCXN needs rule n")?)?;
                f.rcxn.push((rule, n));
            }
            "ECX" | "FMX" | "FNCS" if section != "fnctx" => return Err(format!("{tag} outside the `pulsar-fnctx 0` section")),
            "ECX" => {
                let mut n = || num(it.next().ok_or("ECX needs rule site fn target")?).map(|v| v as u32);
                let (rule, site, fn_id, callee) = (n()?, n()?, n()?, n()?);
                f.ecx.push(Rcx { rule, site, fn_id, callee });
            }
            "FMX" => {
                let mut n = || num(it.next().ok_or("FMX needs rule file")?).map(|v| v as u32);
                let (rule, file) = (n()?, n()?);
                f.fmx.push((rule, file));
            }
            "FNCS" => {
                let n = num(it.next().ok_or("FNCS without a count")?)? as usize;
                if n != f.ecx.len() + f.fmx.len() {
                    return Err(format!("FNCS says {n} but {} ECX and FMX lines came before it", f.ecx.len() + f.fmx.len()));
                }
            }
            "NX" | "KX" | "HX" => {
                let want = match tag { "NX" => "fanout", "KX" => "konst", _ => "hot" };
                if section != want {
                    return Err(format!("{tag} outside the `pulsar-{want} 0` section"));
                }
                let n = it.map(|t| num(t).map(|v| v as u32)).collect::<Result<Vec<u32>, _>>()?;
                match (tag, n[..].try_into()) {
                    ("NX", Ok::<[u32; 5], _>([rule, site, fn_id, via, kind])) => f.nx.push(Nx { rule, site, fn_id, via, kind }),
                    ("KX", Ok::<[u32; 5], _>([rule, site, fn_id, callee, pos])) => f.kx.push(Kx { rule, site, fn_id, callee, pos }),
                    ("HX", Ok::<[u32; 5], _>([rule, lane, base, site, fn_id])) => f.hx.push(Hx { rule, lane, base, site, fn_id }),
                    _ => return Err(format!("{tag} needs five numbers, got {}", n.len())),
                }
            }
            "UX" | "GX" => {
                let want = if tag == "UX" { "untested" } else { "grow" };
                if section != want {
                    return Err(format!("{tag} outside the `pulsar-{want} 0` section"));
                }
                let n = it.map(|t| num(t).map(|v| v as u32)).collect::<Result<Vec<u32>, _>>()?;
                match (tag, n.len()) {
                    ("UX", 3) => f.ux.push(Ux { rule: n[0], fn_id: n[1], reason: n[2] }),
                    ("GX", 4) => f.gx.push(Gx { rule: n[0], rs: n[1], table: n[2], ws: n[3] }),
                    _ => return Err(format!("{tag} has {} numbers", n.len())),
                }
            }
            "UXS" | "GXS" => {
                let (want, have) = if tag == "UXS" { ("untested", f.ux.len()) } else { ("grow", f.gx.len()) };
                if section != want {
                    return Err(format!("{tag} outside the `pulsar-{want} 0` section"));
                }
                let n = num(it.next().ok_or_else(|| format!("{tag} without a count"))?)? as usize;
                if n != have {
                    return Err(format!("{tag} says {n} but {have} lines came before it"));
                }
            }
            "NXS" | "KXS" | "HXS" => {
                let (want, have) = match tag { "NXS" => ("fanout", f.nx.len()), "KXS" => ("konst", f.kx.len()), _ => ("hot", f.hx.len()) };
                if section != want {
                    return Err(format!("{tag} outside the `pulsar-{want} 0` section"));
                }
                let n = num(it.next().ok_or_else(|| format!("{tag} without a count"))?)? as usize;
                if n != have {
                    return Err(format!("{tag} says {n} but {have} lines came before it"));
                }
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
        let f = parse("pulsar-findings 0\npulsar-classctx 0\nRCX 0 3 2 7\nRCX 0 4 2 7\nRCXN 0 2\nRCXS 2\n").unwrap();
        assert_eq!(f.rcxn, vec![(0, 2)]);
    }

    #[test]
    fn parses_the_function_context_section() {
        let t = "pulsar-findings 0\npulsar-fnctx 0\nECX 5 10 3 0\nECX 5 13 3 2\nFMX 6 0\nFNCS 3\n";
        let f = parse(t).unwrap();
        assert_eq!(f.ecx, vec![Rcx { rule: 5, site: 10, fn_id: 3, callee: 0 }, Rcx { rule: 5, site: 13, fn_id: 3, callee: 2 }]);
        assert_eq!(f.fmx, vec![(6, 0)]);
        assert!(parse("pulsar-findings 0\npulsar-fnctx 0\nFMX 6 0\nFNCS 2\n").unwrap_err().contains("FNCS says 2"));
        assert!(parse("pulsar-findings 0\nFMX 6 0\n").unwrap_err().contains("outside"));
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
    fn parses_the_binding_section() {
        let t = "pulsar-findings 0\nCERT 1\nS 1 0 0\npulsar-binding 0\nBFX cloudflare.binding-drift 0 3 2 0 declared=5\nBFS 1\n";
        let b = parse(t).unwrap().binding.unwrap();
        assert_eq!(b.xs, vec![Bfx { rule: "cloudflare.binding-drift".into(), dep: 0, bind: 3, value: 2, thr: 0, declared: 5 }]);
        assert!(parse("pulsar-findings 0\nBFX cloudflare.binding-drift 0 3 2 0 declared=5\n").unwrap_err().contains("outside"));
        assert!(parse("pulsar-findings 0\npulsar-binding 0\nBFX cloudflare.binding-drift 0 3 2 0 declared=5\nBFS 0\n").unwrap_err().contains("BFS"));
    }

    #[test]
    fn parses_the_sql_rules_section() {
        let t = "pulsar-findings 0\nCERT 1\npulsar-sql 0\nSQD 4 1 0\nSQX sql.unindexed-filter site 3 7 2 0\nSQX sql.fk-unindexed fk 0 7 2 9\nSQS 2\n";
        let s = parse(t).unwrap().sql.unwrap();
        assert_eq!((s.ok, s.skipped, s.complete), (4, 1, false));
        assert_eq!(s.xs[0], Sqx { rule: "sql.unindexed-filter".into(), kind: SqlKind::Site, id: 3, table: 7, col: 2, detail: 0 });
        assert_eq!(s.xs[1].kind, SqlKind::Fk);
        assert!(parse("pulsar-findings 0\nSQD 1 0 1\n").unwrap_err().contains("outside"));
        assert!(parse("pulsar-findings 0\npulsar-sql 0\nSQX sql.x site 1 2 3 4\nSQS 2\n").unwrap_err().contains("SQS says 2"));
        assert!(parse("pulsar-findings 0\npulsar-sql 0\nSQX sql.x row 1 2 3 4\n").unwrap_err().contains("not site or fk"));
    }

    #[test]
    fn rejects_out_of_order_fm_and_unknown_tags() {
        assert!(parse("pulsar-findings 0\nFM 1 0 0 0 0 0\n").unwrap_err().contains("out of order"));
        assert!(parse("pulsar-findings 0\nZZ 1\n").unwrap_err().contains("unknown"));
        assert!(parse("pulsar-findings 0\nFX core.nesting 1 4\n").unwrap_err().contains("threshold"));
    }
}
