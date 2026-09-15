# Resource performance, 2026-09-15

Round two reduces Vouch's median process-tree peak RSS **1,370.52 → 1,118.69
MiB (18.4%)** and physical footprint **1,125.28 → 886.88 MiB (21.2%)**.
Median wall time is effectively unchanged: **6.625 → 6.632 seconds**. All six
matched profile outputs and four ordinary cold/warm outputs are identical
after removing only `runtime_profile`.

Vellum completes in all three optimized runs under the 4 GiB memory guards;
the matched baseline is stopped at that budget. Effect still exceeds the
physical-footprint guard. This round therefore improves the tested workloads
without establishing a general memory ceiling or solving the largest case.

The previous round's 34.3% memory and 17.2% runtime reductions measured a
different target, Pulsar itself. They cannot be added to these percentages.
See [the previous receipt](resource-performance-2026-09-14.md).

## Changes

- `TsAnalysis.mapFiles` loads source files in ordered windows of 32 instead of
  starting every file request at once. Visitors retain their original ordering.
- TS-CC-01 also uses those windows, requests checker evidence in aligned chunks
  of 128 calls, and applies evidence immediately to per-file results. It no
  longer keeps whole-project call and checker-result arrays alive together.
- TS-AB-03 reuses a module resolver for each observation's type index and reuses
  alias maps when their source-file identity matches. Previously, individual
  references repeatedly rebuilt the repository path index and alias maps.
  A weak-keyed cache preserves observation lifetime and configuration changes.
- Observer-cache compression compares the base64 string's `length + 2` with
  raw JSON bytes, removing a redundant JSON serialization. Base64 is ASCII
  without JSON-escaped characters, so the branch decision is identical.

Signal concurrency, evidence ordering, scoring, exclusions, calibration,
public outputs, and cache versions are preserved. The compression change
affects ordinary cache writes; profile runs bypass it.

Windowing bounds temporary work, not total AST retention. The installed
TypeScript client caches every decoded source file in `Program.getSourceFile`
(`dist/api/async/api.js:824-826`). Its `SourceFileCache.releaseSnapshot`
(`dist/api/sourceFileCache.js:113-135`) and native `ReleaseParams`
(`dist/api/proto.generated.d.ts:165-167`) release a snapshot. Quartz retires
that snapshot after its readers drain (`dist/index.js:409-419`). These inspected
APIs provide no per-file release operation. The caller changes do not remove
that retained-memory floor. No garbage-collector environment setting is shipped.

## Matched Vouch comparison

Runs alternate baseline and optimized builds, three fresh processes each.
Both variants use the same instrumentation, target, dependency tree, and fresh
state directories. Memory includes simultaneously live child processes.

| Run | Variant | Wall (s) | Peak RSS (MiB) | Peak physical footprint (MiB) |
| --- | --- | ---: | ---: | ---: |
| 1 | Before | 6.625 | 1,539.03 | 1,125.28 |
| 1 | Optimized | 6.632 | 1,142.42 | 902.33 |
| 2 | Before | 6.201 | 1,360.02 | 915.13 |
| 2 | Optimized | 6.318 | 1,118.69 | 880.24 |
| 3 | Before | 6.862 | 1,370.52 | 1,171.82 |
| 3 | Optimized | 6.669 | 1,115.11 | 886.88 |

Peak outstanding `Program.getSourceFile` promises fall **5,869 → 105** in
every matched pair. These counts include completed-cache lookups as well as
native requests; they are not a count of concurrent native checker operations.

Normalized score SHA-256 for all six profile and four cache-enabled outputs:
`b99cfb5a464ce732915bcd60be3c64682d821c201247f61a104f00114a2e57aa`.

**Known correctness limitation:** TS-AD-04 fails in both versions with
`TypeError: undefined is not an object (evaluating 'named.elements')`.
The comparison retains that failure, its score, and all diagnostics. Exact
output equality proves preservation of this baseline; it does not mean every
signal successfully analyzed Vouch. The same failure appears in Vellum's
optimized outputs. The affected AD-04 implementation is unchanged this round.

## Larger targets under the same budget

