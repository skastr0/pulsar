# Resource performance, 2026-09-14

On macOS arm64 with Bun 1.3.14, the combined changes reduced median full-score
wall time **7.40 → 6.13 seconds (17.2%)** and median maximum RSS
**1,924 → 1,264 MB (34.3%)** on a fixed Pulsar repository snapshot.
All eleven score JSON outputs were identical after removing `runtime_profile`:
three baseline, three isolated-loader, three combined, and cold/warm cache runs.
These are local measurements, not a memory ceiling for arbitrary repositories.

## Combined build

The combined runtime includes shared pending AST requests (`9ed6122`), the
TS-SEC-01 traversal refactor (`56f62b9`), streamed Git history, disk-cache
streaming and correctness fixes (through `e6e8c36`), and the time-series cache
(`87ae2f0`). It passed a full `bun run build` before these measurements.

| Run | Before wall (s) | Combined wall (s) | Before max RSS (bytes) | Combined max RSS (bytes) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 7.40 | 5.83 | 1,987,248,128 | 1,264,549,888 |
| 2 | 7.02 | 6.13 | 1,924,038,656 | 1,213,595,648 |
| 3 | 7.63 | 8.93 | 1,680,867,328 | 1,264,173,056 |

A separate fresh state directory exercised ordinary cache-enabled scoring:
cold **6.22 s / 1,324,007,424 bytes**, warm **0.76 s / 240,467,968 bytes**.
Both outputs exactly matched the baseline score. No pre-change warm-cache
measurement was taken, so this is a correctness and usability check rather
than a warm-cache improvement percentage.

The slower third combined run is retained above. These samples come from a
shared development machine; runtime variance is visible, while every combined
run used less maximum RSS than every baseline run.

## Cold AST duplication

The isolated loader comparison reduced median wall time **7.40 → 5.88 seconds
(20.5%)** and median maximum RSS **1,924 → 1,223 MB (36.4%)**.

The pinned TypeScript async `Program.getSourceFile` checks its completed cache,
awaits a native binary response, and then constructs a `RemoteSourceFile` before
inserting it into the cache. Concurrent cold readers therefore each fetch and
decode the same AST; the completed cache only deduplicates the final object.
The primary source is the installed
`tsgo-typescript/dist/api/async/api.js`, `Program.getSourceFile`, version
`7.1.0-dev.20260905.1`.

`source-file-loader.ts` shares a pending request by Program identity and absolute
file path. Both `TsAnalysis.mapFiles` and TS-CC-01 use it. Entries are removed on
success and failure: TypeScript still owns completed AST retention and snapshot
invalidation. Signal concurrency, checker ownership, scoring, diagnostics,
calibration, and cache versions are unchanged.

The two instrumented baseline runs each made **3,165 cold source requests**.
Each instrumented optimized run made **492**, an **84.5% reduction**. Total
`getSourceFile` calls, including warm calls, fell **25,847 → 10,103**.

| Run | Before wall (s) | After wall (s) | Before max RSS (bytes) | After max RSS (bytes) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 7.40 | 5.75 | 1,987,248,128 | 1,214,873,600 |
| 2 | 7.02 | 6.34 | 1,924,038,656 | 1,243,676,672 |
| 3 | 7.63 | 5.88 | 1,680,867,328 | 1,223,360,512 |

## Method

The target was a shared local clone fixed at `5358e69`, with its original vector,
calibration modules, and Git history. Its `node_modules` symlink was excluded
through `.git/info/exclude` so every run scored the same clean target. Runtime
dependencies were restored with `bun install --frozen-lockfile`; the original
workspace then passed `bun node_modules/typescript/bin/tsc -b` before timing.

```sh
PULSAR_STATE_HOME=/tmp/pulsar-resource-benchmark.ohJWGG/state \
  /usr/bin/time -l bun packages/cli/src/bin.ts score --profile --json \
  /tmp/pulsar-resource-benchmark.ohJWGG/target
```

`--profile` bypasses observer-cache reads and writes. Each run starts fresh Bun
and native TypeScript processes; filesystem caches were not flushed. Builds are
excluded from timing. Maximum RSS is the command measurement from macOS
`/usr/bin/time -l`, not a sampled sum of all simultaneously live descendants.
Other agents were editing and running focused tests on the same machine, so
small timing differences should not be overinterpreted.

To isolate the loader, only its three runtime files were transpiled with
`Bun.Transpiler` over the original built output. The original two caller files
were saved and restored for the final baseline run. Other agents' source edits
were not rebuilt during this comparison. Execution order was baseline 1–2,
optimized 1–2, baseline 3, optimized 3.

Except baseline 1, runs preloaded a temporary wrapper around the installed
`Program.prototype.getSourceFile`. It counted calls and checked the existing
`sourceFileCache.getRetained(path, snapshotId, project.id)` before calling the
original method. The wrapper did not change returned values or scheduling.

Raw JSON, timing logs, request instrumentation, and focused validation logs were
written to `/tmp/pulsar-resource-benchmark.ohJWGG/` for this session. Permanent
regressions cover simultaneous readers, failed-request retries, missing files,
completed-cache ownership, and isolation between Programs. Existing native
TS-CC-01 fixtures exercise file offsets, exclusions, and checker ownership.

## Time-series ledger

The ledger cache now stores file identity and nanosecond timestamps instead of
the full serialized ledger. Repeated reads and appends validate the cache with
`stat`; changed files are read and decoded again. An unstable read is retried
once and then fails with `TimeSeriesReadFailed`. Tests cover external appends,
replacement, deletion, corruption, and same-size changes with exactly restored
`mtimeNs`.

