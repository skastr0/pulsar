//! The per-sha delta, decided by the engine (FACTS.md "Delta", `engine/Delta.bend`).
//!
//! `pulsar delta` writes both shas' finding keys (`KB`, `KH` with a class) and the measures of the
//! functions it reports trends for (`MB`, `MH`) into a facts file with an empty graph, and the
//! engine prints what was added, allowed, removed, needs coverage, worsened and improved
//! (`Delta-LAWS.bend` D1-D6 and C1-C6). This module only writes those rows and reads the lines back.

use std::fmt::Write as _;
use std::path::Path;

/// `KH` classes.
pub const PLAIN: u32 = 0;
pub const COVERAGE: u32 = 1;
pub const ALLOWED: u32 = 2;

fn hi_lo(k: u64) -> (u64, u64) {
    (k >> 32, k & 0xffff_ffff)
}

fn key(hi: u64, lo: u64) -> Result<u64, String> {
    if hi > 0xffff_ffff || lo > 0xffff_ffff {
        return Err(format!("engine delta key {hi} {lo} is not two U32s"));
    }
    Ok(hi << 32 | lo)
}

/// The facts file for one engine delta run.
pub struct Rows {
    text: String,
}

impl Rows {
    pub fn new() -> Self {
        Rows { text: "pulsar-facts 0\nN 1\nF 0 1\nKD 0\n".to_string() }
    }

    /// A base finding key (already mapped onto its head key when git's rename matching paired it).
    pub fn base(&mut self, k: u64) {
        let (h, l) = hi_lo(k);
        let _ = writeln!(self.text, "KB {h} {l}");
    }

    pub fn head(&mut self, k: u64, cls: u32) {
        let (h, l) = hi_lo(k);
        let _ = writeln!(self.text, "KH {h} {l} {cls}");
    }

    /// Measure `m` of function `k` at base (`tag` MB) or head (MH). A value the engine's U32 cannot
    /// hold refuses the run rather than being cut.
    fn measure(&mut self, tag: &str, k: u64, m: u32, v: u64) -> Result<(), String> {
        if v > 0xffff_ffff {
            return Err(format!("measure {m} of function {k:016x} is {v}, above what the engine delta reads"));
        }
        let (h, l) = hi_lo(k);
        let _ = writeln!(self.text, "{tag} {h} {l} {m} {v}");
        Ok(())
    }

    pub fn measure_base(&mut self, k: u64, m: u32, v: u64) -> Result<(), String> {
        self.measure("MB", k, m, v)
    }

    pub fn measure_head(&mut self, k: u64, m: u32, v: u64) -> Result<(), String> {
        self.measure("MH", k, m, v)
    }
}

/// One measure that moved: (function key, metric, base value, head value).
pub type Move = (u64, u32, u64, u64);

/// The engine's delta section, each list in key order.
#[derive(Debug, Default, PartialEq)]
pub struct Out {
    pub added: Vec<u64>,
    pub allowed: Vec<u64>,
    pub coverage: Vec<u64>,
    pub removed: Vec<u64>,
    pub unchanged: usize,
    pub worse: Vec<Move>,
    pub better: Vec<Move>,
}

/// One `KDA`/`KDL`/`KDC`/`KDR` (a key) or `KDW`/`KDI` (a key, metric and two values) line.
fn row(o: &mut Out, tag: &str, n: &[u64]) -> Result<(), String> {
    let list = match tag {
        "KDA" => &mut o.added,
        "KDL" => &mut o.allowed,
        "KDC" => &mut o.coverage,
        "KDR" => &mut o.removed,
        "KDW" | "KDI" => {
            let [h, l, m, vb, vh] = <[u64; 5]>::try_from(n).map_err(|_| "wrong number of fields")?;
            let mv = (key(h, l)?, u32::try_from(m).map_err(|_| "metric is not a U32")?, vb, vh);
            if tag == "KDW" { o.worse.push(mv) } else { o.better.push(mv) }
            return Ok(());
        }
        other => return Err(format!("unknown engine delta line tag {other:?}")),
    };
    let [h, l] = <[u64; 2]>::try_from(n).map_err(|_| "wrong number of fields")?;
    list.push(key(h, l)?);
    Ok(())
}

