# history

Git history lane. Owner: pulsar-history. It emits `H` (window header), `C` (commits), `A`
(authors, with the bot flag), `CF` (per-file line counts, renames followed) and `CFN` (lines
touched per head function, matched through `FK`).

## Window

`Config { since_days: Some(365), max_commits: 2000 }` by default. The date range is anchored to
the head commit's committer time, never wall clock, so one sha always yields one fact set.
`git log --no-merges --since=@<head-365d> --max-count=2000 --reverse` gives the newest commits in
the range, oldest first. `.pulsar/policy.toml` will construct the `Config`; until then the CLI
uses the default.

## Passes

- **Pass 1**, `git log --numstat -z -M`: commits, authors, and `CF`. One process; `-z` makes
  renames `added\tdeleted\t\0old\0new\0`, so no path quoting or `a => b` parsing. A newest-to-
  oldest walk maps each commit's path to its head file id; a pure rename emits no row.
- **Pass 2**, `git log -p --unified=0 -M`: the post-image hunks per file, joined to pass 1 by
  sha. Each changed blob is read through one long-lived `git cat-file --batch` and parsed by the
  language lane (`lang::ts::function_spans`, `lang::rust::function_spans`) with the file's head
  path, so `FK` follows renames. Added lines are exact; deleted lines are charged to the function
  at the hunk anchor. The innermost span wins (the `.fns` rule). Parsed spans are cached per
  `(blob oid, head path)`; no row is emitted for a function with no head key.

## Seams

- `FnParser` is the language-lane seam; `LangFns` dispatches `.ts/.tsx/.mts/.cts` to the TS
  extractor and `.rs` to the Rust one. Tests inject a line-based stub.
- `SideTables` supplies the head file list and function spans; `FactSet.fn_keys` supplies the
  head key per function id.
- `crate::git` is not used here: both passes need streaming, so they spawn `git` directly.
