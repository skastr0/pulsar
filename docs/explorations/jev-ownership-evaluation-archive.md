# Jev ownership evaluation archive

Research harness for production Jev ownership (`packages/cli/src/jev`, core `aggregateOwnershipAttainment`) is deleted after this note. Live receipts stay in ignored `.amp/in/artifacts/` and `.pulsar/ownership-runs/`; they are **not** durable delivery. This file is.

No live calls were made while writing this. Numbers below were re-read from those receipts and match the paired summaries. Repeats are not independent problems. Credentials never appear in the cited artifacts.

**Source snapshot (exact research executables):** [f09151f](https://github.com/skastr0/pulsar/commit/f09151f07e493ac9c76c84c32c38aed31df4669b). Recover locally with `git show f09151f:<path>`; the GitHub link requires publication of that history.

| Path | git blob |
| --- | --- |
| `scripts/jev-ownership-evaluation.ts` | `4891ef937c396c9a851a64bfb820a4c03d6c914c` |
| `scripts/jev-ownership-live.ts` | `7e8b1f43e48c54df7bf31fca78de63b2aa21cbad` |
| `scripts/__tests__/jev-ownership-evaluation.test.ts` | `a7e45ec443ec4ab9b91407d347e15e5d61726eff` |
| `scripts/jev-ownership-evaluation/cases.ts` | `b8e26ce09770398f77723fc844e08773384cb285` |
| `scripts/jev-ownership-evaluation/compare.ts` | `d972c08e4693152b4e11b1f907b31c8916d7bb58` |
| `scripts/jev-ownership-evaluation/expectations.ts` | `d1d6a6a201b66fb038ed3e5ced46d6f02a745b86` |
| `scripts/jev-ownership-evaluation/followup.ts` | `4ef22adfb68b0e650032da1532ff06ebb4233b38` |
| `scripts/jev-ownership-evaluation/host-score.ts` | `2fb4fe401a088d0fa7160b1ef1e88324ba57a39f` |
| `scripts/jev-ownership-evaluation/index.ts` | `d2224edebbc45cc475aa14de6570c76ab44c8b03` |
| `scripts/jev-ownership-evaluation/requests.ts` | `62481e0cd560b0c0d2463b2c0c7ad4e3c6f61aa8` |
| `scripts/jev-ownership-evaluation/rubrics.ts` | `5b4c007ab224cb4e7603636efc4dc9d275202642` |
| `scripts/jev-ownership-evaluation/sources.ts` | `c2dd8c0748bb406b4b5db9d8a25f2387b4362bda` |
| `scripts/jev-ownership-evaluation/types.ts` | `ba0aed0eddef21c3c9cc3c27af5c49fcfd42c6c0` |

Production evaluator/core/CLI and `packages/cli/src/__tests__/jev-ownership.test.ts` were not part of this cleanup.

---

## Four layers (do not collapse)

1. **Assessment distribution** — Jev choice probabilities on `contrary` / `mixed` / `meets` / (`exceeds`) / `unknown` / `not_applicable`.
2. **Selection gate** — `pulsar.ownership.selection_gate.v1`: `minWinner=0.8`, `minMargin=0.2`. Fail → host `status=unresolved`, `selectedAnchorId=unknown`; `rawSelectedAnchorId` keeps the model choice.
3. **Host arithmetic** — canonical `aggregateOwnershipAttainment` (core). Min of resolved applicable groups. Unresolved / missing declared ids → `insufficient_evidence` (observed min retained, no score). `not_applicable` drops out of the min. All-NA population is NA, not 1. Stretch `exceeds=1.2` attainment may exceed 1; displayed score clamps to 1. Duplicate group ids fail closed. Offline `HOST_SCENARIOS` in `expectations.ts` sealed this; the research host was a thin mapper, not a second engine.
4. **Accuracy** — match to **sealed** expectations (`expectations.ts`), applied only after receipts. Not the same as (1)–(3).

**Mixed-anchor bug is evaluation rubric, not compiler.** `STANDARD_ANCHORS` named both policies’ defects in one `contrary` string and a preference-agnostic `meets` string. `compileOwnershipRequestSync` already forwards `rubric.anchors` verbatim (`promptId` stayed `pulsar.ownership.choice.v2`). Production / `.pulsar/ownership.json` anchors must be preference-conditioned (`followup.ts`). Do not copy `STANDARD_ANCHORS` into shipped policy. Do not bump Jev `promptId` for that experiment.

**No autonomous refactor-improvement loop was tested.** Mutations below are scripted source edits + re-judge, not an agent loop.

---

## Datasets (keep separate)

| Dataset | n | What | Local artifact | SHA-256 of file |
| --- | ---: | --- | --- | --- |
| **v1 first5** | 5 | HTTP-map fixtures, older wire | `.amp/in/artifacts/jev-ownership/first-five-1789719578037.json` | `31f2ec792f47260568ff637724c78916963cbfe3a9e4b4a297f8f1bf1186d979` |
| **production v2 provider112** | 112 | Same HTTP-map family, v2 compiler | `matrix-1789719981415.json` + `matrix-summary-1789719981415.json` | `00f6291acd5bdd2e2e7df71e487cf3d4e9eb93d1bfa4d24a5e6dc0e5f0afdd7f` / `f007dde0955ee4271a6b7dfbe669ade639b46267f858ed3e548b68fa951480a8` |
| **distinct-rule evidence** | 8+8 in provider112; g4/g17 in 101 | Two different fixture families (see below) | inside provider112 and independent101 | — |
| **independent101** mixed two-policy anchors | 101 | Publish/sample fixtures + `STANDARD_ANCHORS` | `jev-ownership-evaluation/receipts-1789721468958.json` + `summary-1789721468958.json` | `6e9e7adda1f80532e3e1b12a0b6d4cc564f78d49d33d40861cb038608f785b73` / `d2f50a78badc3f276e89886aa92708357a61fd5c1368d3f32fb605987f3c21f8` |
| **independent20** conditioned follow-up | 20 | Same five arrangements, preference-conditioned anchors | `receipts-1789721635468.json` + `followup-conditioned-anchors-summary-1789721635468.json` | `f6b2aa47883d4c78e8635e8cb74da9df61efc1e94a25ae00ecee44b4ca4e4815` / `6a303828263fbe18fe916ca28adf550603cf4f70a433fa5f9be1006648e664bd` |
| **provider12 confirmation** | — | **Not locally available. Omitted.** | — | — |
| **CLI pilot1** | 1 | Real repo group `engine-diagnostic-severity-authority` | `pulsar-severity-pilot.json`; judge `pulsar-judge.json`; run `90b50608-468c-497e-a208-96eb4cb594a7` | see CLI section |
| **mutations9** | 9 | 3 copy-counts × 3 repeats on that group | `pulsar-severity-mutations.json` | `3dc878994e4421ace741043ffc411b673e6e134c3be3535ea195c9eeab996cc9` |

Discover (`pulsar-discover.json`) is detector proposals under `packages/cli/src/**`, **not** the severity-authority pilot inventory. Do not mix.

All live series: model `jev-1.13.0`. v2 / 101 / 20 / CLI: `promptId=pulsar.ownership.choice.v2`. v1 first5 assessments have **no** `promptId` / `selectionGate` / `rawSelectedAnchorId` in the stored summary (raw choice still in `rawResponse`).

---

## Request hygiene (sealed tests + live)

Sealed tests (`jev-ownership-evaluation.test.ts` at the snapshot):

- Source snapshots contain none of: `fixture`, `expected`, `contrary`, `meets`, `mixed`, `exceeds`, preference ids, `not_applicable`, `unknown`, `obl-publish` / `obl-sample`, case ids `g1`…`g21`.
- Arrangements are mechanical in the bytes (identical predicate vs `import { mayPublish }` vs distinct `SAMPLE_TIERS` table).
- `requests.ts` / `followup.ts` do not import `expectations.ts` or contain `SEALED`.
- Compiled provider `state` omits forbidden keys: `reference_label`, `expected_direction`, `expected_answer`, `fixture_id`, `split`, `proposedExpectations`, `annotator`, `prior_model_outputs`, `aggregate_score`, `api_key`, `credentials` (and camelCase twins). Encoded state must not contain `obl-publish`, `expected`, `fixture`, or the case id. Criteria always include `unknown` and `not_applicable`. Question type `choice`.
- Live matrix length 90–120, both policies, includes `identical-copies`, `distinct-domain-same-shape`, `healthy-padding-with-copy`, `conflicting-preference-text`, and an `anchor-order` perturbation.
- `STANDARD_ANCHORS` file comments: `ADVERSARIAL / CONFLICTING RUBRIC INPUT` / `NOT PRODUCTION WORDING`. Frozen contrary text includes “or a caller-local rule is extracted”.
- Host tests: import `../../packages/core/src/ownership.ts` `aggregateOwnershipAttainment`; no `histogram.unresolved` / `histogram.not_applicable` in the mapper.

Live 101 compiled states: no case id, no `obl-publish`, no `expected`, no `fixture`. Substring `split` appears only inside padding source `value.split(...)`, not as a request key. v1/v2 HTTP-map compiled requests: no `api_key` / `authorization` / `Bearer` / `TYPESAFE` / `credentials`. CLI pilot `fixture` hit is source comment `executable fixture that proves it` in `packages/core` text, not a request field.

---

## Fixture families

### A. HTTP status-class (v1 first5 + v2 provider112)

Shared owner `src/http-map.ts`: three-way `ok | retry | fail` on HTTP status. Stripe/PayPal adapters either import it or inline the same mapper. Distinct-rules arm replaces that with vendor lifecycle machines (`event.kind === "succeeded"` vs `"COMPLETED"`). Mixed arm: Stripe delegates, PayPal keeps a local copy of the **same** HTTP mapper. Missing/owner-only/one-caller/empty are thin or incomplete snapshots. Definitions: `scripts/jev-ownership-live.ts` at the snapshot.

### B. Publish / sample (independent101 + independent20)

Mechanical predicates in `sources.ts`:

```
PUBLISH_PREDICATE = (signal.tier === 1 || signal.tier === 1.5) && signal.evidence === "proof" && signal.ceiling === "hard-gate"
SAMPLE_TABLE      = const SAMPLE_TIERS = new Set([2, 3])
SAMPLE_PREDICATE  = SAMPLE_TIERS.has(signal.tier) && signal.evidence === "heuristic" && signal.ceiling === "review"
```

Copies embed `mayPublish` locally (`preview.ts` / `submit.ts` / `audit.ts`). Delegation imports `./publish-rule.ts`. Distinct-domain is publish copy + sample copy (similar `if` shape, different table/predicate). Padding is `titleCase` / `slugify` / `clamp` / `unique`. Ambiguous identity: `alphaAllowed` (`tier >= 1 && evidence !== undefined`) vs `betaAllowed` (`tier < 1` then `ceiling.length > 0`). Notes/stubs have no implementation.

**g7a overlapping-publish and g13 three-site-copies send identical source bytes** (same three copies). independent101 therefore reused request SHA `66a89691135782f2c483e33e126b3911a78260e19bb11d01cb1f263c4da5d84d` (shared) and `82c968c57b6f182e00c31e02579dea0f80a3a9917c901779d52ab2495be7927d` (local). Count them as one arrangement, two case ids.

### C. Real CLI group (pilot1 + mutations9)

Declared in `.pulsar/ownership.json`: group `engine-diagnostic-severity-authority`, preference `shared_domain_rule`, owner `packages/core/src/enforcement.ts` (`enforceSeverityCeiling` / poison authority), callers `runner.ts` + `observer-execution.ts`, context `evidence.ts`. Anchors are **preference-conditioned** (see CLI section). One-group pilot, not a whole-repo inventory.

---

## Sealed expectations (family B)

From `SEALED_EXPECTATIONS` (41 rows: 19 `both` × 2 + conflict + 2 stretch). Asymmetric labels are not softened.

| id | arrangement | shared_domain_rule | caller_local |
| --- | --- | --- | --- |
| g1 | identical-copies | resolved contrary 0 | resolved meets 1 |
| g2 | delegated-owner | resolved meets 1 | resolved contrary 0 |
| g3 | mixed-copy-and-delegate | resolved mixed 0.5 | resolved mixed 0.5 |
| g4 | distinct-domain-same-shape | **not_applicable** | resolved meets 1 |
| g5 | extracted-owner | resolved meets 1 | resolved contrary 0 |
| g6 | healthy-padding-with-copy | resolved contrary 0 | resolved meets 1 |
| g7a | overlapping-publish | resolved contrary 0 | resolved meets 1 |
| g7b | overlapping-sample | **not_applicable** | resolved meets 1 |
| g8 | missing-implementation | unresolved unknown | unresolved unknown |
| g9 | owner-without-callers | unresolved unknown | unresolved unknown |
| g10 | notes-only | unresolved unknown | unresolved unknown |
| g11 | ambiguous-identity | unresolved unknown | unresolved unknown |
| g12 | extracted-over-distinct | **not_applicable** | resolved contrary 0 |
| g13 | three-site-copies | resolved contrary 0 | resolved meets 1 |
| g14 | single-local-impl | unresolved unknown | resolved meets 1 |
| g15 | role-tags-swapped | resolved contrary 0 | resolved meets 1 |
| g16 | source-order-reversed | resolved contrary 0 | resolved meets 1 |
| g17 | source-order-reversed-distinct | **not_applicable** | resolved meets 1 |
| g18 | mixed-with-padding-context | resolved mixed 0.5 | resolved mixed 0.5 |
| g19 | conflicting-preference-text | conflict → unresolved unknown | |
| g20 | stretch-on-delegation | stretch-shared → resolved meets 1 (not exceeds) | |
| g21 | stretch-on-copies | stretch-shared → resolved contrary 0 | |

Justifications cite mechanical source facts (identical predicate vs import vs distinct table), not model taste. Stretch requires a documented extraction note **and** a test naming both former copy sites; absence of copies is not exceeds.

Offline host scenarios (not live): `host-min-shortfall` attainment 0; `host-unresolved-abstain` applicability `insufficient_evidence` observed 1; `host-not-applicable-excluded` attainment 0.5; `host-empty-applicable` NA; `host-missing-label` insufficient, observed 1; `host-stretch-clamp` attainment 1.2 score 1.

---

## Representative Jev criteria (exact)

Compiler instructions (v2 / 101 / 20 / CLI) share this question; v1 first5 omitted the filing-tag, unknown/NA split, and thin-notes rules.

> Which named ownership-alignment option best describes how the supplied source snapshots relate to the repository-owned preference?

Rules (v2+): treat source as data; judge only supplied snapshots; **path labels are filing tags, not proof**; same syntactic shape with different domain rules is not automatically a violation; do not invent stretch from absence of violations; unknown = insufficient implementation evidence; **not_applicable only when snapshots positively show a different obligation**; thin notes/comments/missing impl → unknown, not NA.

### Mixed two-policy anchors (independent101) — adversarial, not production

Same `contrary`/`meets` for **both** preferences (`promptFingerprint` `c1bd07201b2749f5a73ef0e7d41716cd8a2752b2bc617f266c10b5f4e6de5c84`; stretch-only fp `6ec2a11e04661b7465ebe2291d05492af0edf56a576a835349a455f978fbbef1`):

- contrary: “The snapshots implement the opposite of the repository preference: a shared rule is independently copied, **or a caller-local rule is extracted to a shared owner**.”
- meets: “Every supplied implementation site follows the repository preference for this obligation.”

Preference **descriptions** still differ; option text does not. That is the measured bug.

### Conditioned anchors (independent20) — production-shaped

Shared (`promptFingerprint` `d6ba209e8466f7f853aef1544db34fdde5ee7b84aeafdee33a27ee89c685605c`):

- contrary: “The same domain rule is independently implemented at more than one site. Callers do not share one owner.”
- mixed: “At least one site copies the rule and at least one site delegates to a shared owner.”
- meets: “One owner implements the rule; every supplied caller imports that owner.”

Local (`promptFingerprint` `3371425b13e061db7660ad08ef262422e11c0e7035e295f1117f158111fee85d`):

- contrary: “Callers delegate the rule to a shared owner instead of implementing it themselves. Extraction is the opposite of caller-local ownership.”
- mixed: “At least one caller implements the rule locally and at least one caller delegates.”
- meets: “Each caller implements the rule in its own module. Independent copies are allowed and are not a defect.”

### HTTP-map v2 (provider112) shared policy — preference-conditioned

- contrary: “Callers each keep their own copy of the same vendor-neutral HTTP class mapping, against the shared-owner preference.”
- meets: “The mapping lives in one owner and the callers use that owner. Same shape with different domain rules is not a miss.”

Local policy contrary: “A shared mapper owns the HTTP class mapping that this preference wants kept caller-local.” Meets: “Each caller keeps the mapping locally. No shared owner for this mapping.”

v1 first5 used the same option `what` strings but older unknown/NA (plain strings) and `state.group` + source `role` (v2: no group, `filing_tag`). **Do not treat first5 and provider112 request SHA as comparable.**

### CLI pilot (conditioned on this obligation)

- contrary: “The declared callers implement their own copies of the same diagnostic severity authority rule rather than delegating to its shared owner. Similar unrelated logic is not a copy of this rule.”
- mixed: “Some declared callers delegate diagnostic severity authority to its shared owner, while others implement a local copy of the same rule.”
- meets: “The declared callers delegate diagnostic severity authority to one shared implementation. This judgment concerns ownership of that rule, not proof that the rule or callers are behaviorally correct.”

---

## v1 first5 (HTTP-map, older wire)

File stamp `1789719578037`. 5 calls, concurrency implied sequential in artifact. Tokens from `rawResponse` usage (assessment token fields are redacted): **5631 in / 292 out**. Elapsed sum 717 ms.

| label | selected | dist (c/x/m/u/na) | conf | sha256 | req id | ms | raw tokens |
| --- | --- | --- | ---: | --- | --- | ---: | --- |
| shared-code/shared-policy | meets | 0/0/1/0/0 | 1.00 | `7fcb6920892e4f6909c4ee613a85b0e85fcf3db2496021078875b5db277f059e` | `req_01a0b399833b752383c643d6f174d1d3` | 203 | 1254/58 |
| shared-code/local-policy | contrary | 0.99/0/0.01/0/0 | 0.99 | `f1c722eeb76c6810009a2538ca2a3d8c1498f292114513016989906a1021d56b` | `req_01a0b39983c774229c8a9e09c54d0b04` | 153 | 1232/58 |
| local-code/local-policy | meets | 0/0/1/0/0 | 1.00 | `624a98c796fd93ebf7a8cbacebe8c2c368cd754f84338d6827e439d9b67c078d` | `req_01a0b39984597712ae52308b94426e43` | 144 | 1160/58 |
| local-code/shared-policy | contrary | 1/0/0/0/0 | 1.00 | `08ead6af296beb47d4c0e2755f18e0ee4c6de9685b85143be2d0c0be148a3120` | `req_01a0b39984eb7d36851488e833345d00` | 95 | 1182/58 |
| missing-evidence/shared-policy | **not_applicable** | 0/0/0/0.39/0.61 | 0.50 | `024d22cd472b33b675e5e01b44f09b18cb49a9d1db3b045f1d8310840fa77f64` | `req_01a0b399854c7b4083805a2c9f43aa76` | 122 | 803/60 |

Sanitized raw (shared-code/shared-policy): `choice=meets confidence=1.0 probabilities meets=1.0`. Missing-evidence: `choice=not_applicable confidence=0.5 not_applicable=0.61 unknown=0.39`. **No gate object stored.** Opposite-policy discrimination on the four code×policy cells holds. Thin notes under v1 unknown/NA wording landed NA at conf 0.5 — not comparable to v2 missing-notes (unknown p=1). Prompt fps: shared `83e738c2a8da222ae5ae8298c03d3f26292d04d0e62f5ae4e41b526d03769063`, local `e5cdb82b846b10ef9fd7b4d9e054073a5a0ee5ad729179a3f3da20d2edf216d2`.

---

## production v2 provider112 (HTTP-map)

`matrix-1789719981415.json`: 112 assessments, 19 unique request SHA, 112 unique request ids. `promptId=pulsar.ownership.choice.v2`. Prompt fps `8425ef40b6c162dd5a3e2738a810b2c4903d87c75cd41017016c517716bc8cdc` and `8e9d2b9b131026636bef35c8fcd33d7bf54c6e5fe8b992206f5e2fb352c92306`. Tokens **128836 in / 6456 out**. Latency min 75 / p50 117 / p90 234 / max 1626 ms. Status: resolved 80, unresolved 32. Gate passed 103, failed 9.

Histogram (family → selectedAnchorId counts) matches the summary file:

| family | selected | n |
| --- | --- | ---: |
| discrimination | meets 16, contrary 16 | 32 |
| mixed | mixed 16 | 16 |
| distinct | unknown 8, meets 8 | 16 |
| missing | unknown 24 | 24 |
| reorder | meets 12, contrary 4 | 16 |
| role | meets 8 | 8 |

Per-base (repeats, **not** independent):

| base | n | selected (all repeats) | gate fail | request SHA |
| --- | ---: | --- | ---: | --- |
| shared-code/shared-policy | 8 | meets | 0 | `9b5a4339c789…` |
| shared-code/local-policy | 8 | contrary | 0 | `24c39aa78c4f…` |
| local-code/local-policy | 8 | meets | 0 | `66ed22f8bab7…` |
| local-code/shared-policy | 8 | contrary | 0 | `dfdda1875dfe…` |
| mixed-code/shared-policy | 8 | mixed (conf 0.98–0.99) | 0 | `b34f0c7934ab…` |
| mixed-code/local-policy | 8 | mixed (conf 0.83–0.92) | 0 | `1cbac09d96ce…` |
| **distinct-rules/shared-policy** | 8 | **unresolved unknown, raw contrary, gate fail** | 8 | `4822dd382fe4…` |
| distinct-rules/local-policy | 8 | meets | 0 | `4ef22064ebfd…` |
| missing-notes/{shared,local} | 6+6 | unknown (conf 1) | 0 | `1f02fae169c4…` / `6b56dba22fdb…` |
| owner-only/shared | 4 | unknown | 0 | `a68c3e1389a0…` |
| one-caller/shared | 4 | unknown (one gate fail at winner 0.79) | 1 | `13f7447eba17…` |
| empty/shared | 4 | unknown | 0 | `0926cbad7abf…` |
| reordered-sources shared/local | 4+4 | meets | 0 | `b85f1b78395b…` / `65ab62787c86…` |
| reordered-anchors shared-code/shared | 4 | meets | 0 | `01488a0b8108…` |
| reordered-anchors local-code/shared | 4 | contrary | 0 | `34deb44984a2…` |
| swapped-roles shared-code/shared | 4 | meets | 0 | `bd0f149c4ebe…` |
| swapped-roles local-code/local | 4 | meets | 0 | `f0ed35fed444…` |

**Distinct-rule evidence (this family only):** Stripe vs PayPal **vendor lifecycle** machines, not the publish/sample pair. Shared-policy raw mode is `contrary` with winner 0.45–0.66 (always below gate) and mass also on unknown (0.16–0.28) and not_applicable (0.11–0.22). Host selected `unknown` / unresolved. Local-policy is resolved meets (winner 0.96–0.99). This is **not** independent101 g4 (publish vs sample → not_applicable under mixed anchors). Do not pool them.

Sanitized distinct shared #1 raw: `choice=contrary confidence=0.46 probabilities contrary=0.57 unknown=0.21 not_applicable=0.16 meets=0.06`. Gate `{winnerProbability:0.57, margin:0.36, passed:false}` → selected unknown.

Analogous HTTP discrimination cells agree with first5 on **selected label**; request SHA and unknown/NA wire differ (v1 vs v2). first5 missing-evidence is **not** in this matrix (matrix uses `missing-notes`, `owner-only`, `one-caller`, `empty`).

This series is **provider behavior under preference-conditioned HTTP-map anchors**, not sealed-expectation accuracy for family B.

---

## independent101 (mixed two-policy anchors)

Schema `pulsar.jev_ownership_evaluation.receipts.v1`. Started `2026-09-18T08:51:08.958Z`, finished `08:51:12.455Z`, concurrency 4, 101 calls. Tokens **119632 in / 5886 out**. Latency min 77.1 / p50 123.3 / p90 197.1 / max 253.9 ms. Unique request SHA 45 (g7a≡g13 sources). Unique request ids 101.

Call-level vs sealed (repeats included, as the summary file does): **matches 69 / mismatches 32**. Status: resolved 53, unresolved 40, not_applicable 8. Mismatch kinds: status 25, anchor 7.

**Case-policy arms** = unique `(caseId, preference)` with `perturbation=none` → **41**. Primary r1 of those: **29 match / 12 mismatch**. These are not 41 independent source arrangements: g7a and g13 reuse bytes, and opposite policies share sources. Do not add repeats. Across none-pert repeats: 28 always-match, 12 always-mismatch, **1 mixed-across-repeats (g19 conflict)**.

Primary r1 mismatches (the 12 case-policy misses):

| id | preference | expected | actual | raw | gate | winner | kind |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| g1 | caller_local | meets | unresolved unknown | meets | fail | 0.74 | status |
| g2 | caller_local | contrary | resolved meets | meets | pass | 0.89 | anchor |
| g5 | caller_local | contrary | resolved meets | meets | pass | 0.89 | anchor |
| g6 | caller_local | meets | unresolved unknown | meets | fail | 0.50 | status |
| g7a | caller_local | meets | unresolved unknown | meets | fail | 0.72 | status |
| g11 | caller_local | unknown | resolved meets | meets | pass | 0.87 | status |
| g12 | shared | not_applicable | unresolved unknown | not_applicable | fail | 0.60 | status |
| g12 | caller_local | contrary | resolved meets | meets | pass | 0.91 | anchor |
| g13 | caller_local | meets | unresolved unknown | meets | fail | 0.61 | status |
| g14 | caller_local | meets | unresolved unknown | meets | fail | 0.48 | status |
| g15 | caller_local | meets | unresolved unknown | meets | fail | 0.54 | status |
| g16 | caller_local | meets | unresolved unknown | meets | fail | 0.74 | status |

Pattern: under mixed contrary/meets text, **caller_local on copies fails the gate** (raw still `meets`, winner ~0.48–0.74) and **caller_local on delegation false-meets** (winner ~0.89–0.91). Shared-policy copies/delegation/mixed/distinct-NA generally match. g12 shared is a near-NA (raw NA 0.60) that the gate refuses.

g2 caller_local repeats (same SHA `d205d8553f4647164549841f5a343f9400a15beacb45a801855e579e2f8bdb41`): r1/r2 resolved meets (0.89, 0.84); r3 unresolved unknown raw meets winner 0.77 — still a miss, not a new problem.

g19 conflict (SHA `7ed75381f426473c5ef6bc736f783410e75932898366e8fbf350a75117eafd0e`): r1 unresolved unknown raw contrary winner 0.79 (match by chance of the gate); r2/r3 resolved contrary winner 0.81/0.84 (mismatch). **Do not treat r1 as a stable pass.**

Anchor-order (6 calls) matched the corresponding r1 selected/status in every case (including the g1 local miss). Not 6 new problems.

Stretch g20/g21 both match (meets, not exceeds, on delegation; contrary on copies). Exceeds mass 0.

**Host arithmetic on these mixed-anchor labels is not accuracy.** Unique-case primary shared: applicability `insufficient_evidence`, observedAttainment **0**, histogram contrary 6 / meets 2 / mixed 2 / NA 3 / unresolved 6, comparison abstain. Unique-case primary local: `insufficient_evidence`, observedAttainment **0.5**, unresolved 10 / meets 7 / mixed 2, abstain. Those unresolved local ids include the gated copy misses (g1, g6, g7a, g13, g15, g16, …). Min still sees contrary/mixed if you only looked at resolved rows.

Sanitized 101 g1 caller_local raw: `choice=meets confidence=0.67 probabilities meets=0.74 contrary=0.25 unknown=0.01` → gate fail. g2 caller_local: `choice=meets confidence=0.85 meets=0.89 contrary=0.1` → gate pass, false meet. g4 shared: `choice=not_applicable confidence=0.88 not_applicable=0.9 meets=0.08` → NA match.

---

## independent20 (conditioned-anchor follow-up)

Schema `pulsar.jev_ownership_evaluation.followup.conditioned_anchors.v1`. Started `2026-09-18T08:53:55.468Z`, finished `08:53:56.401Z`. 20 calls = 5 arrangements × 2 policies × 2 repeats (g1, g2, g5, g13, g15). Tokens **24070 in / 1160 out**. Latency min 77.1 / max 505.0 ms. Unique SHA 10. **matches 20 / mismatches 0** (repeats included; 10 independent arms, all match both repeats).

| arrangement | shared | local |
| --- | --- | --- |
| identical-copies (g1) | contrary winner 0.99 | meets winner 1.00 |
| delegated-owner (g2) | meets winner 1.00 | **contrary winner 0.95–0.97** |
| extracted-owner (g5) | meets winner 1.00 | contrary winner 0.96 |
| three-site-copies (g13) | contrary winner 0.99 | meets winner 1.00 |
| role-tags-swapped (g15) | contrary winner 0.98 | meets winner 0.93–0.95 |

Finding in the summary file (verified against rows): preference-conditioned contrary/meets recover opposite-policy numbers that mixed wording lost. Copies become meets under caller_local (p=1.00) and contrary under shared (p=0.99). Delegation becomes contrary under caller_local instead of false meets.

Sanitized g1 local raw: `choice=meets confidence=0.99 meets=1.0`. g2 local raw: `choice=contrary confidence=0.95 contrary=0.97 meets=0.03`.

This follow-up does **not** re-run g3 mixed, g4 distinct, missing/ambiguous, conflict, or stretch. Do not generalize 20/20 beyond those five arrangements.

SHA examples: g1 shared `a81283bf86effd314b58953c50fa6ddd7359c6b3399380021253d0f0b2083f4e`; g1 local `9d6cf14f9412ebabefa01dbfa46b07d5c95fef70bc6ef5a36b1f93e5ad060d64`; g2 local `bcefe0950d028121e718d17dc516b73225019d774e9d49a312dcd6fb3c155811`.

---

## Distinct-rule evidence (two families, not pooled)

1. **HTTP-map vendor machines (provider112):** shared-policy gate-fail unknown, raw contrary (8 repeats, 1 SHA). Local-policy meets (8). Fixture: `distinctStripe` / `distinctPaypal` in `jev-ownership-live.ts`.
2. **Publish vs sample (independent101 g4/g17):** shared **not_applicable** (match, winner ~0.90); local meets. Order-reversed g17 same. This is the sealed “different obligation” case.

No provider12 confirmation series is in this workspace.

---

## CLI pilot1 and mutations9

### Pilot1

Artifact `.amp/in/artifacts/jev-ownership/pulsar-severity-pilot.json` (SHA `f9e968e5e50a24e90071779b543ef8e828ca5119fee40e095f0e48ec87393717`).

- selected **meets**, status resolved, dist meets=1, conf 1.00, gate pass winner 1 margin 1
- `requestSha256` `f22bee68f013ac6002ee73eb68fa5609cfb1face8425fe9e970a8bd6edeeba6a`
- `promptFingerprint` `9d3490efe3b2241ca4bbd4b39af0e1330ae631484e6a8bc11e03634703d47ee9`
- usage 5508 / 58, elapsed ~249 ms, `req_01a0b3b2a695745fac15b536f325b1b5`
- raw: `choice=meets confidence=1.0 meets=1.0`

**CLI judge** `.amp/in/artifacts/jev-ownership/pulsar-judge.json` (SHA `e357e75e4aac8fda0fd378c50f819eaeda8fded39fb2b754590e0bb131032575`): 1 planned, 1 completed, 0 failures. Receipts `.pulsar/ownership-runs/90b50608-468c-497e-a208-96eb4cb594a7`. Host aggregate applicability applicable, attainment 1, score 1, histogram meets 1. Usage 5508 / 58.

**That run is a second call, not the pilot JSON:** response `requestSha256` `beb2cff0b08dc72668ddb24ffceec92270a2525da2ac0a5155fa426b633a7f72` (file bytes of `00000.request.json` hash to the same), `req_01a0b3b695aa7212850ce5af4a275547`, conf 0.99, still meets p=1, elapsed ~224 ms. Same `promptFingerprint`. Do not count as a second independent problem.

Score artifact `pulsar-score.json` (SHA `6bf2a8eb562116b49ceddd6f58ee78dd1f8a7941d427bd7d2a5a74c5d8ec0abf`): tool 0.2.1 dirty at commit `4fc545cbe22217dc1b5f8c5828d933fff52428b3`. Signal `TS-SL-07-rule-ownership-alignment` applicability applicable, attainment 1, comparison `meets_target`, expected/assessed groups 1. Whole-repo readiness is separately blocked (14 hard-gate violations) — **not** an ownership miss.

Discover (`pulsar-discover.json`): 12 detector-proposed clone groups under `packages/cli/src/**`, `adopted=false`. Not the severity-authority group.

### Mutations9

3 copy-counts × 3 repeats = 9 calls. Same conditioned criteria / `promptFingerprint` as the pilot. Scripted inlining of `enforceSeverityCeiling` into caller bodies (~896 bytes each). **Not** an autonomous loop.

| copies | expected | n | selected | winner | conf | request SHA |
| ---: | --- | ---: | --- | --- | --- | --- |
| 0 | meets | 3 | meets p=1 | 1.00 | 0.99–1.00 | `4f8fe704aaa89c3faecc8e08f4edfe8d403611fcddc331092d598e3b55442d1a` |
| 1 (local copy in `runner.ts`) | mixed | 3 | mixed 0.83–0.85 | 0.83–0.85 | 0.78–0.81 | `3ef4363023c99752427927671022c4ebfeb39be89023757c47bc075097cfaa60` |
| 2 (also copy in `observer-execution.ts`) | contrary | 3 | contrary 0.98 | 0.98 | 0.97–0.98 | `c9f313a8765d55a4bf306f9ccb270f412f848839f04240675172bc90452d89f8` |

All 9 matched their scripted expected anchor. Repeats are not extra problems (3 independent copy-count conditions).

copies=0 SHA ≠ pilot SHA (`f22bee68…` vs `4f8fe704…`): same paths and roles, token counts 5508 vs 5507 — treat as a nearby but not byte-identical request; do not merge with pilot1.

---

## Requests to Jev / production (retained)

1. Ship **preference-conditioned** contrary/meets/mixed text. Mixed two-policy option strings destroy caller_local discrimination even when preference descriptions differ.
2. Do **not** bump `promptId` for rubric wording; compile already forwards anchors. Measured `promptId` stayed `pulsar.ownership.choice.v2` across mixed vs conditioned series; **promptFingerprint** changed with the anchors.
3. Filing tags are not proof of ownership (instruction + g15: swapped tags still contrary under shared, and with conditioned anchors still meet caller_local).
4. unknown vs not_applicable: thin notes / missing impl → unknown; distinct obligation with positive evidence → NA. v1 first5 missing-evidence NA at 0.61/0.39 is the old wording; v2 missing-notes is unknown p=1.
5. Host min-attainment: padding and extra healthy groups cannot raise a shortfall; unresolved abstains; NA is excluded; empty applicable is NA not 1; stretch clamps display score.
6. Distinct domain rules with similar shape are a different obligation, not a shared-rule violation — but the HTTP-map **vendor-lifecycle** pair under shared policy did **not** stably reach NA (gate-fail raw contrary). Publish-vs-sample did reach NA under family B. Those are different fixtures.
7. Stretch is positively evidenced extra work, not “no copies.”
8. Conflicting exclusive policies → unresolved, and even that is gate-unstable under mixed anchors (g19).
9. One declared real-repo group with conditioned anchors can meet; injecting local copies moves mixed then contrary. This is not whole-repo inventory completeness (discover still proposes many CLI clones; ownership.json says so).

---

## Limitations

- Research tests never executed Jev; they sealed fixtures, hygiene, and host arithmetic.
- independent101 accuracy is vs sealed labels **under adversarial mixed anchors**. independent20 accuracy is vs the same labels **under conditioned anchors**, on 5 arrangements only.
- provider112 has no sealed family-B labels; it is HTTP-map provider behavior.
- v1 first5 has no gate fields; do not back-apply the v2 gate.
- No provider12 confirmation receipts here.
- No autonomous refactor loop.
- Host scores computed from mixed-anchor 101 labels are not product accuracy.
- Discover ≠ judge inventory.
- Ignored artifacts remain the byte-level receipts; this Markdown is the tracked reconstruction.

---

## Retained executable coverage

The retired research commands and globs were removed from `package.json`. Production evaluator, judge, ownership facts, cache, discovery and signal tests remain in their package suites. The historical research test specifications above are documentation, not currently executed checks.
