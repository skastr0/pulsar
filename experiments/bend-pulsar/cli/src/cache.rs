//! The `~/.pulsar` cache: derived results per git sha, with a size cap and LRU eviction.
//!
//! Layout: `<root>/<repo-key>/derived/<sha>-<build>-<org>/entry` where
//! - `repo-key` is the repository's first root commit (stable across clones),
//! - `build` is a hash of the running binary, so any rebuild (a changed detector, adapter or FACTS
//!   version) starts from an empty cache and a stale entry can never be read,
//! - `org` is a hash of `~/.pulsar/policy.toml` (the org fallback), the one policy input that is
//!   not part of the sha.
//! An entry is the lanes' output for that sha: the facts text plus the side tables the CLI needs to
//! render findings, so a second run on an unchanged sha skips checkout and parsing. Lanes that cache
//! per file use [`Cache::blob_rel`] (`blobs/<adapter>-<adapter version>-facts<N>/<oid[0..2]>/<oid>`).
//!
//! The root is `$PULSAR_CACHE_DIR` or `~/.pulsar/cache`; the cap is `$PULSAR_CACHE_MAX_MB`
//! (default 1024). When a write takes the root over the cap, the least recently used files go until
//! it is back under 90%. `PULSAR_CACHE=off` disables the cache.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::SystemTime;

const DEFAULT_CAP_MB: u64 = 1024;

pub struct Cache {
    root: PathBuf,
    dir: PathBuf,
    cap: u64,
}

fn fnv_hex(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h = (h ^ *b as u64).wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Hash of the running binary: the cache epoch. Reading the executable costs about a millisecond.
pub fn build_id() -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| {
        std::env::current_exe().ok().and_then(|p| std::fs::read(p).ok()).map_or_else(|| "unknown".into(), |b| fnv_hex(&b))
    })
}

fn root_dir() -> Option<PathBuf> {
    if std::env::var("PULSAR_CACHE").is_ok_and(|v| v == "off") {
        return None;
    }
    if let Some(d) = std::env::var_os("PULSAR_CACHE_DIR") {
        return Some(PathBuf::from(d));
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".pulsar/cache"))
}

/// The repository's key: its smallest root commit sha, 16 hex digits.
fn repo_key(repo: &Path) -> Option<String> {
    let out = Command::new("git").arg("-C").arg(repo).args(["rev-list", "--max-parents=0", "--all"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().filter(|l| l.len() >= 16).min()?;
    Some(first[..16].to_string())
}

impl Cache {
    /// Open the cache for `repo`, or `None` when it is disabled or the repo has no commits.
    pub fn open(repo: &Path) -> Option<Cache> {
        let root = root_dir()?;
        let dir = root.join(repo_key(repo)?);
        let mb = std::env::var("PULSAR_CACHE_MAX_MB").ok().and_then(|v| v.parse().ok()).unwrap_or(DEFAULT_CAP_MB);
        Some(Cache { root, dir, cap: mb * 1024 * 1024 })
    }

    #[cfg(test)]
    pub fn open_at_for_tests(root: &Path, key: &str) -> Cache {
        Cache::at(root, key, 1 << 30)
    }

    #[cfg(test)]
    fn at(root: &Path, key: &str, cap: u64) -> Cache {
        Cache { root: root.to_path_buf(), dir: root.join(key), cap }
    }

    /// The relative path of the derived entry for `sha`.
    pub fn derived_rel(sha: &str, org_policy: Option<&[u8]>) -> String {
        let org = org_policy.map_or_else(|| "none".to_string(), fnv_hex);
        format!("derived/{sha}-{}-{org}/entry", build_id())
    }

    /// The relative path of the engine output cached beside `derived`: it depends on the facts (the
    /// derived entry) and on the engine binary, so the engine's hash is part of the name.
    pub fn engine_rel(derived: &str, engine: &Path) -> String {
        let hash = std::fs::read(engine).map_or_else(|_| "unknown".into(), |b| fnv_hex(&b));
        format!("{}engine-{hash}", derived.trim_end_matches("entry"))
    }

    /// The relative path of one adapter's per-blob entry.
    #[allow(dead_code)] // for the lanes that cache per file (history, TypeScript)
    pub fn blob_rel(adapter: &str, adapter_version: &str, facts_version: u32, oid: &str) -> String {
        format!("blobs/{adapter}-{adapter_version}-facts{facts_version}/{}/{oid}", &oid[..2.min(oid.len())])
    }

    /// Is there an entry at `rel`? Does not mark it used.
    pub fn has(&self, rel: &str) -> bool {
        self.dir.join(rel).is_file()
    }

    /// Read an entry and mark it recently used.
    pub fn get(&self, rel: &str) -> Option<Vec<u8>> {
        let path = self.dir.join(rel);
        let bytes = std::fs::read(&path).ok()?;
        if let Ok(f) = std::fs::File::open(&path) {
            let _ = f.set_modified(SystemTime::now());
        }
        Some(bytes)
    }

    /// Write an entry atomically (temporary file, then rename), then enforce the size cap.
    pub fn put(&self, rel: &str, bytes: &[u8]) -> Result<(), String> {
        let path = self.dir.join(rel);
        let parent = path.parent().ok_or("cache path has no parent")?;
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        let tmp = path.with_extension(format!("tmp{}", std::process::id()));
        std::fs::write(&tmp, bytes).map_err(|e| format!("{}: {e}", tmp.display()))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("{}: {e}", path.display()))?;
        self.evict();
        Ok(())
    }

    /// Delete least recently used files until the root is under 90% of the cap. Best effort.
    pub fn evict(&self) {
        let mut files = Vec::new();
        collect(&self.root, &mut files);
        let total: u64 = files.iter().map(|f| f.1).sum();
        if total <= self.cap {
            return;
        }
        files.sort_by_key(|f| f.2);
        let mut left = total;
        for (path, size, _) in files {
            if left <= self.cap / 10 * 9 {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                left -= size;
            }
        }
    }
}

fn collect(dir: &Path, out: &mut Vec<(PathBuf, u64, SystemTime)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        match e.metadata() {
            Ok(m) if m.is_dir() => collect(&p, out),
            Ok(m) => out.push((p, m.len(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH))),
            Err(_) => {}
        }
    }
}

