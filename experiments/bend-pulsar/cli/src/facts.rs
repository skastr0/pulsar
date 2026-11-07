//! The one facts writer every lane uses.
//!
//! Lanes `push` rows for the relations in FACTS.md. `write_to` emits them canonically:
//! relations in the fixed order of [`Rel::ALL`], each relation's rows sorted left to right
//! with duplicates removed (FACTS.md "Rules"). A lane never formats a fact line itself, so no
//! lane can break sorting or dedup. Side tables (`.paths`, `.fns`) live in [`SideTables`].

use std::io::Write;
use std::path::Path;

/// Relations in FACTS.md, in emission order. Header relations (`N`, `M`, `H`) come before the
/// relations that depend on them. Add a relation here, and in FACTS.md, in the same commit.
#[allow(dead_code)] // lanes land after this module; the table is the shared contract
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rel {
    N,
    F,
    K,
    I,
    U,
    M,
    Fn,
    Fk,
    Ct,
    Tf,
    Mk,
    L,
    Lw,
    Lr,
    H,
    C,
    A,
    Cf,
    Cfn,
    Cv,
    Sy,
    Cl,
    Cs,
    Hd,
    Sv,
    Ly,
    Lq,
    Lp,
    Us,
    Rl,
}

impl Rel {
    pub const ALL: [Rel; 30] = [
        Rel::N,
        Rel::F,
        Rel::K,
        Rel::I,
        Rel::U,
        Rel::M,
        Rel::Fn,
        Rel::Fk,
        Rel::Ct,
        Rel::Tf,
        Rel::Mk,
        Rel::L,
        Rel::Lw,
        Rel::Lr,
        Rel::H,
        Rel::C,
        Rel::A,
        Rel::Cf,
        Rel::Cfn,
        Rel::Cv,
        Rel::Sy,
        Rel::Cl,
        Rel::Cs,
        Rel::Hd,
        Rel::Sv,
        Rel::Ly,
        Rel::Lq,
        Rel::Lp,
        Rel::Us,
        Rel::Rl,
    ];

    pub const fn tag(self) -> &'static str {
        match self {
            Rel::N => "N",
            Rel::F => "F",
            Rel::K => "K",
            Rel::I => "I",
            Rel::U => "U",
            Rel::M => "M",
            Rel::Fn => "FN",
            Rel::Fk => "FK",
            Rel::Ct => "CT",
            Rel::Tf => "TF",
            Rel::Mk => "MK",
            Rel::L => "L",
            Rel::Lw => "LW",
            Rel::Lr => "LR",
            Rel::H => "H",
            Rel::C => "C",
            Rel::A => "A",
            Rel::Cf => "CF",
            Rel::Cfn => "CFN",
            Rel::Cv => "CV",
            Rel::Sy => "SY",
            Rel::Cl => "CL",
            Rel::Cs => "CS",
            Rel::Hd => "HD",
            Rel::Sv => "SV",
            Rel::Ly => "LY",
            Rel::Lq => "LQ",
            Rel::Lp => "LP",
            Rel::Us => "US",
            Rel::Rl => "RL",
        }
    }

    /// Number of U32 fields after the tag.
    pub const fn arity(self) -> usize {
        match self {
            Rel::N | Rel::M | Rel::Sy | Rel::Tf | Rel::L => 1,
            Rel::F | Rel::U | Rel::H | Rel::A | Rel::Cl | Rel::Lq | Rel::Us | Rel::Sv | Rel::Lr => 2,
            Rel::K | Rel::Fk | Rel::C | Rel::Cfn | Rel::Cv | Rel::Hd | Rel::Ly | Rel::Lp | Rel::Mk | Rel::Lw => 3,
            Rel::Fn | Rel::Ct | Rel::Cf | Rel::Rl => 4,
            Rel::I | Rel::Cs => 5,
        }
    }

    const fn idx(self) -> usize {
        self as usize
    }
}

/// Number of facts written per relation, after dedup.
#[derive(Default, Clone)]
pub struct Counts([usize; Rel::ALL.len()]);

impl Counts {
    pub fn get(&self, rel: Rel) -> usize {
        self.0[rel.idx()]
    }
}

/// Collects rows per relation; rows are stored flat (`arity` U32s each) to keep memory low.
pub struct FactWriter {
    rows: [Vec<u32>; Rel::ALL.len()],
    header: &'static str,
}