The watchdog stops at either 4,096 MiB process-group RSS or 4,096 MiB macOS
physical footprint, or after 120 seconds. A stopped run is never accepted as a
score. Sampled measurements can overshoot the threshold between samples.

| Target / variant | Outcome | Wall to completion or stop (s) | Peak RSS (MiB) | Peak physical footprint (MiB) |
| --- | --- | ---: | ---: | ---: |
| Vellum before | Footprint limit | 39.147 | 3,616.66 | 4,097.94 |
| Vellum optimized 1 | Completed | 38.917 | 2,817.78 | 2,534.24 |
| Vellum optimized 2 | Completed | 42.697 | 3,121.17 | 3,002.50 |
| Vellum optimized 3 | Completed | 41.135 | 2,749.39 | 2,491.74 |
| Effect before | Footprint limit | 17.393 | 3,938.67 | 4,140.63 |
| Effect optimized | Footprint limit | 79.192 | 3,860.02 | 4,097.65 |

Vellum's optimized medians are **41.135 s / 2,817.78 MiB RSS / 2,534.24 MiB
physical footprint**. Its three normalized outputs have identical SHA-256
`5c10c96d0fd7e0577246e493bc4f86f5c028b60340285be62dce50e6c3acfd16`.
The baseline did not finish within budget, so there is no completed baseline
score comparison or percentage speedup for Vellum. Effect produced no accepted
score in either matched run. Taking longer to reach its guard is not a speedup.

The optimized Effect stopping sample contains about **3,075 MiB Bun physical
footprint and 1,022 MiB native TypeScript footprint**. Its remaining problem
is therefore not confined to the native process. A further investigation
needs allocation/retention evidence from the JavaScript side as well as the
compiler, rather than another global concurrency guess.

## Ordinary cold and warm scoring

These single-run checks use `score --json`, without `--profile`. Each variant
gets one empty state directory, followed by a new process reusing that state.

| Variant / cache state | Wall (s) | Peak RSS (MiB) | Peak physical footprint (MiB) |
| --- | ---: | ---: | ---: |
| Before cold | 7.471 | 1,380.75 | 917.91 |
| Optimized cold | 8.226 | 1,010.02 | 931.55 |
| Before warm | 0.823 | 163.75 | 129.16 |
| Optimized warm | 0.751 | 170.53 | 130.52 |

Cold RSS is lower, but cold wall time is higher and physical footprint is
slightly higher in this pair. Warm behavior is similar. These are correctness
and default-path observations, not enough repetitions for a timing claim.
No overall cold-score speedup is claimed from the compression change.

## Isolated TS-AB-03 measurement

A real Quartz fixture contains 96 TypeScript files and 704 declarations, with
named imports and inline import-type references. Three alternating cold
processes per variant differ only in `ts-ab-03-indirection-walker.ts`.

| Run | Before signal (ms) | Optimized signal (ms) |
| --- | ---: | ---: |
| 1 | 442.183 | 260.138 |
| 2 | 457.180 | 283.610 |
| 3 | 429.576 | 275.033 |

Median time falls **442.183 → 275.033 ms (37.8%)**. This includes the harness's
analysis setup, not the whole CLI. All six full signal outputs contain 704
declarations / 274,533 serialized bytes and have SHA-256
`bf3aa2c84e9cdab1ba782e4771013f21c9ed68edd7bcd4bc81a605b2577e71c9`.
External maximum RSS changes only slightly; this is primarily a CPU result.

## Method and reproducibility

Environment: macOS arm64, 64 GiB RAM, Bun 1.3.14, Effect 4.0.0-rc.112,
Quartz 0.2.1, and `tsgo-typescript` 7.1.0-dev.20260905.1. Other user work was
active on the machine, with significant memory pressure. Filesystem caches
were not flushed. Runs were sequential; builds and our other agents' tests
were held during timed comparisons.

| Frozen target | Revision | Dependency condition |
| --- | --- | --- |
| Vouch | `81f4aca345bbddc5f4a7864c4a68749e8698dfb6` | Existing dependencies linked into the clone |
| Vellum | `9013b252e460e8a08d7b0d956ca8f4ea02cd1370` | Existing dependencies plus benchmark-only SDK resolution |
| Effect | `f4151e1937c26de14f1d64566f8126173f1b5014` | No installed `node_modules`, matching the supplied checkout |

