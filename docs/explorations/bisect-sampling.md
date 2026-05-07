# Bisect sampling strategy exploration

## Goal

Keep `pulsar bisect` deterministic and evidence-first when commit ranges get too large for full replay to stay practical.

## Prototype strategies

### 1. Full replay

- **Shape**: score every commit in the range
- **Strength**: exact culprit attribution
- **Weakness**: cost grows linearly with commit count
- **Recommendation**: keep as the default for small and medium histories

### 2. Merge-only

- **Shape**: score range endpoints plus merge commits
- **Strength**: fast, aligns with review units in merge-heavy repos
- **Weakness**: can skip the real culprit when the regression landed inside a topic branch
- **Recommendation**: keep as an explicit opt-in for teams that reason primarily at merge boundaries

### 3. Adaptive-delta

- **Shape**: start from evenly spaced samples, then score midpoints only when sampled deltas stay large or commit gaps stay wide
- **Strength**: preserves exact replay on small repos while capping score volume on large histories
- **Weakness**: can miss small local drops between two flat-enough samples
- **Recommendation**: use as the automatic fallback once ranges grow beyond the “full replay is still cheap” threshold

## Score-budget benchmark

These numbers are the deterministic score budgets implied by the current prototype settings:

- `auto` stays **full** through **500 commits**
- `adaptive-delta` starts with **17** evenly spaced samples
- `adaptive-delta` refines only when:
  - sampled score delta is `>= 0.08`, or
  - the sampled gap is still `> 64` commits
- `adaptive-delta` stops at **1025** scored commits

| Range size | Full replay | Merge-only* | Adaptive-delta |
| --- | ---: | ---: | ---: |
| 128 commits | 128 | endpoints + merges | 17-33 typical |
| 2,048 commits | 2,048 | endpoints + merges | 33-257 typical |
| 50,000 commits | 50,000 | endpoints + merges | capped at 1,025 |

\* Merge-only cost depends on actual merge density, so the prototype reports it as “endpoints + merges” instead of inventing a fake exact number.

## Fidelity vs cost

| Strategy | Fidelity | Cost | Best fit |
| --- | --- | --- | --- |
| Full | Exact | Highest | <= 500 commits, final confirmation runs |
| Merge-only | Low-to-medium | Lowest on merge-heavy histories | release / integration archaeology |
| Adaptive-delta | Medium-to-high | Bounded | large linear histories, exploratory bisect |

## Recommendation

Adopt **`--sample auto`** as the CLI default:

1. **`<= 500 commits`** → replay the full range
2. **`> 500 commits`** → switch to `adaptive-delta`
3. Keep **`merge-only`** as an explicit opt-in

This keeps small repos exact, makes large histories tractable, and stays honest by reporting the sampled commit count and caution diagnostics in the bisect output.

## Follow-up

- Add interval confidence reporting so sampled output can mark which culprit windows are approximate rather than exact.
- If maintainers mostly reason at merge boundaries, consider a hybrid `merge-only + adaptive refinement` mode instead of expanding merge-only into the default.
