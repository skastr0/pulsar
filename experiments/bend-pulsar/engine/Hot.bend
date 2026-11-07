# engine/Hot.bend - hot-path composites (PLAN group I): a base finding whose function is
# reachable from an entry point. Laws: Hot-LAWS.bend.
#
#   RH rule lane base depth     a composite rule: base findings of lane `lane` and rule `base`
#                               whose function an EP function reaches within `depth` CE edges
#     lane 1  SQL rule `base` (Sql.bend), at the query site's QS function
#     lane 2  fan-out rule `base` (Fanout.bend NX)
#     lane 3  constant-argument rule `base` (Konst.bend KX)
#   EP fn kind                  entry points, from catalog entries (FACTS.md)
#
# "Hot unindexed query" is RH with lane 1 and the unindexed-filter rule (4); "query fan-out
# on a hot path" is RH with lane 2 and an RF rule. The churn condition of the hot unindexed
# query, when history is on, is not in this file.
#
# Output (`pulsar-hot 0`): one `HX rule lane base site fn` line per finding, per RH row in
# row order, then per base site in base order; then `HXS n`.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./ClassCtx.bend as X
import ./Sql.bend as Q
import ./Fanout.bend as F
import ./Konst.bend as K

type Ep is Data:
  Ep{fn: U32, kind: U32}

type Rh is Data:
  Rh{r: U32, lane: U32, base: U32, depth: U32}

# A base finding's site and function.
type Bs is Data:
  Bs{site: U32, fn: U32}

type Hx is Data:
  Hx{r: U32, lane: U32, base: U32, site: U32, fn: U32}

type HF is Data:
  HF{eps: List<&2, Ep>, ces: List<&2, F.Ce>, qs: List<&2, Q.Qs>, sxs: List<&2, Q.Sx>, nxs: List<&2, F.Nx>, kxs: List<&2, K.Kx>, rhs: List<&2, Rh>}

# ---- the hot set: functions an entry point reaches within k CE edges --------------------------
def Ho.seed(eps: List<&2, Ep>) -> List<&2, U32>:
  match eps:
    case Nil{}:
      Nil{}
    case Con{Ep{fn, kind}, t}:
      Con{fn, Ho.seed(t)}

# The callees of a set.
def Ho.step(ces: List<&2, F.Ce>, +cur: G.Tr) -> List<&2, U32>:
  match ces:
    case Nil{}:
      Nil{}
    case Con{F.Ce{site, +fn, +target, node, ld, ctx}, t}:
      X.Cx.push_u(S.Scope.has(cur, fn), target, Ho.step(t, cur))

def Ho.reach(k: Nat, +ces: List<&2, F.Ce>, +cur: List<&2, U32>) -> List<&2, U32>:
  match k:
    case 0n:
      cur
    case 1n+p:
      Ho.reach(p, ces, List.append(&2, U32, cur, Ho.step(ces, S.Scope.set(cur))))

# ---- base findings per lane -------------------------------------------------------------------
def Ho.when(b: Bool, xs: List<&2, Bs>) -> List<&2, Bs>:
  match b:
    case True{}:
      xs
    case False{}:
      Nil{}

def Ho.bpush(b: Bool, x: Bs, acc: List<&2, Bs>) -> List<&2, Bs>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# The subjects of SQL rule `base`.
def Ho.sids(xs: List<&2, Q.Sx>, +base: U32) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{Q.Sx{rule, +id, table, col, detail}, t}:
      X.Cx.push_u(U32.is_eq(rule, base), id, Ho.sids(t, base))

# The query sites with a finding of SQL rule `base`.
def Ho.sql(qs: List<&2, Q.Qs>, +sset: G.Tr) -> List<&2, Bs>:
  match qs:
    case Nil{}:
      Nil{}
    case Con{Q.Qs{+site, file, +fn, node, kind, flags}, t}:
      Ho.bpush(S.Scope.has(sset, site), Bs{site, fn}, Ho.sql(t, sset))

def Ho.nx(xs: List<&2, F.Nx>, +base: U32) -> List<&2, Bs>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{F.Nx{r, +site, +fn, via, kind}, t}:
      Ho.bpush(U32.is_eq(r, base), Bs{site, fn}, Ho.nx(t, base))

def Ho.kx(xs: List<&2, K.Kx>, +base: U32) -> List<&2, Bs>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{K.Kx{r, +site, +fn, callee, pos}, t}:
      Ho.bpush(U32.is_eq(r, base), Bs{site, fn}, Ho.kx(t, base))

def Ho.bases(+lane: U32, +base: U32, f: HF) -> List<&2, Bs>:
  match f:
    case HF{eps, ces, qs, sxs, +nxs, +kxs, rhs}:
      List.append(&2, Bs, Ho.when(U32.is_eq(lane, 1), Ho.sql(qs, S.Scope.set(Ho.sids(sxs, base)))), List.append(&2, Bs, Ho.when(U32.is_eq(lane, 2), Ho.nx(nxs, base)), Ho.when(U32.is_eq(lane, 3), Ho.kx(kxs, base))))

# ---- the composite ----------------------------------------------------------------------------
def Ho.keep(b: Bool, x: Hx, acc: List<&2, Hx>) -> List<&2, Hx>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Ho.hot(bs: List<&2, Bs>, +r: U32, +lane: U32, +base: U32, +hset: G.Tr) -> List<&2, Hx>:
  match bs:
    case Nil{}:
      Nil{}
    case Con{Bs{+site, +fn}, t}:
      Ho.keep(S.Scope.has(hset, fn), Hx{r, lane, base, site, fn}, Ho.hot(t, r, lane, base, hset))

def Ho.eps(f: HF) -> List<&2, Ep>:
  match f:
    case HF{eps, ces, qs, sxs, nxs, kxs, rhs}:
      eps

def Ho.ces(f: HF) -> List<&2, F.Ce>:
  match f:
    case HF{eps, ces, qs, sxs, nxs, kxs, rhs}:
      ces

def Ho.rule(+f: HF, h: Rh) -> List<&2, Hx>:
  match h:
    case Rh{+r, +lane, +base, depth}:
      Ho.hot(Ho.bases(lane, base, f), r, lane, base, S.Scope.set(Ho.reach(U32.to_nat(depth), Ho.ces(f), Ho.seed(Ho.eps(f)))))

def Ho.rules(+f: HF, rhs: List<&2, Rh>) -> List<&2, Hx>:
  match rhs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      List.append(&2, Hx, Ho.rule(f, h), Ho.rules(f, t))

def Ho.rhs(f: HF) -> List<&2, Rh>:
  match f:
    case HF{eps, ces, qs, sxs, nxs, kxs, rhs}:
      rhs

def Hot.findings(+f: HF) -> List<&2, Hx>:
  Ho.rules(f, Ho.rhs(f))

# ---- output -----------------------------------------------------------------------------------
def Ho.line(x: Hx) -> String:
  match x:
    case Hx{r, lane, base, site, fn}:
      "HX " ++ U32.show(r) ++ " " ++ U32.show(lane) ++ " " ++ U32.show(base) ++ " " ++ U32.show(site) ++ " " ++ U32.show(fn)

def Ho.lines(xs: List<&2, Hx>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Ho.line(h), Ho.lines(t)}

def Hot.lines(+f: HF) -> List<&2, String>:
  +xs = Hot.findings(f)
  Con{"pulsar-hot 0", List.append(&2, String, Ho.lines(xs), ["HXS " ++ Nat.show(List.length(&2, Hx, xs))])}
