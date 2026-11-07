# Fanout.bend - a call of a class reached from a loop (N+1, generalised).
#
# One mechanism for the PLAN.md group I and G rows "a query call reachable from a loop",
# "remote call in a loop" and "repeated calls in a loop where the catalog names a batch
# form": which class counts (query, remote, a batch-capable class) is catalog data,
# never core. A rule row `RF rule class edges none` (FACTS.md) asks for every call site
# at loop depth > 0, whose ctx has no bit of `none`, that reaches a call of a symbol of
# `class` within `edges` call edges:
#
#   kind 0  a CS site in a loop whose callee is of the class itself (0 edges)
#   kind 1  a CE site in a loop whose target function reaches such a call within
#           edges - 1 further CE edges (any loop depth inside the target)
#
# Reach sets: R0 = the functions holding a call of the class; R(k+1) = R(k) plus every
# caller of an R(k) function by a CE edge. The laws (Fanout-LAWS.bend) prove each
# finding has that chain in the facts (sound). Not caught, by design of the facts: a
# call inside an iterator callback (`xs.map(x => q(x))`) belongs to the callback's own
# function at loop depth 0, so it is a finding only once iteration-combinator data
# marks such callbacks; dynamic calls (CU) have no edge.
#
#   pulsar-fanout 0
#   NX <rule> <site> <fn> <via> <kind>     via: the callee symbol (kind 0) or target fn (kind 1)
#   NXS <n>
# Findings come per RF row in row order, the kind 0 sites in CS order, then kind 1 in CE order.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./ClassCtx.bend as X

type Ce is Data:
  Ce{site: U32, fn: U32, target: U32, node: U32, ld: U32, ctx: U32}

type Rf is Data:
  Rf{r: U32, c: U32, edges: U32, none: U32}

type Nx is Data:
  Nx{r: U32, site: U32, fn: U32, via: U32, kind: U32}

type FoF is Data:
  FoF{css: List<&2, X.Cs>, cls: List<&2, X.Cl>, ces: List<&2, Ce>, rfs: List<&2, Rf>}

def Ce.fn(e: Ce) -> U32:
  match e:
    case Ce{site, fn, target, node, ld, ctx}:
      fn

def Ce.target(e: Ce) -> U32:
  match e:
    case Ce{site, fn, target, node, ld, ctx}:
      target

# A loop site whose ctx has no bit of `none`.
def Fo.at(+ld: U32, +ctx: U32, +none: U32) -> Bool:
  Bool.and(Bool.not(U32.is_eq(ld, 0)), U32.is_eq(U32.and(ctx, none), 0))

def Fo.keep(b: Bool, x: Nx, acc: List<&2, Nx>) -> List<&2, Nx>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# ---- reach sets -------------------------------------------------------------------------------
# The functions holding a call to a symbol of `cset`.
def Fo.seed(css: List<&2, X.Cs>, +cset: G.Tr) -> List<&2, U32>:
  match css:
    case Nil{}:
      Nil{}
    case Con{X.Cs{site, +fn, +callee, ld, ctx}, t}:
      X.Cx.push_u(S.Scope.has(cset, callee), fn, Fo.seed(t, cset))

# The callers, by a CE edge, of a function in `rt`.
def Fo.step(ces: List<&2, Ce>, +rt: G.Tr) -> List<&2, U32>:
  match ces:
    case Nil{}:
      Nil{}
    case Con{Ce{site, +fn, +target, node, ld, ctx}, t}:
      X.Cx.push_u(S.Scope.has(rt, target), fn, Fo.step(t, rt))

# R(k) from R(0) = cur.
def Fo.reach(k: Nat, +ces: List<&2, Ce>, +cur: List<&2, U32>) -> List<&2, U32>:
  match k:
    case 0n:
      cur
    case 1n+p:
      Fo.reach(p, ces, List.append(&2, U32, cur, Fo.step(ces, S.Scope.set(cur))))

# ---- the findings -----------------------------------------------------------------------------
def Fo.direct(css: List<&2, X.Cs>, +r: U32, +none: U32, +cset: G.Tr) -> List<&2, Nx>:
  match css:
    case Nil{}:
      Nil{}
    case Con{X.Cs{+site, +fn, +callee, +ld, +ctx}, t}:
      Fo.keep(Bool.and(Fo.at(ld, ctx, none), S.Scope.has(cset, callee)), Nx{r, site, fn, callee, 0}, Fo.direct(t, r, none, cset))

def Fo.edges(ces: List<&2, Ce>, +r: U32, +none: U32, +rt: G.Tr) -> List<&2, Nx>:
  match ces:
    case Nil{}:
      Nil{}
    case Con{Ce{+site, +fn, +target, node, +ld, +ctx}, t}:
      Fo.keep(Bool.and(Fo.at(ld, ctx, none), S.Scope.has(rt, target)), Nx{r, site, fn, target, 1}, Fo.edges(t, r, none, rt))

# Kind 1 findings use R(edges - 1); with 0 edges there are none.
def Fo.via(k: Nat, +ces: List<&2, Ce>, +r: U32, +none: U32, +seed: List<&2, U32>) -> List<&2, Nx>:
  match k:
    case 0n:
      Nil{}
    case 1n+p:
      Fo.edges(ces, r, none, S.Scope.set(Fo.reach(p, ces, seed)))

def Fo.rule(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, Ce>, f: Rf) -> List<&2, Nx>:
  match f:
    case Rf{+r, +c, edges, +none}:
      +cset = S.Scope.set(X.Cx.ids(cls, c))
      List.append(&2, Nx, Fo.direct(css, r, none, cset), Fo.via(U32.to_nat(edges), ces, r, none, Fo.seed(css, cset)))

def Fo.rules(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, Ce>, rfs: List<&2, Rf>) -> List<&2, Nx>:
  match rfs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      List.append(&2, Nx, Fo.rule(css, cls, ces, h), Fo.rules(css, cls, ces, t))

def Fanout.findings(f: FoF) -> List<&2, Nx>:
  match f:
    case FoF{css, cls, ces, rfs}:
      Fo.rules(css, cls, ces, rfs)

# ---- output -----------------------------------------------------------------------------------
def Fo.line(x: Nx) -> String:
  match x:
    case Nx{r, site, fn, via, kind}:
      "NX " ++ U32.show(r) ++ " " ++ U32.show(site) ++ " " ++ U32.show(fn) ++ " " ++ U32.show(via) ++ " " ++ U32.show(kind)

def Fo.lines(xs: List<&2, Nx>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Fo.line(h), Fo.lines(t)}

def Fanout.lines(+f: FoF) -> List<&2, String>:
  +xs = Fanout.findings(f)
  Con{"pulsar-fanout 0", List.append(&2, String, Fo.lines(xs), ["NXS " ++ Nat.show(List.length(&2, Nx, xs))])}