An independent rerun used the lane's 31-row fixture, producing a 33,602,528-byte
ledger. The baseline storage source was byte-compared against `5358e69` before
running; the optimized source was `87ae2f0`.

| Measurement | Before | After |
| --- | ---: | ---: |
| Ledger bytes read through `readFile` | 1,474 MiB | 0 |
| `readFile` attempts | 62 | 1 |
| 31 appends, total | 390.0 ms | 139.9 ms |
| 31 cached reads, total | 319.1 ms | 1.6 ms |
| Maximum process RSS | 1,221,623,808 bytes | 323,403,776 bytes |

The one remaining read attempt observes the initially missing ledger. Maximum
RSS comes from `/usr/bin/time -l` and includes the harness's final digest work;
it is higher than the harness's own sampling between operations.

Persisted ledger SHA-256 on both sides:
`fbe5edc49b71827ecee270d431afd84c837908fb4f814d0a4dddb54182bff090`.
Decoded entries SHA-256 on both sides:
`8e66ed49bd79c4cc29be5b132f1b4439278f6d4b5ab99faaaf2b689400ca89b0`.
Raw rerun receipts are `ledger-{before,after}.{json,time}` in the session
artifact directory. The harness is `/tmp/pulsar-ts-work/bench.mjs`.

Existing lock and compaction behavior is preserved. A non-cooperative writer
that replaces same-sized content between our append and its post-write stat
cannot be distinguished by that stat alone; the source documents this limit.
The metadata cache does not eliminate retention of decoded ledger entries.

## Disk cache

Bucket files are scanned in chunks, and writes use bounded batches plus an
exclusive temporary file and atomic rename. Concurrent first reads share a
pending load; full-index loading uses two workers. Oversized buckets on the
bounded path are rejected before parsing. Eviction decisions use indexed
timestamps and byte counts. Malformed records remain misses, and orphaned
temporary files from dead processes are removed on initialization.

The independent rerun reconstructed its sources directly from Git objects:
`5358e69` versus `e6e8c36`. Source digests are saved in
`cache-ab/runner/sources.json`. The earlier lane benchmark directory had an
overwritten baseline copy, so its numbers are excluded from this receipt.

| Fixture / operation | Before max RSS | After max RSS | Result on both sides |
| --- | ---: | ---: | --- |
| One large 34-record bucket, cold write with eviction | 3,368,828,928 bytes | 1,115,570,176 bytes | 34 records, 513,597,779 accounted bytes |
| 34 buckets, size and byte summary | 881,442,816 bytes | 913,670,144 bytes | 34 records, 534,773,794 accounted bytes |

The large-bucket operation used **66.9% less peak memory**. The wide summary
used **3.7% more**, so this change is not a universal cache-memory reduction.
The index retains serialized lines for untouched records and parsed objects
for accessed records; full summary calls still index all known buckets.
These are single-process fixture comparisons. Captured operation times were
3,618 → 1,127 ms and 375 → 266 ms respectively; timing was not repeated enough
to establish a stable speedup. Raw receipts are `cache-{before,after}.*` and
`cache-wide-{before,after}.*` in the session artifact directory.

## Other work

Git history now streams patch and metadata lines through a shared subprocess
runner with explicit stdout/stderr ceilings and cancellation cleanup. A
ceiling breach fails the operation without returning partial history. The
opt-in reproduction and local heap measurements are in
[`shared-history-git-stream.md`](../receipts/shared-history-git-stream.md).
The coordinator rerun read the same 345,040 lines in 696 ms with a 12.93 MiB
heap delta. This is an end-of-operation heap delta, not peak process RSS.

TS-SEC-01 combines independent syntax collectors and reuses each file's binding
index. Its focused fixtures and the full-score comparisons above preserve
evidence and diagnostic output. The lane also reported a 4.10× improvement on
a synthetic 1,000-call fixture, but retained no raw artifact outside its tool
transcript; that figure is not used in the headline measurements.

## Verification and delivery

`bun run verify` passed on `39478c5`: workspace typechecking, **1,930 tests
across 11 packages**, and all package builds. Existing Effect compiler
suggestions remain. The full run is saved as `verify-final.log` in the session
artifact directory.

Two existing test issues were corrected while running the integration gate:
the SDK source-scanner fixture now canonicalizes macOS temporary paths
(`5034f88`), and the test that sequentially validates all 74 catalog schemas
has an explicit 30-second allowance (`fa3ffad`). The latter exceeded the
default five seconds when run both alone and with the workspace suite.

The regression fixtures cover shared pending AST loads, aborted Git children,
stdout/stderr ceilings, oversized cache buckets, concurrent cache access,
eviction persistence, malformed records, atomic write failures, exact-name
temporary-file collisions, and external ledger changes. The score comparison
manifest is `comparison.json`; its canonical score-object SHA-256 is
`78896e3cf1989f1ca56bcf7c202536ed00bb58255f1743918732d47e80ac50c9`.

Implementation checkpoints:

| Change | Commits |
| --- | --- |
| Pending AST sharing | `9ed6122` |
| TS-SEC-01 traversal | `56f62b9` |
| Git history streaming and process limits | `2a91e07`, `b369d5b`, `cad6d52`, `a2131a6` |
| Opt-in Git benchmark and contract evidence | `d3baf03`, `3f6cee2` |
| Disk-cache memory, persistence, and regression fixes | `83f51c6`, `8d37c84`, `e6e8c36`, `39478c5` |
| Ledger metadata cache and timestamp regression | `87ae2f0`, `0009476` |

All changes are local commits; nothing was pushed. Large disposable cache
fixtures were removed after measurement; source snapshots, generators, JSON
outputs, timing logs, and source digests are retained for this session.
