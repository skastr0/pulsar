import Base
import ./LAWS.bend as Laws
import ./Graph.bend as G
import ./Nat2.bend as N
import ./Lemmas.bend as L

# ---- the Tr map -------------------------------------------------------------------------
def Tr.get_te(n: Nat, w: Word(n)) -> {G.Tr.get(n, G.TE{}, w) == None{} : Maybe<&2, Nat>}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      match w:
        case WCon{False{}, wt}:
          Tr.get_te(p, wt)
        case WCon{True{}, wt}:
          Tr.get_te(p, wt)

def Some.val(m: Maybe<&2, Nat>) -> Nat:
  match m:
    case None{}:
      0n
    case Some{x}:
      x

def Some.inj(+x: Nat, +j: Nat, e: {Some{x} == Some{j} : Maybe<&2, Nat>}) -> {x == j : Nat}:
  Equal.cong(Maybe<&2, Nat>, Nat, Some.val, Some{x}, Some{j}, e)

def Put.lift(-H: Data, p: Nat, +b: Bool, +wt: Word(p), +wt2: Word(p), +x: Nat, +j: Nat, o: Either<&2, &2, Laws.And({wt == wt2 : Word(p)}, {x == j : Nat}), H>) -> Either<&2, &2, Laws.And({WCon{b, wt} == WCon{b, wt2} : Word.Con<p>}, {x == j : Nat}), H>:
  match o:
    case Inl{pr}:
      match pr:
        case Tuple{h1, h2}:
          Inl{Tuple{Equal.cong(Word(p), Word.Con<p>, w => WCon{b, w}, wt, wt2, h1), h2}}
    case Inr{h}:
      Inr{h}

# A lookup that finds j after Tr.put(w, x) either hit the new key, or was already there.
def Put.sound(+n: Nat, +t: G.Tr, +w: Word(n), +x: Nat, +w2: Word(n), +j: Nat, e: {G.Tr.get(n, G.Tr.put(n, t, w, x), w2) == Some{j} : Maybe<&2, Nat>}) -> Either<&2, &2, Laws.And({w == w2 : Word(n)}, {x == j : Nat}), {G.Tr.get(n, t, w2) == Some{j} : Maybe<&2, Nat>}>:
  match n:
    case 0n:
      match w w2:
        case WNil{} WNil{}:
          Inl{Tuple{{==}, Some.inj(x, j, e)}}
    case 1n+p:
      match w w2:
        case WCon{False{}, wt} WCon{False{}, wt2}:
          Put.lift({G.Tr.get(1n+p, t, WCon{False{}, wt2}) == Some{j} : Maybe<&2, Nat>}, p, False{}, wt, wt2, x, j, Put.sound(p, G.Tr.z(t), wt, x, wt2, j, e))
        case WCon{False{}, wt} WCon{True{}, wt2}:
          Inr{e}
        case WCon{True{}, wt} WCon{False{}, wt2}:
          Inr{e}
        case WCon{True{}, wt} WCon{True{}, wt2}:
          Put.lift({G.Tr.get(1n+p, t, WCon{True{}, wt2}) == Some{j} : Maybe<&2, Nat>}, p, True{}, wt, wt2, x, j, Put.sound(p, G.Tr.o(t), wt, x, wt2, j, e))

def Disc.Maybe(m: Maybe<&2, Nat>) -> Type:
  match m:
    case None{}:
      Empty
    case Some{_}:
      Unit

def None.ne_some(+j: Nat, e: {None{} == Some{j} : Maybe<&2, Nat>}) -> Empty:
  %Equal.sym(Maybe<&2, Nat>, None{}, Some{j}, e) : Disc.Maybe(_)
  Unit{}

def NthL(cs: List<&2, List<&2, U32>>, m: Nat) -> List<&2, U32>:
  match cs m:
    case Nil{} _:
      Nil{}
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      NthL(t, p)

def Putu.lift(-H: Data, +wx: Word(32n), +wy: Word(32n), +v: Nat, +j: Nat, o: Either<&2, &2, Laws.And({wx == wy : Word(32n)}, {v == j : Nat}), H>) -> Either<&2, &2, Laws.And({U32{wx} == U32{wy} : U32}, {v == j : Nat}), H>:
  match o:
    case Inl{pr}:
      match pr:
        case Tuple{h1, h2}:
          Inl{Tuple{Equal.cong(Word(32n), U32, w => U32{w}, wx, wy, h1), h2}}
    case Inr{h}:
      Inr{h}

def Putu.sound(+t: G.Tr, +x: U32, +v: Nat, +y: U32, +j: Nat, e: {G.Tr.getu(G.Tr.putu(t, x, v), y) == Some{j} : Maybe<&2, Nat>}) -> Either<&2, &2, Laws.And({x == y : U32}, {v == j : Nat}), {G.Tr.getu(t, y) == Some{j} : Maybe<&2, Nat>}>:
  match x y:
    case U32{+wx} U32{+wy}:
      Putu.lift({G.Tr.getu(t, U32{wy}) == Some{j} : Maybe<&2, Nat>}, wx, wy, v, j, Put.sound(32n, t, wx, v, wy, j, e))

def Ic.k2(+x: U32, +y: U32, +r: List<&2, U32>, +k: Nat, +j: Nat, +tr: G.Tr, o: Either<&2, &2, Laws.And({x == y : U32}, {k == j : Nat}), {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}>) -> Either<&2, &2, Laws.And(Laws.Mem(Con{x, r}, y), {k == j : Nat}), {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}>:
  match o:
    case Inl{pr}:
      match pr:
        case Tuple{h1, h2}:
          Inl{Tuple{Inl{h1}, h2}}
    case Inr{h}:
      Inr{h}

def Ic.k(+x: U32, +y: U32, +r: List<&2, U32>, +k: Nat, +j: Nat, +tr: G.Tr, o: Either<&2, &2, Laws.And(Laws.Mem(r, y), {k == j : Nat}), {G.Tr.getu(G.Tr.putu(tr, x, k), y) == Some{j} : Maybe<&2, Nat>}>) -> Either<&2, &2, Laws.And(Laws.Mem(Con{x, r}, y), {k == j : Nat}), {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}>:
  match o:
    case Inl{pr}:
      match pr:
        case Tuple{h1, h2}:
          Inl{Tuple{Inr{h1}, h2}}
    case Inr{h}:
      Ic.k2(x, y, r, k, j, tr, Putu.sound(tr, x, k, y, j, h))

def Ic.sound(c: List<&2, U32>, +k: Nat, +tr: G.Tr, +y: U32, +j: Nat, e: {G.Tr.getu(G.Graph.ins_comp(c, k, tr), y) == Some{j} : Maybe<&2, Nat>}) -> Either<&2, &2, Laws.And(Laws.Mem(c, y), {k == j : Nat}), {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}>:
  match c:
    case Nil{}:
      Inr{e}
    case Con{+x, +r}:
      Ic.k(x, y, r, k, j, tr, Ic.sound(r, k, G.Tr.putu(tr, x, k), y, j, e))

# ---- component numbers -----------------------------------------------------------------
# y has number j: it is a member of the j-th component (counting from offset k).
def InC(cs: List<&2, List<&2, U32>>, k: Nat, y: U32, j: Nat) -> Data:
  Laws.Ex(Nat, m => Laws.And({j == Nat.add(m, k) : Nat}, Laws.Mem(NthL(cs, m), y)))

def Ids.k2(+c: List<&2, U32>, +t: List<&2, List<&2, U32>>, +k: Nat, +y: U32, +j: Nat, +tr: G.Tr, o: Either<&2, &2, Laws.And(Laws.Mem(c, y), {k == j : Nat}), {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}>) -> Either<&2, &2, InC(Con{c, t}, k, y, j), {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}>:
  match o:
    case Inl{pr}:
      match pr:
        case Tuple{hm, hk}:
          Inl{Tuple{0n, Tuple{Equal.sym(Nat, k, j, hk), hm}}}
    case Inr{h}:
      Inr{h}

def Ids.step(m: Nat, +j: Nat, +k: Nat, hj: {j == Nat.add(m, 1n+k) : Nat}) -> {j == Nat.add(1n+m, k) : Nat}:
  Equal.trans(Nat, j, Nat.add(m, 1n+k), 1n+Nat.add(m, k), hj, N.Nat.add_succ_r(m, k))

