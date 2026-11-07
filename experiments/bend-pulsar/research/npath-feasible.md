# NPath vs real paths: a coupled-path count (#698)

The operator's question: NPath counts syntactic paths — the top function in one
private app measures 1,843,200 — but how many of those paths are *real*? This
note measures the gap on two corpora, classifies what inflates the count,
proposes a coupled-path metric, cites the literature (specs and papers only,
clean room), and recommends what to do with `core.npath`.

Private-app evidence is aggregate-only per the standing privacy rule; the
public-corpus function is named because it is public code.

## 1. What the gap actually is — measured on the top functions

I read the control flow of the eight highest-NPath functions across the two
corpora and classified every decision point by whether its outcome can interact
with another's. Three distinct inflation mechanisms appeared, in order of how
much they dominate:

**(a) Independent validation blocks — the dominant shape.** Sequential
check-then-record passes where each branch reads inputs that no earlier block
wrote, and writes only to a shared *sink* (`problems.push`, an error list) that
no later condition reads.

- Private app, plugin assembly function: **NPath 1,843,200, cyclomatic 31,
  nesting 3, length 136.** The body is ~6 sequential validation phases —
  per-plugin membership, per-tool ownership, per-permission shape, an
  11-category duplicate-name sweep, three referential checks against declared
  sets, then assembly. Every `if` inside the loops guards one check; none reads
  a variable a previous check wrote. Under def-use coupling the phases are
  independent blocks: the honest count is roughly the *sum* of each phase's
  small internal product (order ~10²), not the product of all ~30 decision
  points. **Estimated gap: ~4 orders of magnitude.**
- Public corpus (`pulsar` CLI, `catalog.rs::validate`, NPath 108,000,
  cyclomatic 23): same shape — format check, id check, scope/activate match,
  per-class id/name/rule checks, alias resolution, sortedness. Sequential
  independent field validations.

