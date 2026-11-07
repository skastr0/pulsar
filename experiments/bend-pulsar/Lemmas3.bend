import Base
import ./LAWS.bend as Laws
import ./Graph.bend as G
import ./Nat2.bend as N
import ./Lemmas.bend as L
import ./Lemmas2.bend as L2

# ---- Tr: what a lookup finds after a put ---------------------------------------------------------
def Put.eq(+n: Nat, +t: G.Tr, w: Word(n), x: Nat) -> {G.Tr.get(n, G.Tr.put(n, t, w, x), w) == Some{x} : Maybe<&2, Nat>}:
  match n:
    case 0n:
      match w:
        case WNil{}:
          {==}
    case 1n+p:
      match w:
        case WCon{False{}, wt}:
          Put.eq(p, G.Tr.z(t), wt, x)
        case WCon{True{}, wt}:
          Put.eq(p, G.Tr.o(t), wt, x)

def Fin.same(b: Bool, c: Cmp, e: {Cmp.is_eq(Word.cmp.fin(b, b, c)) == False{} : Bool}) -> {Cmp.is_eq(c) == False{} : Bool}:
  match b c:
    case False{} LT{}:
      {==}
    case False{} EQ{}:
      Empty.absurd({True{} == False{} : Bool}, L.Bool.tt_ff(e))
    case False{} GT{}:
      {==}
    case True{} LT{}:
      {==}
    case True{} EQ{}:
      Empty.absurd({True{} == False{} : Bool}, L.Bool.tt_ff(e))
    case True{} GT{}:
      {==}

def Put.ne(+n: Nat, +t: G.Tr, w: Word(n), w2: Word(n), x: Nat, hne: {Cmp.is_eq(Word.cmp(n, w, w2)) == False{} : Bool}) -> {G.Tr.get(n, G.Tr.put(n, t, w, x), w2) == G.Tr.get(n, t, w2) : Maybe<&2, Nat>}:
  match n:
    case 0n:
      match w w2:
        case WNil{} WNil{}:
          Empty.absurd({G.Tr.get(0n, G.Tr.put(0n, t, WNil{}, x), WNil{}) == G.Tr.get(0n, t, WNil{}) : Maybe<&2, Nat>}, L.Bool.tt_ff(hne))
    case 1n+p:
      match w w2:
        case WCon{False{}, +wt} WCon{False{}, +wt2}:
          Put.ne(p, G.Tr.z(t), wt, wt2, x, Fin.same(False{}, Word.cmp(p, wt, wt2), hne))
        case WCon{False{}, wt} WCon{True{}, wt2}:
          {==}
        case WCon{True{}, wt} WCon{False{}, wt2}:
          {==}
        case WCon{True{}, +wt} WCon{True{}, +wt2}:
          Put.ne(p, G.Tr.o(t), wt, wt2, x, Fin.same(True{}, Word.cmp(p, wt, wt2), hne))

def Putu.eq(t: G.Tr, x: U32, v: Nat) -> {G.Tr.getu(G.Tr.putu(t, x, v), x) == Some{v} : Maybe<&2, Nat>}:
  match x:
    case U32{+w}:
      Put.eq(32n, t, w, v)

def Putu.ne(t: G.Tr, x: U32, y: U32, v: Nat, hne: {U32.is_eq(x, y) == False{} : Bool}) -> {G.Tr.getu(G.Tr.putu(t, x, v), y) == G.Tr.getu(t, y) : Maybe<&2, Nat>}:
  match x y:
    case U32{+wx} U32{+wy}:
      Put.ne(32n, t, wx, wy, v, hne)

# A tally of a list, on top of tr.
def Cnt.fact(+tr: G.Tr, +y1: U32, +y: U32, e: {y1 == y : U32}) -> {G.Tr.getu(G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1))), y) == Some{1n+G.Graph.cnt_of(G.Tr.getu(tr, y))} : Maybe<&2, Nat>}:
  %e : {G.Tr.getu(G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1))), _) == Some{1n+G.Graph.cnt_of(G.Tr.getu(tr, _))} : Maybe<&2, Nat>}
  Putu.eq(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1)))

