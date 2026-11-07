# engine/Layers-LAWS.bend - laws for Layers.bend, the Effect layer-graph detectors.
# (The <Module>.LAWS.bend pair, spelled with a hyphen: a module path is plain
# names.) Filled in Layers-PROOF.bend; gate: `bend engine/Layers-PROOF.bend --verdict`.
#
# Every law is about the functions pulsar-layers runs: Layers.run and the
# detector functions it calls (Layers.req_graph, unprovided, dups, hubs). Each
# finding law says the fact lists support the finding (soundness), stated in
# terms of fact membership below, never in terms of the search that proposed it.
#
# What the relations mean is FACTS.md's ("Effect pack"). The words here:
#   - "l reaches m": a walk along LP facts, outer to inner, of any length.
#     Mode and pipe order are not read, so "reaches" over-approximates what a
#     composition can provide; that only removes unprovided findings.
#   - "provided at root r": some layer reached from a layer of an `LR r _` fact
#     builds the service (an LY fact), or the service has a default (SV kind 1).
#
# Not covered by any law, by design: Rows.bend and Layers.decode (bytes and
# rows to fact lists; shown against engine/fixtures/layers), and the formatting
# of numbers in Layers.lines.

import Base
import ../LAWS.bend as TL
import ../Graph.bend as G
import ./Layers.bend as Y

# ---- fact membership ---------------------------------------------------------------------------
# Some `LY l _ s` fact.
def LyHas(lys: List<&2, Y.Ly>, l: U32, s: U32) -> Data:
  match lys:
    case Nil{}:
      Empty
    case Con{Y.Ly{l2, f, s2}, t}:
      Either<&2, &2, TL.And({l2 == l : U32}, {s2 == s : U32}), LyHas(t, l, s)>

# Some `LQ l s` fact.
def LqHas(lqs: List<&2, Y.Lq>, l: U32, s: U32) -> Data:
  match lqs:
    case Nil{}:
      Empty
    case Con{Y.Lq{l2, s2}, t}:
      Either<&2, &2, TL.And({l2 == l : U32}, {s2 == s : U32}), LqHas(t, l, s)>

# Some `LP o i _` fact.
def LpHas(lps: List<&2, Y.Lp>, o: U32, i: U32) -> Data:
  match lps:
    case Nil{}:
      Empty
    case Con{Y.Lp{o2, i2, m}, t}:
      Either<&2, &2, TL.And({o2 == o : U32}, {i2 == i : U32}), LpHas(t, o, i)>

# Some `LR r l` fact.
def LrHas(lrs: List<&2, Y.Lr>, r: U32, l: U32) -> Data:
  match lrs:
    case Nil{}:
      Empty
    case Con{Y.Lr{r2, l2}, t}:
      Either<&2, &2, TL.And({r2 == r : U32}, {l2 == l : U32}), LrHas(t, r, l)>

# Some `SV s _ k` fact with k not 0 (the service has a default).
def SvDflt(svs: List<&2, Y.Sv>, s: U32) -> Data:
  match svs:
    case Nil{}:
      Empty
    case Con{Y.Sv{s2, f, k}, t}:
      Either<&2, &2, TL.And({s2 == s : U32}, {U32.is_eq(k, 0) == False{} : Bool}), SvDflt(t, s)>

# A walk of exactly k LP steps from u to v.
def LpWalk(lps: List<&2, Y.Lp>, k: Nat, u: U32, v: U32) -> Data:
  match k:
    case 0n:
      {u == v : U32}
    case 1n+p:
      TL.Ex(U32, w => TL.And(LpHas(lps, u, w), LpWalk(lps, p, w, v)))

# x is an element of the list (findings are lists of records).
def In(-A: Data, xs: List<&2, A>, x: A) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == x : A}, In(A, t, x)>

# ---- (1) effect/layer-cycle ---------------------------------------------------------------------
# The binary reports Graph.analyze(Layers.req_graph(lf)) (law E1), so the
# top-level laws G (sound), H (complete, under the run's certificate) and I
# (partition) are about the printed cycles of this graph. C1 says what an edge
# of that graph is in facts.

