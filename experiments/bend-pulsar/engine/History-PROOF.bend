# engine/History-PROOF.bend - proofs of History-LAWS.bend.
# Gate: `bend engine/PROOF.bend --verdict` (it imports this file).

import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Lemmas2.bend as L2
import ../Lemmas3.bend as L3
import ../Nat2.bend as N
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-PROOF.bend as SP
import ./History.bend as Y
import ./History-LAWS.bend as Laws

# ---- helpers ----------------------------------------------------------------------------------
def AL(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {a == True{} : Bool}:
  L.And.fst({a == True{} : Bool}, {b == True{} : Bool}, L.Bool.and_true(a, b, e))

def AR(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {b == True{} : Bool}:
  L.And.snd({a == True{} : Bool}, {b == True{} : Bool}, L.Bool.and_true(a, b, e))

def Clash(a: Bool, e1: {a == False{} : Bool}, e2: {a == True{} : Bool}) -> Empty:
  L.Bool.ff_tt(Equal.trans(Bool, False{}, a, True{}, Equal.sym(Bool, a, False{}, e1), e2))

def NotT(a: Bool, e: {Bool.not(a) == True{} : Bool}) -> {a == False{} : Bool}:
  match a:
    case False{}:
      {==}
    case True{}:
      Empty.absurd({True{} == False{} : Bool}, L.Bool.ff_tt(e))

def Eq(+a: U32, +b: U32, e: {U32.is_eq(a, b) == True{} : Bool}) -> {a == b : U32}:
  L.U32.eq_sound(a, b, e)

def CntZ(+l: List<&2, U32>, +s: U32) -> {Nat.add(TL.Count(l, s), G.Graph.cnt_of(G.Tr.getu(G.TE{}, s))) == TL.Count(l, s) : Nat}:
  %Equal.sym(Nat, G.Graph.cnt_of(G.Tr.getu(G.TE{}, s)), 0n, L3.Te.cnt(s)) : {Nat.add(TL.Count(l, s), _) == TL.Count(l, s) : Nat}
  N.Nat.add_zero(TL.Count(l, s))

# A tally from empty, as a U32, is the count.
def CntU(+l: List<&2, U32>, +x: U32) -> {Y.Hist.cnt(G.Graph.cnt_all(l, G.TE{}), x) == U32.from_nat(TL.Count(l, x)) : U32}:
  Equal.cong(Nat, U32, v => U32.from_nat(v), G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(l, G.TE{}), x)), TL.Count(l, x), Equal.trans(Nat, G.Graph.cnt_of(G.Tr.getu(G.Graph.cnt_all(l, G.TE{}), x)), Nat.add(TL.Count(l, x), G.Graph.cnt_of(G.Tr.getu(G.TE{}, x))), TL.Count(l, x), L3.Cnt.sound(l, G.TE{}, x), CntZ(l, x)))

def CkX(c: Y.Ck) -> U32:
  match c:
    case Y.Ck{x, k}:
      x

def CkK(c: Y.Ck) -> U32:
  match c:
    case Y.Ck{x, k}:
      k

# ---- F1. file churn ---------------------------------------------------------------------------------
def AllF.k(z: Bool, +t: G.Tr, +x: U32, rest: List<&2, U32>, +y: U32, +k: U32, hz: {U32.is_eq(Y.Hist.cnt(t, x), 0) == z : Bool}, h: Laws.In(Y.Ck, Y.Ck.push3(z, Y.Hist.cnt(t, x), x, Y.Ck.all(rest, t)), Y.Ck{y, k}), ih: Laws.In(Y.Ck, Y.Ck.all(rest, t), Y.Ck{y, k}) -> TL.And({k == Y.Hist.cnt(t, y) : U32}, {U32.is_eq(k, 0) == False{} : Bool})) -> TL.And({k == Y.Hist.cnt(t, y) : U32}, {U32.is_eq(k, 0) == False{} : Bool}):
  match z:
    case True{}:
      ih(h)
    case False{}:
      match h:
        case Inl{e}:
          %e : TL.And({CkK(_) == Y.Hist.cnt(t, CkX(_)) : U32}, {U32.is_eq(CkK(_), 0) == False{} : Bool})
          Tuple{{==}, hz}
        case Inr{q}:
          ih(q)

