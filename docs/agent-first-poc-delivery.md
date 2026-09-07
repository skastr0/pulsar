# Agent-first POC: delivered and exercised

The POC is ready for a source-checkout or Linux x64 binary trial. Start with the
[self-service guide](agent-first.md). This is committed local work, not a published
release or an assertion that every adoption blocker has been eliminated.

## Three operations; the existing engine stays authoritative

| Operation | Agent outcome |
| --- | --- |
| `agent catalog` | Discover all 74 installed detectors, actual schemas/defaults, weights, factor controls and typed processor slots. No project-code execution. |
| `agent config` | Strictly validate and explain the repository's policy, or preview explicit candidate paths without adopting them. |
| `agent score` | Get whole-repository evidence immediately, without configuration. Repair code and verify using the same `--expect-policy` fingerprint. |

The agent edits ordinary repository files. Weights and executable calibration
remain first-class; no questionnaire, persona, ratchet, bisect, baseline, hosted
account or LLM key is a prerequisite. Repository policy overrides an explicitly
identified organization fallback; no per-agent preference hierarchy was added.

The JSON protocol is `pulsar/agent/v1alpha1`. Exit 0 means completed with sufficient
evidence, 1 means operation/config/trust error, 2 means an existing hard gate
failed, and 3 means incomplete evidence without a proven block. Detail filters do
not alter the scoring universe. Score colors do not create additional hard gates.

Configuration discovery does not invent controls: ledger-only factors are marked
non-tunable, and four declared slots without runtime consumers are marked
unsupported. Project code requires explicit trust before import and runs in
process, not in a sandbox. Source/helper identities, effective processors,
reference policy and tool build identity participate in the policy guard.

Two integration defects were resolved: unrelated dirty hunks could hide an
existing unfinished implementation, and executed size calibration lacked factor
attribution in full CLI output. Whole-repository assessment and attributed
cold/warm parity now have regression coverage; the size signal cache version was
bumped. No default detector thresholds or weights were weakened for acceptance.

Legacy root CLI workflows remain for external compatibility, not as the agent
product model. Retiring those external contracts is a separately owned breaking
release decision for Pulsar maintainers. Do not build more adoption dependencies
on them; the canonical POC loop is evidence → optional policy → repair → verify.

## Executed acceptance

Runtime/SDK integration was fully checked at local commit
[`b15ed3b`](https://github.com/skastr0/pulsar/commit/b15ed3b2759ce678442e6ebed85433347488c0ee).
Commit [`335986d`](https://github.com/skastr0/pulsar/commit/335986d83679511af4690894210330cc4c0f6260)
then added zero-configuration acceptance, native CI coverage and guide updates,
without changing production behavior; both source and binary were rebuilt and
exercised there. Later delivery documentation does not alter the implementation.

| Executed command | Decisive result |
| --- | --- |
| `bun run typecheck --concurrency=1` | Exit 0; 21 successful tasks. |
| `bun run test --concurrency=1` | 1,901 passed, 0 failed; all 11 test tasks executed, not replayed from cache. |
| `bun run build --concurrency=1` | Exit 0; 11 successful tasks. Dependency builds had already run during verification. |
| Focused agent/runtime/SDK/size/fixture test set | 54 passed, 0 failed, 457 assertions. |
| Standalone strict TypeScript check of harness, fixture test, module and service | Exit 0. |
| `bun run build:cli` | All four macOS/Linux arm64/x64 targets compiled; embedded payload/provenance checks passed. Existing host source/native release JSON parity passed without normalization. |
| `bun scripts/agent-smoke.ts` | PASS: zero-config evidence, catalog, strict validation, pre-import trust, candidate non-mutation, effective weights/processors, real repair, policy guards, detail-only filters, attributed cold/warm parity. |
| `bun scripts/agent-smoke.ts --cli "$PWD/dist/pulsar-linux-x64"` | Same complete acceptance PASS against the clean standalone build. |

Source and Linux x64 binary acceptance are now included in repository CI. These
commands were run in orbs; no remote CI run, push, PR or release was initiated.

## An independent agent adopted it without implementation guidance

A separate agent followed README, the guide and live catalog to create an
unrelated parcel service, a vector with weights 1.9/0.6 and an actual size processor
with file/function limits 120/24. It used the clone's dependency root without
installing dependencies into the consumer. Trusted preview wrote no policy.

The consumer's behavioral tests changed from **2 failures to 2 passes** after a
real implementation repair, not test or policy edits. The exact same policy hash
was used before and after; the input hash changed. The unfinished-code gate
changed from **1 violation to 0**, and module/processor/rule attribution appeared
in emitted factors. The integrating thread inspected the original JSON/logs and
consumer Git diff, then independently reran the repaired tests: 2 passed, 12
assertions. Twelve evidence gaps remained, so the post-repair exit was correctly
3, not a manufactured 0. The overall weighted mean slightly decreased; gate
clearance and behavioral correctness, not a universal score increase, are the
proven outcomes.

## Remaining limits, not hidden prerequisites

- Full-suite attempts on the 4 GB orb timed out or hung at observer integration;
  the unchanged suite passed on a 16 GB orb in 4m12s, with that case taking 13.25s.
  This supports resource pressure, but does not establish the exact small-orb
  failure cause or a minimum-memory requirement.
- The source runner rechecks compiler outputs. The independent trial observed
  487 stderr lines and roughly 1.3 seconds per warmed catalog call. JSON stdout
  stayed clean; a built binary avoids that source preparation step.
- Runtime execution was verified on Linux x64 only. Cross-compilation is not an
  executed platform matrix, and no registry publication was tested or requested.
- Trusted code is not hermetic: environment/network/computed imports and external
  dependency implementation bytes are not fully policy-hashed. Pin tool and
  dependencies and keep processors deterministic.
- Two real consumer fixtures prove the end-to-end loop, not universal finding
  accuracy or large-repository latency. Expand detector coverage and validate
  usefulness on real adopting repositories before claiming no-brainer adoption;
  do not substitute another surrounding workflow for that evidence.
