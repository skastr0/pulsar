# Layers.bend - the Effect pack's service and layer graph detectors (pure core).
#
# Framework-specific (Effect pack), switched on by the pack's facts. Input is
# the pack's relations (FACTS.md, "Effect pack"):
#   E  nl ns nr          header: layer, service and run-root counts
#   SV svc file kind     a service; kind 1 has a default, so it is always provided
#   LY layer file svc    layer builds svc
#   LQ layer svc         layer's constructor requires svc
#   LP outer inner mode  inner is a constituent of outer (mode is not read)
#   LR root layer        layer is provided at run root `root`
#   LC layer fn          fn is the constructor body of layer
#   LO layer             the adapter could not fully resolve the layer
#   US fn svc            fn yield*s svc
# Detectors (each a rule id in the CLI side table):
#   (1) effect.layer-cycle        cycles of "layer A requires a service layer B builds"
#   (2) effect.unprovided-service         a requirement of a layer reachable from a run root
#                                 that no layer reachable from that root builds
#   (3) effect.duplicate-builder  a service built by two layers reachable from one layer
#   (4) effect.hub-service        fan-in (LQ layers + US fns that are not constructors)
#                                 at or above Layers.hub_min()
#
# Every detector is "untrusted search, proven check": the search proposes
# candidates with their evidence (walks, the reachable set), and a Bool checker,
# the only code the soundness laws read, keeps a candidate only if the facts
# support it. Laws: Layers-LAWS.bend, proofs: Layers-PROOF.bend.
#
# "Reachable" ignores LP's mode and the order of a pipe: it is plain reachability
# along LP, outer to inner. That over-approximates what a composition provides,
# so (2) can only miss a finding, never invent one.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./Rows.bend as W

type Sv is Data:
  Sv{s: U32, f: U32, k: U32}

type Ly is Data:
  Ly{l: U32, f: U32, s: U32}

type Lq is Data:
  Lq{l: U32, s: U32}

type Lp is Data:
  Lp{o: U32, i: U32, m: U32}

type Lr is Data:
  Lr{r: U32, l: U32}

type Lc is Data:
  Lc{l: U32, f: U32}

type Us is Data:
  Us{f: U32, s: U32}

type LF is Data:
  LF{nl: U32, ns: U32, nr: U32, svs: List<&2, Sv>, lys: List<&2, Ly>, lqs: List<&2, Lq>, lps: List<&2, Lp>, lrs: List<&2, Lr>, lcs: List<&2, Lc>, los: List<&2, U32>, uss: List<&2, Us>}

type Ce is Data:
  Ce{w: U32, s: U32}
type Pe is Data:
  Pe{x: U32, v: U32, ws: List<&2, U32>}
type BS is Data:
  BS{seen: G.Tr, front: List<&2, Pe>, all: List<&2, Pe>}
type Uc is Data:
  Uc{r: U32, l: U32, s: U32, x: U32, ws: List<&2, U32>, sl: List<&2, U32>}
type RootR is Data:
  RootR{cs: List<&2, Uc>, op: List<&2, Opq>}
type Dc is Data:
  Dc{s: U32, a: U32, b: U32, w: U32, wa: List<&2, U32>, wb: List<&2, U32>}
type Bd is Data:
  Bd{s: U32, m: U32, ws: List<&2, U32>}
type LOut is Data:
  LOut{nl: U32, ns: U32, edges: U32, res: G.Res, unp: List<&2, Uc>, opq: List<&2, Opq>, dups: List<&2, Dc>, hubs: List<&2, Hub>}
type LD is Data:
  LD{bad: U32, e: U32, f: LF}
def LF.nl(lf: LF) -> U32:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      nl

def LF.ns(lf: LF) -> U32:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      ns

def LF.nr(lf: LF) -> U32:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      nr

def LF.svs(lf: LF) -> List<&2, Sv>:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      svs

def LF.lys(lf: LF) -> List<&2, Ly>:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      lys

def LF.lqs(lf: LF) -> List<&2, Lq>:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      lqs

def LF.lps(lf: LF) -> List<&2, Lp>:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      lps

def LF.lrs(lf: LF) -> List<&2, Lr>:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      lrs

def LF.lcs(lf: LF) -> List<&2, Lc>:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      lcs

def LF.los(lf: LF) -> List<&2, U32>:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      los

def LF.uss(lf: LF) -> List<&2, Us>:
  match lf:
    case LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      uss

# ---- relation tests (what the checkers ask of the facts) ------------------------------------
# Some LY fact says layer l builds svc s (from any file).
def Ly.has(lys: List<&2, Ly>, +l: U32, +s: U32) -> Bool:
  match lys:
    case Nil{}:
      False{}
    case Con{Ly{l2, f, s2}, t}:
      Bool.or(Bool.and(U32.is_eq(l2, l), U32.is_eq(s2, s)), Ly.has(t, l, s))

def Lq.has(lqs: List<&2, Lq>, +l: U32, +s: U32) -> Bool:
  match lqs:
    case Nil{}:
      False{}
    case Con{Lq{l2, s2}, t}:
      Bool.or(Bool.and(U32.is_eq(l2, l), U32.is_eq(s2, s)), Lq.has(t, l, s))

# Some LP fact makes i a constituent of o.
def Lp.has(lps: List<&2, Lp>, +o: U32, +i: U32) -> Bool:
  match lps:
    case Nil{}:
      False{}
    case Con{Lp{o2, i2, m}, t}:
      Bool.or(Bool.and(U32.is_eq(o2, o), U32.is_eq(i2, i)), Lp.has(t, o, i))

def Lr.has(lrs: List<&2, Lr>, +r: U32, +l: U32) -> Bool:
  match lrs:
    case Nil{}:
      False{}
    case Con{Lr{r2, l2}, t}:
      Bool.or(Bool.and(U32.is_eq(r2, r), U32.is_eq(l2, l)), Lr.has(t, r, l))

def Lo.has(los: List<&2, U32>, +l: U32) -> Bool:
  G.Graph.mem(los, l)

# svc s has an SV fact with a non-zero kind (a default value).
def Sv.dflt(svs: List<&2, Sv>, +s: U32) -> Bool:
  match svs:
    case Nil{}:
      False{}
    case Con{Sv{s2, f, k}, t}:
      Bool.or(Bool.and(U32.is_eq(s2, s), Bool.not(U32.is_eq(k, 0))), Sv.dflt(t, s))