def AllF(xs: List<&2, U32>, +t: G.Tr, +y: U32, +k: U32, h: Laws.In(Y.Ck, Y.Ck.all(xs, t), Y.Ck{y, k})) -> TL.And({k == Y.Hist.cnt(t, y) : U32}, {U32.is_eq(k, 0) == False{} : Bool}):
  match xs:
    case Nil{}:
      Empty.absurd(TL.And({k == Y.Hist.cnt(t, y) : U32}, {U32.is_eq(k, 0) == False{} : Bool}), h)
    case Con{+x, +rest}:
      AllF.k(U32.is_eq(Y.Hist.cnt(t, x), 0), t, x, rest, y, k, {==}, h, q => AllF(rest, t, y, k, q))

def Laws.file_churn(ch, n, pt, x, k, h):
  +fl = Y.Ch.fl(Y.CH.cfs(ch), Y.Ch.hset(ch), pt)
  +r = AllF(Y.Hist.iota(U32.to_nat(n), 0), G.Graph.cnt_all(fl, G.TE{}), x, k, h)
  Tuple{Equal.trans(U32, k, Y.Hist.cnt(G.Graph.cnt_all(fl, G.TE{}), x), U32.from_nat(TL.Count(fl, x)), L.And.fst({k == Y.Hist.cnt(G.Graph.cnt_all(fl, G.TE{}), x) : U32}, {U32.is_eq(k, 0) == False{} : Bool}, r), CntU(fl, x)), L.And.snd({k == Y.Hist.cnt(G.Graph.cnt_all(fl, G.TE{}), x) : U32}, {U32.is_eq(k, 0) == False{} : Bool}, r)}

# ---- keep lemmas: a kept candidate passed its checker -------------------------------------------
def KP.k(b: Bool, +cft: G.Tr, +r: Y.Rules, +pt: G.Tr, +adj: List<&2, List<&2, U32>>, +ht: G.Tr, +nbt: G.Tr, +tl: G.Tr, +c: Y.Cp, t: List<&2, Y.Cp>, +x: Y.Cp, hb: {Y.Cp.check(cft, r, pt, adj, ht, nbt, tl, c) == b : Bool}, h: Laws.In(Y.Cp, Y.Cp.push(b, c, Y.Cp.keep(t, cft, r, pt, adj, ht, nbt, tl)), x), ih: Laws.In(Y.Cp, Y.Cp.keep(t, cft, r, pt, adj, ht, nbt, tl), x) -> {Y.Cp.check(cft, r, pt, adj, ht, nbt, tl, x) == True{} : Bool}) -> {Y.Cp.check(cft, r, pt, adj, ht, nbt, tl, x) == True{} : Bool}:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          %e : {Y.Cp.check(cft, r, pt, adj, ht, nbt, tl, _) == True{} : Bool}
          hb
        case Inr{q}:
          ih(q)
    case False{}:
      ih(h)

def KP(cs: List<&2, Y.Cp>, +cft: G.Tr, +r: Y.Rules, +pt: G.Tr, +adj: List<&2, List<&2, U32>>, +ht: G.Tr, +nbt: G.Tr, +tl: G.Tr, +x: Y.Cp, h: Laws.In(Y.Cp, Y.Cp.keep(cs, cft, r, pt, adj, ht, nbt, tl), x)) -> {Y.Cp.check(cft, r, pt, adj, ht, nbt, tl, x) == True{} : Bool}:
  match cs:
    case Nil{}:
      Empty.absurd({Y.Cp.check(cft, r, pt, adj, ht, nbt, tl, x) == True{} : Bool}, h)
    case Con{+c, +t}:
      KP.k(Y.Cp.check(cft, r, pt, adj, ht, nbt, tl, c), cft, r, pt, adj, ht, nbt, tl, c, t, x, {==}, h, y => KP(t, cft, r, pt, adj, ht, nbt, tl, x, y))

def KX.k(b: Bool, +r: Y.Rules, +flt: G.Tr, +nf: U32, +total: U32, +c: Y.Cx, t: List<&2, Y.Cx>, +x: Y.Cx, hb: {Y.Cx.check(r, flt, nf, total, c) == b : Bool}, h: Laws.In(Y.Cx, Y.Cx.push(b, c, Y.Cx.keep(t, r, flt, nf, total)), x), ih: Laws.In(Y.Cx, Y.Cx.keep(t, r, flt, nf, total), x) -> {Y.Cx.check(r, flt, nf, total, x) == True{} : Bool}) -> {Y.Cx.check(r, flt, nf, total, x) == True{} : Bool}:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          %e : {Y.Cx.check(r, flt, nf, total, _) == True{} : Bool}
          hb
        case Inr{q}:
          ih(q)
    case False{}:
      ih(h)

