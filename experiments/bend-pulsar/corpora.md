# Validation corpora

The validation set for differential tests, the memory/speed gate (`bench/gate.sh`)
and detector evidence. Every repo is read-only: Pulsar never writes into a
validation repo. Live-edited repos are measured from pinned snapshots in
`/Users/guilhermecastro/Projects/pulsar-corpora/`; the rest are used in place at
the recorded sha. `bench/gate.sh` parses the `corpus` block below — keep it
machine-readable (one TSV row per corpus, fields: name, path, sha, kind, note).

Kinds: `snapshot` = pinned copy under `pulsar-corpora/`; `repo` = live checkout
at the recorded sha (re-check `git rev-parse HEAD` before trusting a number).

```corpus
name	path	sha	kind	note
junto	/Users/guilhermecastro/Projects/pulsar-corpora/junto	bfc7b01ee79e03d71ec6620959ae446bbac10678	snapshot	Effect 4 app, largest TS corpus; copied from the 0.3.0 baseline scratchpad
pulsar	/Users/guilhermecastro/Projects/pulsar-corpora/pulsar	927ab7a51231f635f2d99c7073259b03c36af916	snapshot	Pulsar 0.3.0 itself; same provenance as junto
effect	/Users/guilhermecastro/playground/effect	9428e17499ee3a144f2ac73c67213fb1336d2bdf	repo	Effect 4 monorepo, the Effect-pack reference corpus
opencode	/Users/guilhermecastro/playground/opencode	36234c462cdd48e6eabd6be2dc16225103881760	repo	Effect TS agent CLI
alchemy	/Users/guilhermecastro/playground/alchemy	0a3a41974fc171ee6920087e64ae7610216bdee1	repo	Effect TS, largest corpus by file count
effect-app-barake	/Users/guilhermecastro/playground/effect-app-barake	89b975380aeed9057be8cf54ef477a9d5b053bbb	repo	Small Effect app
effect-website	/Users/guilhermecastro/playground/effect-website	2941fc063508ca3f662ee571f76f24bb742f8640	repo	Effect docs site
effect-http	/Users/guilhermecastro/playground/effect-http	f251f6cf73d0b8c81130226f9f71e597c56dfd7b	repo	Effect-org library monorepo (no effect dep at root; packages are the library)
effect-cluster-via-sst	/Users/guilhermecastro/playground/effect-cluster-via-sst	04d5546381a0e2e7b3afd3547eaf2ac29b798633	repo	Small Effect app
effect-actualbudged-sync	/Users/guilhermecastro/playground/effect-actualbudged-sync	33a1184b3fa6a27c1ff2f80577d9445e2c90ff2c	repo	Tiny Effect app
t3code	/Users/guilhermecastro/playground/t3code	23b55022175e69938514934f65c5a607d38f1e47	repo	Plain TS, large
pi	/Users/guilhermecastro/playground/pi	e65b3b88c08412bb8ffbd21fb5dc5756064a6e5a	repo	Plain TS agent CLI
phoenix	/Users/guilhermecastro/playground/phoenix	380de9b49f53b54530eafa20866cf8df9f2832e3	repo	Plain TS, medium
js-genai	/Users/guilhermecastro/playground/js-genai	e626bef1a780a54b5b3fe04f062adf708335bd58	repo	Plain TS, small
tantivy	/Users/guilhermecastro/playground/tantivy	d0c5ffb0aa6bf046553dde8775ca7b6d362aa388	repo	Pure Rust search library
typst	/Users/guilhermecastro/playground/typst	031f539dca3f41b804e89d39d1ca26126309c96f	repo	Pure Rust, large real project
codex	/Users/guilhermecastro/playground/codex	6111791d0b3dd9de93e9cbea6614c85644523979	repo	Rust core + TS, mixed, large
convex-backend	/Users/guilhermecastro/playground/convex-backend	8258f32547e814e838e66360ed6b8921013b25ff	repo	Rust + TS, mixed, large
```

## History corpora

History lanes (churn, hotspots, co-change, `H`/`C`/`A`/`CF`/`CFN` facts) run only
where real git history exists. The snapshots above are single-commit orphans by
design, so they cannot serve this lane. On the gate VM
(`pulsar-fidelity-bx_89cmcpqp-gate`, corpora mirrored at the same absolute
paths) the history-capable repos are:

| name | VM path | history |
|---|---|---|
| junto | `/Users/guilhermecastro/Projects/junto` | GitHub clone of `skastr0/junto`, blobless (`--filter=blob:none`): all commits and trees, blobs fetched lazily. The pinned `pulsar-corpora/junto` snapshot stays the facts/metrics corpus; this is the history corpus. |
| effect | `/Users/guilhermecastro/playground/effect` | Full clone, checked out at the recorded sha `9428e174` (12,313+ commits). |
| tantivy | `/Users/guilhermecastro/playground/tantivy` | Full clone, checked out at `d0c5ffb0` (3,474 commits) — the long-history Rust repo. |
| typst | `/Users/guilhermecastro/playground/typst` | Full clone, checked out at `031f539d` (4,562 commits) — second Rust history source. |

