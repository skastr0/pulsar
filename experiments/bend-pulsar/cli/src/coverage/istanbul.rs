//! Istanbul `coverage-final.json` → executable lines per file.
//!
//! Vitest's `json` reporter writes this shape from both providers: the istanbul provider
//! directly, and the v8 provider through ast-v8-to-istanbul. A line is executable when a
//! statement starts on it, and its hits are the sum over statements that start there — the
//! same rule Istanbul uses to print "Lines". The v8 mapping marks every physical line of a
//! function (signature and closing brace included) as a statement, so the provider decides
//! the line set; the adapter never rewrites it.

use serde_json::Value;
use std::collections::BTreeMap;

use super::FileLines;

#[derive(Debug)]
pub struct FileEntry {
    /// The path as the report writes it, unnormalized.
    pub path: String,
    pub lines: FileLines,
}

pub fn parse(text: &str) -> Result<Vec<FileEntry>, String> {
    let root: Value = serde_json::from_str(text).map_err(|e| format!("istanbul json: {e}"))?;
    let files = root
        .as_object()
        .ok_or("istanbul json: top level is not an object keyed by path")?;
    let mut out = Vec::with_capacity(files.len());
    for (path, entry) in files {
        let entry = entry
            .as_object()
            .ok_or_else(|| format!("{path}: entry is not an object"))?;
        let statements = entry
            .get("statementMap")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{path}: no statementMap (not Istanbul format)"))?;
        let hits = entry
            .get("s")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{path}: no statement hit counts (s)"))?;
        let mut lines: FileLines = BTreeMap::new();
        for (id, statement) in statements {
            let line = statement
                .get("start")
                .and_then(|s| s.get("line"))
                .and_then(Value::as_u64)
                .ok_or_else(|| format!("{path}: statement {id} has no start.line"))?;
            let line = u32::try_from(line)
                .map_err(|_| format!("{path}: statement {id} line {line} out of range"))?;
            let count = hits.get(id).and_then(Value::as_u64).unwrap_or(0);
            let slot = lines.entry(line).or_insert(0);
            *slot = slot.saturating_add(count);
        }
        out.push(FileEntry { path: path.clone(), lines });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_statements_starting_on_the_same_line() {
        let text = r#"{
          "/r/a.ts": {
            "path": "/r/a.ts",
            "statementMap": {
              "0": {"start": {"line": 2, "column": 2}, "end": {"line": 2, "column": 9}},
              "1": {"start": {"line": 2, "column": 11}, "end": {"line": 2, "column": 18}},
              "2": {"start": {"line": 5, "column": 2}, "end": {"line": 5, "column": 9}}
            },
            "s": {"0": 1, "1": 0, "2": 0}
          }
        }"#;
        let out = parse(text).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].path, "/r/a.ts");
        assert_eq!(out[0].lines.get(&2), Some(&1));
        assert_eq!(out[0].lines.get(&5), Some(&0));
        assert_eq!(out[0].lines.len(), 2);
    }

    #[test]
    fn a_missing_hit_count_reads_as_zero() {
        let text = r#"{"/r/a.ts":{"statementMap":{"0":{"start":{"line":3,"column":0},"end":{"line":3,"column":1}}},"s":{}}}"#;
        let out = parse(text).unwrap();
        assert_eq!(out[0].lines.get(&3), Some(&0));
    }

    #[test]
    fn rejects_a_report_without_statement_map() {
        let err = parse(r#"{"/r/a.ts":{"s":{}}}"#).unwrap_err();
        assert!(err.contains("statementMap"), "{err}");
    }

    #[test]
    fn rejects_a_non_object_top_level() {
        assert!(parse("[]").is_err());
        assert!(parse("null").is_err());
    }
}
