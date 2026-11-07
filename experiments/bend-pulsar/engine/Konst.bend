# Konst.bend - a call of a class with a constant argument (constant partition key).
#
# PLAN.md group I "constant partition key": a call of catalog class `partition` (an
# instance-by-name lookup, a shard selector) whose key argument is a literal funnels all
# traffic to one instance. The mechanism is generic: a rule row `RK rule class pos`
# (FACTS.md) asks for every CS site calling a symbol of `class` whose argument `pos` is
# a constant (an `AL site pos kind` row). Which class is a partition lookup, and which
# argument is its key, is pack data. Laws: Konst-LAWS.bend.
#
#   pulsar-konst 0
#   KX <rule> <site> <fn> <callee> <pos>
#   KXS <n>
# Lines come per RK row in row order, then in CS order.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./ClassCtx.bend as X

type Al is Data:
  Al{site: U32, pos: U32, kind: U32}

type Rk is Data:
  Rk{r: U32, c: U32, pos: U32}

type Kx is Data:
  Kx{r: U32, site: U32, fn: U32, callee: U32, pos: U32}

type KF is Data:
  KF{css: List<&2, X.Cs>, cls: List<&2, X.Cl>, als: List<&2, Al>, rks: List<&2, Rk>}

def Ko.keep(b: Bool, x: Kx, acc: List<&2, Kx>) -> List<&2, Kx>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# The sites whose argument `pos` is a constant.
def Ko.sites(als: List<&2, Al>, +pos: U32) -> List<&2, U32>:
  match als:
    case Nil{}:
      Nil{}
    case Con{Al{+site, +p, kind}, t}:
      X.Cx.push_u(U32.is_eq(p, pos), site, Ko.sites(t, pos))

def Ko.hits(css: List<&2, X.Cs>, +r: U32, +pos: U32, +cset: G.Tr, +aset: G.Tr) -> List<&2, Kx>:
  match css:
    case Nil{}:
      Nil{}
    case Con{X.Cs{+site, +fn, +callee, ld, ctx}, t}:
      Ko.keep(Bool.and(S.Scope.has(cset, callee), S.Scope.has(aset, site)), Kx{r, site, fn, callee, pos}, Ko.hits(t, r, pos, cset, aset))

def Ko.rule(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +als: List<&2, Al>, k: Rk) -> List<&2, Kx>:
  match k:
    case Rk{+r, +c, +pos}:
      Ko.hits(css, r, pos, S.Scope.set(X.Cx.ids(cls, c)), S.Scope.set(Ko.sites(als, pos)))

def Ko.rules(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +als: List<&2, Al>, rks: List<&2, Rk>) -> List<&2, Kx>:
  match rks:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      List.append(&2, Kx, Ko.rule(css, cls, als, h), Ko.rules(css, cls, als, t))

def Konst.findings(f: KF) -> List<&2, Kx>:
  match f:
    case KF{css, cls, als, rks}:
      Ko.rules(css, cls, als, rks)

def Ko.line(x: Kx) -> String:
  match x:
    case Kx{r, site, fn, callee, pos}:
      "KX " ++ U32.show(r) ++ " " ++ U32.show(site) ++ " " ++ U32.show(fn) ++ " " ++ U32.show(callee) ++ " " ++ U32.show(pos)

def Ko.lines(xs: List<&2, Kx>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Ko.line(h), Ko.lines(t)}

def Konst.lines(+f: KF) -> List<&2, String>:
  +xs = Konst.findings(f)
  Con{"pulsar-konst 0", List.append(&2, String, Ko.lines(xs), ["KXS " ++ Nat.show(List.length(&2, Kx, xs))])}
