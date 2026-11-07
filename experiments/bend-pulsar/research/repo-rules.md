# Repo-defined rules: stratified Datalog in `.pulsar/rules`

Design note for #697 (PLAN.md group J), for review by pulsar-research and pulsar-cli before any code. Owner: pulsar-bend.

**The proposal.** A repo writes rules in Datalog with stratified negation, a `count` aggregate, and comparisons of a measured value against a literal. The CLI type-checks the rules, compiles names and globs to numbers, stratifies them, and lowers them to numeric `J*` IR rows in the facts file. The engine runs one evaluator for every rule, refuses IR that is not stratified or not range-restricted, and prints the findings with a completeness certificate. The laws are about that one evaluator: every printed tuple is derivable, and when the certificate passes the output is the least fixed point, stratum by stratum. No rule can compute a score, because the IR has no arithmetic.

Sources: the semantics are textbook Datalog. Stratified negation and its perfect model are from Apt, Blair and Walker (1988). Least fixed points, range restriction and semi-naive evaluation are from Abiteboul, Hull and Vianu, *Foundations of Databases* (1995), and Ullman, *Principles of Database and Knowledge-Base Systems* (1988). Aggregates stratified like negation are from Mumick, Pirahesh and Ramakrishnan (VLDB 1990). These come from background reading; no link was fetched for this note, and no Datalog engine's source was read (clean room).

## 1. What a rule file looks like

`.pulsar/rules/<name>.toml`. Every file is part of the policy fingerprint, and every finding names its file and line.

```toml
format = "pulsar-rules 0"

# Named sets, compiled by the CLI to numeric facts. Path prefixes or globs, symbol patterns,
# catalog classes. The engine never sees the strings.
[sets]
kernel   = { files = ["packages/kernel/"] }
adapters = { files = ["packages/adapter-*/"] }

# Derived relations: helpers, not findings.
[[derive]]
rel  = "covered(F)"
body = ["CV(fn: F, covered: C)", "C > 0"]

# A finding rule. Its id must start with `repo.`.
[[rule]]
id      = "repo.kernel-imports-adapter"
version = 1
doc     = "A kernel file never imports an adapter file."
find    = "bad(A, B)"
body    = ["I(src: A, dst: B)", "in(kernel, A)", "in(adapters, B)"]
```

- **Relations a rule can read:**
  - Every FACTS relation, by tag, with named fields from FACTS.md: `I(src, dst, form, hv, ht)`, `FN(fn, file, parent, loc)`, `CS(site, fn, callee, loop_depth, ctx)`, `CL(sym, class)`, `TF(fn)`, `CV(fn, covered, coverable)`, and so on. A field left out is a wildcard. Positional arguments are not allowed, because named fields survive a schema change and positions do not.
  - Core findings, as one relation per output kind: `FX(rule, fn, value, threshold)`, written with rule names (`FX(rule: core.crap, fn: F)`), and `CYC(cycle, file)` for cycle membership. Other detector outputs join this list when a rule needs them.
  - `in(set, x)`, for the `[sets]` above.
  - Relations derived in any rule file of the repo. All files form one program, so a later stratum may read another file's relation.
- **Body syntax:** a list of literals that are ANDed.
  - an atom `R(field: Term, ...)`, or a negated atom `not R(...)`;
  - a comparison `X op literal`, with op one of `= != < <= > >=`;
  - a bit test on a flags field, `bits(X, 4)` or `nobits(X, 4)`, as RL already does for `ctx`;
  - `N = count V1, .. : R(..), ..`, the number of distinct bindings of V1.. for each binding of the other variables in the literal.
  Several `[[derive]]` or `[[rule]]` blocks with the same head are ORed.
- **Terms:**
  - a variable, which starts with an uppercase letter;
  - `_`, a wildcard;
  - a literal: an integer, a set name, a rule name or a catalog class name, which the CLI maps to its id.

## 2. Types: the first guardrail

Every FACTS field has a domain, and the CLI keeps the domain table next to the schemas:
- **Ids:** `file`, `fn`, `site`, `sym`, `class`, `rule`, `set`, `cycle`, `commit`, `author`.
- **`nat`:** a measured or counted number, such as `loc`, `covered`, `value`, `loop_depth` or a `count`.
- **`flags`:** a bit set, such as `ctx`.

