import Base
import ../PROOF.bend as Top
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Lemmas2.bend as L2
import ../Lemmas3.bend as L3
import ../Resolve.bend as R
import ../Graph.bend as G
import ./Facts.bend as F
import ./Scope.bend as S
import ./Scope-LAWS.bend as Laws

# ---- the production set is the listed ids ------------------------------------------------------
def Has.some(m: Maybe<&2, Nat>, e: {S.Scope.has2(m) == True{} : Bool}) -> TL.Ex(Nat, j => {m == Some{j} : Maybe<&2, Nat>}):
  match m:
    case None{}:
      Empty.absurd(TL.Ex(Nat, j => {None{} == Some{j} : Maybe<&2, Nat>}), L.Bool.ff_tt(e))
    case Some{j}:
      Tuple{j, {==}}

def Has.fin2(+ids: List<&2, U32>, +x: U32, j: Nat, o: Either<&2, &2, TL.And(TL.Mem(ids, x), {0n == j : Nat}), {G.Tr.getu(G.TE{}, x) == Some{j} : Maybe<&2, Nat>}>) -> TL.Mem(ids, x):
  match o:
    case Inl{a}:
      L.And.fst(TL.Mem(ids, x), {0n == j : Nat}, a)
    case Inr{b}:
      Empty.absurd(TL.Mem(ids, x), L2.Top.none(x, j, b))

def Has.fin(+ids: List<&2, U32>, +x: U32, p: TL.Ex(Nat, j => {G.Tr.getu(G.Graph.ins_comp(ids, 0n, G.TE{}), x) == Some{j} : Maybe<&2, Nat>})) -> TL.Mem(ids, x):
  match p:
    case Tuple{+j, e}:
      Has.fin2(ids, x, j, L2.Ic.sound(ids, 0n, G.TE{}, x, j, e))

def Laws.scope_set_sound(ids, x, h):
  Has.fin(ids, x, Has.some(G.Tr.getu(G.Graph.ins_comp(ids, 0n, G.TE{}), x), h))

# Putting a key leaves a stored value at another key alone, and at the same key sets it.
def Eq.put(+tr: G.Tr, +x: U32, +y: U32, k: Nat, e: {x == y : U32}) -> {G.Tr.getu(G.Tr.putu(tr, x, k), y) == Some{k} : Maybe<&2, Nat>}:
  %e : {G.Tr.getu(G.Tr.putu(tr, x, k), _) == Some{k} : Maybe<&2, Nat>}
  L3.Putu.eq(tr, x, k)

def Pres.step(b: Bool, +tr: G.Tr, +z: U32, +y: U32, k: Nat, hb: {U32.is_eq(z, y) == b : Bool}, h: {G.Tr.getu(tr, y) == Some{k} : Maybe<&2, Nat>}) -> {G.Tr.getu(G.Tr.putu(tr, z, k), y) == Some{k} : Maybe<&2, Nat>}:
  match b:
    case True{}:
      Eq.put(tr, z, y, k, L.U32.eq_sound(z, y, hb))
    case False{}:
      Equal.trans(Maybe<&2, Nat>, G.Tr.getu(G.Tr.putu(tr, z, k), y), G.Tr.getu(tr, y), Some{k}, L3.Putu.ne(tr, z, y, k, hb), h)

# Later puts keep a stored value.
def Pres(c: List<&2, U32>, +k: Nat, +tr: G.Tr, +y: U32, h: {G.Tr.getu(tr, y) == Some{k} : Maybe<&2, Nat>}) -> {G.Tr.getu(G.Graph.ins_comp(c, k, tr), y) == Some{k} : Maybe<&2, Nat>}:
  match c:
    case Nil{}:
      h
    case Con{+z, r}:
      Pres(r, k, G.Tr.putu(tr, z, k), y, Pres.step(U32.is_eq(z, y), tr, z, y, k, {==}, h))

def Ic.complete(c: List<&2, U32>, +k: Nat, +tr: G.Tr, +y: U32, hm: TL.Mem(c, y)) -> {G.Tr.getu(G.Graph.ins_comp(c, k, tr), y) == Some{k} : Maybe<&2, Nat>}:
  match c:
    case Nil{}:
      Empty.absurd({G.Tr.getu(tr, y) == Some{k} : Maybe<&2, Nat>}, hm)
    case Con{+x, r}:
      match hm:
        case Inl{e}:
          Pres(r, k, G.Tr.putu(tr, x, k), y, Eq.put(tr, x, y, k, e))
        case Inr{m}:
          Ic.complete(r, k, G.Tr.putu(tr, x, k), y, m)

def Has.of_some(+m: Maybe<&2, Nat>, +k: Nat, e: {m == Some{k} : Maybe<&2, Nat>}) -> {S.Scope.has2(m) == True{} : Bool}:
  %Equal.sym(Maybe<&2, Nat>, m, Some{k}, e) : {S.Scope.has2(_) == True{} : Bool}
  {==}

def Laws.scope_set_complete(ids, x, hm):
  Has.of_some(G.Tr.getu(G.Graph.ins_comp(ids, 0n, G.TE{}), x), 0n, Ic.complete(ids, 0n, G.TE{}, x, hm))

# ---- the scope rule on a fact ----------------------------------------------------------------------
def And.false_r(a: Bool) -> {Bool.and(a, False{}) == False{} : Bool}:
  match a:
    case False{}:
      {==}
    case True{}:
      {==}

def Laws.scope_src_not_prod_no_edge(t, src, dst, form, hv, ht, cur, all, bare, miss, dyn, req, tonly, h):
  %Equal.sym(Bool, S.Scope.has(t, src), False{}, h) : {S.Scope.add2(Bool.and(_, S.Scope.has(t, dst)), F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}
  {==}

def Laws.scope_dst_not_prod_no_edge(t, src, dst, form, hv, ht, cur, all, bare, miss, dyn, req, tonly, h):
  %Equal.sym(Bool, S.Scope.has(t, dst), False{}, h) : {S.Scope.add2(Bool.and(S.Scope.has(t, src), _), F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}
  %Equal.sym(Bool, Bool.and(S.Scope.has(t, src), False{}), False{}, And.false_r(S.Scope.has(t, src))) : {S.Scope.add2(_, F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}
  {==}

def Laws.scope_both_prod_is_rule(t, src, dst, form, hv, ht, acc, hs, hd):
  %Equal.sym(Bool, S.Scope.has(t, src), True{}, hs) : {S.Scope.add2(Bool.and(_, S.Scope.has(t, dst)), F.Fact{src, dst, form, hv, ht}, acc) == F.Facts.add(F.Fact{src, dst, form, hv, ht}, acc) : R.Acc}
  %Equal.sym(Bool, S.Scope.has(t, dst), True{}, hd) : {S.Scope.add2(Bool.and(True{}, _), F.Fact{src, dst, form, hv, ht}, acc) == F.Facts.add(F.Fact{src, dst, form, hv, ht}, acc) : R.Acc}
  {==}
