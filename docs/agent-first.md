# Agent-first POC: one repository, one policy

`pulsar agent` is an opt-in JSON interface to Pulsar's existing detectors,
weighted scoring and executable calibration. It is a source-checkout POC, not
a new published release. Existing CLI commands remain available for compatibility;
their output and exit conventions are not the agent protocol.

Agents own their repositories and edit ordinary policy and source files. There
is no separate plan/apply writer, mandatory human approval step, or automatic
bug-fix promise. Pulsar supplies evidence; the agent implements and tests repairs.

## Run from any working directory

Use Git and the repository-pinned Bun 1.3.14. Check out the revision containing this POC:

```sh
git clone https://github.com/skastr0/pulsar.git /absolute/path/pulsar
bun install --cwd /absolute/path/pulsar --frozen-lockfile
export PULSAR_CLONE=/absolute/path/pulsar
export REPO=/absolute/path/your-service
bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent catalog "$REPO"
```

The source runner builds/checks its own workspace outputs and keeps preparation
messages on stderr. The repository argument selects what is scored; the current
directory need not be the Pulsar clone or the target repository. Omit the argument
only when the current directory is the intended repository.

## Get evidence before configuring anything

```sh
bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent score "$REPO"
```

This uses the repository's existing policy, an explicitly identified organization
fallback, or generic defaults. There is no required setup, vector generation,
baseline, questionnaire or calibration module. A repository that already enables
executable modules still requires explicit trust. Exit 2 means a proven hard block;
exit 3 means incomplete evidence, not an installation failure. Read the JSON in
both cases. Customize only where this repository needs a different interpretation
or weighting; the following sections show how, not additional prerequisites.

## Discover before authoring

Start with `agent catalog`, choose a relevant signal, then request its config
schema, defaults and calibration surfaces. Do not guess config keys or memorize
the examples' IDs as a complete detector API:

```sh
bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent catalog "$REPO" --signal TS-SL-04
bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent catalog "$REPO" --slot typescript.size-policy
```

Use canonical IDs from the catalog in consumers; supported aliases are convenient
for authoring. Findings identify their detector with canonical `signal_id`.
Configuration is per signal, not an undifferentiated global strictness switch.

## Declare the repository's weighting thesis

For an order service, unfinished production code matters more than size pressure.
The following is a valid vector candidate, not a replacement set of detectors:

```json
{
  "id": "order-service",
  "domain": "typescript",
  "signal_overrides": {
    "TS-SL-04": {
      "weight": 1.8,
      "config": { "hard_gate_production": true, "top_n_diagnostics": 30 }
    },
    "TS-LD-02": {
      "weight": 0.7,
      "config": { "max_function_loc": 60, "max_file_loc": 350 }
    }
  }
}
```

Weights are in [0, 2]. They express relative contribution to weighted evidence;
they are not confidence percentages, and a good mean does not erase a hard gate.
Unspecified signals retain defaults. This example keeps the unfinished-code gate
enabled and tunes both weights and detector config rather than disabling checks.
When adopting in an existing repo, preserve its original weighting thesis and
merge intentional changes instead of blindly replacing the vector.

The adopted file is `$REPO/.pulsar/vector.json`. It overrides a home-directory
vector, which is only an organization-standard fallback, never a personal or
per-agent scoring preference. Everyone assessing this repository shares its policy.

## Add executable calibration where a consumed slot exists

Write `$REPO/.pulsar/modules/orders.ts` with your editor:

```ts
import { Effect } from "effect"
import {
  defineProcessor,
  defineProjectModule,
  tuneTypeScriptSize,
} from "@skastr0/pulsar-project-module-sdk"

export default defineProjectModule({
  id: "order-service",
  version: "1.0.0",
  scope: "repository",
  processors: [defineProcessor({
    id: "order-service-size",
    slot: "typescript.size-policy",
    role: "factor-policy",
    fingerprint: "order-service-size-v1",
    process: (current, _context, runtime) => Effect.succeed(
      current.value.file.endsWith("src/service.ts")
        ? tuneTypeScriptSize(current, runtime, {
            maxLoc: current.value.kind === "file" ? 250 : 40,
            ruleId: "order-service.reviewable-size.v1",
            reason: "Order pricing code has a repository-owned review budget.",
            evidence: [{ kind: "path", value: current.value.file }],
          })
        : current,
    ),
  })],
})
```

This typed processor contributes to the size detector's consumed policy slot.
It tightens a repo-specific review budget, records an attributable decision and
does not suppress unfinished-code gates. It is executable TypeScript/Effect,
not a closed JSON rule language. Keep it deterministic and update its declared
fingerprint when its semantics change; loaded source and helper identities are
also fingerprinted by Pulsar.

The module manifest candidate is:

```json
{
  "schema": "pulsar/project-modules/v1",
  "modules": [
    { "id": "order-service", "kind": "repo-local", "path": ".pulsar/modules/orders.ts" }
  ]
}
```