A variable has exactly one domain, and the CLI rejects a rule that:
- joins different domains: `I(src: X)` with `FN(fn: X)` is a file joined with a function;
- compares an id with a number (`F > 3` on a fn);
- compares two variables with `<`, `<=`, `>` or `>=`. Equality between variables is a join. `X != Y` is allowed between ids of the same domain (IR row `JE`);
- uses `bits` on anything but `flags`.

## 3. Strata

The CLI builds the dependency graph between relations. A negated atom or a `count` adds a strict edge: the read relation must sit in a lower stratum. A positive atom adds a non-strict edge. The program is stratified when no cycle passes through a strict edge, and a cycle through `not` or `count` is rejected with the cycle printed. FACTS relations, core findings and sets are stratum 0. Each derived relation gets the lowest stratum that satisfies its edges.

**Range restriction (safety).** Every variable in the head, in a negated atom, in a comparison or in the group of a `count` must occur in a positive atom of the same body. This keeps every relation finite and every answer independent of any domain the program did not name.

**Count semantics:**
- A count counts distinct bindings (set semantics), and it is defined only for the groups its body produces.
- A group with no binding is absent, not zero. To say "fewer than k, including none", the rule needs a positive atom that lists the groups, and must then take the zero case through `not`.
- `pulsar rules check` warns when a rule compares a count with `<` or `<=` and has no such atom.

## 4. The guardrail against mixers

PLAN.md J asks for no arithmetic across metrics, no weights and no score. Here that holds by construction, not by review:
- **The IR has no arithmetic instruction.** There is no add, multiply or divide anywhere, so no repo rule can compute a sum or a weighted blend.
- **Nat values are restricted:** a `nat` value can be compared with a literal, counted, or carried into a finding as evidence. It can never be compared with another `nat`, because section 2 forbids variable-to-variable order comparisons.
- **Several metrics in one rule are only ANDed conditions.** Each is compared with its own literal threshold, like the boolean composites in PLAN group I.
- **A finding names subjects**, and its `nat` columns are evidence only. The CLI never sorts or ranks findings by them. Subjects must have stable keys, so a `find` head's id variables must be of domain `file` (key `K`) or `fn` (key `FK`). Site, symbol, class and commit ids are per-run, and the type check rejects them in a `find` head. The finding key is hash(rule id, version, sorted subject keys), like every other finding (#653).

For example, `score(F, C + N)` fails to parse, `FX(rule: core.crap, fn: F, value: A), CV(fn: F, covered: B), A > B` fails the type check, and `count` over two unlike relations is still one count of one body's bindings, never a sum of two counts.

## 5. The IR the CLI lowers to

Numeric rows, appended to the facts file. All tags start with `J`, for group J. No FACTS tag or engine output tag starts with `J`; `Q` is taken by the SQL lane (`QS`, `QT`, `QU`, `QD`). Strings go to a `.rules` side table.

| Tag | Fields | Meaning |
|---|---|---|
| `JD` | `rel arity stratum src` | A relation. `src` (frozen): 0 = derived, 1 = the `in` sets (`JS` rows), 2 = core `FX` findings (`rule fn value threshold`), 3 = core `CYC` membership (`cycle file`). Any other value is a FACTS tag packed big-endian as `Rows.bend` does (`LY` = 76·256+89, at most 4 bytes). The smallest tag, `A`, is 65, so 0-3 cannot collide. |
| `JS` | `set value` | One member of a compiled set. |
| `JR` | `clause head_rel stratum kind` | One clause. `kind` 0 = Horn, 1 = count. |
| `JH` | `clause pos kind term` | Head term `pos`: `kind` 0 = variable `term`, 1 = constant `term`. For a count clause, the last head position is the count. |
| `JB` | `clause atom rel neg` | Body atom. `neg` 1 = negated. |
| `JT` | `clause atom col kind term` | Field `col` of body atom `atom` is a variable or a constant. Fields not listed are wildcards. |
| `JC` | `clause var op const` | Comparison. `op`: 0 `=`, 1 `!=`, 2 `<`, 3 `<=`, 4 `>`, 5 `>=`, 6 `bits`, 7 `nobits`. |
| `JE` | `clause v1 v2` | `v1 != v2` between two id variables, if section 8 allows it. |
| `JF` | `finding rel` | Derived relation `rel` is reported as finding `finding`, an index into `.rules` (id, version, file, line, subject domains). |