# fn f is some layer's constructor body.
def Lc.has_fn(lcs: List<&2, Lc>, +f: U32) -> Bool:
  match lcs:
    case Nil{}:
      False{}
    case Con{Lc{l, f2}, t}:
      Bool.or(U32.is_eq(f2, f), Lc.has_fn(t, f))

# ws is a walk along LP from u to v (no step when ws is empty and u is v).
def Lp.path0(ws: List<&2, U32>, +lps: List<&2, Lp>, u: U32, +v: U32) -> Bool:
  match ws:
    case Nil{}:
      U32.is_eq(u, v)
    case Con{+w, t}:
      Bool.and(Lp.has(lps, u, w), Lp.path0(t, lps, w, v))

def Layers.push_u(c: Bool, x: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Layers.iota(fuel: Nat, +x: U32) -> List<&2, U32>:
  match fuel:
    case 0n:
      Nil{}
    case 1n+p:
      Con{x, Layers.iota(p, U32.inc(x))}

def Rq.push(c: Bool, x: Ce, acc: List<&2, Ce>) -> List<&2, Ce>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# ---- (1) the layer requirement graph ----------------------------------------------------------
# Node = layer. Edge u -> w when u requires a service that w builds. The row of
# u is proposed with a witness service per target (untrusted) and then checked.

def Rq.builders(lys: List<&2, Ly>, +s: U32, acc: List<&2, Ce>) -> List<&2, Ce>:
  match lys:
    case Nil{}:
      acc
    case Con{Ly{+w, f, s2}, t}:
      Rq.builders(t, s, Rq.push(U32.is_eq(s2, s), Ce{w, s}, acc))

def Rq.cands2(c: Bool, +lys: List<&2, Ly>, +s: U32, acc: List<&2, Ce>) -> List<&2, Ce>:
  match c:
    case True{}:
      Rq.builders(lys, s, acc)
    case False{}:
      acc

def Rq.cands(lqs: List<&2, Lq>, +x: U32, +lys: List<&2, Ly>, acc: List<&2, Ce>) -> List<&2, Ce>:
  match lqs:
    case Nil{}:
      acc
    case Con{Lq{l, +s}, t}:
      Rq.cands(t, x, lys, Rq.cands2(U32.is_eq(l, x), lys, s, acc))

# Insert by target, keeping the first witness for a target.
def Rq.ins_k(c: Cmp, x: Ce, h: Ce, t: List<&2, Ce>, r: List<&2, Ce>) -> List<&2, Ce>:
  match c:
    case LT{}:
      Con{x, Con{h, t}}
    case EQ{}:
      Con{h, t}
    case GT{}:
      Con{h, r}

def Rq.w(c: Ce) -> U32:
  match c:
    case Ce{w, s}:
      w

def Rq.ins(xs: List<&2, Ce>, +x: Ce) -> List<&2, Ce>:
  match xs:
    case Nil{}:
      Con{x, Nil{}}
    case Con{+h, +t}:
      Rq.ins_k(U32.cmp(Rq.w(x), Rq.w(h)), x, h, t, Rq.ins(t, x))

def Rq.sort(xs: List<&2, Ce>) -> List<&2, Ce>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Rq.ins(Rq.sort(t), h)

# The checker: x requires s and w builds s.
def Rq.check(+lqs: List<&2, Lq>, +lys: List<&2, Ly>, +x: U32, +w: U32, +s: U32) -> Bool:
  Bool.and(Lq.has(lqs, x, s), Ly.has(lys, w, s))

def Rq.keep(cs: List<&2, Ce>, +lqs: List<&2, Lq>, +lys: List<&2, Ly>, +x: U32) -> List<&2, U32>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{Ce{+w, +s}, t}:
      Layers.push_u(Rq.check(lqs, lys, x, w, s), w, Rq.keep(t, lqs, lys, x))

def Rq.row(+lqs: List<&2, Lq>, +lys: List<&2, Ly>, +x: U32) -> List<&2, U32>:
  Rq.keep(Rq.sort(Rq.cands(lqs, x, lys, Nil{})), lqs, lys, x)

# Rows for layers x, x+1, ...: the row at position p belongs to layer x+p.
def Rq.rows(fuel: Nat, +x: U32, +lqs: List<&2, Lq>, +lys: List<&2, Ly>) -> List<&2, List<&2, U32>>:
  match fuel:
    case 0n:
      Nil{}
    case 1n+p:
      Con{Rq.row(lqs, lys, x), Rq.rows(p, U32.inc(x), lqs, lys)}

def Layers.req_graph(+lf: LF) -> List<&2, List<&2, U32>>:
  Rq.rows(U32.to_nat(LF.nl(lf)), 0, LF.lqs(lf), LF.lys(lf))

# ---- reachability along LP (untrusted search) -----------------------------------------------
def Lp.row(lps: List<&2, Lp>, +x: U32) -> List<&2, U32>:
  match lps:
    case Nil{}:
      Nil{}
    case Con{Lp{o, i, m}, t}:
      Layers.push_u(U32.is_eq(o, x), i, Lp.row(t, x))

def Lp.rows(fuel: Nat, +x: U32, +lps: List<&2, Lp>) -> List<&2, List<&2, U32>>:
  match fuel:
    case 0n:
      Nil{}
    case 1n+p:
      Con{Lp.row(lps, x), Lp.rows(p, U32.inc(x), lps)}

# v was reached from start x along the walk ws.


def Bf.add2(hit: Bool, +seen: G.Tr, front: List<&2, Pe>, all: List<&2, Pe>, +x: U32, +w: U32, +ws: List<&2, U32>) -> BS:
  match hit:
    case True{}:
      BS{seen, front, all}
    case False{}:
      BS{G.Tr.putu(seen, w, 0n), Con{Pe{x, w, ws}, front}, Con{Pe{x, w, ws}, all}}

def Bf.add(+x: U32, +w: U32, ws: List<&2, U32>, b: BS) -> BS:
  match b:
    case BS{+seen, front, all}:
      Bf.add2(S.Scope.has(seen, w), seen, front, all, x, w, ws)

def Bf.visit(ns: List<&2, U32>, +x: U32, +ws: List<&2, U32>, b: BS) -> BS:
  match ns:
    case Nil{}:
      b
    case Con{+w, t}:
      Bf.visit(t, x, ws, Bf.add(x, w, List.append(&2, U32, ws, Con{w, Nil{}}), b))

def Bf.round(front: List<&2, Pe>, +adj: List<&2, List<&2, U32>>, b: BS) -> BS:
  match front:
    case Nil{}:
      b
    case Con{Pe{+x, +v, +ws}, t}:
      Bf.round(t, adj, Bf.visit(G.Graph.nth(adj, U32.to_nat(v)), x, ws, b))

def Bf.step(+adj: List<&2, List<&2, U32>>, b: BS) -> BS:
  match b:
    case BS{seen, front, all}:
      Bf.round(List.reverse(&2, Pe, front), adj, BS{seen, Nil{}, all})

def Bf.run(fuel: Nat, +adj: List<&2, List<&2, U32>>, b: BS) -> BS:
  match fuel:
    case 0n:
      b
    case 1n+p:
      Bf.run(p, adj, Bf.step(adj, b))

def Bf.starts2(c: Bool, +l: U32, b: BS) -> BS:
  match c:
    case True{}:
      Bf.add(l, l, Nil{}, b)
    case False{}:
      b

def Bf.starts(lrs: List<&2, Lr>, +r: U32, b: BS) -> BS:
  match lrs:
    case Nil{}:
      b
    case Con{Lr{r2, +l}, t}:
      Bf.starts(t, r, Bf.starts2(U32.is_eq(r2, r), l, b))

def Bf.empty() -> BS:
  BS{G.TE{}, Nil{}, Nil{}}

def Bf.seen(b: BS) -> G.Tr:
  match b:
    case BS{seen, front, all}:
      seen

def Bf.all(b: BS) -> List<&2, Pe>:
  match b:
    case BS{seen, front, all}:
      List.reverse(&2, Pe, all)

def Pe.vs(ps: List<&2, Pe>) -> List<&2, U32>:
  match ps:
    case Nil{}:
      Nil{}
    case Con{Pe{x, v, ws}, t}:
      Con{v, Pe.vs(t)}

# ---- (2) unprovided requirements --------------------------------------------------------------
# A candidate: at root r, layer l (reached from x, a layer provided at r, along
# ws) requires s. sl is the claimed reachable set of the root.

# Every layer provided at r is in the set t.
def Un.starts_in(lrs: List<&2, Lr>, +r: U32, +t: G.Tr) -> Bool:
  match lrs:
    case Nil{}:
      True{}
    case Con{Lr{r2, l}, rest}:
      Bool.and(Bool.or(Bool.not(U32.is_eq(r2, r)), S.Scope.has(t, l)), Un.starts_in(rest, r, t))

# t is closed under LP: a constituent of a member is a member.
def Un.closed(lps: List<&2, Lp>, +t: G.Tr) -> Bool:
  match lps:
    case Nil{}:
      True{}
    case Con{Lp{o, i, m}, rest}:
      Bool.and(Bool.or(Bool.not(S.Scope.has(t, o)), S.Scope.has(t, i)), Un.closed(rest, t))

def Un.none_build(sl: List<&2, U32>, +lys: List<&2, Ly>, +s: U32) -> Bool:
  match sl:
    case Nil{}:
      True{}
    case Con{+m, t}:
      Bool.and(Bool.not(Ly.has(lys, m, s)), Un.none_build(t, lys, s))

def Un.none_opaque(sl: List<&2, U32>, +los: List<&2, U32>) -> Bool:
  match sl:
    case Nil{}:
      True{}
    case Con{+m, t}:
      Bool.and(Bool.not(Lo.has(los, m)), Un.none_opaque(t, los))

# The checker. The set part (starts_in, closed) makes sl contain everything
# reachable from the root, so none_build and none_opaque speak for all of it.
def Un.check(+lf: LF, c: Uc) -> Bool:
  match c:
    case Uc{+r, +l, +s, +x, ws, +sl}:
      Bool.and(Bool.and(Lq.has(LF.lqs(lf), l, s), Bool.and(Lr.has(LF.lrs(lf), r, x), Lp.path0(ws, LF.lps(lf), x, l))), Bool.and(Bool.and(Un.starts_in(LF.lrs(lf), r, S.Scope.set(sl)), Un.closed(LF.lps(lf), S.Scope.set(sl))), Bool.and(Bool.and(Un.none_build(sl, LF.lys(lf), s), Un.none_opaque(sl, LF.los(lf))), Bool.not(Sv.dflt(LF.svs(lf), s)))))

def Un.push(c: Bool, x: Uc, acc: List<&2, Uc>) -> List<&2, Uc>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Un.keep(cs: List<&2, Uc>, +lf: LF) -> List<&2, Uc>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{+c, t}:
      Un.push(Un.check(lf, c), c, Un.keep(t, lf))

def Un.built2(c: Bool, s: U32, acc: G.Tr) -> G.Tr:
  match c:
    case True{}:
      G.Tr.putu(acc, s, 0n)
    case False{}:
      acc

# Services some reached layer builds (untrusted shortcut for the search).
def Un.built(lys: List<&2, Ly>, +seen: G.Tr, acc: G.Tr) -> G.Tr:
  match lys:
    case Nil{}:
      acc
    case Con{Ly{m, f, +s}, t}:
      Un.built(t, seen, Un.built2(S.Scope.has(seen, m), s, acc))

def Un.reqs2(c: Bool, r: U32, l: U32, s: U32, p: Pe, sl: List<&2, U32>, acc: List<&2, Uc>) -> List<&2, Uc>:
  match c p:
    case True{} Pe{x, v, ws}:
      Con{Uc{r, l, s, x, ws, sl}, acc}
    case False{} _:
      acc

def Pe.v(p: Pe) -> U32:
  match p:
    case Pe{x, v, ws}:
      v

def Un.reqs(lqs: List<&2, Lq>, +lf: LF, +r: U32, +bt: G.Tr, +p: Pe, +sl: List<&2, U32>, acc: List<&2, Uc>) -> List<&2, Uc>:
  match lqs:
    case Nil{}:
      acc
    case Con{Lq{+l, +s}, t}:
      Un.reqs(t, lf, r, bt, p, sl, Un.reqs2(Bool.and(U32.is_eq(l, Pe.v(p)), Bool.and(Bool.not(S.Scope.has(bt, s)), Bool.not(Sv.dflt(LF.svs(lf), s)))), r, l, s, p, sl, acc))

def Un.per(ps: List<&2, Pe>, +lf: LF, +r: U32, +bt: G.Tr, +sl: List<&2, U32>, acc: List<&2, Uc>) -> List<&2, Uc>:
  match ps:
    case Nil{}:
      acc
    case Con{+p, t}:
      Un.per(t, lf, r, bt, sl, Un.reqs(LF.lqs(lf), lf, r, bt, p, sl, acc))

def Un.min2(c: Bool, m: U32, best: U32) -> U32:
  match c:
    case True{}:
      m
    case False{}:
      best

type Opq is Data:
  Opq{r: U32, l: U32}

def Un.min_if(c: Bool, +m: U32, +best: U32) -> U32:
  match c:
    case True{}:
      Un.min2(U32.is_lt(m, best), m, best)
    case False{}:
      best

# A root that reaches an LO layer: its smallest such layer, or 4294967295.
def Un.first_lo(sl: List<&2, U32>, +los: List<&2, U32>, best: U32) -> U32:
  match sl:
    case Nil{}:
      best
    case Con{+m, t}:
      Un.first_lo(t, los, Un.min_if(Lo.has(los, m), m, best))

def Un.root4(c: Bool, +o: U32, +lf: LF, +r: U32, +b: BS, +sl: List<&2, U32>) -> RootR:
  match c:
    case True{}:
      RootR{Un.per(Bf.all(b), lf, r, Un.built(LF.lys(lf), Bf.seen(b), G.TE{}), sl, Nil{}), Nil{}}
    case False{}:
      RootR{Nil{}, Con{Opq{r, o}, Nil{}}}

# Candidates and the opaque note of one root, from its reach search.

def Un.root3(+o: U32, +lf: LF, +r: U32, +b: BS, +sl: List<&2, U32>) -> RootR:
  Un.root4(U32.is_eq(o, 4294967295), o, lf, r, b, sl)

def Un.root2(+lf: LF, +r: U32, +b: BS) -> RootR:
  Un.root3(Un.first_lo(Pe.vs(Bf.all(b)), LF.los(lf), 4294967295), lf, r, b, Pe.vs(Bf.all(b)))

def Un.root(+lf: LF, +adj: List<&2, List<&2, U32>>, +r: U32) -> RootR:
  Un.root2(lf, r, Bf.run(U32.to_nat(U32.inc(LF.nl(lf))), adj, Bf.starts(LF.lrs(lf), r, Bf.empty())))

type UR is Data:
  UR{cs: List<&2, Uc>, op: List<&2, Opq>}

def Layers.lt2(+a: U32, b: U32, +c: U32, d: U32) -> Bool:
  Bool.or(U32.is_lt(a, c), Bool.and(U32.is_eq(a, c), U32.is_lt(b, d)))

# Within a root, order by (layer, svc).
def Un.key_lt(a: Uc, b: Uc) -> Bool:
  match a b:
    case Uc{r, l, s, x, ws, sl} Uc{r2, l2, s2, x2, ws2, sl2}:
      Layers.lt2(l, s, l2, s2)

def Un.ins_k(c: Bool, x: Uc, h: Uc, t: List<&2, Uc>, r: List<&2, Uc>) -> List<&2, Uc>:
  match c:
    case True{}:
      Con{x, Con{h, t}}
    case False{}:
      Con{h, r}

def Un.ins(xs: List<&2, Uc>, +x: Uc) -> List<&2, Uc>:
  match xs:
    case Nil{}:
      Con{x, Nil{}}
    case Con{+h, +t}:
      Un.ins_k(Un.key_lt(x, h), x, h, t, Un.ins(t, x))

def Un.sort(xs: List<&2, Uc>) -> List<&2, Uc>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Un.ins(Un.sort(t), h)

def Un.join(a: RootR, b: UR) -> UR:
  match a b:
    case RootR{cs, op} UR{cs2, op2}:
      UR{List.append(&2, Uc, cs2, Un.sort(cs)), List.append(&2, Opq, op2, op)}

def Un.roots(rs: List<&2, U32>, +lf: LF, +adj: List<&2, List<&2, U32>>, acc: UR) -> UR:
  match rs:
    case Nil{}:
      acc
    case Con{+r, t}:
      Un.roots(t, lf, adj, Un.join(Un.root(lf, adj, r), acc))

def Layers.lp_adj(+lf: LF) -> List<&2, List<&2, U32>>:
  Lp.rows(U32.to_nat(LF.nl(lf)), 0, LF.lps(lf))

def Layers.unprovided_search(+lf: LF) -> UR:
  Un.roots(Layers.iota(U32.to_nat(LF.nr(lf)), 0), lf, Layers.lp_adj(lf), UR{Nil{}, Nil{}})

def UR.cs(u: UR) -> List<&2, Uc>:
  match u:
    case UR{cs, op}:
      cs

def UR.op(u: UR) -> List<&2, Opq>:
  match u:
    case UR{cs, op}:
      op

# Reported unprovided requirements: the search's candidates that pass Un.check.
def Layers.unprovided(+lf: LF) -> List<&2, Uc>:
  Un.keep(UR.cs(Layers.unprovided_search(lf)), lf)

# Roots skipped because they reach an LO layer (a visibility note, not a finding).
def Layers.opaque(+lf: LF) -> List<&2, Opq>:
  UR.op(Layers.unprovided_search(lf))

# ---- (3) a service built twice in one composition ------------------------------------------------
# Layers a < b both build s, and both are reachable from layer w (wa, wb).

def Du.check(+lf: LF, c: Dc) -> Bool:
  match c:
    case Dc{+s, +a, +b, +w, wa, wb}:
      Bool.and(Bool.and(U32.is_lt(a, b), Bool.and(Ly.has(LF.lys(lf), a, s), Ly.has(LF.lys(lf), b, s))), Bool.and(Lp.path0(wa, LF.lps(lf), w, a), Lp.path0(wb, LF.lps(lf), w, b)))

def Du.push(c: Bool, x: Dc, acc: List<&2, Dc>) -> List<&2, Dc>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Du.keep(cs: List<&2, Dc>, +lf: LF) -> List<&2, Dc>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{+c, t}:
      Du.push(Du.check(lf, c), c, Du.keep(t, lf))

def Du.path2(c: Bool, a: List<&2, U32>, b: List<&2, U32>) -> List<&2, U32>:
  match c:
    case True{}:
      a
    case False{}:
      b

# A builder reached from the top: service, layer and walk.

def Du.path_to(ps: List<&2, Pe>, +m: U32) -> List<&2, U32>:
  match ps:
    case Nil{}:
      Nil{}
    case Con{Pe{x, v, ws}, t}:
      Du.path2(U32.is_eq(v, m), ws, Du.path_to(t, m))

def Du.bds2(c: Bool, s: U32, +m: U32, +ps: List<&2, Pe>, acc: List<&2, Bd>) -> List<&2, Bd>:
  match c:
    case True{}:
      Con{Bd{s, m, Du.path_to(ps, m)}, acc}
    case False{}:
      acc

def Du.bds(lys: List<&2, Ly>, +seen: G.Tr, +ps: List<&2, Pe>, acc: List<&2, Bd>) -> List<&2, Bd>:
  match lys:
    case Nil{}:
      acc
    case Con{Ly{+m, f, s}, t}:
      Du.bds(t, seen, ps, Du.bds2(S.Scope.has(seen, m), s, m, ps, acc))

def Bd.lt(a: Bd, b: Bd) -> Bool:
  match a b:
    case Bd{s, m, ws} Bd{s2, m2, ws2}:
      Layers.lt2(s, m, s2, m2)

def Bd.ins_k(c: Bool, x: Bd, h: Bd, t: List<&2, Bd>, r: List<&2, Bd>) -> List<&2, Bd>:
  match c:
    case True{}:
      Con{x, Con{h, t}}
    case False{}:
      Con{h, r}

def Bd.ins(xs: List<&2, Bd>, +x: Bd) -> List<&2, Bd>:
  match xs:
    case Nil{}:
      Con{x, Nil{}}
    case Con{+h, +t}:
      Bd.ins_k(Bd.lt(x, h), x, h, t, Bd.ins(t, x))

def Bd.sort(xs: List<&2, Bd>) -> List<&2, Bd>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Bd.ins(Bd.sort(t), h)

def Bd.same(a: Bd, b: Bd) -> Bool:
  match a b:
    case Bd{s, m, ws} Bd{s2, m2, ws2}:
      U32.is_eq(s, s2)

def Du.mk(w: U32, a: Bd, b: Bd) -> Dc:
  match a b:
    case Bd{s, m, ws} Bd{s2, m2, ws2}:
      Dc{s, m, m2, w, ws, ws2}

def Du.nfirst(c: Bool, a: Bd, b: Bd) -> Bd:
  match c:
    case True{}:
      a
    case False{}:
      b

def Du.nacc(c: Bool, w: U32, a: Bd, b: Bd, acc: List<&2, Dc>) -> List<&2, Dc>:
  match c:
    case True{}:
      Con{Du.mk(w, a, b), acc}
    case False{}:
      acc

# Sorted builders: pair the first builder of each service with every later one.
def Du.pairs(bs: List<&2, Bd>, +w: U32, +first: Bd, acc: List<&2, Dc>) -> List<&2, Dc>:
  match bs:
    case Nil{}:
      acc
    case Con{+h, t}:
      +c = Bd.same(first, h)
      Du.pairs(t, w, Du.nfirst(c, first, h), Du.nacc(c, w, first, h, acc))

def Du.pairs0(bs: List<&2, Bd>, +w: U32) -> List<&2, Dc>:
  match bs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Du.pairs(t, w, h, Nil{})

# Layers that compose others and are no layer's constituent.
def Du.inner(lps: List<&2, Lp>, +x: U32) -> Bool:
  match lps:
    case Nil{}:
      False{}
    case Con{Lp{o, i, m}, t}:
      Bool.or(U32.is_eq(i, x), Du.inner(t, x))

def Du.outer(lps: List<&2, Lp>, +x: U32) -> Bool:
  match lps:
    case Nil{}:
      False{}
    case Con{Lp{o, i, m}, t}:
      Bool.or(U32.is_eq(o, x), Du.outer(t, x))

def Du.top3(+lf: LF, +w: U32, +b: BS) -> List<&2, Dc>:
  Du.pairs0(Bd.sort(Du.bds(LF.lys(lf), Bf.seen(b), Bf.all(b), Nil{})), w)

def Du.top2(c: Bool, +lf: LF, +adj: List<&2, List<&2, U32>>, +w: U32) -> List<&2, Dc>:
  match c:
    case True{}:
      Du.top3(lf, w, Bf.run(U32.to_nat(U32.inc(LF.nl(lf))), adj, Bf.add(w, w, Nil{}, Bf.empty())))
    case False{}:
      Nil{}

def Du.top(+lf: LF, +adj: List<&2, List<&2, U32>>, +w: U32) -> List<&2, Dc>:
  Du.top2(Bool.and(Du.outer(LF.lps(lf), w), Bool.not(Du.inner(LF.lps(lf), w))), lf, adj, w)

def Du.tops(ws: List<&2, U32>, +lf: LF, +adj: List<&2, List<&2, U32>>) -> List<&2, Dc>:
  match ws:
    case Nil{}:
      Nil{}
    case Con{+w, t}:
      List.append(&2, Dc, Du.top(lf, adj, w), Du.tops(t, lf, adj))

# Order by (svc, a, b); keep the first witness of each pair.
def Dc.lt(x: Dc, y: Dc) -> Bool:
  match x y:
    case Dc{+s, a, b, w, wa, wb} Dc{+s2, a2, b2, w2, wa2, wb2}:
      Bool.or(U32.is_lt(s, s2), Bool.and(U32.is_eq(s, s2), Layers.lt2(a, b, a2, b2)))

def Dc.eq(x: Dc, y: Dc) -> Bool:
  match x y:
    case Dc{s, a, b, w, wa, wb} Dc{s2, a2, b2, w2, wa2, wb2}:
      Bool.and(U32.is_eq(s, s2), Bool.and(U32.is_eq(a, a2), U32.is_eq(b, b2)))

def Dc.ins_k(lt: Bool, eq: Bool, x: Dc, h: Dc, t: List<&2, Dc>, r: List<&2, Dc>) -> List<&2, Dc>:
  match lt eq:
    case True{} _:
      Con{x, Con{h, t}}
    case False{} True{}:
      Con{h, t}
    case False{} False{}:
      Con{h, r}

def Dc.ins(xs: List<&2, Dc>, +x: Dc) -> List<&2, Dc>:
  match xs:
    case Nil{}:
      Con{x, Nil{}}
    case Con{+h, +t}:
      Dc.ins_k(Dc.lt(x, h), Dc.eq(x, h), x, h, t, Dc.ins(t, x))

# Folding from the front keeps the earliest witness (smallest top) on ties.
def Dc.sort(xs: List<&2, Dc>, acc: List<&2, Dc>) -> List<&2, Dc>:
  match xs:
    case Nil{}:
      acc
    case Con{h, t}:
      Dc.sort(t, Dc.ins(acc, h))

def Layers.dups(+lf: LF) -> List<&2, Dc>:
  Du.keep(Dc.sort(Du.tops(Layers.iota(U32.to_nat(LF.nl(lf)), 0), lf, Layers.lp_adj(lf)), Nil{}), lf)

# ---- (4) hub services -----------------------------------------------------------------------
# Rule effect.hub-service: fan-in at or above this. research/thresholds.md
# ("Fan-in/hub defaults", weak evidence); a repo overrides it in policy.
def Layers.hub_min() -> U32:
  10

type Hub is Data:
  Hub{s: U32, k: U32, a: U32, b: U32}

# The hub checker reads the fan-in from tallies of these two lists, one pass
# each: the svc of every LQ fact, and the svc of every US fact whose function is
# not in the LC set. Layers-LAWS H1 states the counts as TL.Count over them.
def Hb.lq_ids(lqs: List<&2, Lq>) -> List<&2, U32>:
  match lqs:
    case Nil{}:
      Nil{}
    case Con{Lq{l, s}, t}:
      Con{s, Hb.lq_ids(t)}

def Hb.lc_fns(lcs: List<&2, Lc>) -> List<&2, U32>:
  match lcs:
    case Nil{}:
      Nil{}
    case Con{Lc{l, f}, t}:
      Con{f, Hb.lc_fns(t)}

# Functions that are some layer's constructor body (Scope-LAWS SC1-SC2: exactly
# the listed ids).
def Hb.lc_set(lcs: List<&2, Lc>) -> G.Tr:
  S.Scope.set(Hb.lc_fns(lcs))

def Hb.us_ids(uss: List<&2, Us>, +lct: G.Tr) -> List<&2, U32>:
  match uss:
    case Nil{}:
      Nil{}
    case Con{Us{+f, s}, t}:
      Layers.push_u(Bool.not(S.Scope.has(lct, f)), s, Hb.us_ids(t, lct))

def Hb.cnt(+t: G.Tr, +s: U32) -> U32:
  U32.from_nat(G.Graph.cnt_of(G.Tr.getu(t, s)))

def Hb.check(+ta: G.Tr, +tb: G.Tr, h: Hub) -> Bool:
  match h:
    case Hub{+s, +k, +a, +b}:
      Bool.and(Bool.and(U32.is_eq(a, Hb.cnt(ta, s)), U32.is_eq(b, Hb.cnt(tb, s))), Bool.and(U32.is_eq(k, U32.add(a, b)), U32.is_ge(k, Layers.hub_min())))

def Hb.push(c: Bool, x: Hub, acc: List<&2, Hub>) -> List<&2, Hub>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Hb.keep(cs: List<&2, Hub>, +ta: G.Tr, +tb: G.Tr) -> List<&2, Hub>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{+c, t}:
      Hb.push(Hb.check(ta, tb, c), c, Hb.keep(t, ta, tb))

def Hb.cand2(+a: U32, +b: U32, s: U32, acc: List<&2, Hub>) -> List<&2, Hub>:
  Hb.push(U32.is_ge(U32.add(a, b), Layers.hub_min()), Hub{s, U32.add(a, b), a, b}, acc)

def Hb.cands(ss: List<&2, U32>, +ta: G.Tr, +tb: G.Tr) -> List<&2, Hub>:
  match ss:
    case Nil{}:
      Nil{}
    case Con{+s, t}:
      Hb.cand2(Hb.cnt(ta, s), Hb.cnt(tb, s), s, Hb.cands(t, ta, tb))

def Hb.ta(+lf: LF) -> G.Tr:
  G.Graph.cnt_all(Hb.lq_ids(LF.lqs(lf)), G.TE{})

def Hb.tb(+lf: LF) -> G.Tr:
  G.Graph.cnt_all(Hb.us_ids(LF.uss(lf), Hb.lc_set(LF.lcs(lf))), G.TE{})

def Hb.hubs2(+lf: LF, +ta: G.Tr, +tb: G.Tr) -> List<&2, Hub>:
  Hb.keep(Hb.cands(Layers.iota(U32.to_nat(LF.ns(lf)), 0), ta, tb), ta, tb)

def Layers.hubs(+lf: LF) -> List<&2, Hub>:
  Hb.hubs2(lf, Hb.ta(lf), Hb.tb(lf))

# ---- validity ---------------------------------------------------------------------------------
# Ids are below the header counts, and every relation is strictly ascending
# (FACTS.md: sorted, duplicates removed). Counts are capped at 2^24.
def Layers.lt3(+a: U32, +b: U32, c: U32, +d: U32, +e: U32, f: U32) -> Bool:
  Bool.or(U32.is_lt(a, d), Bool.and(U32.is_eq(a, d), Layers.lt2(b, c, e, f)))

def Va.svs(xs: List<&2, Sv>, +ns: U32, pa: U32, pb: U32, pc: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Sv{+a, +b, +c}, t}:
      Bool.and(Bool.and(U32.is_lt(a, ns), Bool.or(first, Layers.lt3(pa, pb, pc, a, b, c))), Va.svs(t, ns, a, b, c, False{}))

def Va.lys(xs: List<&2, Ly>, +nl: U32, +ns: U32, pa: U32, pb: U32, pc: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Ly{+a, +b, +c}, t}:
      Bool.and(Bool.and(Bool.and(U32.is_lt(a, nl), U32.is_lt(c, ns)), Bool.or(first, Layers.lt3(pa, pb, pc, a, b, c))), Va.lys(t, nl, ns, a, b, c, False{}))

def Va.lqs(xs: List<&2, Lq>, +nl: U32, +ns: U32, pa: U32, pb: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Lq{+a, +b}, t}:
      Bool.and(Bool.and(Bool.and(U32.is_lt(a, nl), U32.is_lt(b, ns)), Bool.or(first, Layers.lt2(pa, pb, a, b))), Va.lqs(t, nl, ns, a, b, False{}))

def Va.lps(xs: List<&2, Lp>, +nl: U32, pa: U32, pb: U32, pc: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Lp{+a, +b, +c}, t}:
      Bool.and(Bool.and(Bool.and(U32.is_lt(a, nl), U32.is_lt(b, nl)), Bool.or(first, Layers.lt3(pa, pb, pc, a, b, c))), Va.lps(t, nl, a, b, c, False{}))

def Va.lrs(xs: List<&2, Lr>, +nl: U32, +nr: U32, pa: U32, pb: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Lr{+a, +b}, t}:
      Bool.and(Bool.and(Bool.and(U32.is_lt(a, nr), U32.is_lt(b, nl)), Bool.or(first, Layers.lt2(pa, pb, a, b))), Va.lrs(t, nl, nr, a, b, False{}))

def Va.lcs(xs: List<&2, Lc>, +nl: U32, pa: U32, pb: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Lc{+a, +b}, t}:
      Bool.and(Bool.and(U32.is_lt(a, nl), Bool.or(first, Layers.lt2(pa, pb, a, b))), Va.lcs(t, nl, a, b, False{}))

def Va.los(xs: List<&2, U32>, +nl: U32, pa: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+a, t}:
      Bool.and(Bool.and(U32.is_lt(a, nl), Bool.or(first, U32.is_lt(pa, a))), Va.los(t, nl, a, False{}))

def Va.uss(xs: List<&2, Us>, +ns: U32, pa: U32, pb: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Us{+a, +b}, t}:
      Bool.and(Bool.and(U32.is_lt(b, ns), Bool.or(first, Layers.lt2(pa, pb, a, b))), Va.uss(t, ns, a, b, False{}))

def Layers.valid(+lf: LF) -> Bool:
  match lf:
    case LF{+nl, +ns, +nr, svs, lys, lqs, lps, lrs, lcs, los, uss}:
      Bool.and(Bool.and(Bool.and(U32.is_le(nl, 16777216), Bool.and(U32.is_le(ns, 16777216), U32.is_le(nr, 16777216))), Bool.and(Va.svs(svs, ns, 0, 0, 0, True{}), Va.lys(lys, nl, ns, 0, 0, 0, True{}))), Bool.and(Bool.and(Va.lqs(lqs, nl, ns, 0, 0, True{}), Va.lps(lps, nl, 0, 0, 0, True{})), Bool.and(Bool.and(Va.lrs(lrs, nl, nr, 0, 0, True{}), Va.lcs(lcs, nl, 0, 0, True{})), Bool.and(Va.los(los, nl, 0, True{}), Va.uss(uss, ns, 0, 0, True{})))))

# ---- the entry point --------------------------------------------------------------------------

def Layers.out(+lf: LF, +adj: List<&2, List<&2, U32>>) -> LOut:
  LOut{LF.nl(lf), LF.ns(lf), G.Graph.edges(adj, 0), G.Graph.analyze(adj), Layers.unprovided(lf), Layers.opaque(lf), Layers.dups(lf), Layers.hubs(lf)}

def Layers.run2(ok: Bool, +lf: LF) -> Maybe<LOut>:
  match ok:
    case True{}:
      Some{Layers.out(lf, Layers.req_graph(lf))}
    case False{}:
      None{}

# None when the facts are not valid (Layers.valid).
def Layers.run(+lf: LF) -> Maybe<LOut>:
  Layers.run2(Layers.valid(lf), lf)

# ---- output -----------------------------------------------------------------------------------
def LRep.ids(c: List<&2, U32>) -> List<&2, String>:
  match c:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{U32.show(h), LRep.ids(t)}

def LRep.nums(c: List<&2, U32>) -> String:
  String.join(LRep.ids(c), " ")

def LRep.len(+c: List<&2, U32>) -> String:
  U32.show(U32.from_nat(List.length(&2, U32, c)))

def LRep.cyc(cs: List<&2, List<&2, U32>>) -> List<&2, String>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{+h, t}:
      Con{"LCYC " ++ LRep.len(h) ++ " " ++ LRep.nums(h), LRep.cyc(t)}

def LRep.cert(ok: Bool) -> String:
  match ok:
    case True{}:
      "LCERT 1"
    case False{}:
      "LCERT 0"

# LUNP root layer svc start <walk>: the walk goes from start (a layer provided
# at root) to layer, along LP.
def LRep.unp(us: List<&2, Uc>) -> List<&2, String>:
  match us:
    case Nil{}:
      Nil{}
    case Con{Uc{r, l, s, x, ws, sl}, t}:
      Con{String.join(LRep.ids(Con{r, Con{l, Con{s, Con{x, ws}}}}), " "), LRep.unp(t)}

def LRep.opq(os: List<&2, Opq>) -> List<&2, String>:
  match os:
    case Nil{}:
      Nil{}
    case Con{Opq{r, l}, t}:
      Con{"LOPQ " ++ U32.show(r) ++ " " ++ U32.show(l), LRep.opq(t)}

# LDUP svc a b top na <walk top->a> <walk top->b>
def LRep.dup(ds: List<&2, Dc>) -> List<&2, String>:
  match ds:
    case Nil{}:
      Nil{}
    case Con{Dc{s, a, b, w, +wa, wb}, t}:
      Con{String.join(LRep.ids(Con{s, Con{a, Con{b, Con{w, Con{U32.from_nat(List.length(&2, U32, wa)), List.append(&2, U32, wa, wb)}}}}}), " "), LRep.dup(t)}

def LRep.hub(hs: List<&2, Hub>) -> List<&2, String>:
  match hs:
    case Nil{}:
      Nil{}
    case Con{Hub{s, k, a, b}, t}:
      Con{"LHUB " ++ String.join(LRep.ids(Con{s, Con{k, Con{a, Con{b, Nil{}}}}}), " "), LRep.hub(t)}

def LRep.pre(+p: String, xs: List<&2, String>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{p ++ h, LRep.pre(p, t)}

def LRep.summary(nl: U32, ns: U32, edges: U32, +cs: List<&2, List<&2, U32>>, +us: List<&2, Uc>, +ds: List<&2, Dc>, +hs: List<&2, Hub>) -> String:
  "LS " ++ String.join(LRep.ids([nl, ns, edges, U32.from_nat(List.length(&2, List<&2, U32>, cs)), U32.from_nat(List.length(&2, Uc, us)), U32.from_nat(List.length(&2, Dc, ds)), U32.from_nat(List.length(&2, Hub, hs)), Layers.hub_min()]), " ")

def LRep.res(nl: U32, ns: U32, edges: U32, r: G.Res, +us: List<&2, Uc>, os: List<&2, Opq>, +ds: List<&2, Dc>, +hs: List<&2, Hub>) -> List<&2, String>:
  match r:
    case G.Res{+cs, ok}:
      Con{"pulsar-layers 0", List.append(&2, String, LRep.cyc(cs), Con{LRep.cert(ok), List.append(&2, String, LRep.pre("LUNP ", LRep.unp(us)), List.append(&2, String, LRep.opq(os), List.append(&2, String, LRep.pre("LDUP ", LRep.dup(ds)), List.append(&2, String, LRep.hub(hs), Con{LRep.summary(nl, ns, edges, cs, us, ds, hs), Nil{}}))))})}

def Layers.lines(o: LOut) -> List<&2, String>:
  match o:
    case LOut{nl, ns, edges, res, unp, opq, dups, hubs}:
      LRep.res(nl, ns, edges, res, unp, opq, dups, hubs)

# ---- decoding rows (reader; unproven) ----------------------------------------------------------
# Tags: E 69, SV 21334, LY 19545, LQ 19537, LP 19536, LR 19538, LC 19523,
# LO 19535, US 21843. Other tags are other detectors' and are skipped. A row of
# a known tag with the wrong field count, or a second E, makes the input bad.

def Ld.bad(d: LD) -> LD:
  match d:
    case LD{bad, e, f}:
      LD{1, e, f}

def Ld.e(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} LD{bad, +e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{U32.add(bad, e), 1, LF{a, b, c, svs, lys, lqs, lps, lrs, lcs, los, uss}}
    case _ d2:
      Ld.bad(d2)

def Ld.sv(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{bad, e, LF{nl, ns, nr, Con{Sv{a, b, c}, svs}, lys, lqs, lps, lrs, lcs, los, uss}}
    case _ d2:
      Ld.bad(d2)

def Ld.ly(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{bad, e, LF{nl, ns, nr, svs, Con{Ly{a, b, c}, lys}, lqs, lps, lrs, lcs, los, uss}}
    case _ d2:
      Ld.bad(d2)

def Ld.lq(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Con{b, Nil{}}} LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{bad, e, LF{nl, ns, nr, svs, lys, Con{Lq{a, b}, lqs}, lps, lrs, lcs, los, uss}}
    case _ d2:
      Ld.bad(d2)

def Ld.lp(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, Con{Lp{a, b, c}, lps}, lrs, lcs, los, uss}}
    case _ d2:
      Ld.bad(d2)

def Ld.lr(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Con{b, Nil{}}} LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, Con{Lr{a, b}, lrs}, lcs, los, uss}}
    case _ d2:
      Ld.bad(d2)

def Ld.lc(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Con{b, Nil{}}} LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, Con{Lc{a, b}, lcs}, los, uss}}
    case _ d2:
      Ld.bad(d2)

