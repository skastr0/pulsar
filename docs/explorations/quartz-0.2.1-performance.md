# Quartz 0.2.1 scoring assessment

Measured on 2026-09-07 in a Linux x64 Amp orb, Bun 1.3.14, Quartz 0.2.1,
native tsgo 7.1.0-dev.20260905.1. Baseline: Pulsar
`ca95c2eb12ea9cb02bae6d8b824afbf99d2f9f79`.

## Result

Batching TS-CC-01 checker evidence across each owning project, rather than each
file, reduced median signal time **1,436.50 → 799.40 ms (44.4%)**. Median full
CLI wall time fell **8.41 → 7.93 s (5.7%)**. This is a measured local improvement,
not a claim of a massive end-to-end speedup or a cross-machine benchmark.

| Run | Before wall (s) | After wall (s) | Before CC-01 (ms) | After CC-01 (ms) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 8.42 | 7.83 | 1436.50 | 799.40 |
| 2 | 8.25 | 8.11 | 1484.38 | 806.34 |
| 3 | 8.41 | 7.93 | 1365.73 | 722.18 |

All three final JSON outputs matched baseline run 3 after removing only
`runtime_profile`: scores, diagnostics, factors, metadata and calibration were
unchanged. The analysis cache version is unchanged because interpretation and
output semantics did not change. `noResolve`, `noLib`, and `noEmit` remain pinned.

## Method

Build runtime exports before timing (the CLI source entry imports package dist
exports). The initial clean workspace build failed on a missing rs-pack output;
the subsequent incremental build succeeded. Builds were not timed.

```sh
bun run dev score --help
git clone --shared . /tmp/pulsar-benchmark-target
ln -s "$PWD/node_modules" /tmp/pulsar-benchmark-target/node_modules
bun run --filter=@skastr0/pulsar-ts-pack typecheck
/usr/bin/time -p bun packages/cli/src/bin.ts score --profile --json \
  /tmp/pulsar-benchmark-target
```

The target clone stayed at the baseline revision for every before/after run,
including its repo-owned vector and calibration. This avoids scoring the
optimization itself or test/documentation additions. `--profile` bypasses the
observer cache (`makeObserveWithCache` in `scoring-engine-observe.ts`). Each run
started a fresh CLI/native process; filesystem caches were not evicted. Runs
were sequential, three before then three after, on the same orb.

An initial uninstrumented score of the working repository took 10.00 s
(environment setup 1,534.99 ms, observer 7,714.06 ms). That first-use result is
not used for the claimed improvement.

## Cost attribution

Temporary `performance.now()` instrumentation in `buildObservation` and
`makeAnalysis.mapFiles`, removed before the comparison, measured a full score
of the working repo (483 owned production TypeScript files):

- Discovery plus config fingerprint: 15.94 ms.
- Derived config materialization: 5.95 ms (21.89 ms cumulative from discovery).
- `openQuartzWorkspace`: 315.46 ms; exactly one open in that observation.
- First `mapFiles`: 607.98 ms, including 426.03 ms source retrieval and
  180.45 ms visitor execution.
- Subsequent source retrieval passes: generally 0.2–0.8 ms. An additional
  source-file cache would duplicate existing caching, not remove the bottleneck.
- CC-01 visitor: 1,476.62 ms. It already batched `getTypeAtLocation` and
  `getSymbolAtLocation` within each file, but awaited those batches file by file.
  The change moves those same requests to project granularity without running
  visitors concurrently or mixing checker handles between projects.

A Bun CPU profile (`bun --cpu-prof ... score --profile --json`) also showed
LD-09 promise collectors prominently: 93 self samples in
`collectOpaquePromiseApi`, 70 in `collectPromiseCatchCollapse`. Samples establish
CPU activity, not wall-clock percentages or native-process cost.

## Remaining opportunities

The final third-run signal profile still spends 722 ms in CC-01, 510 ms in
LD-09, 497 ms in LD-01 (including initial source loading), 491 ms in AB-03,
442 ms in AB-04, and 399 ms in the git-backed bus-factor signal.

The largest architectural opportunity not taken is overlapping independent
signal execution: `observer-execution.ts` fixes concurrency at one, and final
observer time is still 6.8–7.1 s. That requires proving shared caches, checker
leases, deterministic output, and resource bounds safe before changing the
default. No parallel speedup was measured here.

For a smaller next change, LD-09 recursively awaits every AST node and calls
async promise collectors even for ineligible syntax kinds. Pruning synchronous
non-candidates before async traversal is a grounded CPU optimization candidate;
its benefit remains unmeasured.

CLI session retention could remove repeated opens and initial source loading
in multi-observation commands, but cannot remove the initial open in a one-shot
score. It also needs runtime scope ownership and correct invalidation of
inherited configs: the current session fingerprints directly discovered config
contents, not the full `extends` closure. Do not retain sessions on the strength
of an unchanged direct-config fingerprint alone. No refresh benchmark was run.

## Verification

- `bun run --filter=@skastr0/pulsar-ts-pack typecheck`: exit 0.
- `bun test packages/ts-pack/src/__tests__/ts-cc-01-regressions.test.ts packages/ts-pack/src/__tests__/ts-trust-signals.test.ts packages/ts-pack/src/__tests__/signal-contract.test.ts`:
  34 pass, 0 fail, 577 assertions.
- New regression covers multi-file offsets, call-free files, excluded tests,
  same-named synchronous/async declarations in two projects, and repeatability.
- Three final timed scores: exit 0; JSON equality excluding timings confirmed.