Adopt it as `$REPO/.pulsar/project-modules.json`. Module paths are repo-relative
even when the manifest candidate lives elsewhere. The source-clone option
`--module-dependency-root "$PULSAR_CLONE"` supplies the installed SDK/Effect
dependency graph for this POC without adding dependencies to the consumer.
Other [project module kinds](project-modules.md) support installed package and
workspace plugins. There is no promise of an arbitrary hook on every detector;
use the catalog's actual consumed slots and typed SDK contracts.

**Trust is code execution, not a sandbox.** Every enabled non-builtin executable
module requires `--trust-project-code`, including during config preview. Inspect
the module, its imports and the dependency root before granting it. Once trusted,
code runs with the CLI process's privileges; do not run untrusted repository code
with secrets or elevated access. Refusal happens before importing project code.

## Preview → adopt → assess → repair → verify

1. Author `vector.candidate.json` and `modules.candidate.json` in your current
   directory, plus the repo-local module above. Validate without writing policy:

   ```sh
   bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent config "$REPO" \
     --vector ./vector.candidate.json --modules ./modules.candidate.json \
     --module-dependency-root "$PULSAR_CLONE" --trust-project-code
   ```

   Candidate paths are cwd-relative. Unknown config keys and invalid weights are
   errors, not silent fixes. Inspect `result.configuration`, `result.calibration`
   and `result.policy`. `agent score` accepts the same candidates for assessment
   without adoption. Neither command writes vectors, manifests or baselines.

2. Adopt by editing the canonical `.pulsar` files in the repo. Commit those ordinary
   files with your normal workflow. No special Pulsar writer or approval protocol
   is required. Resolve the adopted policy with `agent config` again and save
   `result.policy.fingerprint`; do not assume a candidate's source identity is
   interchangeable with the adopted file's identity.

3. Assess under that exact policy:

   ```sh
   bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent score "$REPO" \
     --module-dependency-root "$PULSAR_CLONE" --trust-project-code \
     --expect-policy "$FINGERPRINT" --full > assessment.json
   ```

   Set `FINGERPRINT` to the config result's value. Read the exit status and JSON
   even for a blocked assessment. `result.assessment` separates hard gates,
   evidence completeness, counts, weighted mean and readiness. Findings have
   messages, severity, weights, locations when available and detail arguments.
   `--full` includes signal diagnostics and factors. `result.signals` is an object
   keyed by canonical signal ID; each signal's `factors` is an array of entries.
   `--signal ID` and `--limit N` only filter detail, not the scoring universe or verdict.

4. Repair the actual implementation and run the service's own tests. For example,
   replace an order-total `throw new Error("Not implemented")` with validated
   integer-cent arithmetic, not a constant return or a gate suppression.

5. Repeat the score with the **same** `--expect-policy`. Verify the relevant finding
   resolved, the input fingerprint changed and the policy fingerprint did not.
   A weight or module-source change must produce `POLICY_MISMATCH`, not masquerade
   as a code-quality improvement. Commit the repair separately from policy changes.
   The guard also includes tool version/build identity, reference manifests and
   repository author-identity rules. Use the source runner or a built executable
   for provenance; a direct package entrypoint may report an unknown build.
   Dirty development builds and arbitrary trusted-code environment/network reads
   are not hermetic identities; pin the tool and dependencies for repeatable use.

## Opt-in Jev ownership numbers

`TS-SL-07-rule-ownership-alignment` replays an offline assessment against a
repo-owned ownership rubric. It measures **fit on the declared inventory**, not
the fraction of all code that is good. It never calls a model during `agent score`.
Without `.pulsar/ownership.json` it is not applicable; a configured policy with
missing or stale evidence is insufficient evidence, not a healthy score.

The workflow is:

```sh
# Mechanical candidate discovery; no provider calls or policy adoption.
bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent discover "$REPO" --include 'src/**'
# After reviewing candidates and authoring .pulsar/ownership.json:
bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent judge "$REPO" --dry-run
# Explicit source egress to TypeSafe. Set TYPESAFE_API_KEY securely first.
bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent judge "$REPO"
# Subsequent scoring is offline and checks current source/context bytes.
bun "$PULSAR_CLONE/scripts/pulsar-dev.ts" agent score "$REPO" --signal TS-SL-07 --full
```

Add the normal policy/trust flags when the repo uses executable project modules.
Dry-run shows the exact paths, source/request byte counts, model and number of
calls without making calls or writing receipts. Live judgment reads whole declared
files, rejects oversized/unsafe evidence rather than silently clipping it, and
saves requests and responses under `.pulsar/ownership-runs/`. These receipts
contain source code: keep them private and ignored. The adopted output is
`.pulsar/ownership-assessment.json`; it is local generated evidence, not policy.
Source changes during inference prevent adoption. Failed calls produce an
incomplete assessment rather than silently retaining an earlier healthy verdict.

