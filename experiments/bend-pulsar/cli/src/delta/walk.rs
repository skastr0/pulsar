//! Walks over history: `pulsar delta --walk`, `pulsar blame` and `pulsar bisect`.
//!
//! All three evaluate shas with the same `evaluate` as `pulsar delta` and decide each step with the
//! engine's proven delta (`compare`); nothing here computes a set difference. A walk keeps a window
//! of two evaluations (the previous sha and the current one), so its memory is two commits'
//! findings plus the state of the walk, not the length of the history. Every evaluation reads and
//! writes the per-sha cache (`~/.pulsar/cache`), so a second walk over the same shas parses nothing.
//!
//! This is a child module of `delta` so it can use the private `Eval`, `Diff` and `compare`.

use super::*;

pub const WALK_USAGE: &str = "usage: pulsar delta --walk [<base> [<head>]] [--since <sha> | --commits N] [--repo dir] [--json] [--findings] [--no-cache]
  one line per first-parent commit in the range: the findings it added, allowed, removed, and the
  functions it worsened or improved, each step decided by the engine's delta (exit 0)
  <head> defaults to HEAD. The range is --since <sha> (exclusive) .. <head>, or the last --commits N
  first-parent commits (default 20); two positionals are <base> <head>.
  --findings lists the added and removed findings under each commit
  --json prints one JSON line per commit and a summary line
  coverage is not read in a walk: core.crap is not reported";

pub const BLAME_USAGE: &str = "usage: pulsar blame [<head>] [--since <sha> | --commits N] [--repo dir] [--json] [--no-cache]
  for every finding at <head> (default HEAD): the first-parent commit that introduced it, following
  renames, and the commits where a function it is about got worse. The range defaults to the last 100
  first-parent commits; a finding present at the start of the range is `introduced before`.";

pub const BISECT_USAGE: &str = "usage: pulsar bisect <finding-key> [<head>] [--since <sha> | --commits N] [--repo dir] [--no-cache]
       pulsar bisect --test <finding-key> [--repo dir]
  binary-search the first-parent range for the commit that introduced a finding key, evaluating about
  log2(N) shas. exit 0 = found (the commit is printed), 1 = the key is not present at <head>,
  3 = it is present at the start of the range (widen --commits / --since), 2 = error.
  --test evaluates the checked-out commit for `git bisect run`: exit 1 = the finding is present (bad),
  0 = absent (good), 125 = the commit could not be evaluated (skip).
  A key follows the finding's identity at <head>: a finding re-keyed by a rename is absent before it.
  `pulsar blame` follows renames.";

const DEFAULT_WALK: usize = 20;
const DEFAULT_BLAME: usize = 100;

/// One first-parent commit, as shown.
#[derive(Clone, Debug)]
pub struct Commit {
    pub sha: String,
    pub date: String,
    pub subject: String,
}

/// What a walk covers and how it prints.
#[derive(Debug, Default)]
pub struct Opts {
    repo: PathBuf,
    head: Option<String>,
    since: Option<String>,
    commits: Option<usize>,
    json: bool,
    findings: bool,
    no_cache: bool,
    test: bool,
    pos: Vec<String>,
}

fn parse_opts(args: &[String], usage: &str) -> Result<Opts, String> {
    let mut o = Opts { repo: PathBuf::from("."), ..Opts::default() };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--walk" => {}
            "--json" => o.json = true,
            "--findings" => o.findings = true,
            "--no-cache" => o.no_cache = true,
            "--test" => o.test = true,
            "--repo" => o.repo = PathBuf::from(it.next().ok_or("--repo needs a value")?),
            "--since" => o.since = Some(it.next().ok_or("--since needs a sha")?.clone()),
            "--commits" => {
                let n: usize = it.next().ok_or("--commits needs a number")?.parse().map_err(|_| "--commits needs a positive number".to_string())?;
                if n == 0 {
                    return Err("--commits needs a positive number".into());
                }
                o.commits = Some(n);
            }
            f if f.starts_with('-') => return Err(format!("unknown flag {f}\n{usage}")),
            _ => o.pos.push(a.clone()),
        }
    }
    if o.since.is_some() && o.commits.is_some() {
        return Err(format!("--since and --commits are alternatives\n{usage}"));
    }
    Ok(o)
}

