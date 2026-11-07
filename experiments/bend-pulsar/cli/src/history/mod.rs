//! Git history facts: `H`, `C`, `A`, `CF` and `CFN` from the repo's commit window.
//!
//! The window is the newest commits inside the date range, oldest first. `git log
//! --numstat -z` gives commits, authors and per-file line counts; renames are
//! followed to the file's head path. `CFN` needs function spans from the language
//! lane: it parses each changed blob through [`FnParser`] and charges hunk lines to
//! the innermost head function. With no head keys (the lane emits no `FK` yet) the
//! `CFN` relation is simply absent.

use crate::facts::{FactWriter, Rel, SideTables};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub const DEFAULT_SINCE_DAYS: u32 = 365;
pub const DEFAULT_MAX_COMMITS: u32 = 2000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    /// Days before the head commit's committer time. `None` means the whole history.
    pub since_days: Option<u32>,
    /// Newest commits to keep; `0` means no cap.
    pub max_commits: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config { since_days: Some(DEFAULT_SINCE_DAYS), max_commits: DEFAULT_MAX_COMMITS }
    }
}

#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct Stats {
    pub commits: usize,
    pub authors: usize,
    pub cf: usize,
    pub cfn: usize,
    /// Historical blobs parsed for `CFN` (cache misses).
    pub blobs: usize,
    pub pass1_ms: u128,
    pub pass2_ms: u128,
}

/// One function of one file version, as the language lane keys it (`FK`).
pub struct FnSpan {
    pub key: u64,
    pub start_line: u32,
    pub end_line: u32,
}

/// What history needs from a language lane to attribute hunks to head functions.
pub trait FnParser {
    /// Function spans for one file version. `key_path` is the file's path at head:
    /// `FK` is hashed with it, so churn follows renames.
    fn functions(&self, key_path: &Path, source: &str) -> Vec<FnSpan>;
}

/// Dispatches to the language lane by extension, reusing one oxc allocator across TS blobs.
#[derive(Default)]
struct LangFns {
    alloc: std::cell::RefCell<oxc_allocator::Allocator>,
}

impl FnParser for LangFns {
    fn functions(&self, key_path: &Path, source: &str) -> Vec<FnSpan> {
        let path = key_path.to_string_lossy();
        match key_path.extension().and_then(|e| e.to_str()) {
            Some("rs") => crate::lang::rust::function_spans(&path, source)
                .into_iter()
                .map(|f| FnSpan { key: f.key, start_line: f.start_line, end_line: f.end_line })
                .collect(),
            Some("ts" | "tsx" | "mts" | "cts") => {
                let mut alloc = self.alloc.borrow_mut();
                alloc.reset();
                crate::lang::ts::function_spans(&alloc, &path, source)
                    .into_iter()
                    .map(|f| FnSpan { key: f.key, start_line: f.start_line, end_line: f.end_line })
                    .collect()
            }
            _ => Vec::new(),
        }
    }
}

/// Emit `H`, `C`, `A`, `CF` and (when `head_keys` is non-empty) `CFN`.
///
/// `tables.paths` is the head file list in file-id order. `head_keys` is the `FK`
/// key per function id, in `.fns` order; empty when the language lane has no keys.
pub fn emit(
    repo: &Path,
    cfg: &Config,
    tables: &SideTables,
    head_keys: &[u64],
    w: &mut FactWriter,
) -> Result<Stats, String> {
    emit_with(repo, cfg, tables, head_keys, &LangFns::default(), w)
}

