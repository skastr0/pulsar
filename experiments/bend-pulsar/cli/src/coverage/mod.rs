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
use std::path::{Path, PathBuf};

/// Executable lines and their hit counts for one file, as the report states them.
type FileLines = BTreeMap<u32, u64>;

/// Diagnostics for the stderr line. Counts only; the CLI renders paths.
#[derive(Default, Debug, PartialEq, Eq)]
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
    let (cv, stats) = ingest(repo, explicit, tables)?;
    if stats.reports == 0 {
        return Ok(());
    }
    for (id, covered, coverable) in &cv {
        w.push(Rel::Cv, &[*id, *covered, *coverable]);
    }
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
    Ok(())
}

/// Everything `emit` does except the writer and the stat line.
fn ingest(
    repo: &Path,
    explicit: Option<&Path>,
    tables: &SideTables,
) -> Result<(Vec<(u32, u32, u32)>, Stats), String> {
    let mut stats = Stats::default();
    let reports = resolve_reports(repo, explicit)?;
    if reports.is_empty() {
        return Ok((Vec::new(), stats));
    }
    let mut parsed = Vec::new();
    for path in &reports {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let entries = parse_report(path, &text)?;
        stats.reports += 1;
        stats.reported_files += entries.len();
        parsed.extend(entries);
    }

    let known: std::collections::HashSet<&str> = tables.paths.iter().map(String::as_str).collect();
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
    Ok((assignment.cv, stats))
}