def KX(cs: List<&2, Y.Cx>, +r: Y.Rules, +flt: G.Tr, +nf: U32, +total: U32, +x: Y.Cx, h: Laws.In(Y.Cx, Y.Cx.keep(cs, r, flt, nf, total), x)) -> {Y.Cx.check(r, flt, nf, total, x) == True{} : Bool}:
  match cs:
    case Nil{}:
      Empty.absurd({Y.Cx.check(r, flt, nf, total, x) == True{} : Bool}, h)
    case Con{+c, +t}:
      KX.k(Y.Cx.check(r, flt, nf, total, c), r, flt, nf, total, c, t, x, {==}, h, y => KX(t, r, flt, nf, total, x, y))

# ---- X1. concentration ----------------------------------------------------------------------------
def Laws.concentration(ch, r, n, pt, k, nf, top, total, ws, h):
  +flt = Y.Hist.flt(ch, pt)
  +files = Y.Hist.files(n, flt)
  +nfc = U32.from_nat(List.length(&2, Y.Ck, files))
  +tot = Y.Hist.total(ch, pt)
  +e = KX(Y.Cx.search(r, flt, files, nfc, tot), r, flt, nfc, tot, Y.Cx{k, nf, top, total, ws}, h)
  +ea = AL(Y.Cx.a(nfc, tot, k, nf, total, ws), Y.Cx.b(r, flt, nf, total, k, top, ws), e)
  +eb = AR(Y.Cx.a(nfc, tot, k, nf, total, ws), Y.Cx.b(r, flt, nf, total, k, top, ws), e)
  +ea1 = AL(Bool.and(U32.is_eq(nf, nfc), U32.is_eq(total, tot)), Bool.and(U32.is_eq(k, Y.Hist.len(ws)), Y.Hist.asc(ws, 0, True{})), ea)
  +ea2 = AR(Bool.and(U32.is_eq(nf, nfc), U32.is_eq(total, tot)), Bool.and(U32.is_eq(k, Y.Hist.len(ws)), Y.Hist.asc(ws, 0, True{})), ea)
  +eb1 = AL(Bool.and(U32.is_lt(U32.mul(k, 100), U32.add(U32.mul(nf, Y.Rules.top(r)), 100)), U32.is_eq(top, Y.Hist.sumc(ws, flt))), Bool.and(U32.is_ge(total, 1), U32.is_ge(U32.mul(100, top), U32.mul(Y.Rules.share(r), total))), eb)
  +eb2 = AR(Bool.and(U32.is_lt(U32.mul(k, 100), U32.add(U32.mul(nf, Y.Rules.top(r)), 100)), U32.is_eq(top, Y.Hist.sumc(ws, flt))), Bool.and(U32.is_ge(total, 1), U32.is_ge(U32.mul(100, top), U32.mul(Y.Rules.share(r), total))), eb)
  Tuple{Tuple{Eq(nf, nfc, AL(U32.is_eq(nf, nfc), U32.is_eq(total, tot), ea1)), Eq(total, tot, AR(U32.is_eq(nf, nfc), U32.is_eq(total, tot), ea1))}, Tuple{Tuple{Eq(k, Y.Hist.len(ws), AL(U32.is_eq(k, Y.Hist.len(ws)), Y.Hist.asc(ws, 0, True{}), ea2)), AR(U32.is_eq(k, Y.Hist.len(ws)), Y.Hist.asc(ws, 0, True{}), ea2)}, Tuple{Tuple{AL(U32.is_lt(U32.mul(k, 100), U32.add(U32.mul(nf, Y.Rules.top(r)), 100)), U32.is_eq(top, Y.Hist.sumc(ws, flt)), eb1), Eq(top, Y.Hist.sumc(ws, flt), AR(U32.is_lt(U32.mul(k, 100), U32.add(U32.mul(nf, Y.Rules.top(r)), 100)), U32.is_eq(top, Y.Hist.sumc(ws, flt)), eb1))}, Tuple{AL(U32.is_ge(total, 1), U32.is_ge(U32.mul(100, top), U32.mul(Y.Rules.share(r), total)), eb2), AR(U32.is_ge(total, 1), U32.is_ge(U32.mul(100, top), U32.mul(Y.Rules.share(r), total)), eb2)}}}}