/// `git log --first-parent` rows (`sha`, date, subject), newest first.
fn log_rows(repo: &Path, args: &[&str]) -> Result<Vec<Commit>, String> {
    let mut a = vec!["log", "--first-parent", "--format=%H%x1f%cs%x1f%s"];
    a.extend_from_slice(args);
    let out = git(repo, &a, &[])?;
    Ok(String::from_utf8_lossy(&out)
        .lines()
        .filter_map(|l| {
            let mut f = l.splitn(3, '\u{1f}');
            Some(Commit { sha: f.next()?.to_string(), date: f.next()?.to_string(), subject: f.next().unwrap_or("").to_string() })
        })
        .collect())
}

/// The commits a walk visits, oldest first. The first one is the baseline: it is evaluated but no
/// step ends at it. `since` is exclusive and becomes the baseline; `commits N` takes the last N
/// first-parent commits plus the one before them as the baseline.
fn commit_range(repo: &Path, head: &str, since: Option<&str>, commits: Option<usize>, default: usize) -> Result<Vec<Commit>, String> {
    let head = resolve(repo, head)?;
    let mut rows = match since {
        Some(s) => {
            let base = resolve(repo, s)?;
            let range = format!("{base}..{head}");
            let mut r = log_rows(repo, &[&range])?;
            let mut b = log_rows(repo, &["-n", "1", &base])?;
            r.append(&mut b);
            r
        }
        None => log_rows(repo, &["-n", &(commits.unwrap_or(default) + 1).to_string(), &head])?,
    };
    rows.reverse();
    if rows.len() < 2 {
        return Err(format!("{head}: fewer than two first-parent commits in the range, nothing to walk"));
    }
    Ok(rows)
}

fn head_of(o: &Opts) -> &str {
    o.head.as_deref().unwrap_or("HEAD")
}

/// The window walk: evaluate each sha once, compare it with the one before, give the step to
/// `on_step`, drop the older evaluation. Returns the evaluation of the last commit.
enum Event<'a> {
    /// The baseline commit, evaluated; no step ends at it.
    Start(&'a Commit, &'a Eval),
    /// Commit `i` was compared with commit `i - 1`.
    Step(usize, &'a Eval, &'a Eval, &'a Diff<'a>),
}

fn walk(repo: &Path, commits: &[Commit], use_cache: bool, mut on: impl FnMut(Event) -> Result<(), String>) -> Result<Eval, String> {
    let engine = engine::locate()?;
    let scratch = Scratch::new("engine")?;
    let run = |rows: &Rows, name: &str| delta_engine::run(&engine, rows, &scratch.0, name);
    let mut prev = evaluate(repo, &commits[0].sha, "walk", None, false, use_cache)?;
    on(Event::Start(&commits[0], &prev))?;
    for (i, c) in commits.iter().enumerate().skip(1) {
        let cur = evaluate(repo, &c.sha, "walk", None, false, use_cache)?;
        let renames = rename::detect(repo, &commits[i - 1].sha, &c.sha)?;
        {
            let diff = compare(&prev, &cur, &renames, false, &run)?;
            on(Event::Step(i, &prev, &cur, &diff))?;
        }
        prev = cur;
    }
    Ok(prev)
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(12)]
}

