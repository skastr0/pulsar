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

/// Diagnostics for the stderr line and for a caller that wants them in its own output (the
/// delta summary prints `rerooted_prefix`). Counts only; the CLI renders paths.
#[derive(Default, Debug, PartialEq, Eq)]
pub struct Stats {
    pub reports: usize,
    pub reported_files: usize,
    pub reported_lines: usize,
    pub skipped: usize,
    pub assigned: usize,
    pub unassigned: usize,
    pub cv: usize,
    /// Report files whose absolute path was re-rooted onto the repo by suffix match.
    pub rerooted_files: usize,
    /// The prefix those paths carried outside the repo, when there was exactly one.
    pub rerooted_prefix: Option<String>,
    /// The reports that were read, repo-relative when they live under `repo`. A caller that
    /// prints them names the input it used; empty means no report was found or given.
    pub report_paths: Vec<String>,
}

/// Whether the repo has a coverage report where [`emit`] would auto-discover one. A caller that
/// caches derived facts asks this first: a cached entry never carries coverage, so a run that
/// finds a report must not read one.
pub fn has_report(repo: &Path) -> bool {
    !discover::discover(repo).is_empty()
}

/// Read the repo's coverage report and push `CV` facts. `explicit` is `--coverage <file|dir>`;
/// without it the lane auto-discovers reports under `repo`. No report found means no `CV`
/// facts and no error. `tables.fns` maps lines to functions.
pub fn emit(
    repo: &Path,
    explicit: Option<&Path>,
    tables: &SideTables,
    w: &mut FactWriter,
) -> Result<Stats, String> {
    let (cv, stats) = ingest(repo, explicit, tables)?;
    if stats.reports == 0 {
        return Ok(stats);
    }
    for (id, covered, coverable) in &cv {
        w.push(Rel::Cv, &[*id, *covered, *coverable]);
    }
    let rerooted = match &stats.rerooted_prefix {
        Some(prefix) => format!(" rerooted={prefix} rerooted_files={}", stats.rerooted_files),
        None => String::new(),
    };
    eprintln!(
        "pulsar: coverage reports={} files={} lines={} skipped={} assigned={} unassigned={} cv={}{rerooted}",
        stats.reports,
        stats.reported_files,
        stats.reported_lines,
        stats.skipped,
        stats.assigned,
        stats.unassigned,
        stats.cv
    );
    Ok(stats)
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
    stats.report_paths = reports.iter().map(|p| p.strip_prefix(repo).unwrap_or(p).display().to_string()).collect();
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
    let mut prefixes: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut rerooted = 0usize;
    for (raw, file_lines) in union(parsed) {
        stats.reported_lines += file_lines.len();
        match normalize(repo, &raw, &known) {
            Some(found) if known.contains(found.rel.as_str()) => {
                if let Some(prefix) = &found.dropped {
                    prefixes.insert(prefix.clone());
                    rerooted += 1;
                }
                lines.insert(found.rel, file_lines);
            }
            _ => stats.skipped += 1,
        }
    }
    // One prefix means the report was produced in one other checkout. Two mean the paths are
    // not all describing the same tree, and guessing would silently attach lines to the wrong
    // functions, so the run refuses instead.
    if prefixes.len() > 1 {
        let listed: Vec<&str> = prefixes.iter().map(String::as_str).collect();
        return Err(format!(
            "coverage: report paths re-root at more than one prefix ({}); refusing to guess",
            listed.join(", ")
        ));
    }
    stats.rerooted_files = rerooted;
    stats.rerooted_prefix = prefixes.into_iter().next();

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

/// A report path resolved onto the repo, plus the prefix dropped to get there.
struct Normalized {
    rel: String,
    dropped: Option<String>,
}

/// Resolve a report path to a repo-relative one.
///
/// A report written in another checkout carries that checkout's absolute root, so when the path
/// is not under `repo` the lane re-roots it: the longest suffix of the report path that is a
/// tracked path wins. `dropped` names the prefix that was cut, so the caller can report it and
/// refuse a report whose paths resolve through two different roots.
fn normalize(repo: &Path, raw: &str, known: &std::collections::HashSet<&str>) -> Option<Normalized> {
    let p = Path::new(raw);
    if p.is_absolute() {
        if let (Ok(root), Ok(canon)) = (std::fs::canonicalize(repo), std::fs::canonicalize(p)) {
            if let Ok(rel) = canon.strip_prefix(&root) {
                return Some(Normalized { rel: rel.to_str()?.replace('\\', "/"), dropped: None });
            }
        }
        return reroot(raw, known);
    }
    let from_root = repo.join(p);
    if !from_root.exists() {
        return None;
    }
    let canon = std::fs::canonicalize(&from_root).ok()?;
    let root = std::fs::canonicalize(repo).ok()?;
    let rel = canon.strip_prefix(&root).ok()?;
    Some(Normalized { rel: rel.to_str()?.replace('\\', "/"), dropped: None })
}

/// Longest tracked suffix of an absolute report path, with the leading prefix it cut.
fn reroot(raw: &str, known: &std::collections::HashSet<&str>) -> Option<Normalized> {
    let parts: Vec<&str> = raw.split('/').filter(|s| !s.is_empty()).collect();
    for start in 0..parts.len() {
        let candidate = parts[start..].join("/");
        if known.contains(candidate.as_str()) {
            let dropped = if start == 0 {
                None
            } else {
                Some(format!("/{}", parts[..start].join("/")))
            };
            return Some(Normalized { rel: candidate, dropped });
        }
    }
    None
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
        SideTables { paths, fns, ..Default::default() }
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
    fn a_report_from_another_checkout_is_rerooted_by_longest_tracked_suffix() {
        let dir = fixture("coverage/reroot").join("repo");
        let report = fixture("coverage/reroot").join("report/coverage-final.json");
        let (cv, stats) = ingest(&dir, Some(&report), &tables(&dir.join(".."))).unwrap();
        assert_eq!(render(&tables(&dir.join("..")), &cv), expected(&dir.join(".."), "expected.txt"));
        assert_eq!(stats.rerooted_files, 2, "{stats:?}");
        assert_eq!(stats.rerooted_prefix.as_deref(), Some("/build/agent-7/work"));
        assert_eq!(stats.skipped, 0, "{stats:?}");
    }

    #[test]
    fn two_reroot_prefixes_are_refused() {
        let dir = fixture("coverage/reroot").join("repo");
        let tmp = std::env::temp_dir().join(format!("pulsar-cov-reroot-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let report = tmp.join("two-roots.json");
        let entry = |path: &str| {
            format!(
                r#""{path}":{{"path":"{path}","statementMap":{{"0":{{"start":{{"line":2,"column":0}},"end":{{"line":2,"column":4}}}}}},"s":{{"0":1}}}}"#
            )
        };
        std::fs::write(
            &report,
            format!(
                "{{{},\n{}}}",
                entry("/build/one/src/math.ts"),
                entry("/build/two/src/other.ts")
            ),
        )
        .unwrap();
        let err = ingest(&dir, Some(&report), &tables(&dir.join(".."))).unwrap_err();
        assert!(err.contains("more than one prefix"), "{err}");
        std::fs::remove_dir_all(&tmp).unwrap();
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

    #[test]
    fn stats_name_the_reports_the_reader_used() {
        let dir = fixture("coverage/ts");
        let (_, stats) = ingest(&dir, Some(&dir.join("reports/istanbul")), &tables(&dir)).unwrap();
        assert_eq!(
            stats.report_paths,
            vec!["reports/istanbul/coverage-final.json", "reports/istanbul/lcov.info"]
        );
        let empty = std::env::temp_dir().join(format!("pulsar-cov-nopaths-{}", std::process::id()));
        std::fs::create_dir_all(&empty).unwrap();
        let (_, stats) = ingest(&empty, None, &tables(&dir)).unwrap();
        assert!(stats.report_paths.is_empty(), "{stats:?}");
        std::fs::remove_dir_all(&empty).unwrap();
    }

    #[test]
    fn has_report_sees_only_the_discovery_locations() {
        let dir = std::env::temp_dir().join(format!("pulsar-cov-has-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("reports")).unwrap();
        std::fs::write(dir.join("reports/lcov.info"), "SF:a.ts\nDA:1,1\n").unwrap();
        assert!(!has_report(&dir), "a report elsewhere is not discovered");
        std::fs::create_dir_all(dir.join("coverage")).unwrap();
        std::fs::write(dir.join("coverage/lcov.info"), "SF:a.ts\nDA:1,1\n").unwrap();
        assert!(has_report(&dir), "coverage/lcov.info is a discovery location");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
