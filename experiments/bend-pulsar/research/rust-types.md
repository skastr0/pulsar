# Rust type facts: options, measured (#658)

Question: how does Pulsar get Rust type facts (trait/impl graph, resolved method calls,
`Result`-typed expressions) inside a sane memory budget? The default lane never needs types; this
is for the opt-in lane. Sources and API notes: `rust-type-sources.md` (pulsar-research).

**Recommendation.** Use rust-analyzer as a library (`ra_ap_*`), in a separate opt-in binary that
loads the workspace and infers *workspace bodies only*, with a hard RSS guard, one process per
crate (or crate group) for large workspaces. Not SCIP (no type information). Not rustc output
(nightly only, and it must compile every dependency first). Expect 1.0 to 1.2 GB for a small
workspace and about 6.6 GiB for a 209-crate one: this lane does not meet the product's low-memory
bar and must say so.

## Method

- Machine: Boat `default` VM, Linux x86_64, 4 vCPU, 8 GB, idle (load average under 1 before every
  run, noted in `rust-types-harness/results/*.txt`). Peak RSS is `Maximum resident set size` from
  GNU `time -v`; MiB below = KiB / 1024. One run per configuration unless stated.
- Corpora, snapshots with `target/` removed (read-only on the originals):
  `pulsar-cli` (`experiments/bend-pulsar/cli` at 453fccc: 6 files, 888 LOC, 3.0M LOC of dependencies),
  `convex-rs` (4f76800: 30 files, 7.5k LOC, 3.2M LOC of deps), `codex-rs` (`~/playground/codex/codex-rs`
  at 6111791d0b: 2,026 files, 923k LOC, 209 workspace crates, 10.9M LOC of deps). `~/Projects/quasar`
  has no Cargo workspace, so it is not a Rust corpus.
- `RUSTUP_TOOLCHAIN=stable` for every run (the corpora pin other toolchains). Build scripts and
  proc-macro servers off unless stated.

## Results

### A. `rust-analyzer analysis-stats` (rust-analyzer 1.97.1): eager

It collects item trees for every dependency crate (std, core and alloc alone are about 1.45M LOC) and
infers every workspace body.

| corpus | wall | peak RSS |
|---|---|---|
| pulsar-cli | 12.3 s | 1,871 MiB |
| convex-rs | 15.5 s | 2,281 MiB |
| codex-rs | killed (SIGKILL, OOM) at 113 s | 7,223 MiB, item trees alone 3.75 GB when it died |

Build scripts and proc macros off changes the peak by under 7% (pulsar-cli 29.3 s / 1,806 MiB,
convex-rs 21.1 s / 2,142 MiB), so they are not the memory lever. The same run on the Mac,
machine loaded (load 70 to 440): pulsar-cli 195 s / 1,473 MiB.

### B. `rust-analyzer scip`

| corpus | wall | peak RSS |
|---|---|---|
| pulsar-cli | 16.8 s | 1,164 MiB |
| convex-rs | 72.5 s | 1,455 MiB |
| codex-rs | killed (SIGKILL, OOM) at 210 s | 7,177 MiB |

SCIP carries symbols, occurrences and relationships such as implementation edges, and no expression
types (`rust-type-sources.md`). It is a names-and-edges source, not the type lane, and it is no
cheaper than option A on the large corpus.

### C. `ra_ap_*` as a library, workspace bodies only: `rust-types-harness/`

Pinned `=0.0.349` for every `ra_ap_*` crate (`hir`, `hir_ty`, `hir_def`, `ide_db`, `load-cargo`,
`project_model`, `paths`, `vfs`, `base_db`), `salsa` held at 0.28.2. Newer ra_ap versions need rustc
1.98; 0.0.358 failed to build here. The harness loads the workspace (sysroot discovered, build
scripts and proc macros off, caches not primed, one worker), then for every local crate walks its
modules and runs inference on each function body, and counts typed expressions, `core::result::Result`
typed expressions and resolved method calls.

| corpus | wall | peak RSS | functions | exprs typed | `Result`-typed | resolved method calls |
|---|---|---|---|---|---|---|
| pulsar-cli (1 crate) | 4.9 s | 977 MiB | 33 | 3,429 | 161 | 447 |
| convex-rs (4 crates) | 7.7 s | 1,181 MiB | 414 | 9,946 | 744 | 1,145 |
| codex-rs, `codex_utils_absolute_path` only | 3.9 s | 1,499 MiB | 44 | 706 | 69 | 94 |
| codex-rs, `codex_core` only | 42.6 s | 4,127 MiB | 3,472 | 182,447 | 6,108 | 25,135 |
| codex-rs, all 209 local crates | 252.8 s | 6,748 MiB | 29,469 | 1,796,253 | 98,856 | 213,615 |