def Ids.fin(+c: List<&2, U32>, +t: List<&2, List<&2, U32>>, +k: Nat, +y: U32, +j: Nat, +tr: G.Tr, o: Either<&2, &2, InC(t, 1n+k, y, j), {G.Tr.getu(G.Graph.ins_comp(c, k, tr), y) == Some{j} : Maybe<&2, Nat>}>) -> Either<&2, &2, InC(Con{c, t}, k, y, j), {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}>:
  match o:
    case Inl{ex}:
      match ex:
        case Tuple{+m, pr}:
          match pr:
            case Tuple{hj, hm}:
              Inl{Tuple{1n+m, Tuple{Ids.step(m, j, k, hj), hm}}}
    case Inr{h}:
      Ids.k2(c, t, k, y, j, tr, Ic.sound(c, k, tr, y, j, h))

def Ids.sound(cs: List<&2, List<&2, U32>>, +k: Nat, +tr: G.Tr, +y: U32, +j: Nat, e: {G.Tr.getu(G.Graph.ids(cs, k, tr), y) == Some{j} : Maybe<&2, Nat>}) -> Either<&2, &2, InC(cs, k, y, j), {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}>:
  match cs:
    case Nil{}:
      Inr{e}
    case Con{+c, +t}:
      Ids.fin(c, t, k, y, j, tr, Ids.sound(t, 1n+k, G.Graph.ins_comp(c, k, tr), y, j, e))

def Top.none(+y: U32, +j: Nat, h: {G.Tr.getu(G.TE{}, y) == Some{j} : Maybe<&2, Nat>}) -> Empty:
  match y:
    case U32{+w}:
      None.ne_some(j, Equal.trans(Maybe<&2, Nat>, None{}, G.Tr.get(32n, G.TE{}, w), Some{j}, Equal.sym(Maybe<&2, Nat>, G.Tr.get(32n, G.TE{}, w), None{}, Tr.get_te(32n, w)), h))

def Top.k(+cs: List<&2, List<&2, U32>>, +y: U32, +j: Nat, o: Either<&2, &2, InC(cs, 0n, y, j), {G.Tr.getu(G.TE{}, y) == Some{j} : Maybe<&2, Nat>}>) -> Laws.Ex(Nat, m => Laws.And({j == m : Nat}, Laws.Mem(NthL(cs, m), y))):
  match o:
    case Inl{ex}:
      match ex:
        case Tuple{+m, pr}:
          match pr:
            case Tuple{hj, hm}:
              Tuple{m, Tuple{Equal.trans(Nat, j, Nat.add(m, 0n), m, hj, N.Nat.add_zero(m)), hm}}
    case Inr{h}:
      Empty.absurd(Laws.Ex(Nat, m => Laws.And({j == m : Nat}, Laws.Mem(NthL(cs, m), y))), Top.none(y, j, h))

# A node whose number is j belongs to the j-th component of cs.
def Ids.top(+cs: List<&2, List<&2, U32>>, +y: U32, +j: Nat, e: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), y) == Some{j} : Maybe<&2, Nat>}) -> Laws.Ex(Nat, m => Laws.And({j == m : Nat}, Laws.Mem(NthL(cs, m), y))):
  Top.k(cs, y, j, Ids.sound(cs, 0n, G.TE{}, y, j, e))

# ---- order on Nat --------------------------------------------------------------------------
def Le(a: Nat, b: Nat) -> Data:
  match a b:
    case 0n _:
      Unit
    case 1n+_ 0n:
      Empty
    case 1n+a2 1n+b2:
      Le(a2, b2)

def Le.of_bool(a: Nat, b: Nat, e: {Nat.is_le(a, b) == True{} : Bool}) -> Le(a, b):
  match a b:
    case 0n _:
      Unit{}
    case 1n+a2 0n:
      Empty.absurd(Empty, L.Bool.ff_tt(e))
    case 1n+a2 1n+b2:
      Le.of_bool(a2, b2, e)

def Le.trans(a: Nat, b: Nat, c: Nat, h1: Le(a, b), h2: Le(b, c)) -> Le(a, c):
  match a b c:
    case 0n _ _:
      Unit{}
    case 1n+a2 0n _:
      Empty.absurd(Le(1n+a2, c), h1)
    case 1n+a2 1n+b2 0n:
      Empty.absurd(Le(1n+a2, 0n), h2)
    case 1n+a2 1n+b2 1n+c2:
      Le.trans(a2, b2, c2, h1, h2)

def Le.anti(a: Nat, b: Nat, h1: Le(a, b), h2: Le(b, a)) -> {a == b : Nat}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+b2:
      Empty.absurd({0n == 1n+b2 : Nat}, h2)
    case 1n+a2 0n:
      Empty.absurd({1n+a2 == 0n : Nat}, h1)
    case 1n+a2 1n+b2:
      %Le.anti(a2, b2, h1, h2) : {1n+a2 == 1n+_ : Nat}
      {==}

# ---- numbers along edges --------------------------------------------------------------------
# mi and mj are numbers i <= j.
def LeM(mi: Maybe<&2, Nat>, mj: Maybe<&2, Nat>) -> Data:
  Laws.Ex(Nat, i => Laws.Ex(Nat, j => Laws.And(Laws.And({mi == Some{i} : Maybe<&2, Nat>}, {mj == Some{j} : Maybe<&2, Nat>}), Le(i, j))))

def LeOk.sound(mi: Maybe<&2, Nat>, mj: Maybe<&2, Nat>, e: {G.Graph.le_ok(mi, mj) == True{} : Bool}) -> LeM(mi, mj):
  match mi mj:
    case Some{+i} Some{+j}:
      Tuple{i, Tuple{j, Tuple{Tuple{{==}, {==}}, Le.of_bool(i, j, e)}}}
    case Some{+i2} None{}:
      Empty.absurd(LeM(Some{i2}, None{}), L.Bool.ff_tt(e))
    case None{} _:
      Empty.absurd(LeM(None{}, mj), L.Bool.ff_tt(e))

def Row.fin(+h: U32, +w: U32, +mi: Maybe<&2, Nat>, +tr: G.Tr, a: {G.Graph.le_ok(mi, G.Tr.getu(tr, h)) == True{} : Bool}, hh: {h == w : U32}) -> LeM(mi, G.Tr.getu(tr, w)):
  %hh : LeM(mi, G.Tr.getu(tr, _))
  LeOk.sound(mi, G.Tr.getu(tr, h), a)

def Row.k(+h: U32, +t: List<&2, U32>, +mi: Maybe<&2, Nat>, +tr: G.Tr, +w: U32, o: Laws.And({G.Graph.le_ok(mi, G.Tr.getu(tr, h)) == True{} : Bool}, {G.Graph.row_ok(t, mi, tr) == True{} : Bool}), hm: Laws.Mem(Con{h, t}, w), ih: {G.Graph.row_ok(t, mi, tr) == True{} : Bool} -> Laws.Mem(t, w) -> LeM(mi, G.Tr.getu(tr, w))) -> LeM(mi, G.Tr.getu(tr, w)):
  match o:
    case Tuple{a, b}:
      match hm:
        case Inl{hh}:
          Row.fin(h, w, mi, tr, a, hh)
        case Inr{h2}:
          ih(b, h2)

def Row.sound(ns: List<&2, U32>, +mi: Maybe<&2, Nat>, +tr: G.Tr, +w: U32, e: {G.Graph.row_ok(ns, mi, tr) == True{} : Bool}, hm: Laws.Mem(ns, w)) -> LeM(mi, G.Tr.getu(tr, w)):
  match ns:
    case Nil{}:
      Empty.absurd(LeM(mi, G.Tr.getu(tr, w)), hm)
    case Con{+h, +t}:
      Row.k(h, t, mi, tr, w, L.Bool.and_true(G.Graph.le_ok(mi, G.Tr.getu(tr, h)), G.Graph.row_ok(t, mi, tr), e), hm, y => z => Row.sound(t, mi, tr, w, y, z))

