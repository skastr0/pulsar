# Agent validation harness

The fan-out shapes for validating pulsar against real repos, with the cost
structure that makes fleet-scale validation affordable. Calibrated on the
2026-06 batch-3 close: the cheap shape agreed 22/22 with frontier
ground-truth verdicts (zero false refutes, zero false confirms), at ~5% of
the cost.

## Roles and model allocation

- **Find** (frontier model, few agents): open-ended judgment. One agent per
  (scope × lens). Lenses that worked: detector-vs-language-reality, test
  honesty (would the test fail if the fix regressed?), score-curve sanity
  (denominators, floors, monotonicity). Prompt finders to REFUTE, ground
  every claim in read source, and treat an empty list as an honest result.
- **Verify** (haiku, many agents): bounded judgment over articulated
  claims. This is the layer where cost explodes if done wrong — and the
  layer where haiku measured at parity.
- **Escalate** (main model, few): only verdicts where the cheap voters
  split or said "uncertain". The escalation rate is the health metric:
  ~20-25% is normal; a climbing rate means the cheap layer is degrading
  and the structure self-corrects by routing spend upward.
- **Synthesize/triage** (main model or human): map confirmed findings to
  fixes, manifest items, or tracked work.

## The three cost rules

1. **Cluster verification by file, not by finding.** One voter judges ALL
   findings against a file in a single read. Per-finding fan-out re-reads
   the same file dozens of times — the original design burned ~280
   frontier agents where ~35 mostly-haiku agents (15 clusters × 2 voters +
   escalations) did the same job.
2. **Prefer probe-tests over reader votes.** When a finding reduces to
   "delete X / feed input Y — does the suite notice?", one builder agent
   writing throwaway probes verifies a dozen findings per context, catches
   live bugs reader-votes miss, and leaves permanent fixtures. Never pay
   agents twice for the same question — encode the answer as a test.
3. **Verifiers are READ-ONLY, stated explicitly.** Probe-minded agents
   sharing a working tree have live-edited source mid-review (see
   operational-pitfalls). Builders that must write get disjoint file sets
   and never commit.

## Calibration method

Before trusting a cheaper verification shape, run it blind against a
labeled set: findings already resolved by the expensive shape (or by fix
history — "fixed on branch" findings make perfect refute-labels, since
agreeing requires reading current code against a well-written claim).
Score agreement, and weigh the error DIRECTION: a false refute silently
drops a real finding (quality loss); a false confirm only costs triage
minutes. Demand zero false refutes before adopting.

Sanity signals that verification is genuine reading, not sycophancy:
line-number citations in verdict notes that resolve against the actual
files; correct refutation of fixed-on-branch findings; verdict notes that
restate the mechanism rather than the finding's prose.

## Workflow mechanics that matter

- Pass findings to verifiers via a file path the agents read themselves;
  embed only the small cluster list in the workflow script.
- Embed static inputs in the script rather than relying on `args`
  surviving resumes.
- Resumed workflows replay cached agent results — session-limit deaths
  lose nothing; resume until done.
- Dedupe findings against everything SEEN, not everything confirmed, or
  judge-rejected findings reappear every round.

## Fleet validation (release gate)

Maintain baseline JSON scans per fleet repo. After semantic changes:
re-scan, build the table `repo | old score/band | new score/band |
considered verdict`, and hold four gates — band agreement on nearly all
repos, zero dangerous-direction misses, true hard-gate blocks preserved,
and cwd-determinism (two different working directories, byte-identical
JSON). Tune defaults only against this table, never against a single
repo's feelings.
