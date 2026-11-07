# 0.4.1 precision samples — Effect pack rules 1–3, 5 (pre-freeze)

Independent sample by pulsar-research, per `precision-protocol-041.md`. Pre-freeze
build at `d8cb4e0` (clean worktree, own engine build); the official table re-runs
on the frozen SHA. Implementer samples (pulsar-ts-effect) and pulsar-fidelity's
are separate and do not substitute.

## Method

- Facts+engine from the same commit, run locally (no VM).
- Corpora: `junto` @ draft `effect_only` policy (committed); a private
  Effect+Cloudflare app snapshot with a sampling policy written for this pass
  (`effect_only` = the dirs where most non-test files import `effect`,
  boundary unset — its worker entry sits inside scope, so its rows are
  scope-sensitive); `effect-introduction` (public repo) cloned to /tmp with
  `effect_only = ["src/"]`.
- Findings pooled per rule across corpora, sorted by (corpus, file, line,
  finding key), round-robin up to 20. Class rules group RCX by (rule, fn,
  callee); edge/module rules group ECX by (rule, fn, target) and FMX per file.

## Results

| rule | sampled | TP | precision | corpora (findings) |
|---|---|---|---|---|
| effect.promise-style-in-effect-scope | 20 | 20 | 20/20 | junto 2006, private app 138, effect-introduction 33 |
| effect.exception-style-in-effect-scope | 20 | 20 | 20/20 | junto 971, private app 46, effect-introduction 11 |
| effect.internal-promise-bridge | 20 | 20 | 20/20 | junto 75, private app 1 |
| effect.mixed-module | 20 | 20 | 20/20 | junto 39, private app 5, effect-introduction 1 |

No false positives; no FP causes to report.

## Verification notes

- Class rules: every sampled finding's function span was read; the construct
  (async fn / await / `new Promise` / `Promise.*` / `.then`-family, or
  `throw` / `try`) is present in `effect_only` scope outside test, boundary
  and interop-callback ctx, matching the rule contract.
- `internal-promise-bridge`: all 20 sampled edges mechanically verified —
  call-site ctx ⊇ {effect_only, interop} minus {test, boundary}, target fn
  async+effect_only. Source shape is `Effect.tryPromise`/`Effect.promise`
  bridging async helpers (e.g. an install routine's `tryPromise` block calling
  async path/lock helpers; a webhook signature check via `Effect.promise`).
- `mixed-module`: all 20 sampled files mechanically verified to hold both an
  Effect-code function (ctx bits 2+8, none of 4/16/32) and an async function
  (bits 1+8, none of 2/4/16/32) in scope.
- Counts differ slightly from the implementer's Junto numbers (2006 vs 2002,
  971 vs 969): different build/policy state; immaterial to sampling.

## Caveats

- Pre-freeze, ad-hoc scopes for two of three corpora; the frozen-SHA refresh
  with each repo's real policy is the gate.
- Junto's lazy `import()` command loaders (~59 promise-style findings plus the
  bulk of its mixed-module files) are TP per the rule contract — async+await
  in `effect_only` outside boundary/interop — but are the debatable category
  the implementer flagged. If loaders belong in `boundary`, that is a policy
  edit, not a detector change.
- Rule 4 (`throw-or-try-in-gen`) measured 0.40 by the implementer and is held
  pending the ctx-128 "directly in wrapper body" fix; it joins this table
  after resampling.

## Resample after fixes (post-`fc4a029`, worktree `fc0e065`)

Independent resample by pulsar-research; own facts+engine, seeds distinct
from the implementer's (7192/7193) and pulsar-fidelity's.

| rule | pool | sampled | TP | precision | repos |
|---|---|---|---|---|---|
| effect.throw-or-try-in-gen (ctx 128) | 92 site rows | 20 | 20 | 20/20 | opencode 70, junto 13, effect 8, uploadthing 1 (the private app and confect 0; t3code facts scanned, pool not extracted at draw time) |
| effect.mixed-module v2 | 82 | 20 | 19 | 19/20 | junto 39, opencode 36, effect 4, uploadthing 2, confect 1 |

- Rule 4: every sampled throw/try verified lexically inside the
  `Effect.gen`/`Effect.fn`/`fnUntraced` generator body, including
  try-to-`Effect.fail` idioms and sites carrying Effect's own
  `@effect-diagnostics tryCatchInEffectGen:off` markers. Nested helpers and
  interop callbacks correctly absent (the documented conservative limit).
- Mixed-module: all 19 TPs verified to hold both an Effect-code function
  and a real async function in `effect_only` scope outside generic test
  paths. The one FP is `effect/packages/vitest/typetest/index.tst.ts`, a
  type-test file the generic test naming does not recognize — classified as
  FP caused by test naming per the lead ruling (no `*.tst.ts` policy entry
  yet; suffix support is pulsar-cli's pending 0.4.1 change).
- `cloudflare.binding-drift` remains held at fidelity's 1/5 pending the
  env-escape fix; resample at the fix SHA with vendored `.repos/` excluded
  where policy permits.
