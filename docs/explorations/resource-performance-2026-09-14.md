# Resource performance, 2026-09-14

On macOS arm64 with Bun 1.3.14, sharing pending TypeScript source-file requests
reduced median full-score wall time **7.40 → 5.88 seconds (20.5%)** and median
maximum RSS **1,924 → 1,223 MB (36.4%)** on a fixed Pulsar repository snapshot.
All six score JSON outputs were identical after removing `runtime_profile`.
These are local measurements, not a memory ceiling for arbitrary repositories.

## Cold AST duplication

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