def Lei(+tr: G.Tr, x: U32, y: U32) -> Data:
  LeM(G.Tr.getu(tr, x), G.Tr.getu(tr, y))

def Mono.k0(+ns: List<&2, U32>, +t: List<&2, List<&2, U32>>, +p: Nat, +x: U32, +tr: G.Tr, +w: U32, hx: {x == U32.from_nat(p) : U32}, o: Laws.And({G.Graph.row_ok(ns, G.Tr.getu(tr, x), tr) == True{} : Bool}, {G.Graph.mono_ok(t, U32.inc(x), tr) == True{} : Bool}), hm: Laws.Mem(ns, w)) -> Lei(tr, U32.from_nat(p), w):
  match o:
    case Tuple{a, b}:
      %hx : LeM(G.Tr.getu(tr, _), G.Tr.getu(tr, w))
      Row.sound(ns, G.Tr.getu(tr, x), tr, w, a, hm)

def Mono.k1(+t: List<&2, List<&2, U32>>, +ns: List<&2, U32>, +p: Nat, +x: U32, +tr: G.Tr, +w: U32, +q2: Nat, o: Laws.And({G.Graph.row_ok(ns, G.Tr.getu(tr, x), tr) == True{} : Bool}, {G.Graph.mono_ok(t, U32.inc(x), tr) == True{} : Bool}), hm: Laws.Mem(Laws.Nth(t, q2), w), ih: {G.Graph.mono_ok(t, U32.inc(x), tr) == True{} : Bool} -> Laws.Mem(Laws.Nth(t, q2), w) -> Lei(tr, U32.from_nat(Nat.add(q2, 1n+p)), w)) -> Lei(tr, U32.from_nat(1n+Nat.add(q2, p)), w):
  match o:
    case Tuple{a, b}:
      %N.Nat.add_succ_r(q2, p) : Lei(tr, U32.from_nat(_), w)
      ih(b, hm)

# A numbered edge: from the node at position q of the suffix starting at p.
def Mono.sound(adj: List<&2, List<&2, U32>>, +p: Nat, +x: U32, +tr: G.Tr, +w: U32, +q: Nat, hx: {x == U32.from_nat(p) : U32}, e: {G.Graph.mono_ok(adj, x, tr) == True{} : Bool}, hm: Laws.Mem(Laws.Nth(adj, q), w)) -> Lei(tr, U32.from_nat(Nat.add(q, p)), w):
  match adj q:
    case Nil{} _:
      Empty.absurd(Lei(tr, U32.from_nat(Nat.add(q, p)), w), hm)
    case Con{+ns, +t} 0n:
      Mono.k0(ns, t, p, x, tr, w, hx, L.Bool.and_true(G.Graph.row_ok(ns, G.Tr.getu(tr, x), tr), G.Graph.mono_ok(t, U32.inc(x), tr), e), hm)
    case Con{+ns, +t} 1n+q2:
      Mono.k1(t, ns, p, x, tr, w, q2, L.Bool.and_true(G.Graph.row_ok(ns, G.Tr.getu(tr, x), tr), G.Graph.mono_ok(t, U32.inc(x), tr), e), hm, y => z => Mono.sound(t, 1n+p, U32.inc(x), tr, w, q2, Equal.cong(U32, U32, U32.inc, x, U32.from_nat(p), hx), y, z))

def Mono.top(adj: List<&2, List<&2, U32>>, +tr: G.Tr, +x: U32, +w: U32, e: {G.Graph.mono_ok(adj, 0, tr) == True{} : Bool}, hs: Laws.Succ(adj, x, w)) -> Lei(tr, x, w):
  %N.U32.round(x) : Lei(tr, _, w)
  %N.Nat.add_zero(U32.to_nat(x)) : Lei(tr, U32.from_nat(_), w)
  Mono.sound(adj, 0n, 0, tr, w, U32.to_nat(x), {==}, e, hs)

# ---- transitivity ------------------------------------------------------------------------------
def Le.rw(+j: Nat, +j2: Nat, +k: Nat, hj: {j2 == j : Nat}, le2: Le(j2, k)) -> Le(j, k):
  %hj : Le(_, k)
  le2

def Same.num(+tr: G.Tr, +y: U32, +i: Nat, +j: Nat, a: {G.Tr.getu(tr, y) == Some{i} : Maybe<&2, Nat>}, b: {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}) -> {i == j : Nat}:
  Some.inj(i, j, Equal.trans(Maybe<&2, Nat>, Some{i}, G.Tr.getu(tr, y), Some{j}, Equal.sym(Maybe<&2, Nat>, G.Tr.getu(tr, y), Some{i}, a), b))

def Lei.t3(+i: Nat, +j: Nat, +j2: Nat, +k: Nat, +tr: G.Tr, +x: U32, +y: U32, +z: U32, a: {G.Tr.getu(tr, x) == Some{i} : Maybe<&2, Nat>}, b: {G.Tr.getu(tr, y) == Some{j} : Maybe<&2, Nat>}, le1: Le(i, j), a2: {G.Tr.getu(tr, y) == Some{j2} : Maybe<&2, Nat>}, b2: {G.Tr.getu(tr, z) == Some{k} : Maybe<&2, Nat>}, le2: Le(j2, k)) -> Lei(tr, x, z):
  Tuple{i, Tuple{k, Tuple{Tuple{a, b2}, Le.trans(i, j, k, le1, Le.rw(j, j2, k, Same.num(tr, y, j2, j, a2, b), le2))}}}

def Lei.trans(+tr: G.Tr, +x: U32, +y: U32, +z: U32, h1: Lei(tr, x, y), h2: Lei(tr, y, z)) -> Lei(tr, x, z):
  match h1:
    case Tuple{+i, r1}:
      match r1:
        case Tuple{+j, r2}:
          match r2:
            case Tuple{ab, le1}:
              match ab:
                case Tuple{a, b}:
                  match h2:
                    case Tuple{+j2, s1}:
                      match s1:
                        case Tuple{+k, s2}:
                          match s2:
                            case Tuple{ab2, le2}:
                              match ab2:
                                case Tuple{a2, b2}:
                                  Lei.t3(i, j, j2, k, tr, x, y, z, a, b, le1, a2, b2, le2)

# Numbers do not decrease along a walk with at least one edge.
def Walk.lei(+k: Nat, +adj: List<&2, List<&2, U32>>, +tr: G.Tr, +x: U32, +y: U32, +e: {G.Graph.mono_ok(adj, 0, tr) == True{} : Bool}, wk: Laws.Walk(adj, 1n+k, x, y)) -> Lei(tr, x, y):
  match k:
    case 0n:
      match wk:
        case Tuple{+w, r}:
          match r:
            case Tuple{s, hw}:
              %hw : Lei(tr, x, _)
              Mono.top(adj, tr, x, w, e, s)
    case 1n+k2:
      match wk:
        case Tuple{+w, r}:
          match r:
            case Tuple{s, wk2}:
              Lei.trans(tr, x, w, y, Mono.top(adj, tr, x, w, e, s), Walk.lei(k2, adj, tr, w, y, e, wk2))

def Reach.lei2(+adj: List<&2, List<&2, U32>>, +tr: G.Tr, +u: U32, +w: U32, +v: U32, +k: Nat, +e: {G.Graph.mono_ok(adj, 0, tr) == True{} : Bool}, h: Lei(tr, u, w), wk: Laws.Walk(adj, k, w, v)) -> Lei(tr, u, v):
  match k:
    case 0n:
      %wk : Lei(tr, u, _)
      h
    case 1n+k2:
      Lei.trans(tr, u, w, v, h, Walk.lei(k2, adj, tr, w, v, e, wk))

def Reach.lei(+adj: List<&2, List<&2, U32>>, +tr: G.Tr, +u: U32, +v: U32, +e: {G.Graph.mono_ok(adj, 0, tr) == True{} : Bool}, r: Laws.Reach1(adj, u, v)) -> Lei(tr, u, v):
  match r:
    case Tuple{+w, r2}:
      match r2:
        case Tuple{s, r3}:
          match r3:
            case Tuple{+k, wk}:
              Reach.lei2(adj, tr, u, w, v, k, e, Mono.top(adj, tr, u, w, e, s), wk)

