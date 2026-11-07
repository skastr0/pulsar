# SQL parser choice for the SQLite lane (#692)

Decision: `sqlite3-parser` 0.17.0 (Apache-2.0 OR MIT). It follows SQLite's own grammar, accepted every
file SQLite itself accepted apart from 16 files that I believe SQLite also rejects (below), parses faster
than `sqlparser` and uses a third of its memory. Runner-up: `turso_parser` 0.9.0-pre.2 (MIT, a pre-release,
fastest, and more lenient than SQLite). Rejected: `sqlparser` 0.63 (Apache-2.0, `SQLiteDialect`): it
rejects valid SQLite and accepts other dialects' syntax.

## Method

- Boat `default` VM from `pulsar-base`, x86_64, 4 vCPU, 8 GB, load average 0.6; release build; peak RSS from
  GNU `time -v`; one process, whole corpus parsed 200 times in memory for timing.
- Corpus: every `.sql` file under `~/playground` and `~/Projects` except this repo, tidb (MySQL test suite) and
  archived trees: 423 files, 677 KB, 27 repos. Most are migrations written for other databases, which is
  the point: a SQLite-first lane must reject them, not misread them.
- Oracle: the `sqlite3` 3.45.1 CLI run on each file over `:memory:`; a file counts as invalid SQLite if it
  prints `syntax error`, `incomplete input` or `unrecognized token`. Semantic errors (no such table) do not
  count. The oracle is imperfect: SQLite reports `no such table` for `ALTER TABLE` on a missing table before
  it reaches later syntax, so ALTER files with non-SQLite syntax can pass it.

## Results

| crate | corpus time (200 passes) | per pass | peak RSS | files it parses | files with a syntax error in SQLite but accepted anyway |
|---|---|---|---|---|---|
| read-only baseline | 0.0001 s | | 3 MiB | | |
| `sqlparser` 0.63 | 3.13 s | 15.6 ms | 10 MiB | 247 of 423 | 88 of 153 |
| `sqlite3-parser` 0.17 | 0.53 s | 2.7 ms | 4 MiB | 254 of 423 | 2 of 153 |
| `turso_parser` 0.9.0-pre.2 | 0.35 s | 1.8 ms | 4 MiB | 262 of 423 | 10 of 153 |

SQLite's own CLI found no syntax error in 270 files and a syntax error in 153.

- `sqlite3-parser` rejects 16 of those 270 and `turso_parser` the same 16 (identical sets: 7 opencode, 9 paperclip).
  The ones I opened are `ALTER TABLE .. ADD CONSTRAINT .. UNIQUE`, `ADD COLUMN IF NOT EXISTS`, `enum(..)`,
  `jsonb`/`::jsonb` and a schema-qualified `CREATE TABLE a.b`: MySQL and PostgreSQL syntax that the oracle let
  through because the table does not exist. I read 16 heads, so "I believe SQLite also rejects them" is for those
  16 files and nothing more.
- `sqlparser` rejects 23 of the 270, 19 of them files `sqlite3-parser` parses. Their text contains `PRAGMA`,
  `CREATE TRIGGER`, `INSERT OR IGNORE`, `AUTOINCREMENT`, `VIRTUAL TABLE` or generated columns. I matched
  keywords, not individual statements, so the construct behind each rejection is a likely reading, not a proof.
- On the 153 files SQLite rejects, `sqlparser` accepts 88: it reads PostgreSQL and MySQL migrations as SQLite
  and would emit facts from them without a word. For a lane whose schema facts must be sound that is the worse
  failure, so strictness wins over a higher parse count.

By repo (`parsed` = the parser accepted the whole file; `valid` = no syntax error in SQLite 3.45.1):

| repo | files | valid | `sqlite3-parser` parsed | `sqlparser` parsed |
|---|---|---|---|---|
| opencode | 111 | 73 | 66 | 92 |
| paperclip | 77 | 19 | 12 | 58 |
| openinterpreter | 44 | 44 | 44 | 41 |
| codex | 39 | 39 | 39 | 36 |
| alchemy | 15 | 8 | 8 | 14 |
| sst | 5 | 5 | 5 | 5 |
| phoenix | 5 | 1 | 1 | 1 |
| t3code | 4 | 4 | 4 | 4 |
| zulip | 2 | 0 | 0 | 0 |
| vercel-examples | 1 | 0 | 0 | 1 |
| other local repos | 120 | 77 | 77 | 83 |

## What this does not cover

- Whole-file parsing only. `sqlite3-parser` yields one command at a time, so the lane can keep statements
  before a bad one; the per-statement failure rate is measured when the lane exists.
- SQL inside TypeScript and Rust strings (tagged templates, query-class call arguments): none of this corpus.
- SQLite versions: the oracle is 3.45.1, the parser's grammar tracks a newer SQLite; no file here exercises the gap.

## Licence

`sqlite3-parser` is `Apache-2.0 OR MIT`: ship the notice text with the binary when it lands in `Cargo.toml`
(its own commit, per the charter). It pulls in `bumpalo` (the parser allocates ASTs in an arena) and `fallible-iterator`.
