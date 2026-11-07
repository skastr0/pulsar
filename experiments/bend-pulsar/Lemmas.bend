import Base
import ./LAWS.bend as Laws
import ./Graph.bend as G

def And.fst(-A: Data, -B: Data, p: Laws.And(A, B)) -> A:
  match p:
    case Tuple{a, b}:
      a

def And.snd(-A: Data, -B: Data, p: Laws.And(A, B)) -> B:
  match p:
    case Tuple{a, b}:
      b
# --- word eq reflection
law Cmp.eq_true:
  for c: Cmp
  for e: {Cmp.is_eq(c) == True{} : Bool}
  {c == EQ{} : Cmp}

def Disc.Bool(b: Bool) -> Type:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

def Bool.ff_tt(e: {False{} == True{} : Bool}) -> Empty:
  %Equal.sym(Bool, False{}, True{}, e) : Disc.Bool(_)
  Unit{}

def Cmp.eq_true(c, e):
  match c:
    case LT{}:
      Empty.absurd({LT{} == EQ{} : Cmp}, Bool.ff_tt(e))
    case EQ{}:
      {==}
    case GT{}:
      Empty.absurd({GT{} == EQ{} : Cmp}, Bool.ff_tt(e))

law Bool.cmp_eq:
  for a: Bool
  for b: Bool
  for e: {Bool.cmp(a, b) == EQ{} : Cmp}
  {a == b : Bool}

def Disc.Cmp(c: Cmp) -> Type:
  match c:
    case EQ{}:
      Empty
    case o:
      Unit

def Cmp.lt_eq(e: {LT{} == EQ{} : Cmp}) -> Empty:
  %e : Disc.Cmp(_)
  Unit{}

def Cmp.gt_eq(e: {GT{} == EQ{} : Cmp}) -> Empty:
  %e : Disc.Cmp(_)
  Unit{}

def Bool.cmp_eq(a, b, e):
  match a b:
    case False{} False{}:
      {==}
    case False{} True{}:
      Empty.absurd({False{} == True{} : Bool}, Cmp.lt_eq(e))
    case True{} False{}:
      Empty.absurd({True{} == False{} : Bool}, Cmp.gt_eq(e))
    case True{} True{}:
      {==}

law Word.cmp_eq:
  for +n: Nat
  for a: Word(n)
  for b: Word(n)
  for e: {Word.cmp(n, a, b) == EQ{} : Cmp}
  {a == b : Word(n)}

law Word.cmp_fin_eq:
  for ab: Bool
  for bb: Bool
  for t: Cmp
  for e: {Word.cmp.fin(ab, bb, t) == EQ{} : Cmp}
  Laws.And({t == EQ{} : Cmp}, {ab == bb : Bool})

def Word.cmp_fin_eq(ab, bb, t, e):
  match t:
    case LT{}:
      Empty.absurd(Laws.And({LT{} == EQ{} : Cmp}, {ab == bb : Bool}), Cmp.lt_eq(e))
    case EQ{}:
      Tuple{{==}, Bool.cmp_eq(ab, bb, e)}
    case GT{}:
      Empty.absurd(Laws.And({GT{} == EQ{} : Cmp}, {ab == bb : Bool}), Cmp.gt_eq(e))

def Word.cmp_eq(n, a, b, e):
  match n:
    case 0n:
      match a b:
        case WNil{} WNil{}:
          {==}
    case 1n+p:
      match a b:
        case WCon{+ab, +at} WCon{+bb, +bt}:
          +pr = Word.cmp_fin_eq(ab, bb, Word.cmp(p, at, bt), e)
          e2 = And.snd({Word.cmp(p, at, bt) == EQ{} : Cmp}, {ab == bb : Bool}, pr)
          ih = Word.cmp_eq(p, at, bt, And.fst({Word.cmp(p, at, bt) == EQ{} : Cmp}, {ab == bb : Bool}, pr))
          %ih : {WCon{ab, at} == WCon{bb, _} : Word.Con<p>}
          %e2 : {WCon{ab, at} == WCon{_, at} : Word.Con<p>}
          {==}

law U32.eq_sound:
  for a: U32
  for b: U32
  for e: {U32.is_eq(a, b) == True{} : Bool}
  {a == b : U32}

def U32.eq_sound(a, b, e):
  match a b:
    case U32{+x} U32{+y}:
      ec = Cmp.eq_true(Word.cmp(32n, x, y), e)
      h = Word.cmp_eq(32n, x, y, ec)
      %h : {U32{x} == U32{_} : U32}
      {==}