def Same(+tr: G.Tr, u: U32, v: U32) -> Data:
  Laws.Ex(Nat, j => Laws.And({G.Tr.getu(tr, u) == Some{j} : Maybe<&2, Nat>}, {G.Tr.getu(tr, v) == Some{j} : Maybe<&2, Nat>}))

def Le.rw2(+j: Nat, +i: Nat, +i2: Nat, hi: {i2 == i : Nat}, le: Le(j, i2)) -> Le(j, i):
  %hi : Le(j, _)
  le

def Num.rw(+tr: G.Tr, +v: U32, +i: Nat, +j: Nat, hij: {i == j : Nat}, b: {G.Tr.getu(tr, v) == Some{j} : Maybe<&2, Nat>}) -> {G.Tr.getu(tr, v) == Some{i} : Maybe<&2, Nat>}:
  %Equal.sym(Nat, i, j, hij) : {G.Tr.getu(tr, v) == Some{_} : Maybe<&2, Nat>}
  b

def Same.fin(+tr: G.Tr, +u: U32, +v: U32, +i: Nat, +j: Nat, +j2: Nat, +i2: Nat, +a: {G.Tr.getu(tr, u) == Some{i} : Maybe<&2, Nat>}, +b: {G.Tr.getu(tr, v) == Some{j} : Maybe<&2, Nat>}, le1: Le(i, j), +a2: {G.Tr.getu(tr, v) == Some{j2} : Maybe<&2, Nat>}, +b2: {G.Tr.getu(tr, u) == Some{i2} : Maybe<&2, Nat>}, le2: Le(j2, i2)) -> Same(tr, u, v):
  Tuple{i, Tuple{a, Num.rw(tr, v, i, j, Le.anti(i, j, le1, Le.rw2(j, i, i2, Same.num(tr, u, i2, i, b2, a), Le.rw(j, j2, i2, Same.num(tr, v, j2, j, a2, b), le2))), b)}}

def Same.of(+tr: G.Tr, +u: U32, +v: U32, h1: Lei(tr, u, v), h2: Lei(tr, v, u)) -> Same(tr, u, v):
  match h1:
    case Tuple{+i, r1}:
      match r1:
        case Tuple{+j, r2}:
          match r2:
            case Tuple{ab, le1}:
              match ab:
                case Tuple{a, b}:
                  match h2:
                    case Tuple{+j2, s1}:
                      match s1:
                        case Tuple{+i2, s2}:
                          match s2:
                            case Tuple{ab2, le2}:
                              match ab2:
                                case Tuple{a2, b2}:
                                  Same.fin(tr, u, v, i, j, j2, i2, a, b, le1, a2, b2, le2)

def Common.mem2(+cs: List<&2, List<&2, U32>>, +y: U32, +j: Nat, ex: Laws.Ex(Nat, m => Laws.And({j == m : Nat}, Laws.Mem(NthL(cs, m), y)))) -> Laws.Mem(NthL(cs, j), y):
  match ex:
    case Tuple{+m, pr}:
      match pr:
        case Tuple{hj, hm}:
          %Equal.sym(Nat, j, m, hj) : Laws.Mem(NthL(cs, _), y)
          hm

def Common.mem(+cs: List<&2, List<&2, U32>>, +y: U32, +j: Nat, e: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), y) == Some{j} : Maybe<&2, Nat>}) -> Laws.Mem(NthL(cs, j), y):
  Common.mem2(cs, y, j, Ids.top(cs, y, j, e))

# ---- from facts back to the Bool checks ----------------------------------------------------------
def Word.cmp_refl(+n: Nat, w: Word(n)) -> {Word.cmp(n, w, w) == EQ{} : Cmp}:
  match n:
    case 0n:
      match w:
        case WNil{}:
          {==}
    case 1n+p:
      match w:
        case WCon{False{}, +t}:
          %Equal.sym(Cmp, Word.cmp(p, t, t), EQ{}, Word.cmp_refl(p, t)) : {Word.cmp.fin(False{}, False{}, _) == EQ{} : Cmp}
          {==}
        case WCon{True{}, +t}:
          %Equal.sym(Cmp, Word.cmp(p, t, t), EQ{}, Word.cmp_refl(p, t)) : {Word.cmp.fin(True{}, True{}, _) == EQ{} : Cmp}
          {==}

def U32.eq_refl(a: U32) -> {U32.is_eq(a, a) == True{} : Bool}:
  match a:
    case U32{+w}:
      %Equal.sym(Cmp, Word.cmp(32n, w, w), EQ{}, Word.cmp_refl(32n, w)) : {Cmp.is_eq(_) == True{} : Bool}
      {==}

def Bool.or_r(a: Bool, b: Bool, hb: {b == True{} : Bool}) -> {Bool.or(a, b) == True{} : Bool}:
  match a:
    case False{}:
      hb
    case True{}:
      {==}

def Mem.k2(+h: U32, +w: U32, +t: List<&2, U32>, hh: {h == w : U32}) -> {G.Graph.mem(Con{h, t}, w) == True{} : Bool}:
  %hh : {Bool.or(U32.is_eq(h, _), G.Graph.mem(t, w)) == True{} : Bool}
  %Equal.sym(Bool, U32.is_eq(h, h), True{}, U32.eq_refl(h)) : {Bool.or(_, G.Graph.mem(t, w)) == True{} : Bool}
  {==}

def Mem.to_bool(xs: List<&2, U32>, +w: U32, hm: Laws.Mem(xs, w)) -> {G.Graph.mem(xs, w) == True{} : Bool}:
  match xs:
    case Nil{}:
      Empty.absurd({G.Graph.mem(Nil{}, w) == True{} : Bool}, hm)
    case Con{+h, +t}:
      match hm:
        case Inl{hh}:
          Mem.k2(h, w, t, hh)
        case Inr{h2}:
          Bool.or_r(U32.is_eq(h, w), G.Graph.mem(t, w), Mem.to_bool(t, w, h2))

def Edge.to_bool(+adj: List<&2, List<&2, U32>>, +u: U32, +w: U32, hs: Laws.Succ(adj, u, w)) -> {G.Graph.edge(adj, u, w) == True{} : Bool}:
  %Equal.sym(List<&2, U32>, G.Graph.nth(adj, U32.to_nat(u)), Laws.Nth(adj, U32.to_nat(u)), L.Nth.eq(adj, U32.to_nat(u))) : {G.Graph.mem(_, w) == True{} : Bool}
  Mem.to_bool(Laws.Nth(adj, U32.to_nat(u)), w, hs)

# ---- insertion sort keeps members (U32 lists) ---------------------------------------
def InsU.k(b: Bool, +x: U32, +h: U32, +t: List<&2, U32>, +r: List<&2, U32>, +y: U32, hm: Laws.Mem(Con{h, t}, y), ih: Laws.Mem(t, y) -> Laws.Mem(r, y)) -> Laws.Mem(G.Graph.ins_u_k(b, x, h, t, r), y):
  match b:
    case True{}:
      Inr{hm}
    case False{}:
      match hm:
        case Inl{e}:
          Inl{e}
        case Inr{h2}:
          Inr{ih(h2)}

def InsU.keep(xs: List<&2, U32>, +x: U32, +y: U32, hm: Laws.Mem(xs, y)) -> Laws.Mem(G.Graph.ins_u(xs, x), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.Mem(Con{x, Nil{}}, y), hm)
    case Con{+h, +t}:
      InsU.k(U32.is_le(x, h), x, h, t, G.Graph.ins_u(t, x), y, hm, z => InsU.keep(t, x, y, z))

def InsU.k2(b: Bool, +x: U32, +h: U32, +t: List<&2, U32>, +r: List<&2, U32>, ih: Laws.Mem(r, x)) -> Laws.Mem(G.Graph.ins_u_k(b, x, h, t, r), x):
  match b:
    case True{}:
      Inl{{==}}
    case False{}:
      Inr{ih}

def InsU.self(xs: List<&2, U32>, +x: U32) -> Laws.Mem(G.Graph.ins_u(xs, x), x):
  match xs:
    case Nil{}:
      Inl{{==}}
    case Con{+h, +t}:
      InsU.k2(U32.is_le(x, h), x, h, t, G.Graph.ins_u(t, x), InsU.self(t, x))