/// Resolve `--coverage` (a file or a directory) or the default locations under `repo`.
fn resolve_reports(repo: &Path, explicit: Option<&Path>) -> Result<Vec<PathBuf>, String> {
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

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures")
            .join(name)
    }

    /// The fixture's `.fns` side table (id, path, start, end, parent, kind, chain), turned into
    /// the shape the CLI writes: file ids index the sorted path list. `paths.txt`, when the
    /// fixture has one, is that list; otherwise it is the distinct paths the fns rows name.
    fn tables(dir: &Path) -> SideTables {
        let text = std::fs::read_to_string(dir.join("fns.tsv")).unwrap();
        let mut rows: Vec<Vec<String>> = Vec::new();
        for line in text.lines().filter(|l| !l.is_empty()) {
            let fields: Vec<String> = line.split('\t').map(str::to_string).collect();
            assert_eq!(fields.len(), 7, ".fns row: {line}");
            rows.push(fields);
        }
        let mut paths: Vec<String> = match std::fs::read_to_string(dir.join("paths.txt")) {
            Ok(list) => list.lines().filter(|l| !l.is_empty()).map(str::to_string).collect(),
            Err(_) => Vec::new(),
        };
        if paths.is_empty() {
            for row in &rows {
                if !paths.iter().any(|p| p == &row[1]) {
                    paths.push(row[1].clone());
                }
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

    /// Expected rows: `path<TAB>chain<TAB>covered/coverable`, in the file's order.
    fn expected(dir: &Path, name: &str) -> Vec<String> {
        std::fs::read_to_string(dir.join(name))
            .unwrap()
            .lines()
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect()
    }

    fn render(tables: &SideTables, cv: &[(u32, u32, u32)]) -> Vec<String> {
        let mut rows: Vec<(u32, String)> = cv
            .iter()
            .map(|&(id, covered, coverable)| {
                let f = &tables.fns[id as usize];
                let path = &tables.paths[f.file as usize];
                (id, format!("{path}\t{}\t{covered}/{coverable}", f.chain))
            })
            .collect();
        rows.sort();
        rows.into_iter().map(|(_, line)| line).collect()
    }

    fn ingest_report(dir: &Path, report: &Path) -> (Vec<(u32, u32, u32)>, Stats) {
        ingest(dir, Some(report), &tables(dir)).unwrap()
    }

    #[test]
    fn v8_json_matches_the_hand_checked_expectation() {
        let dir = fixture("coverage/ts");
        let (cv, _) = ingest_report(&dir, &dir.join("reports/v8/coverage-final.json"));
        assert_eq!(render(&tables(&dir), &cv), expected(&dir, "expected-v8.txt"));
    }

    #[test]
    fn istanbul_json_matches_the_hand_checked_expectation() {
        let dir = fixture("coverage/ts");
        let (cv, _) = ingest_report(&dir, &dir.join("reports/istanbul/coverage-final.json"));
        assert_eq!(render(&tables(&dir), &cv), expected(&dir, "expected-istanbul.txt"));
    }

    #[test]
    fn lcov_agrees_with_json_for_the_same_provider() {
        for provider in ["v8", "istanbul"] {
            let dir = fixture("coverage/ts");
            let base = dir.join("reports").join(provider);
            let (from_json, _) = ingest_report(&dir, &base.join("coverage-final.json"));
            let (from_lcov, _) = ingest_report(&dir, &base.join("lcov.info"));
            assert_eq!(from_json, from_lcov, "{provider}: json and lcov disagree");
        }
    }

    #[test]
    fn cobertura_agrees_with_the_istanbul_provider() {
        let dir = fixture("coverage/ts");
        let (from_json, _) = ingest_report(&dir, &dir.join("reports/istanbul/coverage-final.json"));
        let (from_xml, _) = ingest_report(&dir, &dir.join("reports/cobertura/coverage.xml"));
        assert_eq!(render(&tables(&dir), &from_json), render(&tables(&dir), &from_xml));
    }

    #[test]
    fn cargo_llvm_cov_matches_the_hand_checked_expectation() {
        let dir = fixture("coverage/rs");
        let (cv, stats) = ingest_report(&dir, &dir.join("reports/lcov.info"));
        assert_eq!(render(&tables(&dir), &cv), expected(&dir, "expected.txt"));
        // llvm-cov instruments `mod tests`; those lines have no FN span, so they are unassigned.
        assert_eq!(stats.unassigned, 6, "test-module lines: {stats:?}");
        assert_eq!(stats.skipped, 0, "the SF: path must normalize: {stats:?}");
    }

    #[test]
    fn cargo_llvm_cov_on_the_rust_fn_fixture_matches_the_hand_checked_expectation() {
        let dir = fixture("rust-fn");
        let (cv, stats) = ingest_report(&dir, &dir.join("reports/lcov.info"));
        assert_eq!(render(&tables(&dir), &cv), expected(&dir, "expected-cv.txt"));
        // Test functions are ordinary FN rows with a TF flag (#657), so the lines llvm-cov
        // instruments in `mod tests` belong to them and nothing is left unassigned.
        assert_eq!(stats.unassigned, 0, "unassigned lines: {stats:?}");
        assert_eq!(stats.skipped, 0, "every SF: path must normalize: {stats:?}");
    }

    #[test]
    fn a_missing_report_is_not_an_error() {
        let dir = fixture("coverage/ts");
        let empty = std::env::temp_dir().join(format!("pulsar-cov-empty-{}", std::process::id()));
        std::fs::create_dir_all(&empty).unwrap();
        let (cv, stats) = ingest(&empty, None, &tables(&dir)).unwrap();
        assert!(cv.is_empty());
        assert_eq!(stats.reports, 0);
        std::fs::remove_dir_all(&empty).unwrap();
    }

    #[test]
    fn an_explicit_missing_report_is_an_error() {
        let dir = fixture("coverage/ts");
        let err = ingest(&dir, Some(Path::new("reports/nope.json")), &tables(&dir)).unwrap_err();
        assert!(err.contains("no such file"), "{err}");
    }

    #[test]
    fn an_explicit_directory_finds_every_report_in_it() {
        let dir = fixture("coverage/ts");
        let (cv, stats) = ingest(&dir, Some(&dir.join("reports/istanbul")), &tables(&dir)).unwrap();
        assert_eq!(stats.reports, 2, "json and lcov: {stats:?}");
        assert_eq!(render(&tables(&dir), &cv), expected(&dir, "expected-istanbul.txt"));
    }
}