/// What a derived entry holds besides the facts text: the side tables and file set that rendering
/// and finding identity need. Plain data, so the cache never depends on a lane's types.
#[derive(Serialize, Deserialize, Default, PartialEq, Debug)]
pub struct Meta {
    pub files: Vec<String>,
    pub prod: usize,
    pub fn_keys: Vec<u64>,
    /// (file, start_line, end_line, parent, kind, chain)
    pub fns: Vec<(u32, u32, u32, Option<u32>, u8, String)>,
    pub syms: Vec<String>,
    pub rules: Vec<String>,
    pub laws: String,
    /// The `.effect` side table text (service and layer names), empty without the Effect pack.
    #[serde(default)]
    pub effect: String,
    #[serde(default)]
    pub sql_names: Vec<String>,
    #[serde(default)]
    pub sql_indexes: Vec<Option<String>>,
    #[serde(default)]
    pub sql_sites: Vec<(u32, u32)>,
    /// (lane, cause)
    pub degraded: Vec<(String, String)>,
    /// The facts text after the metadata is only the side rows `pulsar delta` re-reads (`DT`, `RT`,
    /// `QS`), not the whole facts file: the engine's output is cached beside it, so a warm run never
    /// needs the rest, and an entry costs a quarter of the disk. A slim entry whose engine output is
    /// gone is a miss.
    #[serde(default)]
    pub slim: bool,
}

/// An entry is the metadata as one JSON line, then the facts text.
pub fn encode(meta: &Meta, facts: &[u8]) -> Vec<u8> {
    let mut out = serde_json::to_vec(meta).unwrap_or_default();
    out.push(b'\n');
    out.extend_from_slice(facts);
    out
}

pub fn decode(bytes: &[u8]) -> Option<(Meta, &[u8])> {
    let nl = bytes.iter().position(|b| *b == b'\n')?;
    Some((serde_json::from_slice(&bytes[..nl]).ok()?, &bytes[nl + 1..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("pulsar-cache-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn entries_round_trip_and_a_miss_is_none() {
        let root = tmp("rt");
        let c = Cache::at(&root, "repo0", 1 << 20);
        assert!(c.get("derived/x/entry").is_none());
        let meta = Meta { files: vec!["a.ts".into()], fn_keys: vec![7], fns: vec![(0, 1, 2, None, 3, "f".into())], degraded: vec![("rust".into(), "why".into())], ..Meta::default() };
        let bytes = encode(&meta, b"pulsar-facts 0\nN 1\n");
        c.put("derived/x/entry", &bytes).unwrap();
        let got = c.get("derived/x/entry").unwrap();
        let (m, facts) = decode(&got).unwrap();
        assert_eq!(m, meta);
        assert_eq!(facts, b"pulsar-facts 0\nN 1\n");
        assert!(decode(b"no newline").is_none() && decode(b"{bad}\nfacts").is_none());
    }

    #[test]
    fn the_key_changes_with_sha_build_and_org_policy() {
        let a = Cache::derived_rel("aaa", None);
        assert_ne!(a, Cache::derived_rel("bbb", None));
        assert_ne!(a, Cache::derived_rel("aaa", Some(b"org policy")));
        assert_eq!(a, Cache::derived_rel("aaa", None));
        assert!(a.contains(build_id()));
    }

    #[test]
    fn the_least_recently_used_entries_go_first_when_over_the_cap() {
        let root = tmp("lru");
        let c = Cache::at(&root, "repo0", 3000);
        for (i, name) in ["old", "mid", "new"].iter().enumerate() {
            c.put(&format!("derived/{name}/entry"), &vec![b'x'; 1000]).unwrap();
            let f = std::fs::File::open(root.join("repo0/derived").join(name).join("entry")).unwrap();
            f.set_modified(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000 + i as u64)).unwrap();
        }
        // Touching "old" makes it the most recently used.
        assert!(c.get("derived/old/entry").is_some());
        c.put("derived/extra/entry", &vec![b'x'; 1000]).unwrap();
        assert!(c.get("derived/mid/entry").is_none(), "least recently used goes first");
        assert!(c.get("derived/old/entry").is_some() && c.get("derived/extra/entry").is_some());
    }

    #[test]
    fn engine_output_is_cached_beside_the_derived_entry_by_engine_hash() {
        let dir = tmp("eng");
        let (a, b) = (dir.join("a"), dir.join("b"));
        std::fs::write(&a, b"engine one").unwrap();
        std::fs::write(&b, b"engine two").unwrap();
        let d = Cache::derived_rel("sha", None);
        let (ra, rb) = (Cache::engine_rel(&d, &a), Cache::engine_rel(&d, &b));
        assert_ne!(ra, rb, "another engine binary must not read this engine's output");
        assert!(ra.starts_with(d.trim_end_matches("entry")) && ra.contains("engine-"));
    }

    #[test]
    fn blob_entries_live_under_the_adapter_and_version() {
        assert_eq!(Cache::blob_rel("ts", "3", 0, "ab12cd"), "blobs/ts-3-facts0/ab/ab12cd");
    }
}