**(b) Fail-fast guards — infeasible tails.** Early `return Err`/`throw` guards
mean a later check is unreachable once an earlier one fails. The number of
*distinct observable outcomes* is ~checks + 1 (first failure wins, or
success), while NPath multiplies every guard's continuation. `catalog.rs
validate` is this shape: ~18 decision points, but a run exhibits exactly one
error or none. NPath counts all 2^k combinations of pass/fail as if later
checks still ran.

**(c) Genuinely coupled branches — where NPath is roughly right.** The funnel
state-machine transition in the private app's sales-funnel package (NPath 279,936,
cyclomatic 40): about a dozen boolean flags are computed from the incoming
event and current card, feed one combined guard, then chain through derived
facts into the next state where later conditions read earlier results.
Def-use links most decision points, so a
coupled count stays within ~1–2 orders of NPath here — still inflated by
same-variable correlations (below) but the right order of magnitude.

Webhook ingress functions (verify → decode → route, NPath 14k–737k) sit
between (a) and (c): sequential guards share `request`/`envelope`, so partially
coupled — real reduction maybe 10–100×, not 10⁴×.

**Summary of the gap:** on this sample, NPath overstates real interacting-path
complexity by ~10²–10⁴× on validation/dispatch-shaped functions (the common
case in real code) and is approximately honest on state-machine-shaped
functions. The metric's inflation is *structural*, not a bug — Nejmeh's
recurrence multiplies across sequence by definition.

## 2. A third inflation class the task's taxonomy misses

The task names independent blocks, correlated conditions (same normalized
condition twice), and coupled branches. Measurement adds a fourth, arguably the
most common:

**(d) Mutually exclusive predicates on one immutable variable.** A ladder of
`event.type === A`, `event.type === B`, … tests reads the *same* variable that
nothing writes between tests. Syntactically independent under def-use (no block
writes `event.type`), but semantically at most one arm can hold per evaluation —
the cross-product of arms is infeasible. Event-kind dispatchers
(~50 arms) and the funnel flags above both show it. A coupled-path count
that only tracks def-use *writes* will still multiply these; it needs a
same-read correlation rule: conditions reading the same unmodified variable
with disjoint literal predicates form one coupled group with additive (not
multiplicative) outcomes.

## 3. Candidate metric: coupled-path count

**Definition.** Build the function's decision blocks in control-tree order.
Two blocks are *linked* when a variable written inside or by the first block's
region is read by the second block's condition (def-use), when both read the
same unmodified variable with disjoint literal predicates (§2d), or when the
second reads an accumulator written by the first (accumulator rule below).
Unlinked blocks form separate *components*; the function's coupled-path count
is

```
CP = D + 1 + Σ_components (Π_{blocks in component} n(block) − 1)
```

where `n(block)` is the block's count of *continuing* outcomes (below), `D` is
the sum of dead-end paths from terminal outcomes, and the `1 + Σ(·−1)` form —
not the naive `Σ Π` — is what makes `coupled ≤ NPath` hold: with components
`c` partitioning the blocks, `NPath = Π_c Π_{b∈c} paths(b)`, and
`1 + Σ_c(P_c − 1) ≤ Π_c P_c` for all `P_c ≥ 1` by induction from
`(a−1)(b−1) ≥ 0`. Two independent straight-line blocks give `CP = 1`, not 2.
(Review fix: the earlier `Σ Π` form violated the law — two components of one
path each summed to 2 > NPath 1.)

**Continuing vs terminal outcomes — the fail-fast rule (§1b).** A branch or
arm whose body *always exits* (`return`, `throw`, `break`, `continue`, Rust
`?` — CT kind 7, or a branch/multi-branch whose every arm is terminal, or a
try whose body and every catch are terminal; finally never decides) cannot
reach the continuation. Such an outcome contributes its paths to `D`,
weighted by the product of continuing outcomes of the blocks that precede it
in its component — it is a dead end, not a multiplier. `n(block)` counts only
non-terminal outcomes. `if (!ok) return err; rest` therefore multiplies
`rest` by 1, not 2, and adds one dead path — which is exactly the §1b
correction. Terminality is computed engine-side from the `CT` rows already
emitted (kind 7 plus recursive all-arms-terminal); no new fact is needed.
Conservative default: an arm the predicate cannot prove terminal counts as
continuing (CP leans toward NPath, never past it). A block with `n = 0`
truncates its component — the suffix is unreachable and contributes nothing;
after it, only `D` accumulates. For a clean fail-fast chain — guards reading
straight-line results, continuation in one component — the formula
degenerates to the exact observable count: k dead ends plus the continuation's
paths. The `D` reach-weighting is an over-approximation when a terminal arm
sits behind other decision outcomes (it cannot prove which predecessors
actually reach it), so CP stays honest-but-high there, never below the true
count.

**Mutually exclusive predicates (§2d).** Conditions in one component that
read the same variable, with no intervening write to it, and whose predicates
are provably disjoint (same variable, equality-family operators, distinct
literals — `x === A` vs `x === B`) collapse into one multiplicative unit whose
outcome count is `k + 1` (one of k literal matches, or none) instead of `2^k`.
`x === A` vs `x !== A` is the complementary pair — also one unit, outcomes 2.
Anything not provably disjoint stays def-use-only. This needs per-atom
condition structure, specified below as `BC` rows; `cond_hash` alone cannot
express disjointness.

**Repeated conditions (§1c).** The same normalized condition tested twice
with no intervening write to its operands has a determined second outcome:
the pair contributes 2 joint outcomes, not 4. Detected via `cond_hash`
equality on `BL` rows.

**Accumulators.** A later `if (xs.length)` where every prior block appends to
`xs` *is* coupled to those blocks — but the product over-weights it: appends
make the guard's outcome distribution skewed, not combinatorial. Treat
accumulator reads as a 2-outcome coupled link (continue/exit), never as a
fresh multiplier per appending block. Concretely: the guard joins the
appending blocks' component with `n(guard) = 2`, contributing
`Π appends × 2` to that component's product — not `Π (appends × 2)`.

**Laws it could carry** (same shape as the Metrics laws):
- `coupled ≤ NPath` — every CP term removes multiplicative freedom;
- equality when every block is def-use linked and no arm is terminal (the
  state-machine case);
- `coupled ≥ cyclomatic` is *not* claimed — CP can drop below CC on pure
  dispatchers, which is honest (CC counts arms, CP counts interacting
  scenarios);
- monotonicity: adding an independent check never decreases CP;
- terminal-outcome law: replacing a continuing outcome with a terminal one
  never increases CP.

**Facts needed (adapter work, estimated):**
- `BL block fn writes reads cond_hash` — per decision block: locals written
  (numeric local ids), locals read in conditions, one normalized condition
  hash per condition for §1c. The TS adapter already walks the AST for `CT`;
  collecting write/read sets per control node is maybe +15–25% walker cost.
- `BC block var op lit` — one row per atomic predicate inside a block's
  conditions: `var` an interned local id (same domain as `BL` writes/reads),
  `op` a small enum (`eq`, `neq`, `lt`, `le`, `gt`, `ge`, `other`), `lit` an
  interned literal id or 0 when the operand is not a literal. This is what
  §2d's disjointness proof consumes; `cond_hash` cannot supply it.
- terminality needs **no** new fact — it is a pure function of `CT`.
- total: two relations + small walker additions per language; the Rust lane
  needs the same for its `CT` emission. No new parsing, no type information —
  this stays in the default lane.

## 4. Literature (specs and papers only)

- Nejmeh, "NPATH: A Measure of Execution Path Complexity and Its Applications",
  CACM 31(2), 1988 — the recurrence being measured; its sequence-multiplication
  rule is the direct cause of the inflation documented above.
- Ammann & Offutt, *Introduction to Software Testing* — path coverage and the
  distinction between syntactic paths and feasible test sequences; the
  fail-fast infeasibility of §1b is the textbook case.
- King, "Symbolic execution and program testing" (CACM 1976); Cadar, Dunbar &
  Engler, "KLEE" (OSDI 2008) — path feasibility via path conditions; the exact
  problem §2d approximates cheaply (correlated predicates = unsatisfiable path
  conditions). Full symbolic execution is out of scope for a per-SHA metric —
  the coupled count is the static, decidable fragment.
- Offutt & Pan, "Detecting equivalent mutants and the feasible path problem"
  (COMPASS 1996; extended in STVR 7(3), 1997); Goldberg, Zimmerman & Wang,
  "Applications of feasible path analysis to program testing" (ISSTA 1994) —
  the feasible-path problem named and attacked with theorem proving; CP is
  the cheap syntactic approximation of what they solve exactly.
- SonarSource Cognitive Complexity (already in `research/cognitive-complexity.md`)
  — the existing answer to "NPath over-counts": it counts *nesting-weighted*
  structures, not paths. CP is complementary: it counts interacting scenarios.

## 5. Recommendation

**Keep `core.npath` as the exact syntactic number; add `core.coupled-path` as
a second, opt-in-by-default-OFF rule** — same evidence posture as
`core.cognitive` (threshold proposed 50, pending corpus tuning). Do not replace
NPath: it is the spec-exact figure, cheap, and already proven; CP is an
interpretation layer on top, and the dogfood plus private-case-study evidence
says the interpretation matters most for ranking, not gating.

Concretely:
- `core.npath` keeps firing at >200 (its job: flag syntactic explosion).
- `core.coupled-path` fires at a lower threshold (~50) and is the better
  *ranking* signal — the private app's assembly function (CP ~10²) drops below
  its funnel transition (CP ~10⁵) even though raw NPath says the opposite.
- The private app's policy turns it on; default stays off until a second corpus shows the
  same gap shape (one data point each way so far: validators inflate, state
  machines don't).

**Open measurement caveat:** my CP estimates are hand-derived from reading the
functions, not computed — the metric doesn't exist yet. The classification
(§1a–d) is solid; the ~10²–10⁴× factors are order-of-magnitude estimates a
prototype must confirm before thresholds are set.