fn emit_with(
    repo: &Path,
    cfg: &Config,
    tables: &SideTables,
    head_keys: &[u64],
    parser: &dyn FnParser,
    w: &mut FactWriter,
) -> Result<Stats, String> {
    if !head_keys.is_empty() && head_keys.len() != tables.fns.len() {
        return Err(format!(
            "history: {} FK keys for {} .fns rows",
            head_keys.len(),
            tables.fns.len()
        ));
    }
    let head_ts = head_commit_time(repo)?;
    let mut stats = Stats::default();

    // Pass 1: commits, authors, churn per head file.
    let pass1 = std::time::Instant::now();
    let mut args = vec![
        "-c".to_string(),
        "core.quotePath=false".into(),
        "log".into(),
        "--numstat".into(),
        "-z".into(),
        "-M".into(),
        "--format=%x01%H%x01%ct%x01%an%x01%ae".into(),
    ];
    args.extend(log_args(cfg, head_ts));
    let out = git_output(repo, &args)?;
    let raw = parse_log(&out)?;
    let mut authors: Vec<Author> = Vec::new();
    let mut author_ids: HashMap<String, u32> = HashMap::new();
    let mut commits: Vec<Commit> = Vec::with_capacity(raw.len());
    for r in raw {
        let identity = author_identity(&r.email, &r.name);
        let author = *author_ids.entry(identity).or_insert_with(|| {
            authors.push(Author { name: r.name.clone(), email: r.email.clone(), bot: false });
            (authors.len() - 1) as u32
        });
        commits.push(Commit { sha: r.sha, day: (r.ts / 86_400) as u32, author, files: r.files });
    }
    let bots = BotMatcher::defaults();
    for a in &mut authors {
        a.bot = bots.is_bot(&a.name, &a.email);
    }

    w.push(Rel::H, &[commits.len() as u32, authors.len() as u32]);
    for (id, a) in authors.iter().enumerate() {
        w.push(Rel::A, &[id as u32, a.bot as u32]);
    }
    for (id, c) in commits.iter().enumerate() {
        w.push(Rel::C, &[id as u32, c.author, c.day]);
    }

    // Path at each commit -> path at head, for files that still exist at head.
    let mut head_paths: Vec<HashMap<String, String>> = vec![HashMap::new(); commits.len()];
    let mut at_head: HashMap<String, u32> = tables
        .paths
        .iter()
        .enumerate()
        .map(|(id, p)| (p.clone(), id as u32))
        .collect();
    for ci in (0..commits.len()).rev() {
        for f in &commits[ci].files {
            let mapped = match &f.old {
                Some(old) => {
                    let target = at_head.get(&f.new).copied();
                    match target {
                        Some(id) => {
                            at_head.insert(old.clone(), id);
                            Some(id)
                        }
                        None => {
                            at_head.remove(old);
                            None
                        }
                    }
                }
                None => at_head.get(&f.new).copied(),
            };
            let Some(id) = mapped else { continue };
            if f.added + f.deleted > 0 {
                w.push(Rel::Cf, &[ci as u32, id, f.added, f.deleted]);
                stats.cf += 1;
            }
            if !head_keys.is_empty() {
                head_paths[ci].insert(f.new.clone(), tables.paths[id as usize].clone());
            }
        }
    }

    stats.commits = commits.len();
    stats.authors = authors.len();
    stats.pass1_ms = pass1.elapsed().as_millis();

    // Pass 2: hunks charged to head functions.
    let pass2 = std::time::Instant::now();
    if !head_keys.is_empty() {
        let mut key_ids: HashMap<u64, u32> = HashMap::with_capacity(head_keys.len());
        for (id, key) in head_keys.iter().enumerate() {
            key_ids.entry(*key).or_insert(id as u32);
        }
        let fn_files: HashSet<&str> = tables
            .fns
            .iter()
            .filter_map(|f| tables.paths.get(f.file as usize).map(String::as_str))
            .collect();
        let commit_ids: HashMap<&str, u32> =
            commits.iter().enumerate().map(|(id, c)| (c.sha.as_str(), id as u32)).collect();
        let mut cfn = Cfn {
            key_ids: &key_ids,
            fn_files: &fn_files,
            head_paths: &head_paths,
            commit_ids,
            parser,
            cat: CatFile::start(repo)?,
            parsed: HashMap::new(),
            w,
            rows: 0,
            blobs: 0,
        };
        for_each_patch(repo, cfg, head_ts, &mut |sha, file| cfn.file(sha, file))?;
        stats.cfn = cfn.rows;
        stats.blobs = cfn.blobs;
        stats.pass2_ms = pass2.elapsed().as_millis();
    }

    Ok(stats)
}

