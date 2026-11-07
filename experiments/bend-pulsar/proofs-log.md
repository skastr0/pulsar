# proofs-log

Gate: `bend PROOF.bend` and `bend PROOF.bend --verdict` (Lean 4.34 kernel). Both print ALL PROOFS CHECK, exit 0.

## Design: translation validation
Tarjan (`Graph.sccs`) and the certificate search (BFS in `Graph.find`) are untrusted and unproven.
Only the checkers are proven: `Graph.cert_ok`, `Graph.mono_ok`, `Graph.part_rows` (+ `all_cert`).
- G `cycles_sound`: unconditional. `Graph.cycles` keeps a candidate only if `Graph.certified` accepts it.
- H `cycles_complete`: conditional on `Graph.verified(adj) == True`.
- I `sccs_partition`: conditional on `Graph.part_ok(adj) == True`.
Not proven: that Tarjan/BFS always make the checkers accept (liveness). Empirically they do on both
corpora and all fixtures. A caller must treat `Graph.analyze(..).ok == False` as an internal error.

## Round 1: soundness (certificate route)
cert = for each member v of component c (root r = head): walk r ->+ v and v ->+ r. Proof: Path1/Path0 sound,
Walk.cat, Reach.trans, Members.sound, Cert.sound, Keep.sound (Lemmas.bend).
## Round 2: completeness
Component number = index in `sccs` list (Tarjan emits sinks first, list is latest-first, so numbers never
decrease along an edge). `Graph.ids` numbers nodes in a bitwise trie `Tr` (`Tr.get/put`); `mono_ok` checks
every edge. Proof: Put.sound, Ic/Ids.sound, Mono.sound (needs U32 from_nat/to_nat round trip, Nat2.bend),
Walk.lei, Same.of, Cand.is (singleton case: self edge derived), Cand.mem (insertion sorts keep members),
KeepCert.mem (Lemmas2.bend). Candidates were rewritten proof-friendly (`is_cand`, `keep_cand`, insertion
sorts instead of Base List.sort; output order unchanged: components are disjoint so the order is total).
## Round 3: partition
Tally trie (`cnt_all`), check each position has tally 1. Proof: Put.eq, Put.ne, Cnt.sound, Part.sound (Lemmas3.bend).

## Spec edits in LAWS.bend (declared in the report)
- Mem/MemL/Succ/Walk/Reach1 are Data-kinded (reusable); Walk is "exactly k edges" (Reach1 equivalent).
- G: `wf` hypothesis dropped (not needed).
- H: added hypothesis `verified(adj) == True`; conclusion uses And.
- I: added hypothesis `part_ok(adj) == True`; quantifies over positions p < length (U32.from_nat p) instead of
  U32 i below a bound, so no wrap-around arithmetic is needed. Distinctness of from_nat(p) for p < 2^32 is not proven.

## Proof-tooling lessons
Proofs are affine (`+x` on Data binders). `A & B` (Sigma<&1,&1>) is not Data; use And/Ex with &2.
`match` cannot scrutinize a computed value: pass it to a helper def. No mutual recursion: pass the
recursive result into the helper (as a lambda or a computed proof argument). Rewrite `%e : P`: `_` marks e's
right-hand side, so most rewrites need `Equal.sym`. Termination reads args left to right: put the shrinking
argument first.

## Negative controls (scratch copies, gate and --verdict both fail, exit 1)
G: path1 accepts empty walk; member_ok drops the `down` check; cert_ok always True.
H: le_ok always True; mono_ok skips rows; edge test reversed (is_ge); ids never increments k; candidate rule drops
multi-node components; singleton reported without self-edge check.
I: tally check is_le instead of is_eq; part_rows skips nodes; tally always writes 1.
Behavioural (Tarjan broken, gtest): drop first component -> NOT VERIFIED; merge all into one component -> no
false cycle reported, NOT VERIFIED; split into singletons -> NOT VERIFIED.

## Integration
`main.analyze.diff`: switches main.bend to `G.Graph.analyze` and prints `certificates: verified|NOT VERIFIED`
to stderr. main.bend is not mine; unmodified main.bend still builds and calls `Graph.cycles` (sound, but the
verdict is not surfaced).