def Isort_u.k(+h: U32, +t: List<&2, U32>, +y: U32, hm: Laws.Mem(Con{h, t}, y), ih: Laws.Mem(t, y) -> Laws.Mem(G.Graph.isort_u(t), y)) -> Laws.Mem(G.Graph.ins_u(G.Graph.isort_u(t), h), y):
  match hm:
    case Inl{e}:
      %e : Laws.Mem(G.Graph.ins_u(G.Graph.isort_u(t), h), _)
      InsU.self(G.Graph.isort_u(t), h)
    case Inr{h2}:
      InsU.keep(G.Graph.isort_u(t), h, y, ih(h2))

def Isort_u.mem(xs: List<&2, U32>, +y: U32, hm: Laws.Mem(xs, y)) -> Laws.Mem(G.Graph.isort_u(xs), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.Mem(Nil{}, y), hm)
    case Con{+h, +t}:
      Isort_u.k(h, t, y, hm, z => Isort_u.mem(t, y, z))

# ---- insertion sort keeps members (lists of lists) ---------------------------------------
def InsL.k(b: Bool, +x: List<&2, U32>, +h: List<&2, U32>, +t: List<&2, List<&2, U32>>, +r: List<&2, List<&2, U32>>, +y: List<&2, U32>, hm: Laws.MemL(Con{h, t}, y), ih: Laws.MemL(t, y) -> Laws.MemL(r, y)) -> Laws.MemL(G.Graph.ins_l_k(b, x, h, t, r), y):
  match b:
    case True{}:
      Inr{hm}
    case False{}:
      match hm:
        case Inl{e}:
          Inl{e}
        case Inr{h2}:
          Inr{ih(h2)}

def InsL.keep(xs: List<&2, List<&2, U32>>, +x: List<&2, U32>, +y: List<&2, U32>, hm: Laws.MemL(xs, y)) -> Laws.MemL(G.Graph.ins_l(xs, x), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemL(Con{x, Nil{}}, y), hm)
    case Con{+h, +t}:
      InsL.k(G.Graph.list_le(x, h), x, h, t, G.Graph.ins_l(t, x), y, hm, z => InsL.keep(t, x, y, z))

def InsL.k2(b: Bool, +x: List<&2, U32>, +h: List<&2, U32>, +t: List<&2, List<&2, U32>>, +r: List<&2, List<&2, U32>>, ih: Laws.MemL(r, x)) -> Laws.MemL(G.Graph.ins_l_k(b, x, h, t, r), x):
  match b:
    case True{}:
      Inl{{==}}
    case False{}:
      Inr{ih}

def InsL.self(xs: List<&2, List<&2, U32>>, +x: List<&2, U32>) -> Laws.MemL(G.Graph.ins_l(xs, x), x):
  match xs:
    case Nil{}:
      Inl{{==}}
    case Con{+h, +t}:
      InsL.k2(G.Graph.list_le(x, h), x, h, t, G.Graph.ins_l(t, x), InsL.self(t, x))

def Isort_l.k(+h: List<&2, U32>, +t: List<&2, List<&2, U32>>, +y: List<&2, U32>, hm: Laws.MemL(Con{h, t}, y), ih: Laws.MemL(t, y) -> Laws.MemL(G.Graph.isort_l(t), y)) -> Laws.MemL(G.Graph.ins_l(G.Graph.isort_l(t), h), y):
  match hm:
    case Inl{e}:
      %e : Laws.MemL(G.Graph.ins_l(G.Graph.isort_l(t), h), _)
      InsL.self(G.Graph.isort_l(t), h)
    case Inr{h2}:
      InsL.keep(G.Graph.isort_l(t), h, y, ih(h2))

def Isort_l.mem(xs: List<&2, List<&2, U32>>, +y: List<&2, U32>, hm: Laws.MemL(xs, y)) -> Laws.MemL(G.Graph.isort_l(xs), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemL(Nil{}, y), hm)
    case Con{+h, +t}:
      Isort_l.k(h, t, y, hm, z => Isort_l.mem(t, y, z))

# ---- candidates and certified output keep what they should ----------------------------------------
def PushL.in(b: Bool, +x: List<&2, U32>, acc: List<&2, List<&2, U32>>, +c: List<&2, U32>, hb: {b == True{} : Bool}, hx: {x == c : List<&2, U32>}) -> Laws.MemL(G.Graph.push_if(b, x, acc), c):
  match b:
    case False{}:
      Empty.absurd(Laws.MemL(acc, c), L.Bool.ff_tt(hb))
    case True{}:
      Inl{hx}

def PushL.keep(b: Bool, +x: List<&2, U32>, acc: List<&2, List<&2, U32>>, +c: List<&2, U32>, hm: Laws.MemL(acc, c)) -> Laws.MemL(G.Graph.push_if(b, x, acc), c):
  match b:
    case False{}:
      hm
    case True{}:
      Inr{hm}

def KeepCand.rw(+adj: List<&2, List<&2, U32>>, +c1: List<&2, U32>, +c: List<&2, U32>, h: {c1 == c : List<&2, U32>}, hc: {G.Graph.is_cand(c, G.Graph.selfs(adj)) == True{} : Bool}) -> {G.Graph.is_cand(c1, G.Graph.selfs(adj)) == True{} : Bool}:
  %Equal.sym(List<&2, U32>, c1, c, h) : {G.Graph.is_cand(_, G.Graph.selfs(adj)) == True{} : Bool}
  hc

def KeepCand.k(+adj: List<&2, List<&2, U32>>, +c1: List<&2, U32>, +t: List<&2, List<&2, U32>>, +c: List<&2, U32>, hm: Laws.MemL(Con{c1, t}, c), hc: {G.Graph.is_cand(c, G.Graph.selfs(adj)) == True{} : Bool}, ih: Laws.MemL(t, c) -> Laws.MemL(G.Graph.keep_cand(t, G.Graph.selfs(adj)), c)) -> Laws.MemL(G.Graph.keep_cand(Con{c1, t}, G.Graph.selfs(adj)), c):
  match hm:
    case Inl{+h}:
      PushL.in(G.Graph.is_cand(c1, G.Graph.selfs(adj)), c1, G.Graph.keep_cand(t, G.Graph.selfs(adj)), c, KeepCand.rw(adj, c1, c, h, hc), h)
    case Inr{h2}:
      PushL.keep(G.Graph.is_cand(c1, G.Graph.selfs(adj)), c1, G.Graph.keep_cand(t, G.Graph.selfs(adj)), c, ih(h2))

def KeepCand.mem(cs: List<&2, List<&2, U32>>, +adj: List<&2, List<&2, U32>>, +c: List<&2, U32>, hm: Laws.MemL(cs, c), +hc: {G.Graph.is_cand(c, G.Graph.selfs(adj)) == True{} : Bool}) -> Laws.MemL(G.Graph.keep_cand(cs, G.Graph.selfs(adj)), c):
  match cs:
    case Nil{}:
      Empty.absurd(Laws.MemL(Nil{}, c), hm)
    case Con{+c1, +t}:
      KeepCand.k(adj, c1, t, c, hm, hc, z => KeepCand.mem(t, adj, c, z, hc))

def SortM.k(+h: List<&2, U32>, +t: List<&2, List<&2, U32>>, +c: List<&2, U32>, hm: Laws.MemL(Con{h, t}, c), ih: Laws.MemL(t, c) -> Laws.MemL(G.Graph.sort_members(t), G.Graph.isort_u(c))) -> Laws.MemL(Con{G.Graph.isort_u(h), G.Graph.sort_members(t)}, G.Graph.isort_u(c)):
  match hm:
    case Inl{e}:
      Inl{Equal.cong(List<&2, U32>, List<&2, U32>, G.Graph.isort_u, h, c, e)}
    case Inr{h2}:
      Inr{ih(h2)}

def SortM.mem(cs: List<&2, List<&2, U32>>, +c: List<&2, U32>, hm: Laws.MemL(cs, c)) -> Laws.MemL(G.Graph.sort_members(cs), G.Graph.isort_u(c)):
  match cs:
    case Nil{}:
      Empty.absurd(Laws.MemL(Nil{}, G.Graph.isort_u(c)), hm)
    case Con{+h, +t}:
      SortM.k(h, t, c, hm, z => SortM.mem(t, c, z))