Shallow clones everywhere else are fine for facts and metrics; do not run
history lanes on them (`git rev-list --count HEAD` of 1 gives no signal).

## Intended differences from the 0.3.0 baselines

The new baselines are the CLI and engine output at a recorded sha; two
differences from the 0.3.0 numbers are known and intended (lead ruling
2026-11-07):

1. **Prod scope** counts git-tracked files even when they fall outside the
   tsconfig `include` set, so Junto reports 1979 prod files (0.3.0: 1976)
   and Pulsar 517 (0.3.0: 505). This is the CLI's class A.
2. **Junto cycles:** 5, not 6. The 0.3.0 39-file `src/core/ops` cycle came
   from a file-vs-directory import resolution bug; `tsc` resolves the way
   the new extractor does. This is class B.

## Coverage notes

- **Effect pack evidence:** `effect` is the Effect 4 monorepo itself;
  `opencode`, `alchemy`, `junto` and the `effect-*` apps consume it. The pack
  must not fire on the plain-TS corpora (`t3code`, `pi`, `phoenix`,
  `js-genai`, and the Rust repos).
- **Generic detectors beyond Effect:** the four plain-TS repos span large to
  small with no Effect dependency, so syntax-level detectors are checked
  against unrelated code.
- **Rust:** `tantivy`, `typst` and `codex` are three unrelated real-size Rust
  codebases (library, application, agent). `convex-backend` adds a large
  mixed Rust+TS repo so both lanes run on one tree once the Rust adapter
  lands. Until `cli/src/lang/rust/` emits facts, the Rust corpora measure the
  file walk only (`files=0`) — that is expected, not a failure.
- **Snapshots:** `junto` and `pulsar` are pinned because seats edit them live.
  Both snapshots carry `.git` and `.pulsar/`, matching a real checkout; the
  0.3.0 baseline measured `.pulsar`-removed copies (`work/` in the old
  scratchpad), so absolute numbers differ from `baseline/measurements.json`
  by design.

## Reserves ( surveyed 2026-11-07, not in the gate set )

Add when a lane needs more coverage or a corpus must be swapped:

- Rust: `grok-build` (2219 .rs), `openinterpreter` (2571 .rs + TS),
  `frankensim` (4096 .rs), `asupersync` (821 .rs), `Graphite` (698 .rs),
  `buzz` (585 .rs + TS), `perry` (439 .rs + TS), `oh-my-pi` (402 .rs + TS),
  `herdr` (394 .rs), `atlas` (290 .rs), `frankensearch` (216 .rs),
  `infinity` (173 .rs), `coding_agent_session_search` (540 .rs),
  `workbooks.sh` (88 .rs + TS), `convex-rs` (30 .rs, small).
- TS/Effect: `hermes-agent` (1960 ts, clean), `smithers` (1455 ts, Effect),
  `prism` (849 ts, Effect), `qm` (1027 ts), `hyperframes` (801 ts),
  `postiz-app` (781 ts), `agent-device` (554 ts), `airlock` (539 ts, Effect),
  `plinth` (536 ts, Effect), `vouch` (494 ts, Effect), `ripple` (275 ts,
  Effect), `groundwork` (255 ts, Effect), `evolu` (297 ts), `zulip` (470 ts),
  `uploadthing` (412 ts), `convex-js` (247 ts, dirty tree), `junto-app`
  (330 ts, Effect, dirty tree), `junto-landing` (83 ts).
- Effect apps skipped: `effect-discord-bot`, `effect-openai`, `effect-react`,
  `effect-next`, `effect-crashcourse`, `effect-advanced-workshop` have no
  `.git` (no sha to pin); `effect-workshop` (92 ts) and
  `effect-days-2025-workshop` (92 ts) and `effect-introduction` (8 ts) have
  dirty trees — untracked non-source files only, usable if needed;
  `effect-memfs` (6 ts), `effect-io-ai`, `effect-website` extras are tiny.
- `~/Projects/quasar` is TypeScript (217 ts, 0 .rs) — a plain-TS reserve, not
  a Rust corpus despite the charter's example.

## Gate

`bench/gate.sh` runs `pulsar facts` then `pulsar-engine` on every corpus above,
median of 3 runs, and compares against the committed `bench/baseline.json`.
Gate metrics are peak RSS and user+sys CPU time (lead ruling 2026-11-07: they
hold up under machine load); wall time and load average are recorded as
information only. Regression margins: RSS +25%, CPU +25%. `baseline.json` is
tagged with the repo HEAD sha and the CLI/engine binary sha256s — re-record
after engine or CLI changes. Expensive runs go through the lead's queue
(charter).