def Cnt.k(b: Bool, +y1: U32, +y: U32, r: List<&2, U32>, +tr: G.Tr, hb: {U32.is_eq(y1, y) == b : Bool}, ih: {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(r, G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1)))), y)) == Nat.add(Laws.Count(r, y), G.Graph.cnt_of(G.Tr.getu(G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1))), y))) : Nat}) -> {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(r, G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1)))), y)) == Nat.add(Laws.Count.step(b, Laws.Count(r, y)), G.Graph.cnt_of(G.Tr.getu(tr, y))) : Nat}:
  match b:
    case False{}:
      %Putu.ne(tr, y1, y, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1)), hb) : {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(r, G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1)))), y)) == Nat.add(Laws.Count(r, y), G.Graph.cnt_of(_)) : Nat}
      ih
    case True{}:
      %N.Nat.add_succ_r(Laws.Count(r, y), G.Graph.cnt_of(G.Tr.getu(tr, y))) : {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(r, G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1)))), y)) == _ : Nat}
      %Cnt.fact(tr, y1, y, L.U32.eq_sound(y1, y, hb)) : {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(r, G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1)))), y)) == Nat.add(Laws.Count(r, y), G.Graph.cnt_of(_)) : Nat}
      ih

def Cnt.sound(l: List<&2, U32>, +tr: G.Tr, +y: U32) -> {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(l, tr), y)) == Nat.add(Laws.Count(l, y), G.Graph.cnt_of(G.Tr.getu(tr, y))) : Nat}:
  match l:
    case Nil{}:
      {==}
    case Con{+y1, +r}:
      Cnt.k(U32.is_eq(y1, y), y1, y, r, tr, {==}, Cnt.sound(r, G.Tr.putu(tr, y1, 1n+G.Graph.cnt_of(G.Tr.getu(tr, y1))), y))

def Nat.cmp_eq(a: Nat, b: Nat, e: {Nat.cmp(a, b) == EQ{} : Cmp}) -> {a == b : Nat}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+b2:
      Empty.absurd({0n == 1n+b2 : Nat}, L.Cmp.lt_eq(e))
    case 1n+a2 0n:
      Empty.absurd({1n+a2 == 0n : Nat}, L.Cmp.gt_eq(e))
    case 1n+a2 1n+b2:
      %Nat.cmp_eq(a2, b2, e) : {1n+a2 == 1n+_ : Nat}
      {==}

def Nat.eq_sound(+a: Nat, +b: Nat, e: {Nat.is_eq(a, b) == True{} : Bool}) -> {a == b : Nat}:
  Nat.cmp_eq(a, b, L.Cmp.eq_true(Nat.cmp(a, b), e))

def Part.k0(+x: U32, +p: Nat, +cnt: G.Tr, hx: {x == U32.from_nat(p) : U32}, e: {Nat.is_eq(G.Graph.cnt_of(G.Tr.getu(cnt, x)), 1n) == True{} : Bool}) -> {G.Graph.cnt_of(G.Tr.getu(cnt, U32.from_nat(p))) == 1n : Nat}:
  %hx : {G.Graph.cnt_of(G.Tr.getu(cnt, _)) == 1n : Nat}
  Nat.eq_sound(G.Graph.cnt_of(G.Tr.getu(cnt, x)), 1n, e)

def Part.k1(+p: Nat, +q2: Nat, +cnt: G.Tr, ih: {G.Graph.cnt_of(G.Tr.getu(cnt, U32.from_nat(Nat.add(q2, 1n+p)))) == 1n : Nat}) -> {G.Graph.cnt_of(G.Tr.getu(cnt, U32.from_nat(1n+Nat.add(q2, p)))) == 1n : Nat}:
  %N.Nat.add_succ_r(q2, p) : {G.Graph.cnt_of(G.Tr.getu(cnt, U32.from_nat(_))) == 1n : Nat}
  ih