// ---------------------------------------------------------------- git plumbing

fn git_output(repo: &Path, args: &[String]) -> Result<Vec<u8>, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("cannot run git: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

fn head_commit_time(repo: &Path) -> Result<u64, String> {
    let out = git_output(repo, &["log".into(), "-1".into(), "--format=%ct".into(), "HEAD".into()])?;
    let s = String::from_utf8_lossy(&out);
    s.trim()
        .parse()
        .map_err(|_| format!("history: cannot read the head commit time from {s:?}"))
}

/// The shared window for both git passes: newest `max_commits` inside `since_days`
/// before the head commit, emitted oldest first.
fn log_args(cfg: &Config, head_ts: u64) -> Vec<String> {
    let mut args = vec!["--no-merges".to_string(), "--reverse".to_string()];
    if let Some(days) = cfg.since_days {
        let since = head_ts.saturating_sub(days as u64 * 86_400);
        args.push(format!("--since=@{since}"));
    }
    if cfg.max_commits > 0 {
        args.push(format!("--max-count={}", cfg.max_commits));
    }
    args
}

struct Commit {
    sha: String,
    day: u32,
    author: u32,
    files: Vec<FileChange>,
}

struct FileChange {
    added: u32,
    deleted: u32,
    /// Set for a rename: the path in the parent commit.
    old: Option<String>,
    /// The path in this commit (the new side of a rename).
    new: String,
}

struct Author {
    name: String,
    email: String,
    bot: bool,
}

struct RawCommit {
    sha: String,
    ts: u64,
    name: String,
    email: String,
    files: Vec<FileChange>,
}

fn author_identity(email: &str, name: &str) -> String {
    let e = email.trim().to_ascii_lowercase();
    if e.is_empty() {
        name.trim().to_ascii_lowercase()
    } else {
        e
    }
}

/// Parse `git log --numstat -z --format=%x01%H%x01%ct%x01%an%x01%ae`.
///
/// Records are NUL-terminated. A commit header is `\x01<sha>\x01<ct>\x01<name>\x01<email>`.
/// A numstat record is `<added>\t<deleted>\t<path>`, or for a rename
/// `<added>\t<deleted>\t` followed by `\0<old>\0<new>\0`.
fn parse_log(out: &[u8]) -> Result<Vec<RawCommit>, String> {
    let mut commits = Vec::new();
    let mut i = 0;
    while i < out.len() {
        match out[i] {
            0 | b'\n' => i += 1,
            0x01 => {
                let Some(end) = out[i..].iter().position(|&b| b == 0) else {
                    return Err("history: unterminated commit header".into());
                };
                let fields: Vec<&[u8]> = out[i + 1..i + end].split(|&b| b == 0x01).collect();
                if fields.len() != 4 {
                    return Err(format!("history: commit header has {} fields", fields.len()));
                }
                commits.push(RawCommit {
                    sha: text(fields[0]),
                    ts: number(fields[1])? as u64,
                    name: text(fields[2]),
                    email: text(fields[3]),
                    files: Vec::new(),
                });
                i += end + 1;
            }
            _ => {
                let Some(end) = out[i..].iter().position(|&b| b == 0) else {
                    let tail = &out[i..out.len().min(i + 80)];
                    return Err(format!(
                        "history: unterminated numstat record at {i}/{}: {:?}",
                        out.len(),
                        text(tail)
                    ));
                };
                let rec = &out[i..i + end];
                i += end + 1;
                let mut parts = rec.splitn(3, |&b| b == b'\t');
                let added = number(parts.next().unwrap_or(b"0")).unwrap_or(0);
                let deleted = number(parts.next().unwrap_or(b"0")).unwrap_or(0);
                let rest = parts.next().unwrap_or(b"");
                let (old, new) = if rest.is_empty() {
                    let Some(e) = out[i..].iter().position(|&b| b == 0) else {
                        return Err("history: unterminated rename source".into());
                    };
                    let old = text(&out[i..i + e]);
                    i += e + 1;
                    let Some(e) = out[i..].iter().position(|&b| b == 0) else {
                        return Err("history: unterminated rename target".into());
                    };
                    let new = text(&out[i..i + e]);
                    i += e + 1;
                    (Some(old), new)
                } else {
                    (None, text(rest))
                };
                let Some(cur) = commits.last_mut() else {
                    return Err("history: numstat before the first commit".into());
                };
                cur.files.push(FileChange { added, deleted, old, new });
            }
        }
    }
    Ok(commits)
}

fn text(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

/// A numstat field is decimal, or `-` for a binary file.
fn number(b: &[u8]) -> Result<u32, String> {
    if b == b"-" {
        return Ok(0);
    }
    std::str::from_utf8(b)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .ok_or_else(|| format!("history: bad numstat number {:?}", text(b)))
}

// -------------------------------------------------------------------- bots

/// Bot authors are excluded from churn by the engine (`A bot 1`). The defaults are
/// technology-free: a `[bot]` name suffix, plus the names GitHub's automation uses.
/// Repo catalog patterns plug in here later, as extra entries in `names`.
pub struct BotMatcher {
    names: HashSet<String>,
}

impl BotMatcher {
    pub fn defaults() -> Self {
        let names = [
            "allcontributors",
            "dependabot",
            "github-actions",
            "greenkeeper",
            "mergify",
            "pre-commit-ci",
            "renovate",
            "semantic-release-bot",
            "snyk-bot",
        ];
        BotMatcher { names: names.iter().map(|s| s.to_string()).collect() }
    }

    pub fn is_bot(&self, name: &str, _email: &str) -> bool {
        let n = name.trim().to_ascii_lowercase();
        n.ends_with("[bot]") || self.names.contains(&n)
    }
}

// --------------------------------------------------------------- patch pass

/// One file section of `git log -p --unified=0`, with its post-image hunks.
struct PatchFile {
    path: String,
    oid: Option<String>,
    deleted: bool,
    hunks: Vec<Hunk>,
}

struct Hunk {
    new_start: u32,
    new_count: u32,
    old_count: u32,
}

/// Stream `git log -p --unified=0 -M` and hand each complete file section to `f`.
fn for_each_patch(
    repo: &Path,
    cfg: &Config,
    head_ts: u64,
    f: &mut dyn FnMut(&str, PatchFile) -> Result<(), String>,
) -> Result<(), String> {
    let mut args = vec![
        "-c".to_string(),
        "core.quotePath=false".into(),
        "log".into(),
        "-p".into(),
        "--unified=0".into(),
        "-M".into(),
        "--format=%x01%H".into(),
    ];
    args.extend(log_args(cfg, head_ts));
    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("cannot run git log -p: {e}"))?;
    let stdout = child.stdout.take().ok_or("history: git log -p has no stdout")?;
    let mut lines = BufReader::new(stdout);
    let mut line = Vec::new();
    let mut sha = String::new();
    let mut file: Option<PatchFile> = None;
    loop {
        line.clear();
        let n = lines
            .read_until(b'\n', &mut line)
            .map_err(|e| format!("history: reading git log -p: {e}"))?;
        if n == 0 {
            break;
        }
        let l = line.strip_suffix(b"\n").unwrap_or(&line);
        if let Some(rest) = l.strip_prefix(b"\x01") {
            flush_patch(&sha, &mut file, f)?;
            sha = text(rest);
        } else if l.starts_with(b"diff --git ") {
            flush_patch(&sha, &mut file, f)?;
            file = Some(PatchFile { path: String::new(), oid: None, deleted: false, hunks: Vec::new() });
        } else if let Some(rest) = l.strip_prefix(b"index ") {
            if let Some(cur) = file.as_mut() {
                let spec = rest.split(|&b| b == b' ').next().unwrap_or(b"");
                if let Some(dots) = spec.windows(2).position(|w| w == b"..") {
                    let new = &spec[dots + 2..];
                    if !new.is_empty() && !new.iter().all(|&b| b == b'0') {
                        cur.oid = Some(text(new));
                    }
                }
            }
        } else if let Some(rest) = l.strip_prefix(b"+++ ") {
            if let Some(cur) = file.as_mut() {
                if rest == b"/dev/null" {
                    cur.deleted = true;
                } else {
                    let path = if rest.first() == Some(&b'"') { unquote(rest) } else { text(rest) };
                    cur.path = path.strip_prefix("b/").unwrap_or(&path).to_string();
                }
            }
        } else if l.starts_with(b"@@ ") {
            if let (Some(cur), Some(h)) = (file.as_mut(), parse_hunk(l)) {
                cur.hunks.push(h);
            }
        }
    }
    flush_patch(&sha, &mut file, f)?;
    let status = child.wait().map_err(|e| format!("history: git log -p: {e}"))?;
    if !status.success() {
        return Err(format!("history: git log -p exited with {status}"));
    }
    Ok(())
}

fn flush_patch(
    sha: &str,
    file: &mut Option<PatchFile>,
    f: &mut dyn FnMut(&str, PatchFile) -> Result<(), String>,
) -> Result<(), String> {
    if let Some(p) = file.take() {
        if p.hunks.is_empty() || p.deleted || p.oid.is_none() {
            return Ok(());
        }
        f(sha, p)?;
    }
    Ok(())
}

/// Undo git's C-style path quoting (`"a\tb"`), when it applied.
fn unquote(b: &[u8]) -> String {
    if b.first() != Some(&b'"') || b.last() != Some(&b'"') || b.len() < 2 {
        return text(b);
    }
    let mut out = Vec::with_capacity(b.len());
    let mut i = 1;
    while i + 1 < b.len() {
        let c = b[i];
        if c != b'\\' {
            out.push(c);
            i += 1;
            continue;
        }
        i += 1;
        match b.get(i).copied().unwrap_or(b'\\') {
            b'n' => out.push(b'\n'),
            b't' => out.push(b'\t'),
            b'r' => out.push(b'\r'),
            b'"' => out.push(b'"'),
            b'\\' => out.push(b'\\'),
            b'0'..=b'7' => {
                let mut v = 0u32;
                let mut k = 0;
                while k < 3 {
                    match b.get(i + k).copied() {
                        Some(d @ b'0'..=b'7') => {
                            v = v * 8 + (d - b'0') as u32;
                            k += 1;
                        }
                        _ => break,
                    }
                }
                out.push(v as u8);
                i += k - 1;
            }
            other => out.push(other),
        }
        i += 1;
    }
    text(&out)
}

fn parse_hunk(line: &[u8]) -> Option<Hunk> {
    let s = std::str::from_utf8(line).ok()?;
    let mut it = s.split_whitespace();
    if it.next()? != "@@" {
        return None;
    }
    let old = it.next()?.strip_prefix('-')?;
    let new = it.next()?.strip_prefix('+')?;
    let (new_start, new_count) = parse_range(new)?;
    let (_, old_count) = parse_range(old)?;
    Some(Hunk { new_start, new_count, old_count })
}

fn parse_range(s: &str) -> Option<(u32, u32)> {
    let mut p = s.split(',');
    let start = p.next()?.parse().ok()?;
    let count = match p.next() {
        Some(c) => c.parse().ok()?,
        None => 1,
    };
    Some((start, count))
}

// ------------------------------------------------------------- blob parsing

/// One long-lived `git cat-file --batch`: a blob per changed file version.
struct CatFile {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

impl CatFile {
    fn start(repo: &Path) -> Result<Self, String> {
        let mut child = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(["cat-file", "--batch"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("cannot run git cat-file: {e}"))?;
        let stdin = BufWriter::new(child.stdin.take().ok_or("history: cat-file has no stdin")?);
        let stdout = BufReader::new(child.stdout.take().ok_or("history: cat-file has no stdout")?);
        Ok(CatFile { child, stdin, stdout })
    }

    fn read(&mut self, oid: &str) -> Result<Vec<u8>, String> {
        writeln!(self.stdin, "{oid}").map_err(|e| format!("history: cat-file write: {e}"))?;
        self.stdin.flush().map_err(|e| format!("history: cat-file flush: {e}"))?;
        let mut header = String::new();
        self.stdout
            .read_line(&mut header)
            .map_err(|e| format!("history: cat-file read: {e}"))?;
        let mut it = header.split_whitespace();
        let _oid = it.next();
        let kind = it.next().unwrap_or("");
        let size: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        if kind != "blob" {
            return Err(format!("history: cat-file: {oid} is {kind:?}"));
        }
        let mut buf = vec![0u8; size];
        self.stdout
            .read_exact(&mut buf)
            .map_err(|e| format!("history: cat-file body: {e}"))?;
        let mut nl = [0u8; 1];
        self.stdout
            .read_exact(&mut nl)
            .map_err(|e| format!("history: cat-file newline: {e}"))?;
        Ok(buf)
    }
}

impl Drop for CatFile {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Parsed {
    spans: Vec<FnSpan>,
    lines: u32,
}

struct Cfn<'a> {
    key_ids: &'a HashMap<u64, u32>,
    fn_files: &'a HashSet<&'a str>,
    head_paths: &'a [HashMap<String, String>],
    commit_ids: HashMap<&'a str, u32>,
    parser: &'a dyn FnParser,
    cat: CatFile,
    /// Parsed spans per (blob oid, head path): FK depends on both.
    parsed: HashMap<(String, String), Parsed>,
    w: &'a mut FactWriter,
    rows: usize,
    blobs: usize,
}

impl Cfn<'_> {
    fn file(&mut self, sha: &str, file: PatchFile) -> Result<(), String> {
        let Some(&commit) = self.commit_ids.get(sha) else { return Ok(()) };
        let Some(oid) = file.oid else { return Ok(()) };
        let Some(head_path) = self.head_paths[commit as usize].get(&file.path).cloned() else {
            return Ok(());
        };
        if !self.fn_files.contains(head_path.as_str()) {
            return Ok(());
        }
        let key = (oid.clone(), head_path.clone());
        if !self.parsed.contains_key(&key) {
            let blob = self.cat.read(&oid)?;
            self.blobs += 1;
            let parsed = match std::str::from_utf8(&blob) {
                Ok(source) => {
                    let lines = source.lines().count() as u32;
                    let spans = self.parser.functions(Path::new(&head_path), source);
                    Parsed { spans, lines }
                }
                Err(_) => Parsed { spans: Vec::new(), lines: 0 },
            };
            self.parsed.insert(key.clone(), parsed);
        }
        let parsed = self.parsed.get(&key).expect("inserted above");
        if parsed.spans.is_empty() {
            return Ok(());
        }
        let mut counts: HashMap<u32, u32> = HashMap::new();
        for h in &file.hunks {
            charge(&parsed.spans, self.key_ids, parsed.lines, h, &mut counts);
        }
        for (fn_id, touched) in counts {
            if touched > 0 {
                self.w.push(Rel::Cfn, &[commit, fn_id, touched]);
                self.rows += 1;
            }
        }
        Ok(())
    }
}

fn charge(
    spans: &[FnSpan],
    keys: &HashMap<u64, u32>,
    file_lines: u32,
    h: &Hunk,
    counts: &mut HashMap<u32, u32>,
) {
    // (start, end, head fn id), only spans whose key exists at head.
    let mut ids: Vec<(u32, u32, u32)> = spans
        .iter()
        .filter_map(|s| keys.get(&s.key).map(|&id| (s.start_line, s.end_line, id)))
        .collect();
    ids.sort_unstable();
    let innermost = |line: u32| -> Option<u32> {
        let mut best: Option<(u32, u32, u32)> = None;
        for &(start, end, id) in &ids {
            if start > line {
                break;
            }
            if line <= end {
                best = match best {
                    Some((bs, be, _)) if start > bs || (start == bs && end < be) => Some((start, end, id)),
                    None => Some((start, end, id)),
                    other => other,
                };
            }
        }
        best.map(|(_, _, id)| id)
    };
    for k in 0..h.new_count {
        let line = h.new_start.saturating_add(k);
        if line == 0 {
            continue;
        }
        if let Some(id) = innermost(line) {
            *counts.entry(id).or_insert(0) += 1;
        }
    }
    if h.old_count > 0 {
        let anchor = if h.new_count == 0 { h.new_start.max(1) } else { h.new_start };
        let anchor = anchor.min(file_lines.max(1));
        if let Some(id) = innermost(anchor) {
            *counts.entry(id).or_insert(0) += h.old_count;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facts::{FnEntry, SideTables};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const DAY: u64 = 86_400;

    struct TempRepo {
        dir: PathBuf,
    }

    impl TempRepo {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "pulsar-history-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            let repo = TempRepo { dir };
            repo.git(&["init", "-q"]);
            repo
        }

        fn git(&self, args: &[&str]) -> String {
            let out = Command::new("git")
                .arg("-C")
                .arg(&self.dir)
                .args(args)
                .output()
                .unwrap_or_else(|e| panic!("git {args:?}: {e}"));
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8_lossy(&out.stdout).into_owned()
        }

        fn write(&self, path: &str, body: &str) {
            let p = self.dir.join(path);
            if let Some(parent) = p.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(p, body).unwrap();
        }

        fn commit(&self, message: &str, ts: u64, name: &str, email: &str) {
            self.git(&["add", "-A"]);
            let date = format!("@{ts} +0000");
            let out = Command::new("git")
                .arg("-C")
                .arg(&self.dir)
                .args([
                    "-c",
                    &format!("user.name={name}"),
                    "-c",
                    &format!("user.email={email}"),
                    "commit",
                    "-q",
                    "-m",
                    message,
                ])
                .env("GIT_AUTHOR_DATE", &date)
                .env("GIT_COMMITTER_DATE", &date)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "commit: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    /// A stand-in for a language lane: a function is a line `fn <name>`; it runs to
    /// the line before the next `fn` line or the end of the file.
    struct LineFns;

    impl FnParser for LineFns {
        fn functions(&self, _key_path: &Path, source: &str) -> Vec<FnSpan> {
            let lines: Vec<&str> = source.lines().collect();
            let mut out = Vec::new();
            for (i, line) in lines.iter().enumerate() {
                let Some(name) = line.strip_prefix("fn ") else { continue };
                let end = lines
                    .iter()
                    .enumerate()
                    .skip(i + 1)
                    .find(|(_, l)| l.starts_with("fn "))
                    .map(|(j, _)| j)
                    .unwrap_or(lines.len());
                out.push(FnSpan {
                    key: crate::facts::stable_key(name.trim()),
                    start_line: (i + 1) as u32,
                    end_line: end as u32,
                });
            }
            out
        }
    }

    fn facts(
        repo: &Path,
        cfg: Config,
        tables: &SideTables,
        keys: &[u64],
        parser: &dyn FnParser,
    ) -> (String, Stats) {
        let mut w = FactWriter::new();
        let stats = emit_with(repo, &cfg, tables, keys, parser, &mut w).unwrap();
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        (String::from_utf8(out).unwrap(), stats)
    }

    fn rows(text: &str, tag: &str) -> Vec<Vec<u32>> {
        text.lines()
            .filter_map(|l| {
                let mut it = l.split(' ');
                if it.next()? != tag {
                    return None;
                }
                Some(it.map(|v| v.parse().unwrap()).collect())
            })
            .collect()
    }

    fn tables(paths: &[&str]) -> SideTables {
        SideTables {
            paths: paths.iter().map(|p| p.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn window_authors_and_bots() {
        let repo = TempRepo::new("window");
        repo.write("a.ts", "one\n");
        repo.commit("c1", 1_767_225_600, "Alice", "alice@example.com");
        repo.write("a.ts", "one\ntwo\n");
        repo.commit("c2", 1_767_225_600 + DAY, "dependabot[bot]", "bot@example.com");
        repo.write("a.ts", "one\ntwo\nthree\n");
        repo.commit("c3", 1_767_225_600 + 2 * DAY, "alice", "ALICE@example.com");

        let cfg = Config { since_days: None, max_commits: 2 };
        let (text, stats) = facts(&repo.dir, cfg, &tables(&["a.ts"]), &[], &LineFns);

        assert_eq!(rows(&text, "H"), vec![vec![2, 2]]);
        assert_eq!(
            rows(&text, "C"),
            vec![
                vec![0, 0, (1_767_225_600 / DAY + 1) as u32],
                vec![1, 1, (1_767_225_600 / DAY + 2) as u32],
            ]
        );
        // Author 0 is the bot, author 1 is Alice (same lowercased email as c1).
        assert_eq!(rows(&text, "A"), vec![vec![0, 1], vec![1, 0]]);
        assert_eq!(rows(&text, "CF"), vec![vec![0, 0, 1, 0], vec![1, 0, 1, 0]]);
        assert_eq!(stats.commits, 2);
        assert_eq!(stats.authors, 2);
    }

    #[test]
    fn rename_is_followed_to_the_head_file() {
        let repo = TempRepo::new("rename");
        repo.write("old.ts", "a\nb\nc\n");
        repo.commit("add", 1_767_225_600, "Alice", "alice@example.com");
        repo.git(&["mv", "old.ts", "new.ts"]);
        repo.write("new.ts", "a\nB\nc\n");
        repo.commit("rename", 1_767_225_600 + DAY, "Alice", "alice@example.com");

        let cfg = Config { since_days: None, max_commits: 0 };
        let (text, _) = facts(&repo.dir, cfg, &tables(&["new.ts"]), &[], &LineFns);
        assert_eq!(rows(&text, "CF"), vec![vec![0, 0, 3, 0], vec![1, 0, 1, 1]]);
    }

    #[test]
    fn cfn_charges_hunks_to_head_functions() {
        let repo = TempRepo::new("cfn");
        repo.write("a.ts", "fn a\nx\ny\nfn b\np\nq\n");
        repo.commit("add", 1_767_225_600, "Alice", "alice@example.com");
        repo.write("a.ts", "fn a\nx2\ny\nfn b\np\nq\n");
        repo.commit("edit", 1_767_225_600 + DAY, "Alice", "alice@example.com");
        repo.write("a.ts", "fn a\nx2\ny\nfn b\nq\n");
        repo.commit("delete", 1_767_225_600 + 2 * DAY, "Alice", "alice@example.com");

        let head = fs::read_to_string(repo.dir.join("a.ts")).unwrap();
        let spans = LineFns.functions(Path::new("a.ts"), &head);
        let keys: Vec<u64> = spans.iter().map(|s| s.key).collect();
        let mut t = tables(&["a.ts"]);
        t.fns = spans
            .iter()
            .map(|s| FnEntry {
                file: 0,
                start_line: s.start_line,
                end_line: s.end_line,
                parent: None,
                kind: 0,
                chain: "f".into(),
            })
            .collect();

        let cfg = Config { since_days: None, max_commits: 0 };
        let (text, stats) = facts(&repo.dir, cfg, &t, &keys, &LineFns);

        // Adds charge every line; the edit charges one added and one deleted line to
        // `fn a`; the deletion anchors at line 4, inside `fn b`.
        assert_eq!(
            rows(&text, "CFN"),
            vec![vec![0, 0, 3], vec![0, 1, 3], vec![1, 0, 2], vec![2, 1, 1]]
        );
        assert_eq!(stats.cfn, 4);
    }
}