Use [Pulsar's one-rule pilot](../.pulsar/ownership.json) as a concrete schema
example, not a universal architecture preference. It declares that both signal
execution paths should share the diagnostic severity authority rule. The source
files are `enforcement.ts`, `runner.ts` and `observer-execution.ts`, with
`evidence.ts` as context. Reviewers can directly check both calls to
`enforceSeverityCeiling`; Jev estimates whether that arrangement matches the
declared rubric. This does not prove that either execution path is bug-free.

Policy fields specify `preference` (`shared_domain_rule` or `caller_local`),
`target: 1`, described `anchors`, allowed classifier/model/prompt identities, and
stable group IDs with owner/caller/context paths. Candidate origins must be
changed from `detector_proposed` to `declared` when intentionally adopted.
Keep the group ID and update its paths after extraction: deleting a clone must
not delete the obligation being measured. Discovery finds clone candidates only;
it cannot inventory noncloned shared rules such as this pilot automatically.

Jev uses a **Choice**, not a free-form score: it chooses a described anchor, or
`unknown` / `not_applicable`. Pulsar maps that selection to the policy's numbers:

| Judgment | Pilot attainment |
| --- | --- |
| Contrary: callers copy the same rule | 0 |
| Mixed: some delegate, some copy | 0.5 |
| Meets: callers share one implementation | 1 |
| Exceeds | Unavailable unless the repo defines an explicit stretch requirement and value >1 |
| Unknown, missing, stale or invalid evidence | No overall attainment |

The inventory attainment is the **minimum** applicable resolved group value.
Adding healthy groups cannot hide a shortfall. The histogram shows how many
groups received each anchor. Signal score clamps attainment to 1, while
`result.assessment.preference_alignment` preserves the full attainment, target and comparison.
Partial results retain `observed_attainment` but make no overall fit claim.
An explicitly empty or entirely not-applicable inventory has no score claim.

Confidence never multiplies attainment. The current evaluator routes a winner
below 0.8 probability or a winner/runner-up margin below 0.2 to unresolved.
Those thresholds are an **uncalibrated abstention rule**, not an accuracy guarantee.
Full probability mass, including unknown/not-applicable, stays in the artifact.
Synthetic development cases discriminate opposite preferences, but similarly
shaped code implementing distinct rules remains unreliable without domain-identity
evidence. Additional context can change judgments; more files are not a substitute
for the right evidence. Treat results as advisory, with a soft-warning ceiling.

The loader validates policy/rubric, declared inventory, classifier allowlist,
source/context hashes and expiration before cache lookup. Replays expire after
seven days by default. Hashes identify bytes; they do not authenticate a dishonest
artifact writer. Do not accept untrusted assessment artifacts as proof.

## Machine contract and limits

Operations emit one JSON envelope on stdout, without `--json` (`--help` is text):
`{schema: "pulsar/agent/v1alpha1", operation, status, result}`. Consumers should
ignore unknown optional fields. Errors use `status: "error"` and
`error: {code, message, issues, recovery}` instead of an assessment result.
Trusted modules must cooperate: console logging is routed to stderr, but arbitrary
code can still write directly to stdout or exit the process; trust is not isolation.

| Exit | Meaning |
| --- | --- |
| 0 | Completed; no hard block and no incomplete evidence |
| 1 | Invalid input/config, trust refusal or policy mismatch; inspect structured error |
| 2 | Existing engine hard gate failed, even if evidence is also incomplete |
| 3 | Evidence incomplete without a hard block; do not treat as a clean assessment |

Pulsar detects grounded patterns; absence of findings is not proof of correct
business behavior. Ratchets, bisect, personas and surrounding workflows are not
prerequisites. This POC does not claim a platform release matrix, portable native
binary support on every OS, or automatic fixes.

## External-consumer acceptance

```sh
bun "$PULSAR_CLONE/scripts/agent-smoke.ts"
# Run the same contract against a separately built executable:
bun "$PULSAR_CLONE/scripts/agent-smoke.ts" --cli /absolute/path/to/pulsar
# Fixture/old-engine proof only; NOT acceptance of the new JSON protocol:
bun "$PULSAR_CLONE/scripts/agent-smoke.ts" --fixture-only
```

The harness creates and deletes an isolated temporary Git order-service repo,
uses its own tests, disables Git signing command-locally and isolates HOME and
`PULSAR_STATE_HOME`. It first assesses a separate zero-config service without
creating policy, then checks catalog/config validation, pre-import trust refusal,
candidate non-mutation, effective weighting and actual SDK processor execution,
block→repair→gate-pass, weight/module policy guards, detail-only filtering and
attributed cold/warm parity. The fresh service lacks history and reference data:
after repair the hard gate passes but exit 3 correctly preserves those evidence
gaps. The harness does not disable those signals to manufacture exit 0. It does
not hardcode a passing score or suppress other detectors. Fixture-only mode links
the clone's dependencies and declares them in the temporary repo solely because
the legacy CLI lacks the POC dependency-root option; full acceptance does not.
Fixture-only success does not establish native or JSON-contract acceptance.
See the [executed POC acceptance and remaining limits](agent-first-poc-delivery.md)
for the delivered revision's source, Linux x64 binary and independent-agent proof.