# C1. an edge u -> w means: u requires some service s, and w builds s.
law req_edge_sound:
  for +lf: Y.LF
  for +u: U32
  for +w: U32
  for hs: TL.Succ(Y.Layers.req_graph(lf), u, w)
  exs s: U32
  TL.And(LqHas(Y.LF.lqs(lf), u, s), LyHas(Y.LF.lys(lf), w, s))

# ---- (2) effect/unprovided ----------------------------------------------------------------------
# A reported `Uc{r, l, s, x, ws, sl}`: at run root r, layer l requires s; l is
# reached from x, a layer provided at r; and s is provided by nothing reached
# from any layer provided at r. U1-U5 split that; U3-U5 quantify over every
# reach, not over the search's set sl.

# U1. l requires s.
law unprovided_requires:
  for +lf: Y.LF
  for +r: U32
  for +l: U32
  for +s: U32
  for +x: U32
  for +ws: List<&2, U32>
  for +sl: List<&2, U32>
  for h: In(Y.Uc, Y.Layers.unprovided(lf), Y.Uc{r, l, s, x, ws, sl})
  LqHas(Y.LF.lqs(lf), l, s)

# U2. x is provided at r, and x reaches l.
law unprovided_rooted:
  for +lf: Y.LF
  for +r: U32
  for +l: U32
  for +s: U32
  for +x: U32
  for +ws: List<&2, U32>
  for +sl: List<&2, U32>
  for h: In(Y.Uc, Y.Layers.unprovided(lf), Y.Uc{r, l, s, x, ws, sl})
  TL.And(LrHas(Y.LF.lrs(lf), r, x), TL.Ex(Nat, k => LpWalk(Y.LF.lps(lf), k, x, l)))

# U3. no layer reached from any layer provided at r builds s.
law unprovided_no_builder:
  for +lf: Y.LF
  for +r: U32
  for +l: U32
  for +s: U32
  for +x: U32
  for +ws: List<&2, U32>
  for +sl: List<&2, U32>
  for h: In(Y.Uc, Y.Layers.unprovided(lf), Y.Uc{r, l, s, x, ws, sl})
  for +y: U32
  for hy: LrHas(Y.LF.lrs(lf), r, y)
  for +k: Nat
  for +m: U32
  for hw: LpWalk(Y.LF.lps(lf), k, y, m)
  for hb: LyHas(Y.LF.lys(lf), m, s)
  Empty

# U4. no layer reached from any layer provided at r is LO (unresolved).
law unprovided_no_opaque:
  for +lf: Y.LF
  for +r: U32
  for +l: U32
  for +s: U32
  for +x: U32
  for +ws: List<&2, U32>
  for +sl: List<&2, U32>
  for h: In(Y.Uc, Y.Layers.unprovided(lf), Y.Uc{r, l, s, x, ws, sl})
  for +y: U32
  for hy: LrHas(Y.LF.lrs(lf), r, y)
  for +k: Nat
  for +m: U32
  for hw: LpWalk(Y.LF.lps(lf), k, y, m)
  for ho: TL.Mem(Y.LF.los(lf), m)
  Empty

# U5. s has no default value (no SV fact of a non-zero kind).
law unprovided_no_default:
  for +lf: Y.LF
  for +r: U32
  for +l: U32
  for +s: U32
  for +x: U32
  for +ws: List<&2, U32>
  for +sl: List<&2, U32>
  for h: In(Y.Uc, Y.Layers.unprovided(lf), Y.Uc{r, l, s, x, ws, sl})
  for hd: SvDflt(Y.LF.svs(lf), s)
  Empty

# ---- (3) effect/duplicate-builder ---------------------------------------------------------------
# A reported `Dc{s, a, b, w, wa, wb}`: two distinct layers a < b both build s,
# and one layer w reaches both.

# D1. a and b are distinct, and both build s.
law dup_builders:
  for +lf: Y.LF
  for +s: U32
  for +a: U32
  for +b: U32
  for +w: U32
  for +wa: List<&2, U32>
  for +wb: List<&2, U32>
  for h: In(Y.Dc, Y.Layers.dups(lf), Y.Dc{s, a, b, w, wa, wb})
  TL.And({U32.is_lt(a, b) == True{} : Bool}, TL.And(LyHas(Y.LF.lys(lf), a, s), LyHas(Y.LF.lys(lf), b, s)))