/// `pulsar delta --walk`: the per-commit table.
pub fn run_walk(args: &[String]) -> Result<u8, String> {
    let mut o = parse_opts(args, WALK_USAGE)?;
    let (mut base, mut head) = (None, None);
    match o.pos.as_slice() {
        [] => {}
        [h] => head = Some(h.clone()),
        [b, h] => (base, head) = (Some(b.clone()), Some(h.clone())),
        _ => return Err(WALK_USAGE.to_string()),
    }
    o.head = head;
    let since = base.or_else(|| o.since.clone());
    let commits = commit_range(&o.repo, head_of(&o), since.as_deref(), o.commits, DEFAULT_WALK)?;
    let started = Instant::now();
    let (mut hits, mut misses, mut totals) = (0usize, 0usize, [0usize; 4]);
    let mut count = |e: &Eval| match e.timing.cache {
        "hit" => hits += 1,
        _ => misses += 1,
    };
    let (mut lines, json, findings) = (Vec::<String>::new(), o.json, o.findings);
    let mut out = std::io::stdout().lock();
    let mut emit = |s: String| -> Result<(), String> {
        use std::io::Write;
        out.write_all(s.as_bytes()).and_then(|()| out.flush()).map_err(|e| format!("stdout: {e}"))
    };
    let last = walk(&o.repo, &commits, !o.no_cache, |ev| {
        let (i, cur, d) = match ev {
            Event::Start(c, e) => {
                count(e);
                eprintln!("pulsar: walk baseline {} cache={}", short(&c.sha), e.timing.cache);
                return Ok(());
            }
            Event::Step(i, _, cur, d) => (i, cur, d),
        };
        {
            count(cur);
            let c = &commits[i];
            let (worse, better) = (d.count(true), d.count(false));
            for (t, n) in totals.iter_mut().zip([d.added.len(), d.removed.len(), worse, better]) {
                *t += n;
            }
            lines.clear();
            if json {
                let mut v = json!({"type":"step","sha":c.sha,"parent":commits[i - 1].sha,"date":c.date,"subject":c.subject,
                    "added":d.added.len(),"allowed":d.allowed.len(),"removed":d.removed.len(),"coverage":d.coverage.len(),
                    "unchanged":d.unchanged,"worsened":worse,"improved":better,"degraded":d.degraded.len(),
                    "renamed_files":d.renamed_files,"renamed_findings":d.renamed_findings,"cache":cur.timing.cache});
                if findings {
                    v["added_findings"] = Value::Array(d.added.iter().map(|f| f.json("added")).collect());
                    v["removed_findings"] = Value::Array(d.removed.iter().map(|f| f.json("removed")).collect());
                }
                lines.push(v.to_string());
            } else {
                lines.push(format!(
                    "{} {} +{} -{} ~{} ~{}  {}",
                    short(&c.sha), c.date, d.added.len(), d.removed.len(), worse, better, c.subject
                ));
                if findings {
                    lines.extend(d.added.iter().map(|f| format!("  + {}", f.text())));
                    lines.extend(d.removed.iter().map(|f| format!("  - {}", f.text())));
                }
                lines.extend(d.degraded.iter().map(|(side, g)| format!("  ! DEGRADED INPUT ({side}) {}: {}", g.lane, g.cause)));
            }
            emit(lines.iter().map(|l| format!("{l}\n")).collect())
        }
    })?;
    let _ = last;
    let n = commits.len() - 1;
    let [added, removed, worse, better] = totals;
    let ms = started.elapsed().as_millis();
    let summary = if o.json {
        json!({"type":"summary","commits":n,"first":commits[1].sha,"last":commits[n].sha,"baseline":commits[0].sha,
            "added":added,"removed":removed,"worsened":worse,"improved":better,"cache_hits":hits,"cache_misses":misses,"ms":ms})
        .to_string()
    } else {
        format!(
            "# walk commits={n} baseline={} last={} added={added} removed={removed} worsened={worse} improved={better} cache_hits={hits} cache_misses={misses} ms={ms}",
            short(&commits[0].sha),
            short(&commits[n].sha)
        )
    };
    println!("{summary}");
    Ok(0)
}

/// Where a finding came from, as the blame walk tracks it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Origin {
    /// Index into the commit list of the commit that added it; `None` = present at the baseline.
    added_at: Option<usize>,
    /// Indices of the commits where a function it is about got worse.
    worsened_at: Vec<usize>,
}

/// One step of the blame state: the findings alive after `cur`, keyed as they are at `cur`.
/// `removed` and `pairs` are the base-side keys the engine delta reported; `introduced` are the head
/// keys it called added, allowed or coverage. Anything alive in `cur` that the state lacks is
/// introduced here too, and anything the state holds that `cur` lacks is dropped; the number of such
/// repairs is returned, because it should be zero.
fn advance(
    state: &mut BTreeMap<u64, Origin>,
    step: usize,
    removed: &[u64],
    pairs: &[(u64, u64)],
    introduced: &[u64],
    worsened_findings: &[u64],
    alive: &BTreeSet<u64>,
) -> usize {
    for k in removed {
        state.remove(k);
    }
    let moved: Vec<(u64, Origin)> = pairs.iter().filter_map(|(b, h)| state.remove(b).map(|o| (*h, o))).collect();
    state.extend(moved);
    for k in introduced {
        state.insert(*k, Origin { added_at: Some(step), worsened_at: Vec::new() });
    }
    for k in worsened_findings {
        if let Some(o) = state.get_mut(k) {
            if o.worsened_at.last() != Some(&step) {
                o.worsened_at.push(step);
            }
        }
    }
    let mut repairs = 0;
    state.retain(|k, _| {
        let keep = alive.contains(k);
        repairs += usize::from(!keep);
        keep
    });
    for k in alive {
        if !state.contains_key(k) {
            state.insert(*k, Origin { added_at: Some(step), worsened_at: Vec::new() });
            repairs += 1;
        }
    }
    repairs
}

