//! `.fns` side table → function spans, and report lines → the owning function.
//!
//! The innermost rule is the contract's: a line belongs to the function with the largest
//! `start_line` whose span contains it, so a nested closure owns its own lines and functions
//! partition a report's lines. Ties break by smallest `end_line`, then largest function id, so
//! the result never depends on iteration order.

use crate::facts::SideTables;
use std::collections::BTreeMap;

use super::FileLines;

/// One function's span, with its path resolved through the side table.
#[derive(Debug)]
pub struct Span<'a> {
    pub id: u32,
    pub path: &'a str,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Default)]
pub struct Assignment {
    /// `(fn, covered, coverable)`, ascending by function id.
    pub cv: Vec<(u32, u32, u32)>,
    /// Report lines that landed on a function.
    pub assigned: usize,
    /// Report lines no function span contains (module level, or a function the adapter skipped).
    pub unassigned: usize,
}

/// Resolve every side-table function to its path. A function whose file id is out of range is
/// a lane bug in whatever wrote the table, so it is an error rather than a silent skip.
pub fn spans(tables: &SideTables) -> Result<Vec<Span<'_>>, String> {
    let mut out = Vec::with_capacity(tables.fns.len());
    for (id, f) in tables.fns.iter().enumerate() {
        let path = tables.paths.get(f.file as usize).ok_or_else(|| {
            format!("coverage: fn {id} points at file {} of {}", f.file, tables.paths.len())
        })?;
        if f.start_line == 0 || f.end_line < f.start_line {
            return Err(format!(
                "coverage: fn {id} span {}..{} is not a line range",
                f.start_line, f.end_line
            ));
        }
        out.push(Span { id: id as u32, path, start_line: f.start_line, end_line: f.end_line });
    }
    Ok(out)
}

#[derive(Clone, Copy)]
struct Sig {
    start: u32,
    end: u32,
    id: u32,
}

/// A start-group: one `start_line` shared by the signatures in `lo..hi`.
struct Group {
    start: u32,
    lo: usize,
    hi: usize,
}

/// Owner of `line`: largest `start_line` containing it, then smallest `end_line`, then largest id.
fn owner(groups: &[Group], sigs: &[Sig], line: u32) -> Option<u32> {
    let mut lo = 0usize;
    let mut hi = groups.len();
    while lo < hi {
        let mid = (lo + hi) / 2;
        if groups[mid].start <= line {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    for g in groups[..lo].iter().rev() {
        for sig in &sigs[g.lo..g.hi] {
            if sig.end >= line {
                return Some(sig.id);
            }
        }
    }
    None
}

pub fn assign(lines: &BTreeMap<String, FileLines>, spans: &[Span<'_>]) -> Assignment {
    let mut by_path: BTreeMap<&str, Vec<Sig>> = BTreeMap::new();
    for s in spans {
        by_path
            .entry(s.path)
            .or_default()
            .push(Sig { start: s.start_line, end: s.end_line, id: s.id });
    }
    let mut sigs: Vec<Sig> = Vec::new();
    let mut groups: Vec<Group> = Vec::new();
    let mut result = Assignment::default();
    let mut counts: BTreeMap<u32, (u32, u32)> = BTreeMap::new();

    for (path, file_lines) in lines {
        let Some(found) = by_path.get(path.as_str()) else {
            result.unassigned += file_lines.len();
            continue;
        };
        sigs.clear();
        sigs.extend_from_slice(found);
        sigs.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then(a.end.cmp(&b.end))
                .then(b.id.cmp(&a.id))
        });
        groups.clear();
        let mut i = 0;
        while i < sigs.len() {
            let start = sigs[i].start;
            let lo = i;
            while i < sigs.len() && sigs[i].start == start {
                i += 1;
            }
            groups.push(Group { start, lo, hi: i });
        }
        for (line, hits) in file_lines {
            match owner(&groups, &sigs, *line) {
                Some(id) => {
                    let slot = counts.entry(id).or_insert((0, 0));
                    slot.1 += 1;
                    if *hits > 0 {
                        slot.0 += 1;
                    }
                    result.assigned += 1;
                }
                None => result.unassigned += 1,
            }
        }
    }
    result.cv = counts
        .into_iter()
        .map(|(id, (covered, coverable))| (id, covered, coverable))
        .collect();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(id: u32, start: u32, end: u32) -> Span<'static> {
        Span { id, path: "a.ts", start_line: start, end_line: end }
    }

    fn file(pairs: &[(u32, u64)]) -> BTreeMap<String, FileLines> {
        let mut lines = FileLines::new();
        for (line, hits) in pairs {
            lines.insert(*line, *hits);
        }
        let mut map = BTreeMap::new();
        map.insert("a.ts".to_string(), lines);
        map
    }

    #[test]
    fn a_nested_closure_owns_its_lines() {
        // outer 1..9, closure 2..4: lines 2 and 3 are inside both.
        let spans = [span(0, 1, 9), span(1, 2, 4)];
        let a = assign(&file(&[(1, 1), (2, 1), (3, 0), (4, 1), (5, 1)]), &spans);
        assert_eq!(a.cv, vec![(0, 2, 2), (1, 2, 3)]);
        assert_eq!((a.assigned, a.unassigned), (5, 0));
    }

    #[test]
    fn equal_starts_go_to_the_smaller_span_then_the_larger_id() {
        let spans = [span(0, 2, 10), span(1, 2, 4)];
        assert_eq!(assign(&file(&[(2, 1)]), &spans).cv, vec![(1, 1, 1)]);

        let tied = [span(0, 2, 4), span(1, 2, 4)];
        assert_eq!(assign(&file(&[(3, 1)]), &tied).cv, vec![(1, 1, 1)]);
    }

    #[test]
    fn a_line_outside_every_span_is_unassigned() {
        let spans = [span(0, 5, 8)];
        let a = assign(&file(&[(1, 1), (6, 0)]), &spans);
        assert_eq!(a.cv, vec![(0, 0, 1)]);
        assert_eq!(a.unassigned, 1);
    }

    #[test]
    fn a_report_file_without_functions_is_all_unassigned() {
        let mut map = BTreeMap::new();
        map.insert("b.ts".to_string(), FileLines::from([(1u32, 1u64)]));
        let a = assign(&map, &[span(0, 1, 2)]);
        assert!(a.cv.is_empty());
        assert_eq!(a.unassigned, 1);
    }

    #[test]
    fn a_bad_side_table_is_an_error_not_a_silent_skip() {
        let mut tables = SideTables::default();
        tables.paths.push("a.ts".to_string());
        tables.fns.push(crate::facts::FnEntry {
            file: 3,
            start_line: 1,
            end_line: 2,
            parent: None,
            kind: 0,
            chain: "f".into(),
        });
        assert!(spans(&tables).unwrap_err().contains("points at file 3"));
    }
}