# A genuine cycle component is a candidate.
def Cand.mem(+cs: List<&2, List<&2, U32>>, +adj: List<&2, List<&2, U32>>, +c: List<&2, U32>, hm: Laws.MemL(cs, c), hc: {G.Graph.is_cand(c, G.Graph.selfs(adj)) == True{} : Bool}) -> Laws.MemL(G.Graph.candidates(adj, cs), G.Graph.isort_u(c)):
  Isort_l.mem(G.Graph.sort_members(G.Graph.keep_cand(cs, G.Graph.selfs(adj))), G.Graph.isort_u(c), SortM.mem(G.Graph.keep_cand(cs, G.Graph.selfs(adj)), c, KeepCand.mem(cs, adj, c, hm, hc)))

def KeepCert.k(+adj: List<&2, List<&2, U32>>, +c1: List<&2, U32>, +t: List<&2, List<&2, U32>>, +c: List<&2, U32>, o: Laws.And({G.Graph.certified(c1, adj) == True{} : Bool}, {G.Graph.all_cert(t, adj) == True{} : Bool}), hm: Laws.MemL(Con{c1, t}, c), ih: {G.Graph.all_cert(t, adj) == True{} : Bool} -> Laws.MemL(t, c) -> Laws.MemL(G.Graph.keep_certified(t, adj), c)) -> Laws.MemL(G.Graph.keep_certified(Con{c1, t}, adj), c):
  match o:
    case Tuple{a, b}:
      match hm:
        case Inl{h}:
          PushL.in(G.Graph.certified(c1, adj), c1, G.Graph.keep_certified(t, adj), c, a, h)
        case Inr{h2}:
          PushL.keep(G.Graph.certified(c1, adj), c1, G.Graph.keep_certified(t, adj), c, ih(b, h2))

def KeepCert.mem(cs: List<&2, List<&2, U32>>, +adj: List<&2, List<&2, U32>>, +c: List<&2, U32>, e: {G.Graph.all_cert(cs, adj) == True{} : Bool}, hm: Laws.MemL(cs, c)) -> Laws.MemL(G.Graph.keep_certified(cs, adj), c):
  match cs:
    case Nil{}:
      Empty.absurd(Laws.MemL(Nil{}, c), hm)
    case Con{+c1, +t}:
      KeepCert.k(adj, c1, t, c, L.Bool.and_true(G.Graph.certified(c1, adj), G.Graph.all_cert(t, adj), e), hm, y => z => KeepCert.mem(t, adj, c, y, z))

def NthL.memL(cs: List<&2, List<&2, U32>>, m: Nat, +y: U32, hm: Laws.Mem(NthL(cs, m), y)) -> Laws.MemL(cs, NthL(cs, m)):
  match cs m:
    case Nil{} _:
      Empty.absurd(Laws.MemL(Nil{}, Nil{}), hm)
    case Con{h, t} 0n:
      Inl{{==}}
    case Con{h, t} 1n+p:
      Inr{NthL.memL(t, p, y, hm)}

# ---- completeness ----------------------------------------------------------------------------------------
def Le.refl(a: Nat) -> Le(a, a):
  match a:
    case 0n:
      Unit{}
    case 1n+p:
      Le.refl(p)

def LeM.mk(+mi: Maybe<&2, Nat>, +mj: Maybe<&2, Nat>, +i: Nat, +j: Nat, a: {mi == Some{i} : Maybe<&2, Nat>}, b: {mj == Some{j} : Maybe<&2, Nat>}, le: Le(i, j)) -> LeM(mi, mj):
  Tuple{i, Tuple{j, Tuple{Tuple{a, b}, le}}}

def LeM.diag(+m: Maybe<&2, Nat>, +j: Nat, +b: {m == Some{j} : Maybe<&2, Nat>}) -> LeM(m, m):
  Tuple{j, Tuple{j, Tuple{Tuple{b, b}, Le.refl(j)}}}

def Lei.refl_r(+tr: G.Tr, +x: U32, +w: U32, h: Lei(tr, x, w)) -> Lei(tr, w, w):
  match h:
    case Tuple{+i, r1}:
      match r1:
        case Tuple{+j, r2}:
          match r2:
            case Tuple{ab, le}:
              match ab:
                case Tuple{a, b}:
                  LeM.diag(G.Tr.getu(tr, w), j, b)

def Num.eq2(+tr: G.Tr, +w: U32, +j: Nat, +j2: Nat, hj: {j2 == j : Nat}, b: {G.Tr.getu(tr, w) == Some{j2} : Maybe<&2, Nat>}) -> {G.Tr.getu(tr, w) == Some{j} : Maybe<&2, Nat>}:
  %hj : {G.Tr.getu(tr, w) == Some{_} : Maybe<&2, Nat>}
  b

# w joined x's component: w is a member of NthL(cs, j).
def Sing.mem(+cs: List<&2, List<&2, U32>>, +x: U32, +w: U32, +j: Nat, ax: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), x) == Some{j} : Maybe<&2, Nat>}, sm: Same(G.Graph.ids(cs, 0n, G.TE{}), x, w)) -> Laws.Mem(NthL(cs, j), w):
  match sm:
    case Tuple{+j2, pr}:
      match pr:
        case Tuple{a2, b2}:
          Common.mem(cs, w, j, Num.eq2(G.Graph.ids(cs, 0n, G.TE{}), w, j, j2, Same.num(G.Graph.ids(cs, 0n, G.TE{}), x, j2, j, a2, ax), b2))

# ---- self edges: the selfs_ok certificate covers every self edge -------------------------
def SO.fst(+a: Bool, +b: Bool, p: Laws.And({a == True{} : Bool}, {b == True{} : Bool})) -> {a == True{} : Bool}:
  match p:
    case Tuple{x, y}:
      x

def SO.snd(+a: Bool, +b: Bool, p: Laws.And({a == True{} : Bool}, {b == True{} : Bool})) -> {b == True{} : Bool}:
  match p:
    case Tuple{x, y}:
      y

def SO.imp(+a: Bool, +b: Bool, e: {Bool.or(Bool.not(a), b) == True{} : Bool}, ha: {a == True{} : Bool}) -> {b == True{} : Bool}:
  %ha : {Bool.or(Bool.not(_), b) == True{} : Bool}
  e

def SO.mrw(+xs: List<&2, U32>, +a: U32, +b: U32, h: {a == b : U32}, m: Laws.Mem(xs, a)) -> Laws.Mem(xs, b):
  %h : Laws.Mem(xs, _)
  m

def SO.trw(+s: G.Tr, +a: U32, +b: U32, h: {a == b : U32}, e: {G.Graph.in_tr(s, a) == True{} : Bool}) -> {G.Graph.in_tr(s, b) == True{} : Bool}:
  %h : {G.Graph.in_tr(s, _) == True{} : Bool}
  e

def SO.inc(+x: U32, +p: Nat, hx: {x == U32.from_nat(p) : U32}) -> {U32.inc(x) == U32.from_nat(1n+p) : U32}:
  %hx : {U32.inc(x) == U32.inc(_) : U32}
  {==}

def SO.here(+ns: List<&2, U32>, +t: List<&2, List<&2, U32>>, +s: G.Tr, +x: U32, +p: Nat, +hx: {x == U32.from_nat(p) : U32}, e: {Bool.and(Bool.or(Bool.not(G.Graph.mem(ns, x)), G.Graph.in_tr(s, x)), G.Graph.selfs_ok(t, U32.inc(x), s)) == True{} : Bool}, hm: Laws.Mem(ns, U32.from_nat(p))) -> {G.Graph.in_tr(s, U32.from_nat(p)) == True{} : Bool}:
  SO.trw(s, x, U32.from_nat(p), hx, SO.imp(G.Graph.mem(ns, x), G.Graph.in_tr(s, x), SO.fst(Bool.or(Bool.not(G.Graph.mem(ns, x)), G.Graph.in_tr(s, x)), G.Graph.selfs_ok(t, U32.inc(x), s), L.Bool.and_true(Bool.or(Bool.not(G.Graph.mem(ns, x)), G.Graph.in_tr(s, x)), G.Graph.selfs_ok(t, U32.inc(x), s), e)), Mem.to_bool(ns, x, SO.mrw(ns, U32.from_nat(p), x, Equal.sym(U32, x, U32.from_nat(p), hx), hm))))