impl Default for FactWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl FactWriter {
    pub fn new() -> Self {
        FactWriter { rows: std::array::from_fn(|_| Vec::new()), header: "pulsar-facts 0" }
    }

    /// Add one fact. Panics if `row.len()` is not the relation's arity: a lane bug, not input.
    pub fn push(&mut self, rel: Rel, row: &[u32]) {
        assert_eq!(row.len(), rel.arity(), "relation {} takes {} fields", rel.tag(), rel.arity());
        self.rows[rel.idx()].extend_from_slice(row);
    }

    /// Reserve room for `rows` more rows of `rel`, so a lane that knows its count avoids the
    /// doubling slack of a growing vector.
    pub fn reserve(&mut self, rel: Rel, rows: usize) {
        self.rows[rel.idx()].reserve_exact(rows * rel.arity());
    }

    /// Fold another writer (for example a per-thread shard) into this one.
    #[allow(dead_code)]
    pub fn merge(&mut self, other: FactWriter) {
        for (mine, theirs) in self.rows.iter_mut().zip(other.rows) {
            mine.extend(theirs);
        }
    }

    /// Emit the canonical text: header, then every relation sorted and deduped.
    pub fn write_to(self, out: &mut dyn Write) -> Result<Counts, String> {
        let w = |e: std::io::Error| format!("write: {e}");
        let mut buf = std::io::BufWriter::with_capacity(1 << 20, out);
        writeln!(buf, "{}", self.header).map_err(w)?;
        let mut counts = Counts::default();
        let mut line: Vec<u8> = Vec::with_capacity(64);
        for rel in Rel::ALL {
            let data = &self.rows[rel.idx()];
            let k = rel.arity();
            let n = data.len() / k;
            let row = |i: u32| &data[i as usize * k..(i as usize + 1) * k];
            // Lanes that push in canonical order (strictly increasing rows) skip the index sort.
            let sorted = (1..n as u32).all(|i| row(i - 1) < row(i));
            let order: Vec<u32> = if sorted {
                Vec::new()
            } else {
                let mut o: Vec<u32> = (0..n as u32).collect();
                o.sort_unstable_by(|&a, &b| row(a).cmp(row(b)));
                o
            };
            let mut prev: Option<&[u32]> = None;
            for pos in 0..n {
                let i = if sorted { pos as u32 } else { order[pos] };
                let r = row(i);
                if prev == Some(r) {
                    continue;
                }
                prev = Some(r);
                line.clear();
                line.extend_from_slice(rel.tag().as_bytes());
                for v in r {
                    line.push(b' ');
                    push_u32(&mut line, *v);
                }
                line.push(b'\n');
                buf.write_all(&line).map_err(w)?;
                counts.0[rel.idx()] += 1;
            }
        }
        buf.flush().map_err(w)?;
        Ok(counts)
    }
}