/// Read the `pulsar-delta 0` section of the engine's output. Anything else in that section, a
/// missing or repeated section or `KDS` line, or a `KDS` count that disagrees with the lines, is an
/// error: the CLI never prints a delta the engine did not.
pub fn parse(text: &str) -> Result<Out, String> {
    let mut o = Out::default();
    let (mut sections, mut in_delta, mut kds) = (0, false, None);
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let mut it = line.split_whitespace();
        let tag = it.next().unwrap_or_default();
        if tag.starts_with("pulsar-") {
            in_delta = line == "pulsar-delta 0";
            sections += usize::from(in_delta);
            continue;
        }
        if !in_delta {
            continue;
        }
        let n = it.map(|s| s.parse::<u64>().map_err(|_| format!("bad number {s:?} in engine line {line:?}"))).collect::<Result<Vec<_>, _>>()?;
        if tag == "KDS" {
            match (n.as_slice(), kds) {
                ([a, al, c, r, s, w, b], None) => kds = Some([*a, *al, *c, *r, *s, *w, *b]),
                _ => return Err(format!("engine delta line {line:?} is a repeated or malformed KDS")),
            }
        } else {
            row(&mut o, tag, &n).map_err(|e| format!("engine delta line {line:?}: {e}"))?;
        }
    }
    if sections != 1 {
        return Err(format!("engine printed {sections} delta sections, expected 1"));
    }
    let s = kds.ok_or("engine delta section has no KDS line")?;
    let lens = [o.added.len(), o.allowed.len(), o.coverage.len(), o.removed.len(), s[4] as usize, o.worse.len(), o.better.len()];
    if lens.iter().zip(s).any(|(n, k)| *n as u64 != k) {
        return Err(format!("engine KDS {s:?} disagrees with its lines {lens:?}"));
    }
    o.unchanged = s[4] as usize;
    Ok(o)
}

/// Run the engine on `rows`, through a facts file in `dir`.
pub fn run(engine: &Path, rows: &Rows, dir: &Path, name: &str) -> Result<Out, String> {
    let p = dir.join(name);
    std::fs::write(&p, &rows.text).map_err(|e| format!("{}: {e}", p.display()))?;
    parse(&crate::engine::run_raw(engine, &p)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_split_keys_into_two_u32s() {
        let mut r = Rows::new();
        r.base(0x0000_0001_0000_0002);
        r.head(0xffff_ffff_0000_0000, ALLOWED);
        r.measure_base(5, 2, 300).unwrap();
        r.measure_head(5, 2, 16_777_215).unwrap();
        assert_eq!(r.text, "pulsar-facts 0\nN 1\nF 0 1\nKD 0\nKB 1 2\nKH 4294967295 0 2\nMB 0 5 2 300\nMH 0 5 2 16777215\n");
        assert!(r.measure_head(5, 3, 1 << 32).unwrap_err().contains("above"));
    }

    #[test]
    fn parse_reads_the_fixture_output() {
        // engine/fixtures/delta.expected
        let t = "pulsar-findings 0\nCERT 1\nS 1 0 0\npulsar-delta 0\nKDA 0 9\nKDA 1 3\nKDL 4 0\nKDC 2 5\nKDC 5 0\nKDR 1 2\nKDR 3 0\nKDW 7 7 0 10 12\nKDI 7 7 1 3 2\nKDS 2 1 2 2 1 1 1\n";
        let o = parse(t).unwrap();
        let k = |h: u64, l: u64| h << 32 | l;
        assert_eq!(o.added, vec![k(0, 9), k(1, 3)]);
        assert_eq!(o.allowed, vec![k(4, 0)]);
        assert_eq!(o.coverage, vec![k(2, 5), k(5, 0)]);
        assert_eq!(o.removed, vec![k(1, 2), k(3, 0)]);
        assert_eq!(o.unchanged, 1);
        assert_eq!(o.worse, vec![(k(7, 7), 0, 10, 12)]);
        assert_eq!(o.better, vec![(k(7, 7), 1, 3, 2)]);
    }

    #[test]
    fn parse_refuses_what_the_engine_did_not_say() {
        assert!(parse("pulsar-findings 0\nCERT 1\n").unwrap_err().contains("0 delta sections"));
        assert!(parse("pulsar-delta 0\nKDA 0 1\n").unwrap_err().contains("no KDS"));
        assert!(parse("pulsar-delta 0\nKDA 0 1\nKDS 0 0 0 0 0 0 0\n").unwrap_err().contains("disagrees"));
        assert!(parse("pulsar-delta 0\nKDA 0\nKDS 1 0 0 0 0 0 0\n").unwrap_err().contains("wrong number"));
        assert!(parse("pulsar-delta 0\nKDW 0 1 2 3\nKDS 0 0 0 0 0 1 0\n").unwrap_err().contains("wrong number"));
        assert!(parse("pulsar-delta 0\nKDX 0 1\nKDS 0 0 0 0 0 0 0\n").unwrap_err().contains("unknown"));
        assert!(parse("pulsar-delta 0\nKDS 0 0 0 0 0 0 0\nKDS 0 0 0 0 0 0 0\n").is_err());
        assert!(parse("pulsar-delta 0\nKDS 0 0 0 0 0 0 0\npulsar-delta 0\nKDS 0 0 0 0 0 0 0\n").is_err());
    }
}