Vellum's repo calibration imports an undeclared Pulsar SDK dependency. An
isolated clone dependency overlay adds that SDK, and each benchmark state
root links Pulsar's `node_modules` so the calibration bundler can resolve it.
That adjustment is identical for both variants. No tracked target files or
original checkouts were changed. Effect's absent dependencies limit what can
be inferred about a fully provisioned Effect checkout.

Baseline production output comes from `41d7462`, after round one. Optimized
production source is through `55ab4e6`; the final watchdog is `0b2b4e5`.
Runtime snapshots and SHA-256 manifests are retained. The comparison driver
swaps changed core/TS-pack JavaScript files in the built output, launches a
new CLI process, and restores the validated optimized
bytes in `finally`. Both core and TS-pack output trees were independently
checked byte-for-byte after the series. All three frozen clones remain clean.

Example profile invocation, after selecting the built runtime:

```sh
PULSAR_STATE_HOME=/tmp/pulsar-large-repos.J4NDv7/state-example \
  bun scripts/resource-bench.ts \
  --repo /tmp/pulsar-large-repos.J4NDv7/vouch \
  --out /tmp/pulsar-large-repos.J4NDv7/example \
  --preload /tmp/pulsar-large-repos.J4NDv7/count-source-requests.ts \
  --max-rss-mib 4096 --max-footprint-mib 4096 \
  --timeout-seconds 120 --sample-ms 100
```

RSS is the sampled sum of live process-group resident memory. Physical
footprint is a separate sum from macOS `proc_pid_rusage` and includes compressed
private memory; it is not interchangeable with RSS. Each peak is recorded at
its own time. The requested 100 ms interval is followed by process discovery
and sampling work, so actual samples can be farther apart. Peaks are sampled
observations, not exact maximum allocation sizes. The round-one command-only
`/usr/bin/time -l` figures use a different measurement boundary.

The watchdog verifies its detached process group, fails closed on live-process
sampling errors, rejects partial output, and waits for supervised children to
exit after cancellation. Its 13 fixture tests pass independently of workspace
tests, including compressed-footprint limits and process cleanup.

Permanent selected measurements, runtime digests, and raw-file hashes are in
[the JSON receipt](../receipts/resource-performance-2026-09-15.json).
Raw outputs, metrics, counters, runtime snapshots, isolated AB-03 sources,
and build/test logs are under `/tmp/pulsar-large-repos.J4NDv7/` for this
session. `run-paired.py`, `run-cache-paired.py`, and `ab03-bench.ts` are the
corresponding temporary reproduction drivers.

Initial window-only runs did not reduce Vouch's 5,869-request burst; TS-CC-01
still bypassed that helper. Earlier RSS-only large runs and temporary GC/CPU
diagnostics are retained separately and excluded from the matched tables.
No CPU profile was successfully captured, and no native checker allocation
hotspot is claimed from those diagnostics.

## Validation and checkpoints

`bun run verify` passed on `0b2b4e5`: workspace typechecking, **1,937 tests
across 11 packages**, and all package builds. Existing Effect compiler
warnings remain. The final build stage reused Turbo's successful build cache.
The full command output is retained as `verify-final.log`, with its SHA-256
and package test counts in the JSON receipt.

The opt-in watchdog suite was independently run on the same source:
**13 pass / 0 fail / 79 expectations**. Signal regressions cover source-window
ordering and rejection, missing files, aligned checker chunks across file
boundaries, path-alias changes between observations, and exact repeated
outputs. Both modified production signals include contract-matrix evidence.

| Change | Commits |
| --- | --- |
| Ordered source windows | `14e590c`, `ca463a0` |
| Bounded TS-CC-01 evidence | `ddfb075`, `55ab4e6` |
| Observation-scoped TS-AB-03 indexes | `a21c446` |
| Observer-cache comparison | `3128a46` |
| Opt-in process watchdog and regressions | `26df495`, `f9f8c44`, `0948fa6`, `594ee34`, `0b2b4e5` |

All implementation changes are local commits. Nothing was pushed.