# D2. w reaches a and w reaches b.
law dup_one_composition:
  for +lf: Y.LF
  for +s: U32
  for +a: U32
  for +b: U32
  for +w: U32
  for +wa: List<&2, U32>
  for +wb: List<&2, U32>
  for h: In(Y.Dc, Y.Layers.dups(lf), Y.Dc{s, a, b, w, wa, wb})
  TL.And(TL.Ex(Nat, k => LpWalk(Y.LF.lps(lf), k, w, a)), TL.Ex(Nat, k => LpWalk(Y.LF.lps(lf), k, w, b)))

# ---- (4) effect/hub-service ---------------------------------------------------------------------
# H1. a reported `Hub{s, k, a, b}`: a is the number of LQ facts naming s, b
# the number of US facts naming s whose function is in no LC fact (no layer's
# constructor; Hb.lc_set is exactly the LC functions by Scope-LAWS SC1-SC2),
# k = a + b, and k is at least the rule's threshold, Layers.hub_min(). Facts are
# deduplicated (Layers.valid refuses a relation that is not strictly ascending,
# law E2), so these counts are distinct layers and functions.
law hub_counts:
  for +lf: Y.LF
  for +s: U32
  for +k: U32
  for +a: U32
  for +b: U32
  for h: In(Y.Hub, Y.Layers.hubs(lf), Y.Hub{s, k, a, b})
  TL.And({a == U32.from_nat(TL.Count(Y.Hb.lq_ids(Y.LF.lqs(lf)), s)) : U32}, TL.And({b == U32.from_nat(TL.Count(Y.Hb.us_ids(Y.LF.uss(lf), Y.Hb.lc_set(Y.LF.lcs(lf))), s)) : U32}, TL.And({k == U32.add(a, b) : U32}, {U32.is_ge(k, Y.Layers.hub_min()) == True{} : Bool})))

# ---- the entry point -----------------------------------------------------------------------------
# E1. valid facts: the binary's result is exactly these detector functions.
law run_is_detectors:
  for +lf: Y.LF
  for ok: {Y.Layers.valid(lf) == True{} : Bool}
  {Y.Layers.run(lf) == Some{Y.LOut{Y.LF.nl(lf), Y.LF.ns(lf), G.Graph.edges(Y.Layers.req_graph(lf), 0), G.Graph.analyze(Y.Layers.req_graph(lf)), Y.Layers.unprovided(lf), Y.Layers.opaque(lf), Y.Layers.dups(lf), Y.Layers.hubs(lf)}} : Maybe<Y.LOut>}

# E2. invalid facts are refused, never analysed.
law run_refuses_invalid:
  for +lf: Y.LF
  for bad: {Y.Layers.valid(lf) == False{} : Bool}
  {Y.Layers.run(lf) == None{} : Maybe<Y.LOut>}

# E3. the printed lines are built from the result and nothing else: header,
# one LCYC per cycle, the certificate, LUNP, LOPQ, LDUP and LHUB lines, summary.
law lines_shape:
  for nl: U32
  for ns: U32
  for edges: U32
  for +cs: List<&2, List<&2, U32>>
  for ok: Bool
  for +us: List<&2, Y.Uc>
  for os: List<&2, Y.Opq>
  for +ds: List<&2, Y.Dc>
  for +hs: List<&2, Y.Hub>
  {Y.Layers.lines(Y.LOut{nl, ns, edges, G.Res{cs, ok}, us, os, ds, hs}) == Con{"pulsar-layers 0", List.append(&2, String, Y.LRep.cyc(cs), Con{Y.LRep.cert(ok), List.append(&2, String, Y.LRep.pre("LUNP ", Y.LRep.unp(us)), List.append(&2, String, Y.LRep.opq(os), List.append(&2, String, Y.LRep.pre("LDUP ", Y.LRep.dup(ds)), List.append(&2, String, Y.LRep.hub(hs), Con{Y.LRep.summary(nl, ns, edges, cs, us, ds, hs), Nil{}}))))})} : List<&2, String>}