# ---- Bool ------------------------------------------------------------------------
def Bool.and_true(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> Laws.And({a == True{} : Bool}, {b == True{} : Bool}):
  match a:
    case False{}:
      Empty.absurd(Laws.And({False{} == True{} : Bool}, {b == True{} : Bool}), Bool.ff_tt(e))
    case True{}:
      Tuple{{==}, e}

def Bool.or_true(a: Bool, b: Bool, e: {Bool.or(a, b) == True{} : Bool}) -> Either<&2, &2, {a == True{} : Bool}, {b == True{} : Bool}>:
  match a:
    case False{}:
      Inr{e}
    case True{}:
      Inl{{==}}

# ---- membership ------------------------------------------------------------------
def Mem.k(h: U32, t: List<&2, U32>, +w: U32, o: Either<&2, &2, {U32.is_eq(h, w) == True{} : Bool}, {G.Graph.mem(t, w) == True{} : Bool}>, ih: {G.Graph.mem(t, w) == True{} : Bool} -> Laws.Mem(t, w)) -> Laws.Mem(Con{h, t}, w):
  match o:
    case Inl{x}:
      Inl{U32.eq_sound(h, w, x)}
    case Inr{y}:
      Inr{ih(y)}

def Mem.of_bool(xs: List<&2, U32>, +w: U32, e: {G.Graph.mem(xs, w) == True{} : Bool}) -> Laws.Mem(xs, w):
  match xs:
    case Nil{}:
      Empty.absurd(Empty, Bool.ff_tt(e))
    case Con{+h, +t}:
      Mem.k(h, t, w, Bool.or_true(U32.is_eq(h, w), G.Graph.mem(t, w), e), y => Mem.of_bool(t, w, y))

# ---- edges ------------------------------------------------------------------------
def Nth.eq(adj: List<&2, List<&2, U32>>, n: Nat) -> {G.Graph.nth(adj, n) == Laws.Nth(adj, n) : List<&2, U32>}:
  match adj n:
    case Nil{} _:
      {==}
    case Con{h, t} 0n:
      {==}
    case Con{h, t} 1n+p:
      Nth.eq(t, p)

def Edge.of_bool(+adj: List<&2, List<&2, U32>>, +u: U32, +w: U32, e: {G.Graph.edge(adj, u, w) == True{} : Bool}) -> Laws.Succ(adj, u, w):
  %Nth.eq(adj, U32.to_nat(u)) : Laws.Mem(_, w)
  Mem.of_bool(G.Graph.nth(adj, U32.to_nat(u)), w, e)

# ---- walks ------------------------------------------------------------------------
# Walk(k, a, b) then Walk(m, b, c) gives Walk(k + m, a, c).
def Walk.cat(+adj: List<&2, List<&2, U32>>, k: Nat, +a: U32, +b: U32, +c: U32, +m: Nat, w1: Laws.Walk(adj, k, a, b), w2: Laws.Walk(adj, m, b, c)) -> Laws.Walk(adj, Nat.add(k, m), a, c):
  match k:
    case 0n:
      %Equal.sym(U32, a, b, w1) : Laws.Walk(adj, m, _, c)
      w2
    case 1n+p:
      match w1:
        case Tuple{+x, rest}:
          match rest:
            case Tuple{s, wk}:
              Tuple{x, Tuple{s, Walk.cat(adj, p, x, b, c, m, wk, w2)}}

def Path0.fin(+adj: List<&2, List<&2, U32>>, +u: U32, +w: U32, +v: U32, s: Laws.Succ(adj, u, w), r: Laws.Ex(Nat, k => Laws.Walk(adj, k, w, v))) -> Laws.Ex(Nat, k => Laws.Walk(adj, k, u, v)):
  match r:
    case Tuple{+k, wk}:
      Tuple{1n+k, Tuple{w, Tuple{s, wk}}}

def Path0.k(+adj: List<&2, List<&2, U32>>, +u: U32, +w: U32, t: List<&2, U32>, +v: U32, o: Laws.And({G.Graph.edge(adj, u, w) == True{} : Bool}, {G.Graph.path0(t, adj, w, v) == True{} : Bool}), ih: {G.Graph.path0(t, adj, w, v) == True{} : Bool} -> Laws.Ex(Nat, k => Laws.Walk(adj, k, w, v))) -> Laws.Ex(Nat, k => Laws.Walk(adj, k, u, v)):
  match o:
    case Tuple{a, b}:
      Path0.fin(adj, u, w, v, Edge.of_bool(adj, u, w, a), ih(b))

# A checked walk exists.
def Path0.sound(ws: List<&2, U32>, +adj: List<&2, List<&2, U32>>, +u: U32, +v: U32, e: {G.Graph.path0(ws, adj, u, v) == True{} : Bool}) -> Laws.Ex(Nat, k => Laws.Walk(adj, k, u, v)):
  match ws:
    case Nil{}:
      Tuple{0n, U32.eq_sound(u, v, e)}
    case Con{+w, +t}:
      Path0.k(adj, u, w, t, v, Bool.and_true(G.Graph.edge(adj, u, w), G.Graph.path0(t, adj, w, v), e), y => Path0.sound(t, adj, w, v, y))

def Path1.k(+adj: List<&2, List<&2, U32>>, +u: U32, +w: U32, t: List<&2, U32>, +v: U32, o: Laws.And({G.Graph.edge(adj, u, w) == True{} : Bool}, {G.Graph.path0(t, adj, w, v) == True{} : Bool})) -> Laws.Reach1(adj, u, v):
  match o:
    case Tuple{a, b}:
      Tuple{w, Tuple{Edge.of_bool(adj, u, w, a), Path0.sound(t, adj, w, v, b)}}

def Path1.sound(ws: List<&2, U32>, +adj: List<&2, List<&2, U32>>, +u: U32, +v: U32, e: {G.Graph.path1(ws, adj, u, v) == True{} : Bool}) -> Laws.Reach1(adj, u, v):
  match ws:
    case Nil{}:
      Empty.absurd(Laws.Reach1(adj, u, v), Bool.ff_tt(e))
    case Con{+w, +t}:
      Path1.k(adj, u, w, t, v, Bool.and_true(G.Graph.edge(adj, u, w), G.Graph.path0(t, adj, w, v), e))

def Reach.trans(+adj: List<&2, List<&2, U32>>, +u: U32, +r: U32, +v: U32, h1: Laws.Reach1(adj, u, r), h2: Laws.Reach1(adj, r, v)) -> Laws.Reach1(adj, u, v):
  match h1:
    case Tuple{+w, rest}:
      match rest:
        case Tuple{s, kw}:
          match kw:
            case Tuple{+k, wk}:
              match h2:
                case Tuple{+w2, rest2}:
                  match rest2:
                    case Tuple{s2, kw2}:
                      match kw2:
                        case Tuple{+k2, wk2}:
                          Tuple{w, Tuple{s, Tuple{Nat.add(k, 1n+k2), Walk.cat(adj, k, w, r, v, 1n+k2, wk, Tuple{w2, Tuple{s2, wk2}})}}}

# ---- certificate soundness ----------------------------------------------------------
def Both(adj: List<&2, List<&2, U32>>, r: U32, v: U32) -> Data:
  Laws.And(Laws.Reach1(adj, r, v), Laws.Reach1(adj, v, r))

def Member.fin2(+adj: List<&2, List<&2, U32>>, +r: U32, +v: U32, +up: List<&2, U32>, +down: List<&2, U32>, o: Laws.And({G.Graph.path1(up, adj, r, v) == True{} : Bool}, {G.Graph.path1(down, adj, v, r) == True{} : Bool})) -> Both(adj, r, v):
  match o:
    case Tuple{p1, p2}:
      Tuple{Path1.sound(up, adj, r, v, p1), Path1.sound(down, adj, v, r, p2)}

def Member.fin1(+adj: List<&2, List<&2, U32>>, +r: U32, +v1: U32, +v: U32, +up: List<&2, U32>, +down: List<&2, U32>, a: {G.Graph.member_ok(adj, r, v1, up, down) == True{} : Bool}, h: {v1 == v : U32}) -> Both(adj, r, v):
  %h : Both(adj, r, _)
  Member.fin2(adj, r, v1, up, down, Bool.and_true(G.Graph.path1(up, adj, r, v1), G.Graph.path1(down, adj, v1, r), a))

def Members.k(+adj: List<&2, List<&2, U32>>, +r: U32, +v1: U32, +v: U32, +up: List<&2, U32>, +down: List<&2, U32>, +vt: List<&2, U32>, +ct: List<&2, G.Cert>, o: Laws.And({G.Graph.member_ok(adj, r, v1, up, down) == True{} : Bool}, {G.Graph.members_ok(vt, ct, adj, r) == True{} : Bool}), hm: Laws.Mem(Con{v1, vt}, v), ih: {G.Graph.members_ok(vt, ct, adj, r) == True{} : Bool} -> Laws.Mem(vt, v) -> Both(adj, r, v)) -> Both(adj, r, v):
  match o:
    case Tuple{a, b}:
      match hm:
        case Inl{h}:
          Member.fin1(adj, r, v1, v, up, down, a, h)
        case Inr{h2}:
          ih(b, h2)

def Members.sound(c: List<&2, U32>, cs: List<&2, G.Cert>, +adj: List<&2, List<&2, U32>>, +r: U32, +v: U32, e: {G.Graph.members_ok(c, cs, adj, r) == True{} : Bool}, hm: Laws.Mem(c, v)) -> Both(adj, r, v):
  match c cs:
    case Nil{} Nil{}:
      Empty.absurd(Both(adj, r, v), hm)
    case Nil{} Con{_, _}:
      Empty.absurd(Both(adj, r, v), Bool.ff_tt(e))
    case Con{_, _} Nil{}:
      Empty.absurd(Both(adj, r, v), Bool.ff_tt(e))
    case Con{+v1, +vt} Con{G.Cert{+up, +down}, +ct}:
      Members.k(adj, r, v1, v, up, down, vt, ct, Bool.and_true(G.Graph.member_ok(adj, r, v1, up, down), G.Graph.members_ok(vt, ct, adj, r), e), hm, y => z => Members.sound(vt, ct, adj, r, v, y, z))

# A certified component: any two members are joined by a walk with an edge.
def Cert.sound(c: List<&2, U32>, +cs: List<&2, G.Cert>, +adj: List<&2, List<&2, U32>>, +u: U32, +v: U32, +e: {G.Graph.cert_ok(c, cs, adj) == True{} : Bool}, hu: Laws.Mem(c, u), hv: Laws.Mem(c, v)) -> Laws.Reach1(adj, u, v):
  match c:
    case Nil{}:
      Empty.absurd(Laws.Reach1(adj, u, v), hu)
    case Con{+r, +t}:
      Reach.trans(adj, u, r, v, And.snd(Laws.Reach1(adj, r, u), Laws.Reach1(adj, u, r), Members.sound(Con{r, t}, cs, adj, r, u, e, hu)), And.fst(Laws.Reach1(adj, r, v), Laws.Reach1(adj, v, r), Members.sound(Con{r, t}, cs, adj, r, v, e, hv)))

# ---- filtering by certificate ---------------------------------------------------------
def Push.mem(b: Bool, +x: List<&2, U32>, acc: List<&2, List<&2, U32>>, +c: List<&2, U32>, hm: Laws.MemL(G.Graph.push_if(b, x, acc), c)) -> Either<&2, &2, Laws.And({b == True{} : Bool}, {x == c : List<&2, U32>}), Laws.MemL(acc, c)>:
  match b:
    case False{}:
      Inr{hm}
    case True{}:
      match hm:
        case Inl{h}:
          Inl{Tuple{{==}, h}}
        case Inr{h}:
          Inr{h}

def Keep.fin(+adj: List<&2, List<&2, U32>>, +c1: List<&2, U32>, +c: List<&2, U32>, p: Laws.And({G.Graph.certified(c1, adj) == True{} : Bool}, {c1 == c : List<&2, U32>})) -> {G.Graph.certified(c, adj) == True{} : Bool}:
  match p:
    case Tuple{a, h}:
      %h : {G.Graph.certified(_, adj) == True{} : Bool}
      a

def Keep.k(+adj: List<&2, List<&2, U32>>, +c1: List<&2, U32>, t: List<&2, List<&2, U32>>, +c: List<&2, U32>, o: Either<&2, &2, Laws.And({G.Graph.certified(c1, adj) == True{} : Bool}, {c1 == c : List<&2, U32>}), Laws.MemL(G.Graph.keep_certified(t, adj), c)>, ih: Laws.MemL(G.Graph.keep_certified(t, adj), c) -> {G.Graph.certified(c, adj) == True{} : Bool}) -> {G.Graph.certified(c, adj) == True{} : Bool}:
  match o:
    case Inl{p}:
      Keep.fin(adj, c1, c, p)
    case Inr{h}:
      ih(h)

# Everything Graph.keep_certified returns is certified.
def Keep.sound(cs: List<&2, List<&2, U32>>, +adj: List<&2, List<&2, U32>>, +c: List<&2, U32>, hm: Laws.MemL(G.Graph.keep_certified(cs, adj), c)) -> {G.Graph.certified(c, adj) == True{} : Bool}:
  match cs:
    case Nil{}:
      Empty.absurd({G.Graph.certified(c, adj) == True{} : Bool}, hm)
    case Con{+c1, +t}:
      Keep.k(adj, c1, t, c, Push.mem(G.Graph.certified(c1, adj), c1, G.Graph.keep_certified(t, adj), c, hm), h => Keep.sound(t, adj, c, h))

def Bool.tt_ff(e: {True{} == False{} : Bool}) -> Empty:
  %e : Disc.Bool(_)
  Unit{}
