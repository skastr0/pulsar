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
Two consecutive decision points are *linked* when a variable written inside or
by the first block's region is read by the second block's condition (def-use),
or when both read the same unmodified variable with disjoint predicates
(correlation, §2d). The function's coupled-path count is computed over the DAG
of linked blocks: multiply within a linked component, add across unlinked
components — i.e. `CP = Σ_components Π_{blocks in component} paths(block)`.

**Accumulators.** A later `if (xs.length)` where every prior block appends to
`xs` *is* coupled to those blocks — but the task's hint is right that the
product over-weights it: appends make the guard's outcome distribution skewed,
not combinatorial. Treat accumulator reads as a 2-outcome coupled link
(continue/exit), never as a fresh multiplier per appending block. Concretely:
link the guard to the *set* of appending blocks as one component whose path
count is `Π blocks × 2`, not `Π (blocks × 2)`.

**Laws it could carry** (same shape as the Metrics laws):
- `coupled ≤ NPath` — coupling only removes multiplicative freedom;
- equality when every block is def-use linked (the state-machine case);
- `coupled ≥ cyclomatic` is *not* claimed — CP can drop below CC on pure
  dispatchers, which is honest (CC counts arms, CP counts interacting
  scenarios);
- monotonicity: adding an independent check never decreases CP.

**Facts needed (adapter work, estimated):**
- per block: locals written (names or numeric local ids), locals read in its
  conditions — the TS adapter already walks the AST for CT; collecting
  write/read sets per control node is maybe +15–25% walker cost, one new
  numeric relation `BL block fn writes reads condition_hash`;
- condition hashes: a normalized hash of the predicate (operator + operand
  shape, constants bucketed) to detect §2d correlations — reuse the existing
  string interning, ~5% extra;
- total: one relation + small walker additions per language; Rust lane needs
  the same for its CT emission. No new parsing, no type information — this
  stays in the default lane.

## 4. Literature (specs and papers only)

- Nejmeh, "NPath: a Measure of Execution Path Complexity" (1991) — the
  recurrence being measured; its sequence-multiplication rule is the direct
  cause of the inflation documented above.
- Ammann & Offutt, *Introduction to Software Testing* — path coverage and the
  distinction between syntactic paths and feasible test sequences; the
  fail-fast infeasibility of §1b is the textbook case.
- King, "Symbolic execution and program testing" (CACM 1976); Cadar, Dunbar &
  Engler, "KLEE" (OSDI 2008) — path feasibility via path conditions; the exact
  problem §2d approximates cheaply (correlated predicates = unsatisfiable path
  conditions). Full symbolic execution is out of scope for a per-SHA metric —
  the coupled count is the static, decidable fragment.
- Balaban, Briand & Dufour, feasible-coverage work (late 1990s) — the
  observation that coverage criteria must count *feasible* paths, which is
  precisely the operator's question.
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
