//! Coverage ingest: Vitest, lcov and Cobertura to `CV` facts. Owner: pulsar-cov.
//!
//! Input is the report a repo already writes, never a report Pulsar asks for: Vitest's
//! `coverage-final.json` (Istanbul format, v8 or istanbul provider), `lcov.info` (also
//! `cargo llvm-cov --lcov`) or Cobertura XML. Output is `CV <fn> <covered> <coverable>`,
//! mapped to functions through the `.fns` side table.
//!
//! The lane reports what the report says. Whether a function's coverage becomes a finding is
//! an engine rule (CRAP), as FACTS.md requires, so nothing here filters by production scope.

mod cobertura;
mod discover;
mod istanbul;
mod lcov;
mod map;

use crate::facts::{FactWriter, Rel, SideTables};
use std::collections::BTreeMap;
use std::path::Path;

/// Executable lines and their hit counts for one file, as the report states them.
type FileLines = BTreeMap<u32, u64>;

/// Diagnostics for the stderr line. Counts only; the CLI renders paths.
#[derive(Default)]
struct Stats {
    reports: usize,
    reported_files: usize,
    reported_lines: usize,
    skipped: usize,
    assigned: usize,
    unassigned: usize,
    cv: usize,
}

/// Read the repo's coverage report and push `CV` facts. `explicit` is `--coverage <file|dir>`;
/// without it the lane auto-discovers reports under `repo`. No report found means no `CV`
/// facts and no error. `tables.fns` maps lines to functions.
pub fn emit(
    repo: &Path,
    explicit: Option<&Path>,
    tables: &SideTables,
    w: &mut FactWriter,
) -> Result<(), String> {
    let reports = resolve_reports(repo, explicit)?;
    if reports.is_empty() {
        return Ok(());
    }
    let mut stats = Stats::default();
    let mut parsed = Vec::new();
    for path in &reports {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let entries = parse_report(path, &text)?;
        stats.reports += 1;
        stats.reported_files += entries.len();
        parsed.extend(entries);
    }

    let known: std::collections::HashSet<&str> =
        tables.paths.iter().map(String::as_str).collect();
    let mut lines: BTreeMap<String, FileLines> = BTreeMap::new();
    for (raw, file_lines) in union(parsed) {
        stats.reported_lines += file_lines.len();
        match normalize(repo, &raw) {
            Some(rel) if known.contains(rel.as_str()) => {
                lines.insert(rel, file_lines);
            }
            _ => stats.skipped += 1,
        }
    }

    let spans = map::spans(tables)?;
    let assignment = map::assign(&lines, &spans);
    stats.assigned = assignment.assigned;
    stats.unassigned = assignment.unassigned;
    stats.cv = assignment.cv.len();
    for (id, covered, coverable) in assignment.cv {
        w.push(Rel::Cv, &[id, covered, coverable]);
    }

    if stats.reports > 0 {
        eprintln!(
            "pulsar: coverage reports={} files={} lines={} skipped={} assigned={} unassigned={} cv={}",
            stats.reports,
            stats.reported_files,
            stats.reported_lines,
            stats.skipped,
            stats.assigned,
            stats.unassigned,
            stats.cv
        );
    }
    Ok(())
}

/// Resolve `--coverage` (a file or a directory) or the default locations under `repo`.
fn resolve_reports(repo: &Path, explicit: Option<&Path>) -> Result<Vec<std::path::PathBuf>, String> {
    let Some(given) = explicit else {
        return Ok(discover::discover(repo));
    };
    let path = if given.is_absolute() { given.to_path_buf() } else { repo.join(given) };
    if path.is_dir() {
        let found = discover::in_dir(&path);
        if found.is_empty() {
            return Err(format!("{}: no coverage report in this directory", path.display()));
        }
        return Ok(found);
    }
    if path.is_file() {
        return Ok(vec![path]);
    }
    Err(format!("{}: no such file or directory", path.display()))
}

/// Parse one report by its content, not its name.
fn parse_report(path: &Path, text: &str) -> Result<Vec<istanbul::FileEntry>, String> {
    let head = text
        .char_indices()
        .find(|(_, c)| !c.is_whitespace())
        .map(|(i, _)| &text[i..])
        .unwrap_or("");
    if head.starts_with('<') {
        return cobertura::parse(text).map_err(|e| format!("{}: {e}", path.display()));
    }
    if head.starts_with('{') {
        return istanbul::parse(text).map_err(|e| format!("{}: {e}", path.display()));
    }
    if text.lines().any(|l| l.starts_with("SF:")) {
        return lcov::parse(text).map_err(|e| format!("{}: {e}", path.display()));
    }
    Err(format!("{}: not an Istanbul JSON, lcov or Cobertura report", path.display()))
}

/// Union the reports' line sets: a line is covered when any report says it was hit.
fn union(reports: Vec<istanbul::FileEntry>) -> BTreeMap<String, FileLines> {
    let mut files: BTreeMap<String, FileLines> = BTreeMap::new();
    for entry in reports {
        let lines = files.entry(entry.path).or_default();
        for (line, hits) in entry.lines {
            let slot = lines.entry(line).or_insert(0);
            *slot = slot.saturating_add(hits);
        }
    }
    files
}

