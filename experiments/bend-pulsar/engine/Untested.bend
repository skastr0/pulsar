# engine/Untested.bend - untested data access (PLAN group I composite): a function holding a
# query site whose code is not shown tested, by its core.crap finding or by having no
# coverage data at all. Laws: Untested-LAWS.bend.
#
#   RU rule        the rule is on (the CLI writes one row per active rule)
#   QS ... fn ...  the functions holding query sites (FACTS.md "SQL")
#
# Per RU row, per function in FN order, a non-test function (no TF row) with a QS site gets
#   UX rule fn 1   it has a core.crap finding (Crap.bend, at the CRAP threshold)
#   UX rule fn 2   it has no coverage data: no CV row, or coverable 0 or out of range
# The two reasons never meet, since a CRAP finding needs coverage data. 0% coverage is
# data: it shows as reason 1 when CRAP is over the threshold, and not at all otherwise.
#
# Output, only with an RU row (`pulsar-untested 0`): the UX lines, then `UXS n`.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./Metrics.bend as M
import ./Crap.bend as C

type UF is Data:
  UF{qfns: List<&2, U32>, rus: List<&2, U32>}

type Ux is Data:
  Ux{r: U32, fn: U32, reason: U32}

# The functions of the CRAP findings, and the functions with coverage data.
def Un.ffns(xs: List<&2, M.Finding>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{M.Finding{rule, fn, v, thr}, t}:
      Con{fn, Un.ffns(t)}

def Un.dfns(xs: List<&2, C.CrM>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{C.CrM{fn, c, covered, n, v, test}, t}:
      Con{fn, Un.dfns(t)}

def Un.push(b: Bool, x: Ux, acc: List<&2, Ux>) -> List<&2, Ux>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# One function: reason 1, then reason 2.
def Un.one(m: M.FnM, +r: U32, +qset: G.Tr, +cset: G.Tr, +dset: G.Tr, rest: List<&2, Ux>) -> List<&2, Ux>:
  match m:
    case M.FnM{+fn, cc, nest, np, loc, +test}:
      Un.push(Bool.and(Bool.and(Bool.not(test), S.Scope.has(qset, fn)), S.Scope.has(cset, fn)), Ux{r, fn, 1}, Un.push(Bool.and(Bool.and(Bool.not(test), S.Scope.has(qset, fn)), Bool.not(S.Scope.has(dset, fn))), Ux{r, fn, 2}, rest))

def Un.rule(ms: List<&2, M.FnM>, +r: U32, +qset: G.Tr, +cset: G.Tr, +dset: G.Tr) -> List<&2, Ux>:
  match ms:
    case Nil{}:
      Nil{}
    case Con{m, t}:
      Un.one(m, r, qset, cset, dset, Un.rule(t, r, qset, cset, dset))

def Un.rules(+ms: List<&2, M.FnM>, rus: List<&2, U32>, +qset: G.Tr, +cset: G.Tr, +dset: G.Tr) -> List<&2, Ux>:
  match rus:
    case Nil{}:
      Nil{}
    case Con{r, t}:
      List.append(&2, Ux, Un.rule(ms, r, qset, cset, dset), Un.rules(ms, t, qset, cset, dset))

# ms: Metrics' records; crs: the core.crap findings; cms: the functions with coverage data.
def Untested.findings(+ms: List<&2, M.FnM>, crs: List<&2, M.Finding>, cms: List<&2, C.CrM>, u: UF) -> List<&2, Ux>:
  match u:
    case UF{qfns, rus}:
      Un.rules(ms, rus, S.Scope.set(qfns), S.Scope.set(Un.ffns(crs)), S.Scope.set(Un.dfns(cms)))

# ---- output -----------------------------------------------------------------------------------
def Un.line(x: Ux) -> String:
  match x:
    case Ux{r, fn, reason}:
      "UX " ++ U32.show(r) ++ " " ++ U32.show(fn) ++ " " ++ U32.show(reason)

def Un.lines(xs: List<&2, Ux>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Un.line(h), Un.lines(t)}

def Un.out(+ms: List<&2, M.FnM>, +crs: List<&2, M.Finding>, +cms: List<&2, C.CrM>, +qfns: List<&2, U32>, rus: List<&2, U32>) -> List<&2, String>:
  match rus:
    case Nil{}:
      Nil{}
    case Con{+r, +t}:
      +xs = Untested.findings(ms, crs, cms, UF{qfns, Con{r, t}})
      Con{"pulsar-untested 0", List.append(&2, String, Un.lines(xs), ["UXS " ++ Nat.show(List.length(&2, Ux, xs))])}

def Untested.lines(+ms: List<&2, M.FnM>, +crs: List<&2, M.Finding>, +cms: List<&2, C.CrM>, u: UF) -> List<&2, String>:
  match u:
    case UF{+qfns, rus}:
      Un.out(ms, crs, cms, qfns, rus)