/// The finding keys at `cur` that are about a function in `worse` (head function keys).
fn findings_about(cur: &Eval, worse: &BTreeSet<u64>) -> Vec<u64> {
    cur.findings
        .iter()
        .filter(|(_, f)| f.subjects.iter().any(|s| matches!(s, Subject::Function { key, .. } if worse.contains(key))))
        .map(|(k, _)| *k)
        .collect()
}

/// `pulsar blame`: for every finding at head, the commit that introduced it.
pub fn run_blame(args: &[String]) -> Result<u8, String> {
    let mut o = parse_opts(args, BLAME_USAGE)?;
    match o.pos.as_slice() {
        [] => {}
        [h] => o.head = Some(h.clone()),
        _ => return Err(BLAME_USAGE.to_string()),
    }
    let commits = commit_range(&o.repo, head_of(&o), o.since.as_deref(), o.commits, DEFAULT_BLAME)?;
    let mut state: BTreeMap<u64, Origin> = BTreeMap::new();
    let (mut repairs, mut degraded_steps) = (0usize, 0usize);
    let last = walk(&o.repo, &commits, !o.no_cache, |ev| {
        let (i, cur, d) = match ev {
            Event::Start(_, base) => {
                state = base.findings.keys().map(|k| (*k, Origin::default())).collect();
                return Ok(());
            }
            Event::Step(i, _, cur, d) => (i, cur, d),
        };
        {
            let removed: Vec<u64> = d.removed.iter().map(|f| f.key()).collect();
            let introduced: Vec<u64> = [d.added.as_slice(), d.allowed.as_slice(), d.coverage.as_slice()].concat().iter().map(|f| f.key()).collect();
            let worse: BTreeSet<u64> = d.trends.iter().filter(|t| t.worse).map(|t| t.key).collect();
            let about = if worse.is_empty() { Vec::new() } else { findings_about(cur, &worse) };
            let alive: BTreeSet<u64> = cur.findings.keys().copied().collect();
            repairs += advance(&mut state, i, &removed, &d.pairs, &introduced, &about, &alive);
            degraded_steps += usize::from(!d.degraded.is_empty());
            Ok(())
        }
    })?;
    let mut rows: Vec<(&Finding, &Origin)> = last.findings.iter().filter_map(|(k, f)| state.get(k).map(|o| (f, o))).collect();
    rows.sort_by(|(a, _), (b, _)| (a.rule.id, &a.file, a.line, a.key()).cmp(&(b.rule.id, &b.file, b.line, b.key())));
    let who = |i: usize| format!("{} {} {}", short(&commits[i].sha), commits[i].date, commits[i].subject);
    let mut out = String::new();
    for (f, origin) in &rows {
        let worsened: Vec<String> = origin.worsened_at.iter().map(|i| short(&commits[*i].sha).to_string()).collect();
        if o.json {
            let mut v = f.json("present");
            v["type"] = json!("blame");
            v["introduced"] = match origin.added_at {
                Some(i) => json!({"sha":commits[i].sha,"date":commits[i].date,"subject":commits[i].subject}),
                None => Value::Null,
            };
            v["before_window"] = json!(origin.added_at.is_none());
            v["worsened"] = json!(origin.worsened_at.iter().map(|i| commits[*i].sha.clone()).collect::<Vec<_>>());
            out.push_str(&format!("{v}\n"));
        } else {
            let intro = match origin.added_at {
                Some(i) => format!("introduced {}", who(i)),
                None => format!("introduced before {} (present at the start of the range)", short(&commits[0].sha)),
            };
            let w = if worsened.is_empty() { String::new() } else { format!("  worsened at {}", worsened.join(" ")) };
            out.push_str(&format!("{}\n    {intro}{w}\n", f.text()));
        }
    }
    let before = rows.iter().filter(|(_, o)| o.added_at.is_none()).count();
    let tail = format!(
        "# blame head={} baseline={} commits={} findings={} introduced_in_range={} before_range={} unreconciled={repairs} degraded_steps={degraded_steps}",
        short(&commits[commits.len() - 1].sha),
        short(&commits[0].sha),
        commits.len() - 1,
        rows.len(),
        rows.len() - before,
        before
    );
    if o.json {
        out.push_str(&format!("{}\n", json!({"type":"summary","head":commits[commits.len()-1].sha,"baseline":commits[0].sha,
            "commits":commits.len()-1,"findings":rows.len(),"introduced_in_range":rows.len()-before,"before_range":before,
            "unreconciled":repairs,"degraded_steps":degraded_steps})));
    } else {
        out.push_str(&format!("{tail}\n"));
    }
    print!("{out}");
    Ok(0)
}