def SO.eq(+n2: Nat, +p: Nat) -> {U32.from_nat(1n+Nat.add(n2, p)) == U32.from_nat(Nat.add(n2, 1n+p)) : U32}:
  %Equal.sym(Nat, Nat.add(n2, 1n+p), 1n+Nat.add(n2, p), N.Nat.add_succ_r(n2, p)) : {U32.from_nat(1n+Nat.add(n2, p)) == U32.from_nat(_) : U32}
  {==}

# Row n of adj, where adj starts at node x = from_nat(p), belongs to node from_nat(n + p).
def SO.go(adj: List<&2, List<&2, U32>>, +s: G.Tr, +x: U32, +p: Nat, +n: Nat, +hx: {x == U32.from_nat(p) : U32}, +e: {G.Graph.selfs_ok(adj, x, s) == True{} : Bool}, hm: Laws.Mem(Laws.Nth(adj, n), U32.from_nat(Nat.add(n, p)))) -> {G.Graph.in_tr(s, U32.from_nat(Nat.add(n, p))) == True{} : Bool}:
  match adj:
    case Nil{}:
      match n:
        case 0n:
          Empty.absurd({G.Graph.in_tr(s, U32.from_nat(Nat.add(0n, p))) == True{} : Bool}, hm)
        case 1n+n2:
          Empty.absurd({G.Graph.in_tr(s, U32.from_nat(Nat.add(1n+n2, p))) == True{} : Bool}, hm)
    case Con{+ns, +t}:
      match n:
        case 0n:
          SO.here(ns, t, s, x, p, hx, e, hm)
        case 1n+n2:
          +e2 = SO.snd(Bool.or(Bool.not(G.Graph.mem(ns, x)), G.Graph.in_tr(s, x)), G.Graph.selfs_ok(t, U32.inc(x), s), L.Bool.and_true(Bool.or(Bool.not(G.Graph.mem(ns, x)), G.Graph.in_tr(s, x)), G.Graph.selfs_ok(t, U32.inc(x), s), e))
          %N.Nat.add_succ_r(n2, p) : {G.Graph.in_tr(s, U32.from_nat(_)) == True{} : Bool}
          SO.go(t, s, U32.inc(x), 1n+p, n2, SO.inc(x, p, hx), e2, SO.mrw(Laws.Nth(t, n2), U32.from_nat(1n+Nat.add(n2, p)), U32.from_nat(Nat.add(n2, 1n+p)), SO.eq(n2, p), hm))

def SO.x(+x: U32) -> {x == U32.from_nat(Nat.add(U32.to_nat(x), 0n)) : U32}:
  %Equal.sym(Nat, Nat.add(U32.to_nat(x), 0n), U32.to_nat(x), N.Nat.add_zero(U32.to_nat(x))) : {x == U32.from_nat(_) : U32}
  Equal.sym(U32, U32.from_nat(U32.to_nat(x)), x, N.U32.round(x))

# A self edge x -> x puts x in Graph.selfs(adj), whenever the certificate passed.
def SelfC(+adj: List<&2, List<&2, U32>>, +x: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, hs: Laws.Succ(adj, x, x)) -> {G.Graph.in_tr(G.Graph.selfs(adj), x) == True{} : Bool}:
  SO.trw(G.Graph.selfs(adj), U32.from_nat(Nat.add(U32.to_nat(x), 0n)), x, Equal.sym(U32, x, U32.from_nat(Nat.add(U32.to_nat(x), 0n)), SO.x(x)), SO.go(adj, G.Graph.selfs(adj), 0, 0n, U32.to_nat(x), {==}, e3, SO.mrw(Laws.Nth(adj, U32.to_nat(x)), x, U32.from_nat(Nat.add(U32.to_nat(x), 0n)), SO.x(x), hs)))

def Sing.edge2(+adj: List<&2, List<&2, U32>>, +x: U32, +w: U32, hxw: {x == w : U32}, s: Laws.Succ(adj, x, w)) -> Laws.Succ(adj, x, x):
  %Equal.sym(U32, x, w, hxw) : Laws.Succ(adj, x, _)
  s

def Sing.k(+adj: List<&2, List<&2, U32>>, +x: U32, +w: U32, s: Laws.Succ(adj, x, w), hm: Laws.Mem(Con{x, Nil{}}, w)) -> Laws.Succ(adj, x, x):
  match hm:
    case Inl{+h}:
      Sing.edge2(adj, x, w, h, s)
    case Inr{em}:
      Empty.absurd(Laws.Succ(adj, x, x), em)

def Mem.rw(+c1: List<&2, U32>, +c2: List<&2, U32>, +w: U32, h: {c1 == c2 : List<&2, U32>}, m: Laws.Mem(c1, w)) -> Laws.Mem(c2, w):
  %h : Laws.Mem(_, w)
  m

def Sing.succ3(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +j: Nat, +x: U32, +w: U32, e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, ax: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), x) == Some{j} : Maybe<&2, Nat>}, hC: {NthL(cs, j) == Con{x, Nil{}} : List<&2, U32>}, s: Laws.Succ(adj, x, w), l1: Lei(G.Graph.ids(cs, 0n, G.TE{}), x, w), l2: Lei(G.Graph.ids(cs, 0n, G.TE{}), w, x)) -> Laws.Succ(adj, x, x):
  Sing.k(adj, x, w, s, Mem.rw(NthL(cs, j), Con{x, Nil{}}, w, hC, Sing.mem(cs, x, w, j, ax, Same.of(G.Graph.ids(cs, 0n, G.TE{}), x, w, l1, l2))))

# x numbered j, alone in component j, on a closed walk: x has a self edge.
def Sing.succ2(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +j: Nat, +x: U32, +w: U32, +k: Nat, +e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, ax: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), x) == Some{j} : Maybe<&2, Nat>}, hC: {NthL(cs, j) == Con{x, Nil{}} : List<&2, U32>}, +s: Laws.Succ(adj, x, w), wk: Laws.Walk(adj, k, w, x)) -> Laws.Succ(adj, x, x):
  Sing.succ3(adj, cs, j, x, w, e1, ax, hC, s, Mono.top(adj, G.Graph.ids(cs, 0n, G.TE{}), x, w, e1, s), Reach.lei2(adj, G.Graph.ids(cs, 0n, G.TE{}), w, w, x, k, e1, Lei.refl_r(G.Graph.ids(cs, 0n, G.TE{}), x, w, Mono.top(adj, G.Graph.ids(cs, 0n, G.TE{}), x, w, e1, s)), wk))

def Rw.reach(+adj: List<&2, List<&2, U32>>, +u: U32, +v: U32, +x: U32, hu: {x == u : U32}, hv: {x == v : U32}, r: Laws.Reach1(adj, u, v)) -> Laws.Reach1(adj, x, x):
  %Equal.sym(U32, x, u, hu) : Laws.Reach1(adj, _, x)
  %Equal.sym(U32, x, v, hv) : Laws.Reach1(adj, u, _)
  r

def Rw.num(+tr: G.Tr, +u: U32, +x: U32, +j: Nat, hu: {x == u : U32}, a: {G.Tr.getu(tr, u) == Some{j} : Maybe<&2, Nat>}) -> {G.Tr.getu(tr, x) == Some{j} : Maybe<&2, Nat>}:
  %Equal.sym(U32, x, u, hu) : {G.Tr.getu(tr, _) == Some{j} : Maybe<&2, Nat>}
  a

def Cand.single2(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +j: Nat, +x: U32, +w: U32, +k: Nat, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, ax: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), x) == Some{j} : Maybe<&2, Nat>}, hC: {NthL(cs, j) == Con{x, Nil{}} : List<&2, U32>}, s: Laws.Succ(adj, x, w), wk: Laws.Walk(adj, k, w, x)) -> {G.Graph.in_tr(G.Graph.selfs(adj), x) == True{} : Bool}:
  SelfC(adj, x, e3, Sing.succ2(adj, cs, j, x, w, k, e1, ax, hC, s, wk))