def Part.sound(adj: List<&2, List<&2, U32>>, +p: Nat, +x: U32, +cnt: G.Tr, +q: Nat, hx: {x == U32.from_nat(p) : U32}, e: {G.Graph.part_rows(adj, x, cnt) == True{} : Bool}, hq: {Nat.is_lt(q, List.length(&2, List<&2, U32>, adj)) == True{} : Bool}) -> {G.Graph.cnt_of(G.Tr.getu(cnt, U32.from_nat(Nat.add(q, p)))) == 1n : Nat}:
  match adj q:
    case Nil{} 0n:
      Empty.absurd({G.Graph.cnt_of(G.Tr.getu(cnt, U32.from_nat(Nat.add(0n, p)))) == 1n : Nat}, L.Bool.ff_tt(hq))
    case Nil{} 1n+q2:
      Empty.absurd({G.Graph.cnt_of(G.Tr.getu(cnt, U32.from_nat(Nat.add(1n+q2, p)))) == 1n : Nat}, L.Bool.ff_tt(hq))
    case Con{_, +t} 0n:
      Part.k0(x, p, cnt, hx, L.And.fst({Nat.is_eq(G.Graph.cnt_of(G.Tr.getu(cnt, x)), 1n) == True{} : Bool}, {G.Graph.part_rows(t, U32.inc(x), cnt) == True{} : Bool}, L.Bool.and_true(Nat.is_eq(G.Graph.cnt_of(G.Tr.getu(cnt, x)), 1n), G.Graph.part_rows(t, U32.inc(x), cnt), e)))
    case Con{_, +t} 1n+q2:
      Part.k1(p, q2, cnt, Part.sound(t, 1n+p, U32.inc(x), cnt, q2, Equal.cong(U32, U32, U32.inc, x, U32.from_nat(p), hx), L.And.snd({Nat.is_eq(G.Graph.cnt_of(G.Tr.getu(cnt, x)), 1n) == True{} : Bool}, {G.Graph.part_rows(t, U32.inc(x), cnt) == True{} : Bool}, L.Bool.and_true(Nat.is_eq(G.Graph.cnt_of(G.Tr.getu(cnt, x)), 1n), G.Graph.part_rows(t, U32.inc(x), cnt), e)), hq))

def Te.cnt(y: U32) -> {G.Graph.cnt_of(G.Tr.getu(G.TE{}, y)) == 0n : Nat}:
  match y:
    case U32{+w}:
      %Equal.sym(Maybe<&2, Nat>, G.Tr.get(32n, G.TE{}, w), None{}, L2.Tr.get_te(32n, w)) : {G.Graph.cnt_of(_) == 0n : Nat}
      {==}

def Part.fin(+c: Nat, +k: Nat, hB: {k == Nat.add(c, 0n) : Nat}, hA: {k == 1n : Nat}) -> {c == 1n : Nat}:
  Equal.trans(Nat, c, k, 1n, Equal.trans(Nat, c, Nat.add(c, 0n), k, Equal.sym(Nat, Nat.add(c, 0n), c, N.Nat.add_zero(c)), Equal.sym(Nat, k, Nat.add(c, 0n), hB)), hA)

def Part.rw(+k: Nat, +c: Nat, +y: U32, hz: {G.Graph.cnt_of(G.Tr.getu(G.TE{}, y)) == 0n : Nat}, hB: {k == Nat.add(c, G.Graph.cnt_of(G.Tr.getu(G.TE{}, y))) : Nat}) -> {k == Nat.add(c, 0n) : Nat}:
  %hz : {k == Nat.add(c, _) : Nat}
  hB

def Part.add0(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +p: Nat, ok: {G.Graph.part_rows(adj, 0, G.Graph.cnt_all(List.concat(&2, U32, cs), G.TE{})) == True{} : Bool}, hp: {Nat.is_lt(p, List.length(&2, List<&2, U32>, adj)) == True{} : Bool}) -> {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(List.concat(&2, U32, cs), G.TE{}), U32.from_nat(p))) == 1n : Nat}:
  %N.Nat.add_zero(p) : {G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(List.concat(&2, U32, cs), G.TE{}), U32.from_nat(_))) == 1n : Nat}
  Part.sound(adj, 0n, 0, G.Graph.cnt_all(List.concat(&2, U32, cs), G.TE{}), p, {==}, ok, hp)

def Part.at(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +p: Nat, ok: {G.Graph.part_rows(adj, 0, G.Graph.cnt_all(List.concat(&2, U32, cs), G.TE{})) == True{} : Bool}, hp: {Nat.is_lt(p, List.length(&2, List<&2, U32>, adj)) == True{} : Bool}) -> {Laws.Count(List.concat(&2, U32, cs), U32.from_nat(p)) == 1n : Nat}:
  Part.fin(Laws.Count(List.concat(&2, U32, cs), U32.from_nat(p)), G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(List.concat(&2, U32, cs), G.TE{}), U32.from_nat(p))), Part.rw(G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(List.concat(&2, U32, cs), G.TE{}), U32.from_nat(p))), Laws.Count(List.concat(&2, U32, cs), U32.from_nat(p)), U32.from_nat(p), Te.cnt(U32.from_nat(p)), Cnt.sound(List.concat(&2, U32, cs), G.TE{}, U32.from_nat(p))), Part.add0(adj, cs, p, ok, hp))