Trait/impl enumeration (`Impl::all_for_trait` on every workspace trait) adds under 1% memory:
codex-rs has 105 workspace traits and 427 impls of them; convex-rs 1 and 1; pulsar-cli none.
Whole-expression unknown types: 0 (pulsar-cli), 41 of 9,946 (convex-rs), 2,916 of 1,796,253 (codex-rs).

What the table says:
- Against option A the harness saves about half on small workspaces (977 vs 1,871 MiB, 1,181 vs 2,281 MiB)
  and is the only option that finished codex-rs (6,748 MiB, within 1.2 GiB of the VM's limit).
- Memory follows the local code analysed on top of a floor of about 1.0 to 1.5 GiB: a 44-function crate
  1.5 GiB, a 3,472-function crate 4.1 GiB, all 29,469 functions 6.6 GiB. RSS rose steadily during the codex-rs
  run (4.7 GB at 66 s, 6.8 GB at 238 s): salsa memoizes and the harness never evicts.
- Unverified: that analysing crates in separate processes, or dropping the database between crates,
  lowers the peak; why a 33-function crate needs 1 GiB (guess: sysroot and dependency crate resolution).
  Both are the first thing the lane build (#685) should measure.

### D. rustc's own output (rustc 1.97.1 stable, nightly 1.101 for the `-Z` runs)

| run | pulsar-cli | convex-rs | codex-rs |
|---|---|---|---|
| `cargo check --workspace --all-targets` cold, stable | 10.0 s / 428 MiB | failed after 99 s: rustc says the file for module `testing` is missing in this snapshot (my module graph also reports 2 unresolved `mod` declarations in convex-rs; I did not check they are that one) | failed after 281 s at the `codex-bwrap` build script, 1,532 MiB |
| nightly `-Zunpretty=hir,typed` (typed HIR as text), one crate, deps already checked | 9.9 s / 559 MiB, 302 KB | 48.9 s / 472 MiB, 1.09 MB | failed in dependency `allocative` (E0119 on nightly) |
| nightly `rustdoc --output-format json` | 5.3 s / 449 MiB | 4.8 s / 391 MiB | failed, same dependency |

(Per-run peaks are the largest single process; times are wall.) rustc gives the typed HIR of a crate
at about 0.5 GiB, but only on nightly (`-Z`), only after every dependency compiles on that nightly
(codex-rs did not), and as text to parse. rustdoc JSON has item signatures and no bodies, and its
format is unstable. `rustc_driver` and `stable_mir` need nightly and are not on crates.io
(`rust-type-sources.md`). A path that depends on the user's nightly building all their dependencies
is not a default-safe lane.

## Verdict

| option | types of bodies | stable toolchain | codex-rs (923k LOC) in 8 GB | verdict |
|---|---|---|---|---|
| `ra_ap_*` library, workspace bodies only | yes | yes | yes, 6.6 GiB | the opt-in lane |
| `rust-analyzer analysis-stats` shape (eager) | yes | yes | no, OOM at 7.2 GiB | no |
| SCIP | no | yes | no, OOM | names and edges only |
| rustc `-Zunpretty=hir,typed` | yes | no (nightly) | not reached | no |
| rustdoc JSON | signatures only | no (nightly) | not reached | no |

Design for the lane (#685): a separate binary so `ra_ap_*` never enters the main CLI build; workspace
bodies only; no proc-macro server in v0 (0.16% unknown expression types on codex-rs without it, but
derive-generated code is absent from every count); per-crate processes with a hard RSS guard that
aborts with a clear message; `=0.0.349` pinned with `salsa` at 0.28.2 until the toolchain moves.

## Reproduce

On a Boat VM from `pulsar-base`: `cd research/rust-types-harness && cargo build --release`, then
`RUSTUP_TOOLCHAIN=stable /usr/bin/time -v target/release/ra-harness <workspace dir> [--traits] [--only <crate>]`
via `runone.sh`. Raw `time -v` output and counts for every row of C are in `rust-types-harness/results/`.
Rows A, B and D were run with `/usr/bin/time -v` on the same VM class; their raw files are not committed.
The harness was written by a delegated agent from docs.rs pages only; no rust-analyzer source was read.