fn push_u32(out: &mut Vec<u8>, mut v: u32) {
    let mut tmp = [0u8; 10];
    let mut i = tmp.len();
    loop {
        i -= 1;
        tmp[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    out.extend_from_slice(&tmp[i..]);
}

/// Stable file key: FNV-1a 64 over the UTF-8 bytes of the repo-relative path
/// (offset basis 0xcbf29ce484222325, prime 0x100000001b3). `K` emits (hi, lo) U32 halves.
pub fn stable_key(rel: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in rel.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// One row of the `.fns` side table (FACTS.md "Side tables"). The function id is the row index.
#[allow(dead_code)]
pub struct FnEntry {
    /// File id; the path comes from `SideTables::paths`.
    pub file: u32,
    /// 1-based, inclusive.
    pub start_line: u32,
    pub end_line: u32,
    /// Enclosing function id, or `None` at top level.
    pub parent: Option<u32>,
    /// The `FK` kind number (0-7), as FACTS.md defines it.
    pub kind: u8,
    /// Container names outermost first, ending with the function itself, joined by `>`.
    pub chain: String,
}

/// Strings the engine never sees: paths by file id, and function spans by function id.
#[derive(Default)]
pub struct SideTables {
    pub paths: Vec<String>,
    pub fns: Vec<FnEntry>,
}

impl SideTables {
    /// Write `<base>.paths` and `<base>.fns` next to the facts file.
    pub fn write(&self, base: &Path) -> Result<(), String> {
        let sibling = |ext: &str| {
            let mut p = base.as_os_str().to_owned();
            p.push(ext);
            std::path::PathBuf::from(p)
        };
        let mut s = String::with_capacity(self.paths.iter().map(|f| f.len() + 1).sum());
        for f in &self.paths {
            s.push_str(f);
            s.push('\n');
        }
        let p = sibling(".paths");
        std::fs::write(&p, s).map_err(|e| format!("{}: {e}", p.display()))?;

        let p = sibling(".fns");
        let file = std::fs::File::create(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        let mut out = std::io::BufWriter::new(file);
        for (id, f) in self.fns.iter().enumerate() {
            let path = self.paths.get(f.file as usize).map(String::as_str).unwrap_or("");
            let parent = f.parent.map_or("-".to_string(), |p| p.to_string());
            writeln!(out, "{id}\t{path}\t{}\t{}\t{parent}\t{}\t{}", f.start_line, f.end_line, f.kind, f.chain)
                .map_err(|e| format!("{}: {e}", p.display()))?;
        }
        out.flush().map_err(|e| format!("{}: {e}", p.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(w: FactWriter) -> String {
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn rows_are_sorted_left_to_right_and_deduped() {
        let mut w = FactWriter::new();
        w.push(Rel::I, &[1, 0, 0, 1, 0]);
        w.push(Rel::I, &[0, 2, 0, 1, 0]);
        w.push(Rel::I, &[0, 1, 2, 1, 0]);
        w.push(Rel::I, &[0, 2, 0, 1, 0]);
        assert_eq!(render(w), "pulsar-facts 0\nI 0 1 2 1 0\nI 0 2 0 1 0\nI 1 0 0 1 0\n");
    }

    #[test]
    fn relations_follow_the_fixed_order_not_push_order() {
        let mut w = FactWriter::new();
        w.push(Rel::U, &[0, 1]);
        w.push(Rel::N, &[1]);
        w.push(Rel::Cv, &[0, 1, 2]);
        w.push(Rel::F, &[0, 1]);
        assert_eq!(render(w), "pulsar-facts 0\nN 1\nF 0 1\nU 0 1\nCV 0 1 2\n");
    }

    #[test]
    fn merge_dedups_across_shards() {
        let (mut a, mut b) = (FactWriter::new(), FactWriter::new());
        a.push(Rel::Sy, &[3]);
        b.push(Rel::Sy, &[3]);
        b.push(Rel::Sy, &[1]);
        a.merge(b);
        assert_eq!(render(a), "pulsar-facts 0\nSY 1\nSY 3\n");
    }

    #[test]
    fn sorted_rows_take_the_fast_path_and_print_the_same_text() {
        let mut sorted = FactWriter::new();
        let mut shuffled = FactWriter::new();
        let rows: [[u32; 4]; 4] = [[0, 1, 0, 1], [0, 2, 1, 2], [1, 1, 0, 4_294_967_295], [1, 2, 1, 10]];
        for r in rows {
            sorted.push(Rel::Ct, &r);
        }
        for r in [rows[2], rows[0], rows[3], rows[1], rows[0]] {
            shuffled.push(Rel::Ct, &r);
        }
        let text = render(sorted);
        assert_eq!(text, render(shuffled));
        assert_eq!(text, "pulsar-facts 0\nCT 0 1 0 1\nCT 0 2 1 2\nCT 1 1 0 4294967295\nCT 1 2 1 10\n");
    }

    #[test]
    #[should_panic(expected = "takes 5 fields")]
    fn wrong_arity_is_a_lane_bug() {
        FactWriter::new().push(Rel::I, &[0, 1]);
    }

    #[test]
    fn fns_table_is_tab_separated_with_parent_and_kind() {
        let dir = std::env::temp_dir().join(format!("pulsar-fns-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let t = SideTables {
            paths: vec!["src/a b.ts".into()],
            fns: vec![
                FnEntry { file: 0, start_line: 10, end_line: 22, parent: None, kind: 1, chain: "Foo>bar".into() },
                FnEntry { file: 0, start_line: 12, end_line: 14, parent: Some(0), kind: 3, chain: "Foo>bar>#0".into() },
            ],
        };
        t.write(&dir.join("f")).unwrap();
        let got = std::fs::read_to_string(dir.join("f.fns")).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(got, "0\tsrc/a b.ts\t10\t22\t-\t1\tFoo>bar\n1\tsrc/a b.ts\t12\t14\t0\t3\tFoo>bar>#0\n");
    }
}