**Engine output**, a section after the packs, switched on by the presence of `JR` rows, as packs are by their facts:

```
pulsar-rules 0
JX <finding> <v1> ... <vk>     one per tuple of a finding relation, sorted by (finding, tuple)
JCERT <0|1>                    1 when every stratum reached a fixed point within its fuel
JXS <n>
```

The CLI maps each `vi` through its domain (file id to path and `K`, fn id to `FK`) for rendering and for finding identity (#653). It labels the finding `origin: repo`, with its rule file and line.

## 6. Evaluation, and what the laws say

`Rules.bend` holds one evaluator. Its entry point is `Rules.run(ir, edb) -> Maybe<Out>`.

1. **`Rules.valid(ir)`** checks:
   - every relation's arity is consistent;
   - every clause is range-restricted;
   - every clause's head stratum is at least each positive body relation's stratum, and strictly above each negated or counted relation's;
   - every `src` relation is present.
   Invalid IR is refused, and the engine exits 2, as every detector does.
2. **Strata run in order.** Within a stratum, `Rules.step` is the immediate-consequence operator: the current relations, plus the head of every clause instance whose body holds. Lower strata are fixed. A count clause runs once, over its lower-stratum input.
3. **Fuel.** Iteration stops when a step adds nothing, or when the fuel runs out. The fuel is `1 + Σ |D|^arity` over the stratum's derived relations, where D is the active domain (every value in the input and every constant), computed in `Nat`. Each step that does not stop adds at least one tuple, so a stratum always reaches its fixed point within that fuel. `JCERT` reports whether every stratum reached its fixed point, so a fuel bug cannot pass unnoticed.

**Laws (`Rules-LAWS.bend`), all about the shipped functions:**

- **R1 `join_sound`, R2 `join_complete`.** A binding is in `Rules.join(clause, rels)` if and only if:
  - every positive atom holds in `rels`;
  - no negated atom holds;
  - every comparison holds.
  This is the core lemma, and every other law rests on it.
- **R3 `step_is_tp`.** `Rules.step` equals I ∪ heads(join), the immediate-consequence operator T_P.
- **R4 `run_sound`.** Every printed tuple is derivable: it is in T_P↑k of its stratum for some k. Proved by induction on the iterations. It needs no hypothesis.
- **R5 `run_complete`.** When `JCERT` is 1, the output of each stratum is closed under T_P and contains its input, so it contains every derivable tuple (induction on derivations). With R4, the output is exactly the least fixed point.
- **R6 `stratified_model`.** Stratum s is evaluated with the final relations of strata below s. Each negation and each count reads a finished relation, so the output is the perfect model of the program.
- **R7 `count_is_distinct`.** A count equals the number of distinct bindings of its counted variables in its group.
- **E1-E3.** `run` equals `Some(evaluate(ir, edb))` on valid IR, it refuses invalid IR, and `lines` has the shape above. The engine's `Engine.all` gains a `rules` section, with a P-law in `engine/LAWS.bend`, as for packs.

**What stays unproven, stated as for the other detectors:**
- the decoder from J rows to the IR;
- the decimal printing;
- the CLI's compiler.
The compiler is checked by `pulsar rules check` and by fixtures, and the engine re-checks validity, so a compiler bug can only cause a refusal, never a wrong finding.

**Performance.** Phase 2a is naive iteration with nested-loop joins over sorted lists, because it is the simplest to prove. Phase 2b adds semi-naive iteration and an index on each atom's first bound field, with a law that its step equals the 2a step (the pattern N1 used for NPath in #663). Memory is measured on the large corpora before 2b ships, because rules run on every sha.

## 7. Examples, written fresh (no repo's real rules)

```toml
# A function that calls a query and has no line covered by tests.
[[derive]]
rel  = "covered(F)"
body = ["CV(fn: F, covered: C)", "C > 0"]

[[rule]]
id   = "repo.untested-query"
find = "u(F)"
body = ["CS(fn: F, callee: S)", "CL(sym: S, class: query)", "not covered(F)", "not TF(fn: F)"]

# Fan-in: a file that more than 30 files import.
[[derive]]
rel  = "fanin(B, N)"
body = ["N = count A : I(src: A, dst: B)"]

[[rule]]
id   = "repo.fan-in"
find = "f(B, N)"
body = ["fanin(B, N)", "N > 30"]

# A composite over core findings: a complex function inside a named set.
[[rule]]
id   = "repo.complex-in-core"
find = "c(F)"
body = ["FX(rule: core.cyclomatic, fn: F)", "FN(fn: F, file: P)", "in(kernel, P)"]
```

Rejected:
- `find = "s(F, A + B)"`: there is no arithmetic.
- `"A > B"` with two `nat` variables: no order comparison between variables.
- `"risky(F) :- FN(fn: F), not risky(F)"`: a cycle through negation, which is not stratified.

## 8. Review outcomes

pulsar-cli reviewed this note at 80c2b64 and accepted it:
- **Q1:** `!=` between ids of one domain is allowed (`JE`).
- **Q3:** rules run in the same binary, after the core detectors.
- **Q4:** the domain table lives by hand in `facts.rs`, next to `Rel` (`Rel::fields() -> [(name, Domain)]`). A unit test parses the FACTS.md relation tables and fails when a tag, its arity or its field names drift, so FACTS.md wording never becomes load-bearing.
- **Q6:** arity <= 8, clauses <= 256, body atoms <= 8 per clause, relations <= 64. The CLI prints the bounds it applied, and the engine's `Rules.valid` refuses anything past them too.
- **Subjects:** `find` heads take `file` and `fn` subjects only (section 4).
- **Rule switches:** `rules.disable` in policy.toml can switch a repo rule off, and each finding line shows `origin repo` plus the rule's file:line.
- **Check runs:** `pulsar rules check` needs one engine run, so its tests run on a VM-sized fixture.
- **Timing:** the CLI side starts after pulsar-cli's #654 cache work lands.

pulsar-research's review is pending: Q2 and Q5 below, and anything else.

## 9. Open questions (as first asked)

1. **`!=` between two ids of one domain.** One use is "A imports B where A's package differs from B's". It brings no arithmetic and no ordering, so I recommend allowing it (IR row `JE`).
2. **Which core findings rules may read in phase 2:** `FX` and `CYC` first. Are layer findings (`LM`, `LCYC`, ...) and `RCX` needed for the first real rules?
3. **Where rules run.** The engine evaluates them after the core detectors, in the same binary and stream, so `FX` reaches them in memory. The alternative is a second engine pass that reads the first pass's output, which is simpler to wire but adds a round trip through text. I recommend the same binary.
4. **The domain table:** generated from FACTS.md, or kept by hand in the CLI with a test that compares it to FACTS.md? (pulsar-cli)
5. **`pulsar explain <finding>`:** the engine can print one derivation witness (the clause plus the body tuples) for a requested tuple, checked against R1. Phase 3, unless the first real rules need it sooner.
6. **Limits:** a maximum arity (8?) and a maximum number of clauses per repo, so a rule file cannot blow the memory bar. The CLI reports the bound it applied.

## 10. Who does what

- **pulsar-cli** (#697, the CLI side):
  - the TOML and rule-text parser;
  - the domain table and the type check;
  - set compilation;
  - strata;
  - lowering to J rows, the `.rules` side table and the fingerprint;
  - `pulsar rules check` (strata, relations read, and matches at HEAD from one engine run);
  - rendering `JX`.
- **pulsar-bend:**
  - `Rules.bend` with `Rules-LAWS.bend` / `Rules-PROOF.bend` (R1-R7, E1-E3) and a negative control for each law;
  - the engine wiring with its P-law;
  - fixtures written fresh.
- **First real user:** the private case study's rules (#687), written into that repo's own `.pulsar/rules` once phase 2 runs. Nothing about it goes into this repo.
