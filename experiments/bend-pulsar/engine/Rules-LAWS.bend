# engine/Rules-LAWS.bend - laws about Rules.bend, the repo-rule evaluator (#697).
# Filled in Rules-PROOF.bend. Gate: `bend engine/Rules-PROOF.bend --verdict`.
#
# Every law is about the functions the binary runs. The definitions below (Le, Match1, Matches,
# HasMatch, Holds, MemE) describe what a binding means; none of them is called by the binary.
#
# Increment 1: the join of a body's positive atoms is sound (R1) and complete (R2). Everything
# later (the step, strata, negation, count) is built on these two.

import Base
import ../LAWS.bend as TL
import ./Rules.bend as R

# ---- what a binding means ----------------------------------------------------------------------
# `e` is below `E`: every variable `e` binds, `E` binds to the same value. An unbound slot, or a
# slot past the end of `e`, constrains nothing.
def Le(e: List<&2, Maybe<&2, U32>>, E: List<&2, Maybe<&2, U32>>) -> Data:
  match e E:
    case Nil{} _:
      Unit
    case Con{None{}, t} Nil{}:
      Le(t, Nil{})
    case Con{None{}, t} Con{h, T}:
      Le(t, T)
    case Con{Some{x}, t} Nil{}:
      Empty
    case Con{Some{x}, t} Con{h, T}:
      TL.And({h == Some{x} : Maybe<&2, U32>}, Le(t, T))

# One term agrees with one field under E: a variable is bound to it, a constant equals it.
def Match1(t: R.Tm, x: U32, E: List<&2, Maybe<&2, U32>>) -> Data:
  match t:
    case R.TV{v}:
      {R.Env.get(E, v) == Some{x} : Maybe<&2, U32>}
    case R.TC{c}:
      {c == x : U32}
    case R.TW{}:
      Unit

# The atom's terms agree with the tuple, field by field, and the lengths are equal.
def Matches(ts: List<&2, R.Tm>, xs: List<&2, U32>, E: List<&2, Maybe<&2, U32>>) -> Data:
  match ts xs:
    case Nil{} Nil{}:
      Unit
    case Con{t, tr} Con{x, xr}:
      TL.And(Match1(t, x, E), Matches(tr, xr, E))
    case _ _:
      Empty

# Some tuple of the relation agrees with the atom's terms under E.
def HasMatch(tups: List<&2, List<&2, U32>>, ts: List<&2, R.Tm>, E: List<&2, Maybe<&2, U32>>) -> Data:
  match tups:
    case Nil{}:
      Empty
    case Con{x, t}:
      Either<&2, &2, Matches(ts, x, E), HasMatch(t, ts, E)>

# Every atom of the body holds under E.
def Holds(as: List<&2, R.At>, rels: List<&2, List<&2, List<&2, U32>>>, E: List<&2, Maybe<&2, U32>>) -> Data:
  match as:
    case Nil{}:
      Unit
    case Con{R.At{r, ts}, rest}:
      TL.And(HasMatch(R.Rels.get(rels, r), ts, E), Holds(rest, rels, E))

def MemE(es: List<&2, List<&2, Maybe<&2, U32>>>, e: List<&2, Maybe<&2, U32>>) -> Data:
  match es:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == e : List<&2, Maybe<&2, U32>>}, MemE(t, e)>

# ---- the join ----------------------------------------------------------------------------------
# R1. sound: every environment the join answers extends the start and satisfies every atom.
law join_sound:
  for +as: List<&2, R.At>
  for +rels: List<&2, List<&2, List<&2, U32>>>
  for +e0: List<&2, Maybe<&2, U32>>
  for +e: List<&2, Maybe<&2, U32>>
  for h: MemE(R.Join.atoms(as, rels, [e0]), e)
  TL.And(Le(e0, e), Holds(as, rels, e))

# R2. complete: for every environment E above the start that satisfies every atom, the join
# answers one below E (the bindings of E that the atoms fix, and no others).
law join_complete:
  for +as: List<&2, R.At>
  for +rels: List<&2, List<&2, List<&2, U32>>>
  for +e0: List<&2, Maybe<&2, U32>>
  for +E: List<&2, Maybe<&2, U32>>
  for hl: Le(e0, E)
  for hh: Holds(as, rels, E)
  TL.Ex(List<&2, Maybe<&2, U32>>, e => TL.And(MemE(R.Join.atoms(as, rels, [e0]), e), Le(e, E)))