fn parse_key(s: &str) -> Result<u64, String> {
    if s.len() != 16 || !s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err(format!("{s:?} is not a finding key (16 lowercase hex digits, the second word of a finding line)"));
    }
    u64::from_str_radix(s, 16).map_err(|e| format!("{s}: {e}"))
}

/// Is the finding `key` present when `sha` is evaluated?
fn present(repo: &Path, sha: &str, key: u64, use_cache: bool) -> Result<bool, String> {
    Ok(evaluate(repo, sha, "bisect", None, false, use_cache)?.findings.contains_key(&key))
}

/// The binary search itself, over any `present` predicate: `n` commits oldest first, the last one
/// known present. Returns `None` when the first is already present, else the index of the first
/// commit from which the finding is present, assuming it stays present (a finding that came and
/// went in between is found at one of its introductions, as `git bisect` does).
fn first_present(n: usize, mut present: impl FnMut(usize) -> Result<bool, String>) -> Result<Option<usize>, String> {
    if present(0)? {
        return Ok(None);
    }
    let (mut lo, mut hi) = (0, n - 1);
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if present(mid)? {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    Ok(Some(hi))
}

/// `pulsar bisect`: find the introducing commit of one finding key; `--test` is the predicate for
/// `git bisect run`.
pub fn run_bisect(args: &[String]) -> Result<u8, String> {
    let mut o = parse_opts(args, BISECT_USAGE)?;
    let pos = std::mem::take(&mut o.pos);
    let (key, rest) = pos.split_first().ok_or_else(|| BISECT_USAGE.to_string())?;
    let key = parse_key(key)?;
    match rest {
        [] => {}
        [h] => o.head = Some(h.clone()),
        _ => return Err(BISECT_USAGE.to_string()),
    }
    if o.test {
        // git sets the worktree to the commit under test; evaluate that commit from its tree object.
        let sha = match resolve(&o.repo, head_of(&o)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("pulsar: {e}");
                return Ok(125);
            }
        };
        return Ok(match present(&o.repo, &sha, key, !o.no_cache) {
            Ok(true) => 1,
            Ok(false) => 0,
            Err(e) => {
                eprintln!("pulsar: cannot evaluate {}: {e}", short(&sha));
                125
            }
        });
    }
    let commits = commit_range(&o.repo, head_of(&o), o.since.as_deref(), o.commits, DEFAULT_BLAME)?;
    let n = commits.len();
    let mut evaluated = 0usize;
    let mut check = |i: usize| -> Result<bool, String> {
        evaluated += 1;
        let p = present(&o.repo, &commits[i].sha, key, !o.no_cache)?;
        eprintln!("pulsar: bisect {} {}", short(&commits[i].sha), if p { "present" } else { "absent" });
        Ok(p)
    };
    if !check(n - 1)? {
        println!("# bisect key={} not present at {}", hex(key), short(&commits[n - 1].sha));
        return Ok(1);
    }
    let found = first_present(n, &mut check)?;
    match found {
        None => {
            println!("# bisect key={} present at the start of the range {}: widen --commits or --since", hex(key), short(&commits[0].sha));
            Ok(3)
        }
        Some(i) => {
            println!("{} {} {}", commits[i].sha, commits[i].date, commits[i].subject);
            println!("# bisect key={} introduced_at={} parent={} commits={} evaluated={evaluated}", hex(key), short(&commits[i].sha), short(&commits[i - 1].sha), n - 1);
            Ok(0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(at: Option<usize>) -> Origin {
        Origin { added_at: at, worsened_at: vec![] }
    }

    #[test]
    fn a_finding_keeps_its_origin_across_a_rekey_and_a_new_one_gets_the_step() {
        let mut s: BTreeMap<u64, Origin> = BTreeMap::new();
        s.insert(1, origin(None));
        s.insert(2, origin(Some(3)));
        s.insert(3, origin(Some(1)));
        // Step 5: finding 1 is removed, 2 is re-keyed to 20 (a rename), 4 is new, 3 is unchanged.
        let alive: BTreeSet<u64> = [20, 3, 4].into_iter().collect();
        let repairs = advance(&mut s, 5, &[1], &[(2, 20)], &[4], &[], &alive);
        assert_eq!(repairs, 0);
        assert_eq!(s.get(&20), Some(&origin(Some(3))), "the rename carries the introducing commit");
        assert_eq!(s.get(&4), Some(&origin(Some(5))));
        assert_eq!(s.get(&3), Some(&origin(Some(1))));
        assert!(!s.contains_key(&1) && !s.contains_key(&2));
    }

    #[test]
    fn a_finding_that_disappears_and_returns_is_introduced_where_it_returned() {
        let mut s: BTreeMap<u64, Origin> = BTreeMap::new();
        s.insert(7, origin(Some(1)));
        advance(&mut s, 2, &[7], &[], &[], &[], &BTreeSet::new());
        assert!(s.is_empty());
        advance(&mut s, 4, &[], &[], &[7], &[], &[7].into_iter().collect());
        assert_eq!(s.get(&7), Some(&origin(Some(4))));
    }

    #[test]
    fn worsened_commits_accumulate_once_per_step() {
        let mut s: BTreeMap<u64, Origin> = BTreeMap::new();
        s.insert(9, origin(Some(1)));
        let alive: BTreeSet<u64> = [9].into_iter().collect();
        advance(&mut s, 2, &[], &[], &[], &[9, 9], &alive);
        advance(&mut s, 5, &[], &[], &[], &[9], &alive);
        assert_eq!(s[&9].worsened_at, vec![2, 5]);
    }

    #[test]
    fn a_state_that_disagrees_with_the_walk_is_repaired_and_counted() {
        let mut s: BTreeMap<u64, Origin> = BTreeMap::new();
        s.insert(1, origin(None));
        // 1 is not alive and 2 is alive but nobody reported it added.
        let repairs = advance(&mut s, 3, &[], &[], &[], &[], &[2].into_iter().collect());
        assert_eq!(repairs, 2);
        assert_eq!(s.keys().copied().collect::<Vec<_>>(), vec![2]);
        assert_eq!(s[&2], origin(Some(3)));
    }

    #[test]
    fn bisect_finds_the_first_present_commit_in_log_steps() {
        // 16 commits, the finding appears at index 9.
        for first in 1..16usize {
            let mut calls = Vec::new();
            let got = first_present(16, |i| {
                calls.push(i);
                Ok(i >= first)
            })
            .unwrap();
            assert_eq!(got, Some(first));
            assert!(calls.len() <= 6, "{} evaluations for 16 commits: {calls:?}", calls.len());
        }
        assert_eq!(first_present(16, |_| Ok(true)).unwrap(), None, "present at the start: not found inside the range");
        assert!(first_present(4, |_| Err("boom".to_string())).is_err());
    }

    #[test]
    fn keys_are_sixteen_lowercase_hex_digits() {
        assert_eq!(parse_key("78c5bd807667298b").unwrap(), 0x78c5bd807667298b);
        for bad in ["78C5BD807667298B", "78c5bd80", "zzzzzzzzzzzzzzzz", ""] {
            assert!(parse_key(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn options_reject_both_range_forms_and_a_zero_count() {
        let a = |v: &[&str]| parse_opts(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>(), WALK_USAGE);
        assert!(a(&["--since", "abc", "--commits", "5"]).is_err());
        assert!(a(&["--commits", "0"]).is_err());
        assert!(a(&["--commits", "x"]).is_err());
        let ok = a(&["--walk", "--commits", "5", "--json", "main"]).unwrap();
        assert_eq!((ok.commits, ok.json, ok.pos), (Some(5), true, vec!["main".to_string()]));
    }
}
