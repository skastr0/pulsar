//! Where a repo keeps its coverage report, when `--coverage` was not given.

use std::path::{Path, PathBuf};

/// The report file names, in the precedence a repo would expect: Vitest's `json` reporter
/// writes `coverage-final.json`, lcov is the other shape most repos have on disk, and the
/// Cobertura names are what Istanbul's `cobertura` reporter writes.
pub const NAMES: &[&str] = &[
    "coverage-final.json",
    "lcov.info",
    "cobertura.xml",
    "cobertura-coverage.xml",
];

/// Repo-root-relative locations, in order.
pub const DEFAULT_REPORTS: &[&str] = &[
    "coverage/coverage-final.json",
    "coverage/lcov.info",
    "coverage/cobertura.xml",
    "coverage/cobertura-coverage.xml",
    "lcov.info",
];

pub fn discover(repo: &Path) -> Vec<PathBuf> {
    DEFAULT_REPORTS
        .iter()
        .map(|rel| repo.join(rel))
        .filter(|p| p.is_file())
        .collect()
}

/// The same names, looked for inside an explicit directory.
pub fn in_dir(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for name in NAMES {
        let path = dir.join(name);
        if path.is_file() && !out.contains(&path) {
            out.push(path);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_only_what_exists() {
        let dir = std::env::temp_dir().join(format!("pulsar-cov-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("coverage")).unwrap();
        std::fs::write(dir.join("coverage/lcov.info"), "SF:a.ts\nDA:1,1\n").unwrap();
        assert_eq!(discover(&dir), vec![dir.join("coverage/lcov.info")]);
        assert_eq!(in_dir(&dir.join("coverage")), vec![dir.join("coverage/lcov.info")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_explicit_directory_lists_each_name_once() {
        let dir = std::env::temp_dir().join(format!("pulsar-cov-dir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("lcov.info"), "").unwrap();
        std::fs::write(dir.join("coverage-final.json"), "{}").unwrap();
        let found = in_dir(&dir);
        assert_eq!(found, vec![dir.join("coverage-final.json"), dir.join("lcov.info")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