# ---- co-change: the checker's verdict on a reported pair ------------------------------------------
def CK(+ch: Y.CH, +r: Y.Rules, +pt: G.Tr, +adj: List<&2, List<&2, U32>>, +a: U32, +b: U32, +sup: U32, +na: U32, +nb: U32, +ws: List<&2, U32>, h: Laws.In(Y.Cp, Y.Hist.pairs(ch, r, pt, adj), Y.Cp{a, b, sup, na, nb, ws})) -> {Y.Cp.check(Y.P2.set(Y.CH.cfs(ch)), r, pt, adj, Y.Ch.hset(ch), Y.Ch.nbset(ch, r), Y.Hist.tl(ch, pt, Y.Ch.hset(ch), Y.Ch.nbset(ch, r)), Y.Cp{a, b, sup, na, nb, ws}) == True{} : Bool}:
  KP(Y.Cs.search(ch, r, pt, adj, Y.Ch.hset(ch), Y.Ch.nbset(ch, r)), Y.P2.set(Y.CH.cfs(ch)), r, pt, adj, Y.Ch.hset(ch), Y.Ch.nbset(ch, r), Y.Hist.tl(ch, pt, Y.Ch.hset(ch), Y.Ch.nbset(ch, r)), Y.Cp{a, b, sup, na, nb, ws}, h)

# The five parts of Cp.check: files, support, ws_ok, conf, noimp.
def P1(+a: Bool, +b: Bool, +c: Bool, +d: Bool, +f: Bool, e: {Bool.and(Bool.and(a, b), Bool.and(Bool.and(c, d), f)) == True{} : Bool}) -> {a == True{} : Bool}:
  AL(a, b, AL(Bool.and(a, b), Bool.and(Bool.and(c, d), f), e))

def P2(+a: Bool, +b: Bool, +c: Bool, +d: Bool, +f: Bool, e: {Bool.and(Bool.and(a, b), Bool.and(Bool.and(c, d), f)) == True{} : Bool}) -> {b == True{} : Bool}:
  AR(a, b, AL(Bool.and(a, b), Bool.and(Bool.and(c, d), f), e))

def P3(+a: Bool, +b: Bool, +c: Bool, +d: Bool, +f: Bool, e: {Bool.and(Bool.and(a, b), Bool.and(Bool.and(c, d), f)) == True{} : Bool}) -> {c == True{} : Bool}:
  AL(c, d, AL(Bool.and(c, d), f, AR(Bool.and(a, b), Bool.and(Bool.and(c, d), f), e)))

def P4(+a: Bool, +b: Bool, +c: Bool, +d: Bool, +f: Bool, e: {Bool.and(Bool.and(a, b), Bool.and(Bool.and(c, d), f)) == True{} : Bool}) -> {d == True{} : Bool}:
  AR(c, d, AL(Bool.and(c, d), f, AR(Bool.and(a, b), Bool.and(Bool.and(c, d), f), e)))

def P5(+a: Bool, +b: Bool, +c: Bool, +d: Bool, +f: Bool, e: {Bool.and(Bool.and(a, b), Bool.and(Bool.and(c, d), f)) == True{} : Bool}) -> {f == True{} : Bool}:
  AR(Bool.and(c, d), f, AR(Bool.and(a, b), Bool.and(Bool.and(c, d), f), e))

# ---- C1. support ---------------------------------------------------------------------------------
def Laws.cochange_support(ch, r, pt, adj, a, b, sup, na, nb, ws, h):
  +ht = Y.Ch.hset(ch)
  +nbt = Y.Ch.nbset(ch, r)
  +tl = Y.Hist.tl(ch, pt, ht, nbt)
  +cft = Y.P2.set(Y.CH.cfs(ch))
  +e = CK(ch, r, pt, adj, a, b, sup, na, nb, ws, h)
  +ef = P1(Y.Cp.files(pt, a, b), Y.Cp.support(r, sup, ws), Y.Cp.ws_ok(ws, cft, ht, nbt, a, b), Y.Cp.conf(r, tl, a, b, sup, na, nb), Y.Cp.noimp(adj, a, b), e)
  +es = P2(Y.Cp.files(pt, a, b), Y.Cp.support(r, sup, ws), Y.Cp.ws_ok(ws, cft, ht, nbt, a, b), Y.Cp.conf(r, tl, a, b, sup, na, nb), Y.Cp.noimp(adj, a, b), e)
  +ef2 = AR(U32.is_lt(a, b), Bool.and(S.Scope.has(pt, a), S.Scope.has(pt, b)), ef)
  +es1 = AL(Bool.and(U32.is_eq(sup, Y.Hist.len(ws)), U32.is_ge(sup, Y.Rules.sup(r))), Y.Hist.asc(ws, 0, True{}), es)
  Tuple{Tuple{AL(U32.is_lt(a, b), Bool.and(S.Scope.has(pt, a), S.Scope.has(pt, b)), ef), Tuple{AL(S.Scope.has(pt, a), S.Scope.has(pt, b), ef2), AR(S.Scope.has(pt, a), S.Scope.has(pt, b), ef2)}}, Tuple{Tuple{Eq(sup, Y.Hist.len(ws), AL(U32.is_eq(sup, Y.Hist.len(ws)), U32.is_ge(sup, Y.Rules.sup(r)), es1)), AR(U32.is_eq(sup, Y.Hist.len(ws)), U32.is_ge(sup, Y.Rules.sup(r)), es1)}, AR(Bool.and(U32.is_eq(sup, Y.Hist.len(ws)), U32.is_ge(sup, Y.Rules.sup(r))), Y.Hist.asc(ws, 0, True{}), es)}}

