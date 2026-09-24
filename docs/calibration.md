# Calibration and policy

Pulsar needs no configuration to run. This page is for when you want the scores to follow your repository's priorities.

## The rules

Generic evidence needs local interpretation. A 600-line integration file is a liability in one architecture and the intended seam in another; a solo maintainer's bus factor of 1 is a fact, not a fixable defect. Calibration is how a repository says what the evidence *means* — explicitly, in files it owns and commits.

The rules that keep calibration honest:

- **Repo-level, always.** `.pulsar/vector.json` in the repo is the source of truth. A home-directory vector is only an organization-standard fallback, and CLI output labels it as such. There is no personal Pulsar vector.
- **Explicit, not hidden.** Score-affecting rules carry rule IDs, sources, activation evidence, and fingerprints. A policy change always shows up as a policy change.
- **Presets are templates, not policy.** A preset does nothing until it is applied to a repo-owned vector.

See [Defaults vs Programmable Taste](explorations/defaults-vs-programmable-taste.md) for the full design boundary.

## How to calibrate

**1. Discover what's tunable.** Don't guess config keys; read the real schemas:

```bash
pulsar agent catalog .                              # every signal, weight, and slot
pulsar agent catalog . --signal TS-SL-04            # one signal's config schema
pulsar agent catalog . --slot typescript.size-policy # one calibration slot's typed contract
```

**2. Weight the vector.** Create `.pulsar/vector.json` — or start from a preset:

```bash
pulsar persona list                                  # shipped templates
pulsar persona apply strict-type-safety --to ./.pulsar/vector.json
```

A vector override is `{ active?, weight?, config? }` per signal ID. Weights are 0–2 (relative contribution, not confidence); unknown keys and invalid weights are load-time errors, not silent fixes. Shipped presets: `velocity-first`, `refactor-friendly`, `security-paranoid`, `strict-type-safety`, `domain-purist`, `ai-slop-defense` — each labeled `workflow-risk`, `technology-practice`, or `architecture-taste` so you know what kind of judgment you're adopting.

**3. Add executable calibration (optional).** When weights aren't enough, a **project module** attaches deterministic TypeScript/Effect processors to typed calibration slots (file classification, size policy, clone policy, boundary trust, mixer policy…). Write `.pulsar/modules/<name>.ts` with the [project-module SDK](project-modules.md), register it in `.pulsar/project-modules.json`, and validate with `pulsar agent config --trust-project-code`. Trust is explicit permission to execute the repo's calibration code in-process — it is not a sandbox, so inspect the code first. Ready-made examples: `@skastr0/pulsar-project-module-effect`, `-convex`, and `-nextjs`.

**4. Commit and verify.** `.pulsar/` files are ordinary committed source. Every policy resolves to a fingerprint; pin it when you score:

```bash
pulsar agent config . --trust-project-code           # prints result.policy.fingerprint
pulsar agent score . --expect-policy <fingerprint> --trust-project-code
```

Any change to weights, config, or module source changes the fingerprint — a policy edit can never masquerade as a code repair.

## Policy files

Repo-owned policy lives under `.pulsar/` and is meant to be committed:

- `.pulsar/vector.json` — scoring weights and overrides
- `.pulsar/project-modules.json` + `.pulsar/modules/**` — executable calibration
- `.pulsar/conventions.json`, `.pulsar/glossary.json`, `.pulsar/author-aliases.json` — reference data

Generated caches and history snapshots live under `~/.config/pulsar/repos/<repo-id>/` — local runtime state, never policy. CI ratcheting debt is recorded separately in `pulsar-baseline.json`.

## Agent protocol

`pulsar agent` is a JSON-first protocol designed for AI coding agents (and scripts). Every operation emits exactly one JSON envelope on stdout — `{schema, operation, status, result}` — with logs on stderr and errors carrying structured `code`/`issues`/`recovery` fields.

| Operation | Purpose |
|---|---|
| `pulsar agent catalog [repo]` | Discover signals, config schemas, defaults, weights, and calibration slots. Never executes project code. |
| `pulsar agent config [repo]` | Validate and explain candidate or adopted policy without scoring or writing anything. |
| `pulsar agent score [repo]` | Full assessment under the resolved policy: findings with locations, severities, fix hints, and the policy fingerprint. |

Exit codes: **0** complete · **1** invalid input/config/trust/policy error · **2** proven hard-gate violations · **3** incomplete evidence.

The agent loop is three steps:

```bash
pulsar agent catalog $REPO                                   # 1. discover
pulsar agent config $REPO --vector ./vector.candidate.json   # 2. customize (preview)
pulsar agent score $REPO --expect-policy $FINGERPRINT        # 3. assess → repair → re-score
```

Agent operations write nothing to your repo — no vectors, no baselines — only disposable caches. `--full` lifts the compact-mode cap (10 findings, 16 KiB); `--signal` filters detail without changing the verdict.

See the [complete agent guide](agent-first.md) for runnable examples, trust requirements, and the acceptance harness. Agent mode ships in the npm release (0.2.x) and in binaries built from source; running from a checkout requires Bun 1.3.14 and Git.

## Packages

| Package | Role |
|---|---|
| `@skastr0/pulsar-core` | Signal runtime, registry, scoring engine, vectors, calibration |
| `@skastr0/pulsar-ts-pack` / `@skastr0/pulsar-rs-pack` | TypeScript / Rust signal packs |
| `@skastr0/pulsar-shared-signals` | Language-agnostic signals |
| `@skastr0/pulsar-project-module-sdk` | Typed authoring APIs for calibration modules |
| `@skastr0/pulsar-project-module-effect` / `-convex` / `-nextjs` | Technology calibration modules |
| `@skastr0/pulsar-cli` | CLI source and standalone binary target |
| `@skastr0/pulsar` | npm runner for `npx`/`bunx`/`pnpm dlx` |
