# Operational pitfalls (incident log)

Concrete incidents from the truth-pass batches. Each rule in the skill's
"Operational rules" section exists because one of these actually happened.

## Agents editing a shared working tree

- A review agent **deleted the RS-DE-02 score floor** (changed
  `Math.max(SCORE_FLOOR, ...)` to `Math.max(0, ...)`) while probing the
  hypothesis "the floor has no test" — and left the edit in the tree. It
  was caught only because a test builder wrote the missing floor pin the
  same hour. Another agent rewrote RS-AD-01's pressure max mid-review.
- Review agents left scratch test files (`adv-review-scratch.test.ts`,
  `zz-probe-hrtb.test.ts`, `rs-ab02-probe-verify.test.ts`) that `git add
  -A` swept into commits twice.

Rules: verifier prompts state READ-ONLY explicitly; stage by explicit
path; audit `git status` before every commit while agents run; treat any
diff you didn't make as contamination — revert it and let the finding
arrive through the structured channel.

## Test invocation

Bare `bun test` from the repo root executes stale compiled copies under
`dist/__tests__` alongside source tests — 18 phantom failures. Always
`bun run test` (which scopes to `./src`) or target explicit files.

## GitHub push protection vs secret-detection fixtures

TS-SEC-03's detection fixtures contained realistic GitHub PAT and Slack
token strings; push protection blocked every ref containing those blobs
(reported as "repository rule violations" — the explanatory block is
easily truncated by `tail`). Fix shape: assemble tokens from parts at
fixture-write time so no source blob contains a contiguous token, and
scrub history with `git filter-repo --replace-text` BEFORE first push
(safe only on never-pushed history). AWS's `AKIAIOSFODNN7EXAMPLE` and the
demo HS256 JWT are universally allowlisted and fine to keep literal.

## Cache discipline

- Observer caches key on content + config hash, NOT environment — any
  environment-dependent input (ambient `@types` from cwd) freezes
  whichever environment computed first and breaks determinism. Pin the
  environment (`types: []`) and re-check determinism (two cwds, identical
  JSON) after every aggregation change.
- Shared-helper changes invalidate every consumer: when
  `walkAttributedNodes` semantics changed, all 13 consuming signals needed
  cacheVersion bumps. The pin tests turn forgotten bumps into red tests.

## Shell environment

- In zsh, `path` is the array tied to `PATH`: `path="/some/dir"` in a loop
  silently destroys PATH for the shell and all children (bun stops finding
  git; `wc` vanishes). Name loop variables `repo_path`.
- Sandboxed shell commands (e.g. redirecting output outside the worktree)
  run with a stripped environment. Keep scratch artifacts inside the repo,
  excluded via `.git/info/exclude` (`.fleet-baselines/` is already set up).

## Board hygiene (Tower)

Work completed outside the board leaves glyphs stale in
building/reviewing for weeks. When closing: done requires file-level
evidence (commit subjects, current-code citations); partial is not done —
supersede explicitly (comment naming where the remainder is tracked) or
leave open stating what remains. Worktree-local commit SHAs cited in old
glyphs may not exist on main after rebases; verify by subject + diff
scope instead.