# ---- C2. witnesses ---------------------------------------------------------------------------------
# The 64-bit key determines the commit and the file.
def Wd.hd(+p: Nat, w: Word(1n+p)) -> Bool:
  match w:
    case WCon{x, t}:
      x

def Wd.tl(+p: Nat, w: Word(1n+p)) -> Word(p):
  match w:
    case WCon{x, t}:
      t

def WdInj.c(+p: Nat, +x: Bool, +at: Word(p), +x2: Bool, +at2: Word(p), ex: {x == x2 : Bool}, e1: {at == at2 : Word(p)}) -> {WCon{x, at} == WCon{x2, at2} : Word(1n+p)}:
  %ex : {WCon{x, at} == WCon{_, at2} : Word(1n+p)}
  %e1 : {WCon{x, at} == WCon{x, _} : Word(1n+p)}
  {==}

def WdInj.k(+p: Nat, +x: Bool, +at: Word(p), +x2: Bool, +at2: Word(p), +b: Word(32n), +b2: Word(32n), ex: {x == x2 : Bool}, ih: TL.And({at == at2 : Word(p)}, {b == b2 : Word(32n)})) -> TL.And({WCon{x, at} == WCon{x2, at2} : Word(1n+p)}, {b == b2 : Word(32n)}):
  match ih:
    case Tuple{e1, e2}:
      Tuple{WdInj.c(p, x, at, x2, at2, ex, e1), e2}

def WdInj(+n: Nat, +a: Word(n), +a2: Word(n), +b: Word(32n), +b2: Word(32n), +e: {Y.Wd.cat(n, a, b) == Y.Wd.cat(n, a2, b2) : Word(Nat.add(n, 32n))}) -> TL.And({a == a2 : Word(n)}, {b == b2 : Word(32n)}):
  match n:
    case 0n:
      match a a2:
        case WNil{} WNil{}:
          Tuple{{==}, e}
    case 1n+p:
      match a a2:
        case WCon{+x, +at} WCon{+x2, +at2}:
          WdInj.k(p, x, at, x2, at2, b, b2, Equal.cong(Word(1n+Nat.add(p, 32n)), Bool, w => Wd.hd(Nat.add(p, 32n), w), WCon{x, Y.Wd.cat(p, at, b)}, WCon{x2, Y.Wd.cat(p, at2, b2)}, e), WdInj(p, at, at2, b, b2, Equal.cong(Word(1n+Nat.add(p, 32n)), Word(Nat.add(p, 32n)), w => Wd.tl(Nat.add(p, 32n), w), WCon{x, Y.Wd.cat(p, at, b)}, WCon{x2, Y.Wd.cat(p, at2, b2)}, e)))

def KeyInj.k(+w1: Word(32n), +w2: Word(32n), +w3: Word(32n), +w4: Word(32n), p: TL.And({w1 == w2 : Word(32n)}, {w3 == w4 : Word(32n)})) -> TL.And({U32{w1} == U32{w2} : U32}, {U32{w3} == U32{w4} : U32}):
  match p:
    case Tuple{x, y}:
      Tuple{Equal.cong(Word(32n), U32, w => U32{w}, w1, w2, x), Equal.cong(Word(32n), U32, w => U32{w}, w3, w4, y)}