def Ld.lo(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Nil{}} LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, Con{a, los}, uss}}
    case _ d2:
      Ld.bad(d2)

def Ld.us(fs: List<&2, U32>, d: LD) -> LD:
  match fs d:
    case Con{a, Con{b, Nil{}}} LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, Con{Us{a, b}, uss}}}
    case _ d2:
      Ld.bad(d2)

def Ld.add(tag: U32, fs: List<&2, U32>, d: LD) -> LD:
  match tag:
    case 69:
      Ld.e(fs, d)
    case 21334:
      Ld.sv(fs, d)
    case 19545:
      Ld.ly(fs, d)
    case 19537:
      Ld.lq(fs, d)
    case 19536:
      Ld.lp(fs, d)
    case 19538:
      Ld.lr(fs, d)
    case 19523:
      Ld.lc(fs, d)
    case 19535:
      Ld.lo(fs, d)
    case 21843:
      Ld.us(fs, d)
    case _:
      d

def Ld.go(rows: List<&2, W.Row>, d: LD) -> LD:
  match rows:
    case Nil{}:
      d
    case Con{W.Row{tag, fs}, t}:
      Ld.go(t, Ld.add(tag, fs, d))

def Ld.fin2(ok: Bool, f: LF) -> Maybe<LF>:
  match ok:
    case True{}:
      Some{f}
    case False{}:
      None{}

def Ld.fin(d: LD) -> Maybe<LF>:
  match d:
    case LD{bad, e, LF{nl, ns, nr, svs, lys, lqs, lps, lrs, lcs, los, uss}}:
      Ld.fin2(U32.is_eq(bad, 0), LF{nl, ns, nr, List.reverse(&2, Sv, svs), List.reverse(&2, Ly, lys), List.reverse(&2, Lq, lqs), List.reverse(&2, Lp, lps), List.reverse(&2, Lr, lrs), List.reverse(&2, Lc, lcs), List.reverse(&2, U32, los), List.reverse(&2, Us, uss)})

def Layers.decode(rows: List<&2, W.Row>) -> Maybe<LF>:
  Ld.fin(Ld.go(rows, LD{0, 0, LF{0, 0, 0, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}}}))