def Cand.single1(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +j: Nat, +x: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, ax: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), x) == Some{j} : Maybe<&2, Nat>}, hC: {NthL(cs, j) == Con{x, Nil{}} : List<&2, U32>}, r: Laws.Reach1(adj, x, x)) -> {G.Graph.in_tr(G.Graph.selfs(adj), x) == True{} : Bool}:
  match r:
    case Tuple{+w, r2}:
      match r2:
        case Tuple{s, r3}:
          match r3:
            case Tuple{+k, wk}:
              Cand.single2(adj, cs, j, x, w, k, e3, e1, ax, hC, s, wk)

def Cand.single(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +j: Nat, +x: U32, +u: U32, +v: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, ax: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), u) == Some{j} : Maybe<&2, Nat>}, hC: {NthL(cs, j) == Con{x, Nil{}} : List<&2, U32>}, +hu: {x == u : U32}, hv: {x == v : U32}, r1: Laws.Reach1(adj, u, v)) -> {G.Graph.in_tr(G.Graph.selfs(adj), x) == True{} : Bool}:
  Cand.single1(adj, cs, j, x, e3, e1, Rw.num(G.Graph.ids(cs, 0n, G.TE{}), u, x, j, hu, ax), hC, Rw.reach(adj, u, v, x, hu, hv, r1))

def Cand.s2(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +j: Nat, +x: U32, +u: U32, +v: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, ax: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), u) == Some{j} : Maybe<&2, Nat>}, hC: {NthL(cs, j) == Con{x, Nil{}} : List<&2, U32>}, hu: Laws.Mem(Con{x, Nil{}}, u), hv: Laws.Mem(Con{x, Nil{}}, v), r1: Laws.Reach1(adj, u, v)) -> {G.Graph.in_tr(G.Graph.selfs(adj), x) == True{} : Bool}:
  match hu:
    case Inl{h1}:
      match hv:
        case Inl{h2}:
          Cand.single(adj, cs, j, x, u, v, e3, e1, ax, hC, h1, h2, r1)
        case Inr{em}:
          Empty.absurd({G.Graph.in_tr(G.Graph.selfs(adj), x) == True{} : Bool}, em)
    case Inr{em}:
      Empty.absurd({G.Graph.in_tr(G.Graph.selfs(adj), x) == True{} : Bool}, em)

# The component holding u and v is a candidate cycle.
def Cand.is(c: List<&2, U32>, +adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +j: Nat, +u: U32, +v: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, ax: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), u) == Some{j} : Maybe<&2, Nat>}, hC: {NthL(cs, j) == c : List<&2, U32>}, hu: Laws.Mem(c, u), hv: Laws.Mem(c, v), r1: Laws.Reach1(adj, u, v)) -> {G.Graph.is_cand(c, G.Graph.selfs(adj)) == True{} : Bool}:
  match c:
    case Nil{}:
      Empty.absurd({G.Graph.is_cand(Nil{}, G.Graph.selfs(adj)) == True{} : Bool}, hu)
    case Con{+x, Nil{}}:
      Cand.s2(adj, cs, j, x, u, v, e3, e1, ax, hC, hu, hv, r1)
    case Con{+x, Con{+y, +r}}:
      {==}

def Done(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, u: U32, v: U32) -> Data:
  Laws.Ex(List<&2, U32>, c => Laws.And(Laws.MemL(G.Graph.keep_certified(G.Graph.candidates(adj, cs), adj), c), Laws.And(Laws.Mem(c, u), Laws.Mem(c, v))))

def Done.mk(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +u: U32, +v: U32, +c0: List<&2, U32>, +ok: {G.Graph.all_cert(G.Graph.candidates(adj, cs), adj) == True{} : Bool}, +hm: Laws.MemL(cs, c0), hc: {G.Graph.is_cand(c0, G.Graph.selfs(adj)) == True{} : Bool}, hu: Laws.Mem(c0, u), hv: Laws.Mem(c0, v)) -> Done(adj, cs, u, v):
  Tuple{G.Graph.isort_u(c0), Tuple{KeepCert.mem(G.Graph.candidates(adj, cs), adj, G.Graph.isort_u(c0), ok, Cand.mem(cs, adj, c0, hm, hc)), Tuple{Isort_u.mem(c0, u, hu), Isort_u.mem(c0, v, hv)}}}

def Complete.k2(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +j: Nat, +u: U32, +v: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, +e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, +ok: {G.Graph.all_cert(G.Graph.candidates(adj, cs), adj) == True{} : Bool}, a: {G.Tr.getu(G.Graph.ids(cs, 0n, G.TE{}), u) == Some{j} : Maybe<&2, Nat>}, r1: Laws.Reach1(adj, u, v), +hu: Laws.Mem(NthL(cs, j), u), +hv: Laws.Mem(NthL(cs, j), v)) -> Done(adj, cs, u, v):
  Done.mk(adj, cs, u, v, NthL(cs, j), ok, NthL.memL(cs, j, u, hu), Cand.is(NthL(cs, j), adj, cs, j, u, v, e3, e1, a, {==}, hu, hv, r1), hu, hv)

def Complete.k(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +u: U32, +v: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, +e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, +ok: {G.Graph.all_cert(G.Graph.candidates(adj, cs), adj) == True{} : Bool}, r1: Laws.Reach1(adj, u, v), s: Same(G.Graph.ids(cs, 0n, G.TE{}), u, v)) -> Done(adj, cs, u, v):
  match s:
    case Tuple{+j, pr}:
      match pr:
        case Tuple{+a, b}:
          Complete.k2(adj, cs, j, u, v, e3, e1, ok, a, r1, Common.mem(cs, u, j, a), Common.mem(cs, v, j, b))

def Complete.main(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +u: U32, +v: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, +e1: {G.Graph.mono_ok(adj, 0, G.Graph.ids(cs, 0n, G.TE{})) == True{} : Bool}, +ok: {G.Graph.all_cert(G.Graph.candidates(adj, cs), adj) == True{} : Bool}, +r1: Laws.Reach1(adj, u, v), r2: Laws.Reach1(adj, v, u)) -> Done(adj, cs, u, v):
  Complete.k(adj, cs, u, v, e3, e1, ok, r1, Same.of(G.Graph.ids(cs, 0n, G.TE{}), u, v, Reach.lei(adj, G.Graph.ids(cs, 0n, G.TE{}), u, v, e1, r1), Reach.lei(adj, G.Graph.ids(cs, 0n, G.TE{}), v, u, e1, r2)))

def Complete.conv(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>, +u: U32, +v: U32, d: Done(adj, cs, u, v)) -> Sigma<&1, &1, List<&2, U32>, c => Laws.And(Laws.MemL(G.Graph.keep_certified(G.Graph.candidates(adj, cs), adj), c), Laws.And(Laws.Mem(c, u), Laws.Mem(c, v)))>:
  match d:
    case Tuple{+c, pf}:
      Tuple{c, pf}

def Complete.fin(+adj: List<&2, List<&2, U32>>, +u: U32, +v: U32, +e3: {G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)) == True{} : Bool}, o: Laws.And({G.Graph.mono_ok(adj, 0, G.Graph.ids(G.Graph.sccs(adj), 0n, G.TE{})) == True{} : Bool}, {G.Graph.all_cert(G.Graph.candidates(adj, G.Graph.sccs(adj)), adj) == True{} : Bool}), +r1: Laws.Reach1(adj, u, v), r2: Laws.Reach1(adj, v, u)) -> Sigma<&1, &1, List<&2, U32>, c => Laws.And(Laws.MemL(G.Graph.keep_certified(G.Graph.candidates(adj, G.Graph.sccs(adj)), adj), c), Laws.And(Laws.Mem(c, u), Laws.Mem(c, v)))>:
  match o:
    case Tuple{e1, e2}:
      Complete.conv(adj, G.Graph.sccs(adj), u, v, Complete.main(adj, G.Graph.sccs(adj), u, v, e3, e1, e2, r1, r2))
