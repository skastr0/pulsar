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

## Postgres dialect (added with the Postgres front-end)

Decision: `pg_query` 6.2 (MIT; it wraps libpg_query, which is Postgres's own parser, so its accept/reject
is Postgres's by construction). Runner-up: `sqlparser` 0.63 with `PostgreSqlDialect`.

Same VM as above (default, x86_64, 4 vCPU, 8 GB, load under 1), release build, 20 passes in memory, `?`
placeholders rewritten to `$n` before parsing.

| input | files | `pg_query` rejects | `sqlparser` (Postgres) rejects | `sqlparser` rejects what `pg_query` accepts | `sqlparser` accepts what `pg_query` rejects |
|---|---|---|---|---|---|
| 7,663 SQL templates from one TS app (Junto) | 7,663 | 563 (7.3%) | 342 (4.5%) | 0 | 221 |
| the 423 local `.sql` files (mostly SQLite and MySQL) | 423 | 182 (43.0%) | 163 (38.5%) | 18 | 37 |

| input | `pg_query` | `sqlparser` (Postgres) | peak RSS |
|---|---|---|---|
| 7,663 templates, 20 passes | 1.64 s (82 ms a pass) | 0.86 s (43 ms) | 7 MiB and 8 MiB |

`pg_query` is 1.9 times slower than `sqlparser` and uses the same memory; it needs a C compiler (the whole
bench built in 37 s) and its tree is the protobuf one, larger than a hand-written AST. In exchange there are
no false rejects and no silent acceptance of syntax Postgres refuses, the same argument as for SQLite.
`sqlparser` accepting 221 texts Postgres rejects is the failure to avoid: facts from text that is not valid
SQL for the database in use. I did not inspect which constructs those 221 are.

### Lane measurements (the SQL lane itself, `sql::tests::corpus`)

The 7,663 templates were pulled out of the TS of one repo with a regex for `sql` tagged templates, each
`${..}` replaced by `?` (the TS lane's rule). They are SQL fragments as the program writes them; some are not
statements on their own (a template that is only `AND x = ?`).

| dialect | statements | failed | texts failing | wall | peak RSS |
|---|---|---|---|---|---|
| SQLite | 7,862 | 450 | 251 of 7,663 (3.3%) | 25 ms | 12 MiB |
| Postgres | 7,862 | 762 | 563 of 7,663 (7.3%) | 100 ms | 14 MiB |

Every text that fails as SQLite also fails as Postgres (251 in both), and no text parses only as Postgres: all
312 texts that Postgres rejects but SQLite accepts are SQLite-only syntax (94 start with `PRAGMA`; the rest
include `INSERT OR ..`). So for this repo a per-repo dialect of Postgres would lose 312 texts that a per-repo
SQLite loses none of. Of the 251 texts neither dialect parses, by their first word: 44 start with `AND`, 11 with `,`,
and the rest are `INSERT`, `SELECT`, `UPDATE`, `DELETE`, `CREATE` and `DROP` texts I did not classify further
(a likely cause is an interpolation standing for an identifier or a clause, which the `?` rule makes unparseable).
The dialect therefore has to be chosen per call site from the client class, not once per repo; until the catalog
carries it, the driver passes SQLite.

The same lane over the 423-file local corpus (SQLite): 2,787 statements, 1,557 failed, 8 ms, 6 MiB. 0 failed
in the four repos whose files are SQLite (openinterpreter, codex, sst, t3code), 73 of 266 in opencode and 704
of 805 in paperclip, whose migrations are MySQL and Postgres.