def KeyInj(+c2: U32, +c: U32, +f2: U32, +f: U32, e: {Y.P2.key(c2, f2) == Y.P2.key(c, f) : Word(64n)}) -> TL.And({c2 == c : U32}, {f2 == f : U32}):
  match c2 c f2 f:
    case U32{+w1} U32{+w2} U32{+w3} U32{+w4}:
      KeyInj.k(w1, w2, w3, w4, WdInj(32n, w1, w2, w3, w4, e))

# A lookup that finds j in P2.ins(cfs, t) hit a CF row, or was already in t.
def P2G.k2(+c2: U32, +f2: U32, +t: G.Tr, +c: U32, +f: U32, +j: Nat, o: Either<&2, &2, TL.And({Y.P2.key(c2, f2) == Y.P2.key(c, f) : Word(64n)}, {0n == j : Nat}), {G.Tr.get(64n, t, Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}>) -> Either<&2, &2, TL.And({c2 == c : U32}, {f2 == f : U32}), {G.Tr.get(64n, t, Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}>:
  match o:
    case Inl{p}:
      Inl{KeyInj(c2, c, f2, f, L.And.fst({Y.P2.key(c2, f2) == Y.P2.key(c, f) : Word(64n)}, {0n == j : Nat}, p))}
    case Inr{q}:
      Inr{q}

def P2G.k3(+c2: U32, +f2: U32, +ad: U32, +de: U32, r: List<&2, Y.Cf>, +t: G.Tr, +c: U32, +f: U32, +j: Nat, o: Either<&2, &2, TL.And({c2 == c : U32}, {f2 == f : U32}), {G.Tr.get(64n, t, Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}>) -> Either<&2, &2, Laws.CfHas(Con{Y.Cf{c2, f2, ad, de}, r}, c, f), {G.Tr.get(64n, t, Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}>:
  match o:
    case Inl{p}:
      Inl{Inl{p}}
    case Inr{q}:
      Inr{q}

def P2G.k1(+c2: U32, +f2: U32, +ad: U32, +de: U32, r: List<&2, Y.Cf>, +t: G.Tr, +c: U32, +f: U32, +j: Nat, o: Either<&2, &2, Laws.CfHas(r, c, f), {G.Tr.get(64n, G.Tr.put(64n, t, Y.P2.key(c2, f2), 0n), Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}>) -> Either<&2, &2, Laws.CfHas(Con{Y.Cf{c2, f2, ad, de}, r}, c, f), {G.Tr.get(64n, t, Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}>:
  match o:
    case Inl{q}:
      Inl{Inr{q}}
    case Inr{q2}:
      P2G.k3(c2, f2, ad, de, r, t, c, f, j, P2G.k2(c2, f2, t, c, f, j, L2.Put.sound(64n, t, Y.P2.key(c2, f2), 0n, Y.P2.key(c, f), j, q2)))

def P2G(cfs: List<&2, Y.Cf>, +t: G.Tr, +c: U32, +f: U32, +j: Nat, e: {G.Tr.get(64n, Y.P2.ins(cfs, t), Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}) -> Either<&2, &2, Laws.CfHas(cfs, c, f), {G.Tr.get(64n, t, Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}>:
  match cfs:
    case Nil{}:
      Inr{e}
    case Con{Y.Cf{+c2, +f2, +ad, +de}, +r}:
      P2G.k1(c2, f2, ad, de, r, t, c, f, j, P2G(r, G.Tr.put(64n, t, Y.P2.key(c2, f2), 0n), c, f, j, e))

def P2S.fin(+cfs: List<&2, Y.Cf>, +c: U32, +f: U32, +j: Nat, o: Either<&2, &2, Laws.CfHas(cfs, c, f), {G.Tr.get(64n, G.TE{}, Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>}>) -> Laws.CfHas(cfs, c, f):
  match o:
    case Inl{q}:
      q
    case Inr{b}:
      Empty.absurd(Laws.CfHas(cfs, c, f), L2.None.ne_some(j, Equal.trans(Maybe<&2, Nat>, None{}, G.Tr.get(64n, G.TE{}, Y.P2.key(c, f)), Some{j}, Equal.sym(Maybe<&2, Nat>, G.Tr.get(64n, G.TE{}, Y.P2.key(c, f)), None{}, L2.Tr.get_te(64n, Y.P2.key(c, f))), b)))

def P2S.ex(+cfs: List<&2, Y.Cf>, +c: U32, +f: U32, p: TL.Ex(Nat, j => {G.Tr.get(64n, Y.P2.set(cfs), Y.P2.key(c, f)) == Some{j} : Maybe<&2, Nat>})) -> Laws.CfHas(cfs, c, f):
  match p:
    case Tuple{+j, e}:
      P2S.fin(cfs, c, f, j, P2G(cfs, G.TE{}, c, f, j, e))

# P2.has on the CF set means a CF row.
def P2S(+cfs: List<&2, Y.Cf>, +c: U32, +f: U32, e: {Y.P2.has(Y.P2.set(cfs), c, f) == True{} : Bool}) -> Laws.CfHas(cfs, c, f):
  P2S.ex(cfs, c, f, SP.Has.some(G.Tr.get(64n, Y.P2.set(cfs), Y.P2.key(c, f)), e))

# ws_ok and c in ws: c passes the per-commit test.
def WsS(ws: List<&2, U32>, +cft: G.Tr, +ht: G.Tr, +nbt: G.Tr, +a: U32, +b: U32, +c: U32, e: {Y.Cp.ws_ok(ws, cft, ht, nbt, a, b) == True{} : Bool}, hm: TL.Mem(ws, c)) -> {Y.Cp.w1(cft, ht, nbt, a, b, c) == True{} : Bool}:
  match ws:
    case Nil{}:
      Empty.absurd({Y.Cp.w1(cft, ht, nbt, a, b, c) == True{} : Bool}, hm)
    case Con{+x, +t}:
      match hm:
        case Inl{ex}:
          %ex : {Y.Cp.w1(cft, ht, nbt, a, b, _) == True{} : Bool}
          AL(Y.Cp.w1(cft, ht, nbt, a, b, x), Y.Cp.ws_ok(t, cft, ht, nbt, a, b), e)
        case Inr{q}:
          WsS(t, cft, ht, nbt, a, b, c, AR(Y.Cp.w1(cft, ht, nbt, a, b, x), Y.Cp.ws_ok(t, cft, ht, nbt, a, b), e), q)

def Laws.cochange_witness(ch, r, pt, adj, a, b, sup, na, nb, ws, h, c, hm):
  +ht = Y.Ch.hset(ch)
  +nbt = Y.Ch.nbset(ch, r)
  +tl = Y.Hist.tl(ch, pt, ht, nbt)
  +cfs = Y.CH.cfs(ch)
  +cft = Y.P2.set(cfs)
  +e = CK(ch, r, pt, adj, a, b, sup, na, nb, ws, h)
  +ew = P3(Y.Cp.files(pt, a, b), Y.Cp.support(r, sup, ws), Y.Cp.ws_ok(ws, cft, ht, nbt, a, b), Y.Cp.conf(r, tl, a, b, sup, na, nb), Y.Cp.noimp(adj, a, b), e)
  +e1 = WsS(ws, cft, ht, nbt, a, b, c, ew, hm)
  +eab = AL(Bool.and(Y.P2.has(cft, c, a), Y.P2.has(cft, c, b)), Bool.and(S.Scope.has(ht, c), S.Scope.has(nbt, c)), e1)
  +ehn = AR(Bool.and(Y.P2.has(cft, c, a), Y.P2.has(cft, c, b)), Bool.and(S.Scope.has(ht, c), S.Scope.has(nbt, c)), e1)
  Tuple{Tuple{P2S(cfs, c, a, AL(Y.P2.has(cft, c, a), Y.P2.has(cft, c, b), eab)), P2S(cfs, c, b, AR(Y.P2.has(cft, c, a), Y.P2.has(cft, c, b), eab))}, Tuple{AL(S.Scope.has(ht, c), S.Scope.has(nbt, c), ehn), AR(S.Scope.has(ht, c), S.Scope.has(nbt, c), ehn)}}

# ---- C3. no import edge ------------------------------------------------------------------------------
def NoE(+adj: List<&2, List<&2, U32>>, +u: U32, +w: U32, e: {Bool.not(G.Graph.edge(adj, u, w)) == True{} : Bool}, hs: TL.Succ(adj, u, w)) -> Empty:
  Clash(G.Graph.edge(adj, u, w), NotT(G.Graph.edge(adj, u, w), e), L2.Edge.to_bool(adj, u, w, hs))

def NoE2(+adj: List<&2, List<&2, U32>>, +a: U32, +b: U32, en: {Bool.and(Bool.not(G.Graph.edge(adj, a, b)), Bool.not(G.Graph.edge(adj, b, a))) == True{} : Bool}, hs: Either<&2, &2, TL.Succ(adj, a, b), TL.Succ(adj, b, a)>) -> Empty:
  match hs:
    case Inl{s}:
      NoE(adj, a, b, AL(Bool.not(G.Graph.edge(adj, a, b)), Bool.not(G.Graph.edge(adj, b, a)), en), s)
    case Inr{s}:
      NoE(adj, b, a, AR(Bool.not(G.Graph.edge(adj, a, b)), Bool.not(G.Graph.edge(adj, b, a)), en), s)

def Laws.cochange_no_import(ch, r, pt, adj, a, b, sup, na, nb, ws, h, hs):
  +ht = Y.Ch.hset(ch)
  +nbt = Y.Ch.nbset(ch, r)
  +tl = Y.Hist.tl(ch, pt, ht, nbt)
  +cft = Y.P2.set(Y.CH.cfs(ch))
  +e = CK(ch, r, pt, adj, a, b, sup, na, nb, ws, h)
  +en = P5(Y.Cp.files(pt, a, b), Y.Cp.support(r, sup, ws), Y.Cp.ws_ok(ws, cft, ht, nbt, a, b), Y.Cp.conf(r, tl, a, b, sup, na, nb), Y.Cp.noimp(adj, a, b), e)
  NoE2(adj, a, b, en, hs)

# ---- C4. confidence -----------------------------------------------------------------------------------
def Laws.cochange_confidence(ch, r, pt, adj, a, b, sup, na, nb, ws, h):
  +ht = Y.Ch.hset(ch)
  +nbt = Y.Ch.nbset(ch, r)
  +cl = Y.Ch.cl(Y.CH.cfs(ch), ht, nbt, pt)
  +tl = Y.Hist.tl(ch, pt, ht, nbt)
  +cft = Y.P2.set(Y.CH.cfs(ch))
  +e = CK(ch, r, pt, adj, a, b, sup, na, nb, ws, h)
  +ec = P4(Y.Cp.files(pt, a, b), Y.Cp.support(r, sup, ws), Y.Cp.ws_ok(ws, cft, ht, nbt, a, b), Y.Cp.conf(r, tl, a, b, sup, na, nb), Y.Cp.noimp(adj, a, b), e)
  +ec1 = AL(Bool.and(U32.is_eq(na, Y.Hist.cnt(tl, a)), U32.is_eq(nb, Y.Hist.cnt(tl, b))), U32.is_ge(U32.mul(100, sup), U32.mul(Y.Rules.conf(r), Y.Hist.min(na, nb))), ec)
  Tuple{Tuple{Equal.trans(U32, na, Y.Hist.cnt(tl, a), U32.from_nat(TL.Count(cl, a)), Eq(na, Y.Hist.cnt(tl, a), AL(U32.is_eq(na, Y.Hist.cnt(tl, a)), U32.is_eq(nb, Y.Hist.cnt(tl, b)), ec1)), CntU(cl, a)), Equal.trans(U32, nb, Y.Hist.cnt(tl, b), U32.from_nat(TL.Count(cl, b)), Eq(nb, Y.Hist.cnt(tl, b), AR(U32.is_eq(na, Y.Hist.cnt(tl, a)), U32.is_eq(nb, Y.Hist.cnt(tl, b)), ec1)), CntU(cl, b))}, AR(Bool.and(U32.is_eq(na, Y.Hist.cnt(tl, a)), U32.is_eq(nb, Y.Hist.cnt(tl, b))), U32.is_ge(U32.mul(100, sup), U32.mul(Y.Rules.conf(r), Y.Hist.min(na, nb))), ec)}

# ---- E. the entry point -------------------------------------------------------------------------------
def Laws.run_is_detectors(ch, r, n, pt, adj, ok):
  %Equal.sym(Bool, Y.Hist.valid(ch, r, n), True{}, ok) : {Y.Hist.run2(_, ch, r, n, pt, adj) == Some{Y.COut{Y.Hist.files(n, Y.Hist.flt(ch, pt)), Y.Hist.conc(ch, r, n, pt), Y.Hist.pairs(ch, r, pt, adj)}} : Maybe<Y.COut>}
  {==}

def Laws.run_refuses_invalid(ch, r, n, pt, adj, bad):
  %Equal.sym(Bool, Y.Hist.valid(ch, r, n), False{}, bad) : {Y.Hist.run2(_, ch, r, n, pt, adj) == None{} : Maybe<Y.COut>}
  {==}

def Laws.lines_shape(r, files, cxs, cps):
  {==}