/// Repo-relative path for a report path, when the file exists inside the repo.
fn normalize(repo: &Path, raw: &str) -> Option<String> {
    let p = Path::new(raw);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        let from_root = repo.join(p);
        if from_root.exists() {
            from_root
        } else {
            return None;
        }
    };
    let canon = std::fs::canonicalize(&abs).ok()?;
    let root = std::fs::canonicalize(repo).ok()?;
    let rel = canon.strip_prefix(&root).ok()?;
    Some(rel.to_str()?.replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::FnEntry;

    /// `experiments/bend-pulsar/fixtures/coverage/ts`, from `experiments/bend-pulsar/cli`.
    fn fixture() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/coverage/ts")
    }

    /// The fixture's hand-written `.fns` (id, path, start, end, parent, kind, chain).
    fn tables() -> SideTables {
        let text = std::fs::read_to_string(fixture().join("fns.tsv")).unwrap();
        let mut rows: Vec<Vec<String>> = Vec::new();
        for line in text.lines().filter(|l| !l.is_empty()) {
            let fields: Vec<String> = line.split('\t').map(str::to_string).collect();
            assert_eq!(fields.len(), 7, ".fns row: {line}");
            rows.push(fields);
        }
        let mut paths: Vec<String> = Vec::new();
        for row in &rows {
            if !paths.iter().any(|p| p == &row[1]) {
                paths.push(row[1].clone());
            }
        }
        paths.sort();
        let mut fns = Vec::new();
        for row in &rows {
            let file = paths.iter().position(|p| p == &row[1]).unwrap() as u32;
            fns.push(FnEntry {
                file,
                start_line: row[2].parse().unwrap(),
                end_line: row[3].parse().unwrap(),
                parent: if row[4] == "-" { None } else { Some(row[4].parse().unwrap()) },
                kind: row[5].parse().unwrap(),
                chain: row[6].clone(),
            });
        }
        SideTables { paths, fns }
    }

    /// Expected rows: `path<TAB>chain<TAB>covered/coverable`, sorted like the file.
    fn expected(name: &str) -> Vec<String> {
        std::fs::read_to_string(fixture().join(name))
            .unwrap()
            .lines()
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect()
    }

    fn render(tables: &SideTables, cv: &[(u32, u32, u32)]) -> Vec<String> {
        let mut rows: Vec<(usize, String)> = cv
            .iter()
            .map(|&(id, covered, coverable)| {
                let f = &tables.fns[id as usize];
                let path = &tables.paths[f.file as usize];
                (id as usize, format!("{path}\t{}\t{covered}/{coverable}", f.chain))
            })
            .collect();
        rows.sort();
        rows.into_iter().map(|(_, line)| line).collect()
    }

    fn emit_into(report: &std::path::Path) -> Vec<(u32, u32, u32)> {
        let tables = tables();
        let mut w = FactWriter::new();
        emit(&fixture(), Some(report), &tables, &mut w).unwrap();
        let mut counts = BTreeMap::new();
        // Read the CV rows back out of the canonical writer output.
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        for line in String::from_utf8(out).unwrap().lines() {
            let f: Vec<&str> = line.split(' ').collect();
            if f[0] == "CV" {
                let row = (f[1].parse().unwrap(), f[2].parse().unwrap(), f[3].parse().unwrap());
                counts.insert(row.0, row);
            }
        }
        counts.into_values().collect()
    }

    #[test]
    fn v8_json_matches_the_hand_checked_expectation() {
        let tables = tables();
        let cv = emit_into(&fixture().join("reports/v8/coverage-final.json"));
        assert_eq!(render(&tables, &cv), expected("expected-v8.txt"));
    }

    #[test]
    fn istanbul_json_matches_the_hand_checked_expectation() {
        let tables = tables();
        let cv = emit_into(&fixture().join("reports/istanbul/coverage-final.json"));
        assert_eq!(render(&tables, &cv), expected("expected-istanbul.txt"));
    }

    #[test]
    fn lcov_agrees_with_json_for_the_same_provider() {
        for provider in ["v8", "istanbul"] {
            let dir = fixture().join("reports").join(provider);
            let from_json = emit_into(&dir.join("coverage-final.json"));
            let from_lcov = emit_into(&dir.join("lcov.info"));
            assert_eq!(from_json, from_lcov, "{provider}: json and lcov disagree");
        }
    }

    #[test]
    fn cobertura_agrees_with_the_istanbul_provider() {
        let tables = tables();
        let dir = fixture().join("reports");
        let from_json = emit_into(&dir.join("istanbul/coverage-final.json"));
        let from_xml = emit_into(&dir.join("cobertura/coverage.xml"));
        assert_eq!(render(&tables, &from_json), render(&tables, &from_xml));
    }

    #[test]
    fn a_missing_report_is_not_an_error() {
        let tables = tables();
        let mut w = FactWriter::new();
        let empty = std::env::temp_dir().join(format!("pulsar-cov-empty-{}", std::process::id()));
        std::fs::create_dir_all(&empty).unwrap();
        emit(&empty, None, &tables, &mut w).unwrap();
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        assert!(!String::from_utf8(out).unwrap().contains("CV "));
        std::fs::remove_dir_all(&empty).unwrap();
    }

    #[test]
    fn an_explicit_missing_report_is_an_error() {
        let tables = tables();
        let mut w = FactWriter::new();
        let err = emit(&fixture(), Some(Path::new("reports/nope.json")), &tables, &mut w)
            .unwrap_err();
        assert!(err.contains("no such file"), "{err}");
    }
}
