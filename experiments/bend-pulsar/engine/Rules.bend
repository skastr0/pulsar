# engine/Rules.bend - the evaluator for repo-defined rules (stratified Datalog).
#
# Design: research/repo-rules.md (#697). The CLI type-checks a repo's rules, compiles names and
# globs to numbers, stratifies them and lowers them to J* rows. This file evaluates that IR. It
# names no technology and holds no text: relations are lists of U32 tuples, variables are
# indices, and there is no arithmetic instruction, so no rule can compute a score.
#
# This is increment 1 of phase 2: terms, environments, matching one atom against one tuple
# (`Un.go`) and the join of a clause body's positive atoms (`Join.atoms`). Laws R1 and R2 in
# Rules-LAWS.bend say the join is sound and complete. The step, strata, negation and count build
# on it.

import Base

# A term in an atom: a variable (by index), a constant, or a wildcard.
type Tm is Data:
  TV{v: Nat}
  TC{c: U32}
  TW{}

# An atom: relation `r` (an index into the relation list) and one term per field.
type At is Data:
  At{r: Nat, ts: List<&2, Tm>}

# ---- environments -----------------------------------------------------------------------------
# An environment binds variable i to the i-th slot. It is extended on demand, so a variable past
# its end is simply unbound, and binding it grows the list with unbound slots.

def Env.get(e: List<&2, Maybe<&2, U32>>, v: Nat) -> Maybe<&2, U32>:
  match e v:
    case Nil{} _:
      None{}
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      Env.get(t, p)

def Env.set(e: List<&2, Maybe<&2, U32>>, v: Nat, +x: U32) -> List<&2, Maybe<&2, U32>>:
  match e v:
    case Nil{} 0n:
      Con{Some{x}, Nil{}}
    case Nil{} 1n+p:
      Con{None{}, Env.set(Nil{}, p, x)}
    case Con{h, t} 0n:
      Con{Some{x}, t}
    case Con{h, t} 1n+p:
      Con{h, Env.set(t, p, x)}

# ---- one atom against one tuple ---------------------------------------------------------------
def Un.pick(b: Bool, +e: List<&2, Maybe<&2, U32>>) -> Maybe<&2, List<&2, Maybe<&2, U32>>>:
  match b:
    case True{}:
      Some{e}
    case False{}:
      None{}

# A variable: bind it when unbound, else require the same value.
def Un.var(m: Maybe<&2, U32>, +v: Nat, +x: U32, +e: List<&2, Maybe<&2, U32>>) -> Maybe<&2, List<&2, Maybe<&2, U32>>>:
  match m:
    case None{}:
      Some{Env.set(e, v, x)}
    case Some{+y}:
      Un.pick(U32.is_eq(y, x), e)

def Un.one(t: Tm, +x: U32, +e: List<&2, Maybe<&2, U32>>) -> Maybe<&2, List<&2, Maybe<&2, U32>>>:
  match t:
    case TV{+v}:
      Un.var(Env.get(e, v), v, x, e)
    case TC{+c}:
      Un.pick(U32.is_eq(c, x), e)
    case TW{}:
      Some{e}

# Match the terms against the tuple, field by field, extending the environment. None when a
# field disagrees or the lengths differ.
def Un.go(ts: List<&2, Tm>, xs: List<&2, U32>, m: Maybe<&2, List<&2, Maybe<&2, U32>>>) -> Maybe<&2, List<&2, Maybe<&2, U32>>>:
  match ts xs m:
    case Nil{} Nil{} m:
      m
    case Con{t, tr} Con{+x, xr} Some{+e}:
      Un.go(tr, xr, Un.one(t, x, e))
    case _ _ _:
      None{}

# ---- the join of a body's positive atoms ------------------------------------------------------
def Rels.get(rels: List<&2, List<&2, List<&2, U32>>>, r: Nat) -> List<&2, List<&2, U32>>:
  match rels r:
    case Nil{} _:
      Nil{}
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      Rels.get(t, p)

def Join.push(m: Maybe<&2, List<&2, Maybe<&2, U32>>>, acc: List<&2, List<&2, Maybe<&2, U32>>>) -> List<&2, List<&2, Maybe<&2, U32>>>:
  match m:
    case None{}:
      acc
    case Some{e}:
      Con{e, acc}

# Every extension of `e` that matches the terms against some tuple, in tuple order.
def Join.one(tups: List<&2, List<&2, U32>>, +ts: List<&2, Tm>, +e: List<&2, Maybe<&2, U32>>) -> List<&2, List<&2, Maybe<&2, U32>>>:
  match tups:
    case Nil{}:
      Nil{}
    case Con{+x, t}:
      Join.push(Un.go(ts, x, Some{e}), Join.one(t, ts, e))

# The same, for every environment in a list.
def Join.ext(es: List<&2, List<&2, Maybe<&2, U32>>>, +tups: List<&2, List<&2, U32>>, +ts: List<&2, Tm>) -> List<&2, List<&2, Maybe<&2, U32>>>:
  match es:
    case Nil{}:
      Nil{}
    case Con{+e, t}:
      List.append(&2, List<&2, Maybe<&2, U32>>, Join.one(tups, ts, e), Join.ext(t, tups, ts))

# Fold the atoms over the environments: each atom keeps the extensions that match it.
def Join.atoms(as: List<&2, At>, +rels: List<&2, List<&2, List<&2, U32>>>, es: List<&2, List<&2, Maybe<&2, U32>>>) -> List<&2, List<&2, Maybe<&2, U32>>>:
  match as:
    case Nil{}:
      es
    case Con{At{+r, +ts}, rest}:
      Join.atoms(rest, rels, Join.ext(es, Rels.get(rels, r), ts))
