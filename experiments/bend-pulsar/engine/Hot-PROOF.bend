# engine/Hot-PROOF.bend - proofs of Hot-LAWS.bend. Gate: bend Hot-PROOF.bend --verdict
import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ./Metrics-NAT.bend as N
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./ClassCtx.bend as X
import ./ClassCtx-PROOF.bend as CP
import ./Sql.bend as Q
import ./Sql-LAWS.bend as QL
import ./Sql-PROOF.bend as QP
import ./Fanout.bend as F
import ./Fanout-LAWS.bend as FL
import ./Fanout-PROOF.bend as FP
import ./Konst.bend as K
import ./Konst-LAWS.bend as KL
import ./Konst-PROOF.bend as KP
import ./Hot.bend as H
import ./Hot-LAWS.bend as Laws

# ---- list lemmas ------------------------------------------------------------------------------
def AB.sh(+a: H.Bs, +t: List<&2, H.Bs>, +ys: List<&2, H.Bs>, +y: H.Bs, o: Either<&2, &2, Laws.MemBs(t, y), Laws.MemBs(ys, y)>) -> Either<&2, &2, Laws.MemBs(Con{a, t}, y), Laws.MemBs(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def AB.split(xs: List<&2, H.Bs>, +ys: List<&2, H.Bs>, +y: H.Bs, h: Laws.MemBs(List.append(&2, H.Bs, xs, ys), y)) -> Either<&2, &2, Laws.MemBs(xs, y), Laws.MemBs(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AB.sh(a, t, ys, y, AB.split(t, ys, y, q))

def AB.l(xs: List<&2, H.Bs>, +ys: List<&2, H.Bs>, +y: H.Bs, h: Laws.MemBs(xs, y)) -> Laws.MemBs(List.append(&2, H.Bs, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemBs(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AB.l(t, ys, y, q)}

def AB.r(xs: List<&2, H.Bs>, +ys: List<&2, H.Bs>, +y: H.Bs, h: Laws.MemBs(ys, y)) -> Laws.MemBs(List.append(&2, H.Bs, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{AB.r(t, ys, y, h)}

def AH.sh(+a: H.Hx, +t: List<&2, H.Hx>, +ys: List<&2, H.Hx>, +y: H.Hx, o: Either<&2, &2, Laws.MemHx(t, y), Laws.MemHx(ys, y)>) -> Either<&2, &2, Laws.MemHx(Con{a, t}, y), Laws.MemHx(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def AH.split(xs: List<&2, H.Hx>, +ys: List<&2, H.Hx>, +y: H.Hx, h: Laws.MemHx(List.append(&2, H.Hx, xs, ys), y)) -> Either<&2, &2, Laws.MemHx(xs, y), Laws.MemHx(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AH.sh(a, t, ys, y, AH.split(t, ys, y, q))

def AH.l(xs: List<&2, H.Hx>, +ys: List<&2, H.Hx>, +y: H.Hx, h: Laws.MemHx(xs, y)) -> Laws.MemHx(List.append(&2, H.Hx, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemHx(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AH.l(t, ys, y, q)}

def AH.r(xs: List<&2, H.Hx>, +ys: List<&2, H.Hx>, +y: H.Hx, h: Laws.MemHx(ys, y)) -> Laws.MemHx(List.append(&2, H.Hx, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{AH.r(t, ys, y, h)}

# Ho.bpush (base sites) and Ho.keep (findings).
def BP.mem(b: Bool, +x: H.Bs, +rest: List<&2, H.Bs>, +y: H.Bs, h: Laws.MemBs(H.Ho.bpush(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : H.Bs}), Laws.MemBs(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def BP.stay(b: Bool, +x: H.Bs, +rest: List<&2, H.Bs>, +y: H.Bs, h: Laws.MemBs(rest, y)) -> Laws.MemBs(H.Ho.bpush(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def BP.hit(b: Bool, +x: H.Bs, +rest: List<&2, H.Bs>, hb: {b == True{} : Bool}) -> Laws.MemBs(H.Ho.bpush(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemBs(H.Ho.bpush(_, x, rest), x)
  Inl{{==}}

def HK.mem(b: Bool, +x: H.Hx, +rest: List<&2, H.Hx>, +y: H.Hx, h: Laws.MemHx(H.Ho.keep(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : H.Hx}), Laws.MemHx(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def HK.stay(b: Bool, +x: H.Hx, +rest: List<&2, H.Hx>, +y: H.Hx, h: Laws.MemHx(rest, y)) -> Laws.MemHx(H.Ho.keep(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def HK.hit(b: Bool, +x: H.Hx, +rest: List<&2, H.Hx>, hb: {b == True{} : Bool}) -> Laws.MemHx(H.Ho.keep(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemHx(H.Ho.keep(_, x, rest), x)
  Inl{{==}}

# Ho.when: a lane's list, or nothing.
def When.s(b: Bool, +xs: List<&2, H.Bs>, +y: H.Bs, h: Laws.MemBs(H.Ho.when(b, xs), y)) -> TL.And({b == True{} : Bool}, Laws.MemBs(xs, y)):
  match b:
    case True{}:
      Tuple{{==}, h}
    case False{}:
      match h:

def When.c(b: Bool, +xs: List<&2, H.Bs>, +y: H.Bs, hb: {b == True{} : Bool}, h: Laws.MemBs(xs, y)) -> Laws.MemBs(H.Ho.when(b, xs), y):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemBs(H.Ho.when(_, xs), y)
  h

def Lift.ep(-P: @e: H.Ep -> Data, +h: H.Ep, +t: List<&2, H.Ep>, w: TL.Ex(H.Ep, e => TL.And(Laws.MemEp(t, e), P(e)))) -> TL.Ex(H.Ep, e => TL.And(Laws.MemEp(Con{h, t}, e), P(e))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.sx(-P: @s: Q.Sx -> Data, +h: Q.Sx, +t: List<&2, Q.Sx>, w: TL.Ex(Q.Sx, s => TL.And(QL.MemS(t, s), P(s)))) -> TL.Ex(Q.Sx, s => TL.And(QL.MemS(Con{h, t}, s), P(s))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.nx(-P: @n: F.Nx -> Data, +h: F.Nx, +t: List<&2, F.Nx>, w: TL.Ex(F.Nx, n => TL.And(FL.MemNx(t, n), P(n)))) -> TL.Ex(F.Nx, n => TL.And(FL.MemNx(Con{h, t}, n), P(n))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.kx(-P: @n: K.Kx -> Data, +h: K.Kx, +t: List<&2, K.Kx>, w: TL.Ex(K.Kx, n => TL.And(KL.MemKx(t, n), P(n)))) -> TL.Ex(K.Kx, n => TL.And(KL.MemKx(Con{h, t}, n), P(n))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.bs(-P: @b: H.Bs -> Data, +h: H.Bs, +t: List<&2, H.Bs>, w: TL.Ex(H.Bs, b => TL.And(Laws.MemBs(t, b), P(b)))) -> TL.Ex(H.Bs, b => TL.And(Laws.MemBs(Con{h, t}, b), P(b))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

# ---- the seed: the entry-point functions ------------------------------------------------------
def Seed.s(eps: List<&2, H.Ep>, +x: U32, h: TL.Mem(H.Ho.seed(eps), x)) -> TL.Ex(H.Ep, e => TL.And(Laws.MemEp(eps, e), {Laws.EpFn(e) == x : U32})):
  match eps:
    case Nil{}:
      match h:
    case Con{H.Ep{+fn, +kind}, +t}:
      match h:
        case Inl{e}:
          Tuple{H.Ep{fn, kind}, Tuple{Inl{{==}}, e}}
        case Inr{q}:
          Lift.ep(e => {Laws.EpFn(e) == x : U32}, H.Ep{fn, kind}, t, Seed.s(t, x, q))

def Seed.hit(e: H.Ep, +t: List<&2, H.Ep>, +x: U32, ef: {Laws.EpFn(e) == x : U32}) -> TL.Mem(H.Ho.seed(Con{e, t}), x):
  match e:
    case H.Ep{+fn, +kind}:
      Inl{ef}

def Seed.stay(h: H.Ep, +t: List<&2, H.Ep>, +x: U32, m: TL.Mem(H.Ho.seed(t), x)) -> TL.Mem(H.Ho.seed(Con{h, t}), x):
  match h:
    case H.Ep{+fn, +kind}:
      Inr{m}

def Seed.c(eps: List<&2, H.Ep>, +x: U32, +e: H.Ep, hm: Laws.MemEp(eps, e), ef: {Laws.EpFn(e) == x : U32}) -> TL.Mem(H.Ho.seed(eps), x):
  match eps:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{q}:
          %Equal.sym(H.Ep, h, e, q) : TL.Mem(H.Ho.seed(Con{_, t}), x)
          Seed.hit(e, t, x, ef)
        case Inr{q}:
          Seed.stay(h, t, x, Seed.c(t, x, e, q, ef))

def Seed.from(+eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +y: U32, r: Laws.HR(0n, eps, ces, y)) -> TL.Mem(H.Ho.seed(eps), y):
  match r:
    case Tuple{w, q}:
      match q:
        case Tuple{ms, ef}:
          Seed.c(eps, y, w, ms, ef)

# ---- one step: the callees of a set -----------------------------------------------------------
def Step.k(+site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, +t: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, o: Either<&2, &2, TL.And({S.Scope.has(S.Scope.set(cur), fn) == True{} : Bool}, {target == x : U32}), TL.Mem(H.Ho.step(t, S.Scope.set(cur)), x)>, ih: TL.Mem(H.Ho.step(t, S.Scope.set(cur)), x) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(t, e), TL.And({F.Ce.target(e) == x : U32}, TL.Mem(cur, F.Ce.fn(e)))))) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(Con{F.Ce{site, fn, target, node, ld, ctx}, t}, e), TL.And({F.Ce.target(e) == x : U32}, TL.Mem(cur, F.Ce.fn(e))))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eh, et}:
          Tuple{F.Ce{site, fn, target, node, ld, ctx}, Tuple{Inl{{==}}, Tuple{et, SL.scope_set_sound(cur, fn, eh)}}}
    case Inr{m}:
      FP.Lift.ce(e => TL.And({F.Ce.target(e) == x : U32}, TL.Mem(cur, F.Ce.fn(e))), F.Ce{site, fn, target, node, ld, ctx}, t, ih(m))

def Step.s(ces: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, h: TL.Mem(H.Ho.step(ces, S.Scope.set(cur)), x)) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), TL.And({F.Ce.target(e) == x : U32}, TL.Mem(cur, F.Ce.fn(e))))):
  match ces:
    case Nil{}:
      match h:
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t}:
      Step.k(site, fn, target, node, ld, ctx, t, cur, x, FP.PU.mem(S.Scope.has(S.Scope.set(cur), fn), target, H.Ho.step(t, S.Scope.set(cur)), x, h), q => Step.s(t, cur, x, q))

def Step.hit(e: F.Ce, +t: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, et: {F.Ce.target(e) == x : U32}, mf: TL.Mem(cur, F.Ce.fn(e))) -> TL.Mem(H.Ho.step(Con{e, t}, S.Scope.set(cur)), x):
  match e:
    case F.Ce{+site, +fn, +target, +node, +ld, +ctx}:
      %et : TL.Mem(H.Ho.step(Con{F.Ce{site, fn, target, node, ld, ctx}, t}, S.Scope.set(cur)), _)
      FP.PU.hit(S.Scope.has(S.Scope.set(cur), fn), target, H.Ho.step(t, S.Scope.set(cur)), SL.scope_set_complete(cur, fn, mf))

def Step.stay(h: F.Ce, +t: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, m: TL.Mem(H.Ho.step(t, S.Scope.set(cur)), x)) -> TL.Mem(H.Ho.step(Con{h, t}, S.Scope.set(cur)), x):
  match h:
    case F.Ce{+site, +fn, +target, +node, +ld, +ctx}:
      CP.PU.keep(S.Scope.has(S.Scope.set(cur), fn), target, H.Ho.step(t, S.Scope.set(cur)), x, m)

def Step.c(ces: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, +e: F.Ce, hm: FL.MemCe(ces, e), et: {F.Ce.target(e) == x : U32}, mf: TL.Mem(cur, F.Ce.fn(e))) -> TL.Mem(H.Ho.step(ces, S.Scope.set(cur)), x):
  match ces:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{q}:
          %Equal.sym(F.Ce, h, e, q) : TL.Mem(H.Ho.step(Con{_, t}, S.Scope.set(cur)), x)
          Step.hit(e, t, cur, x, et, mf)
        case Inr{q}:
          Step.stay(h, t, cur, x, Step.c(t, cur, x, e, q, et, mf))

# ---- the hot set ------------------------------------------------------------------------------
def Inv.edge(+eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.HR(j, eps, ces, y), +y: U32, w: TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), TL.And({F.Ce.target(e) == y : U32}, TL.Mem(cur, F.Ce.fn(e)))))) -> Laws.HR(1n+j, eps, ces, y):
  match w:
    case Tuple{+e, q}:
      match q:
        case Tuple{me, q2}:
          match q2:
            case Tuple{et, mf}:
              Inr{Tuple{e, Tuple{me, Tuple{et, inv(F.Ce.fn(e), mf)}}}}

def Inv.up2(+eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.HR(j, eps, ces, y), +y: U32, o: Either<&2, &2, TL.Mem(cur, y), TL.Mem(H.Ho.step(ces, S.Scope.set(cur)), y)>) -> Laws.HR(1n+j, eps, ces, y):
  match o:
    case Inl{m}:
      Inl{inv(y, m)}
    case Inr{m}:
      Inv.edge(eps, ces, j, cur, inv, y, Step.s(ces, cur, y, m))

def Inv.up(+eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.HR(j, eps, ces, y), +y: U32, h: TL.Mem(List.append(&2, U32, cur, H.Ho.step(ces, S.Scope.set(cur))), y)) -> Laws.HR(1n+j, eps, ces, y):
  Inv.up2(eps, ces, j, cur, inv, y, FP.AU.split(cur, H.Ho.step(ces, S.Scope.set(cur)), y, h))

def RS(k: Nat, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.HR(j, eps, ces, y), +x: U32, hm: TL.Mem(H.Ho.reach(k, ces, cur), x)) -> Laws.HR(Nat.add(k, j), eps, ces, x):
  match k:
    case 0n:
      inv(x, hm)
    case 1n+p:
      +q = p
      %N.Nat.add_succ_r(q, j) : Laws.HR(_, eps, ces, x)
      RS(q, eps, ces, 1n+j, List.append(&2, U32, cur, H.Ho.step(ces, S.Scope.set(cur))), y => h => Inv.up(eps, ces, j, cur, inv, y, h), x, hm)

def Inv.down(+eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> Laws.HR(j, eps, ces, y) -> TL.Mem(cur, y), +y: U32, w: Laws.HR(1n+j, eps, ces, y)) -> TL.Mem(List.append(&2, U32, cur, H.Ho.step(ces, S.Scope.set(cur))), y):
  match w:
    case Inl{r}:
      FP.AU.l(cur, H.Ho.step(ces, S.Scope.set(cur)), y, inv(y, r))
    case Inr{Tuple{+e, Tuple{me, Tuple{et, rf}}}}:
      FP.AU.r(cur, H.Ho.step(ces, S.Scope.set(cur)), y, Step.c(ces, cur, y, e, me, et, inv(F.Ce.fn(e), rf)))

def Rw.hr(+a: Nat, +b: Nat, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +x: U32, e: {b == a : Nat}, w: Laws.HR(b, eps, ces, x)) -> Laws.HR(a, eps, ces, x):
  %e : Laws.HR(_, eps, ces, x)
  w

def RC(k: Nat, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> Laws.HR(j, eps, ces, y) -> TL.Mem(cur, y), +x: U32, w: Laws.HR(Nat.add(k, j), eps, ces, x)) -> TL.Mem(H.Ho.reach(k, ces, cur), x):
  match k:
    case 0n:
      inv(x, w)
    case 1n+p:
      +q = p
      RC(q, eps, ces, 1n+j, List.append(&2, U32, cur, H.Ho.step(ces, S.Scope.set(cur))), y => r => Inv.down(eps, ces, j, cur, inv, y, r), x, Rw.hr(Nat.add(q, 1n+j), 1n+Nat.add(q, j), eps, ces, x, Equal.sym(Nat, Nat.add(q, 1n+j), 1n+Nat.add(q, j), N.Nat.add_succ_r(q, j)), w))

def Laws.ho_reach_sound(k, eps, ces, x, hm):
  %N.Nat.add_zero_r(k) : Laws.HR(_, eps, ces, x)
  RS(k, eps, ces, 0n, H.Ho.seed(eps), y => h => Seed.s(eps, y, h), x, hm)

def Laws.ho_reach_complete(k, eps, ces, x, w):
  RC(k, eps, ces, 0n, H.Ho.seed(eps), y => r => Seed.from(eps, ces, y, r), x, Rw.hr(Nat.add(k, 0n), k, eps, ces, x, Equal.sym(Nat, Nat.add(k, 0n), k, N.Nat.add_zero_r(k)), w))

# ---- lane 1: SQL findings at query sites ------------------------------------------------------
def Sids.k(+rule: U32, +id: U32, +table: U32, +col: U32, +detail: U32, +t: List<&2, Q.Sx>, +base: U32, +b: H.Bs, o: Either<&2, &2, TL.And({U32.is_eq(rule, base) == True{} : Bool}, {id == Laws.BsSite(b) : U32}), TL.Mem(H.Ho.sids(t, base), Laws.BsSite(b))>, ih: TL.Mem(H.Ho.sids(t, base), Laws.BsSite(b)) -> TL.Ex(Q.Sx, s => TL.And(QL.MemS(t, s), Laws.SxAt(s, base, b)))) -> TL.Ex(Q.Sx, s => TL.And(QL.MemS(Con{Q.Sx{rule, id, table, col, detail}, t}, s), Laws.SxAt(s, base, b))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eb, ei}:
          Tuple{Q.Sx{rule, id, table, col, detail}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(rule, base, eb), ei}}}
    case Inr{m}:
      Lift.sx(s => Laws.SxAt(s, base, b), Q.Sx{rule, id, table, col, detail}, t, ih(m))

def Sids.s(sxs: List<&2, Q.Sx>, +base: U32, +b: H.Bs, h: TL.Mem(H.Ho.sids(sxs, base), Laws.BsSite(b))) -> TL.Ex(Q.Sx, s => TL.And(QL.MemS(sxs, s), Laws.SxAt(s, base, b))):
  match sxs:
    case Nil{}:
      match h:
    case Con{Q.Sx{+rule, +id, +table, +col, +detail}, +t}:
      Sids.k(rule, id, table, col, detail, t, base, b, FP.PU.mem(U32.is_eq(rule, base), id, H.Ho.sids(t, base), Laws.BsSite(b), h), q => Sids.s(t, base, b, q))

def Sids.hit(s: Q.Sx, +t: List<&2, Q.Sx>, +base: U32, +b: H.Bs, at: Laws.SxAt(s, base, b)) -> TL.Mem(H.Ho.sids(Con{s, t}, base), Laws.BsSite(b)):
  match s:
    case Q.Sx{+rule, +id, +table, +col, +detail}:
      match at:
        case Tuple{er, ei}:
          %ei : TL.Mem(H.Ho.sids(Con{Q.Sx{rule, id, table, col, detail}, t}, base), _)
          FP.PU.hit(U32.is_eq(rule, base), id, H.Ho.sids(t, base), CP.U.eq_t(rule, base, er))

def Sids.stay(h: Q.Sx, +t: List<&2, Q.Sx>, +base: U32, +x: U32, m: TL.Mem(H.Ho.sids(t, base), x)) -> TL.Mem(H.Ho.sids(Con{h, t}, base), x):
  match h:
    case Q.Sx{+rule, +id, +table, +col, +detail}:
      CP.PU.keep(U32.is_eq(rule, base), id, H.Ho.sids(t, base), x, m)

def Sids.c(sxs: List<&2, Q.Sx>, +base: U32, +b: H.Bs, +s: Q.Sx, hm: QL.MemS(sxs, s), at: Laws.SxAt(s, base, b)) -> TL.Mem(H.Ho.sids(sxs, base), Laws.BsSite(b)):
  match sxs:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{q}:
          %Equal.sym(Q.Sx, h, s, q) : TL.Mem(H.Ho.sids(Con{_, t}, base), Laws.BsSite(b))
          Sids.hit(s, t, base, b, at)
        case Inr{q}:
          Sids.stay(h, t, base, Laws.BsSite(b), Sids.c(t, base, b, s, q, at))

def Sql.lift(+h: Q.Qs, +t: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +base: U32, +b: H.Bs, w: Laws.SqlAt(t, sxs, base, b)) -> Laws.SqlAt(Con{h, t}, sxs, base, b):
  match w:
    case Tuple{wq, ws}:
      match wq:
        case Tuple{q, r}:
          match r:
            case Tuple{mq, at}:
              Tuple{Tuple{q, Tuple{Inr{mq}, at}}, ws}

def Sql.k(+site: U32, +file: U32, +fn: U32, +node: U32, +kind: U32, +flags: U32, +t: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +base: U32, +b: H.Bs, o: Either<&2, &2, TL.And({S.Scope.has(S.Scope.set(H.Ho.sids(sxs, base)), site) == True{} : Bool}, {H.Bs{site, fn} == b : H.Bs}), Laws.MemBs(H.Ho.sql(t, S.Scope.set(H.Ho.sids(sxs, base))), b)>, ih: Laws.MemBs(H.Ho.sql(t, S.Scope.set(H.Ho.sids(sxs, base))), b) -> Laws.SqlAt(t, sxs, base, b)) -> Laws.SqlAt(Con{Q.Qs{site, file, fn, node, kind, flags}, t}, sxs, base, b):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eh, eb}:
          %eb : Laws.SqlAt(Con{Q.Qs{site, file, fn, node, kind, flags}, t}, sxs, base, _)
          Tuple{Tuple{Q.Qs{site, file, fn, node, kind, flags}, Tuple{Inl{{==}}, {==}}}, Sids.s(sxs, base, H.Bs{site, fn}, SL.scope_set_sound(H.Ho.sids(sxs, base), site, eh))}
    case Inr{m}:
      Sql.lift(Q.Qs{site, file, fn, node, kind, flags}, t, sxs, base, b, ih(m))

def Sql.s(qs: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +base: U32, +b: H.Bs, h: Laws.MemBs(H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base))), b)) -> Laws.SqlAt(qs, sxs, base, b):
  match qs:
    case Nil{}:
      match h:
    case Con{Q.Qs{+site, +file, +fn, +node, +kind, +flags}, +t}:
      Sql.k(site, file, fn, node, kind, flags, t, sxs, base, b, BP.mem(S.Scope.has(S.Scope.set(H.Ho.sids(sxs, base)), site), H.Bs{site, fn}, H.Ho.sql(t, S.Scope.set(H.Ho.sids(sxs, base))), b, h), q => Sql.s(t, sxs, base, b, q))

def Rw.has(+sset: G.Tr, +b: H.Bs, +c: H.Bs, e: {b == c : H.Bs}, hs: {S.Scope.has(sset, Laws.BsSite(b)) == True{} : Bool}) -> {S.Scope.has(sset, Laws.BsSite(c)) == True{} : Bool}:
  %e : {S.Scope.has(sset, Laws.BsSite(_)) == True{} : Bool}
  hs

def Sql.hit(q: Q.Qs, +t: List<&2, Q.Qs>, +sset: G.Tr, +b: H.Bs, +at: Laws.QsAt(q, b), hs: {S.Scope.has(sset, Laws.BsSite(b)) == True{} : Bool}) -> Laws.MemBs(H.Ho.sql(Con{q, t}, sset), b):
  match q:
    case Q.Qs{+site, +file, +fn, +node, +kind, +flags}:
      +hs2 = Rw.has(sset, b, H.Bs{site, fn}, Equal.sym(H.Bs, H.Bs{site, fn}, b, at), hs)
      %at : Laws.MemBs(H.Ho.sql(Con{Q.Qs{site, file, fn, node, kind, flags}, t}, sset), _)
      BP.hit(S.Scope.has(sset, site), H.Bs{site, fn}, H.Ho.sql(t, sset), hs2)

def Sql.stay(h: Q.Qs, +t: List<&2, Q.Qs>, +sset: G.Tr, +b: H.Bs, m: Laws.MemBs(H.Ho.sql(t, sset), b)) -> Laws.MemBs(H.Ho.sql(Con{h, t}, sset), b):
  match h:
    case Q.Qs{+site, +file, +fn, +node, +kind, +flags}:
      BP.stay(S.Scope.has(sset, site), H.Bs{site, fn}, H.Ho.sql(t, sset), b, m)

def Sql.c2(qs: List<&2, Q.Qs>, +sset: G.Tr, +b: H.Bs, +q: Q.Qs, hm: QL.MemQs(qs, q), at: Laws.QsAt(q, b), hs: {S.Scope.has(sset, Laws.BsSite(b)) == True{} : Bool}) -> Laws.MemBs(H.Ho.sql(qs, sset), b):
  match qs:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(Q.Qs, h, q, e) : Laws.MemBs(H.Ho.sql(Con{_, t}, sset), b)
          Sql.hit(q, t, sset, b, at, hs)
        case Inr{r}:
          Sql.stay(h, t, sset, b, Sql.c2(t, sset, b, q, r, at, hs))

def Sql.c(+qs: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +base: U32, +b: H.Bs, w: Laws.SqlAt(qs, sxs, base, b)) -> Laws.MemBs(H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base))), b):
  match w:
    case Tuple{wq, ws}:
      match wq:
        case Tuple{+q, r}:
          match r:
            case Tuple{mq, at}:
              match ws:
                case Tuple{+s, r2}:
                  match r2:
                    case Tuple{ms, as}:
                      Sql.c2(qs, S.Scope.set(H.Ho.sids(sxs, base)), b, q, mq, at, SL.scope_set_complete(H.Ho.sids(sxs, base), Laws.BsSite(b), Sids.c(sxs, base, b, s, ms, as)))

# ---- lanes 2 and 3: fan-out and constant-argument findings ------------------------------------
def Nx.k(+r: U32, +site: U32, +fn: U32, +via: U32, +kind: U32, +t: List<&2, F.Nx>, +base: U32, +b: H.Bs, o: Either<&2, &2, TL.And({U32.is_eq(r, base) == True{} : Bool}, {H.Bs{site, fn} == b : H.Bs}), Laws.MemBs(H.Ho.nx(t, base), b)>, ih: Laws.MemBs(H.Ho.nx(t, base), b) -> TL.Ex(F.Nx, n => TL.And(FL.MemNx(t, n), Laws.NxAt(n, base, b)))) -> TL.Ex(F.Nx, n => TL.And(FL.MemNx(Con{F.Nx{r, site, fn, via, kind}, t}, n), Laws.NxAt(n, base, b))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eb, ex}:
          Tuple{F.Nx{r, site, fn, via, kind}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(r, base, eb), ex}}}
    case Inr{m}:
      Lift.nx(n => Laws.NxAt(n, base, b), F.Nx{r, site, fn, via, kind}, t, ih(m))

def Nx.s(nxs: List<&2, F.Nx>, +base: U32, +b: H.Bs, h: Laws.MemBs(H.Ho.nx(nxs, base), b)) -> TL.Ex(F.Nx, n => TL.And(FL.MemNx(nxs, n), Laws.NxAt(n, base, b))):
  match nxs:
    case Nil{}:
      match h:
    case Con{F.Nx{+r, +site, +fn, +via, +kind}, +t}:
      Nx.k(r, site, fn, via, kind, t, base, b, BP.mem(U32.is_eq(r, base), H.Bs{site, fn}, H.Ho.nx(t, base), b, h), q => Nx.s(t, base, b, q))

def Nx.hit(n: F.Nx, +t: List<&2, F.Nx>, +base: U32, +b: H.Bs, at: Laws.NxAt(n, base, b)) -> Laws.MemBs(H.Ho.nx(Con{n, t}, base), b):
  match n:
    case F.Nx{+r, +site, +fn, +via, +kind}:
      match at:
        case Tuple{er, eb}:
          %eb : Laws.MemBs(H.Ho.nx(Con{F.Nx{r, site, fn, via, kind}, t}, base), _)
          BP.hit(U32.is_eq(r, base), H.Bs{site, fn}, H.Ho.nx(t, base), CP.U.eq_t(r, base, er))

def Nx.stay(h: F.Nx, +t: List<&2, F.Nx>, +base: U32, +b: H.Bs, m: Laws.MemBs(H.Ho.nx(t, base), b)) -> Laws.MemBs(H.Ho.nx(Con{h, t}, base), b):
  match h:
    case F.Nx{+r, +site, +fn, +via, +kind}:
      BP.stay(U32.is_eq(r, base), H.Bs{site, fn}, H.Ho.nx(t, base), b, m)

def Nx.c(nxs: List<&2, F.Nx>, +base: U32, +b: H.Bs, +n: F.Nx, hm: FL.MemNx(nxs, n), at: Laws.NxAt(n, base, b)) -> Laws.MemBs(H.Ho.nx(nxs, base), b):
  match nxs:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(F.Nx, h, n, e) : Laws.MemBs(H.Ho.nx(Con{_, t}, base), b)
          Nx.hit(n, t, base, b, at)
        case Inr{q}:
          Nx.stay(h, t, base, b, Nx.c(t, base, b, n, q, at))

def Kx.k(+r: U32, +site: U32, +fn: U32, +callee: U32, +pos: U32, +t: List<&2, K.Kx>, +base: U32, +b: H.Bs, o: Either<&2, &2, TL.And({U32.is_eq(r, base) == True{} : Bool}, {H.Bs{site, fn} == b : H.Bs}), Laws.MemBs(H.Ho.kx(t, base), b)>, ih: Laws.MemBs(H.Ho.kx(t, base), b) -> TL.Ex(K.Kx, n => TL.And(KL.MemKx(t, n), Laws.KxAt(n, base, b)))) -> TL.Ex(K.Kx, n => TL.And(KL.MemKx(Con{K.Kx{r, site, fn, callee, pos}, t}, n), Laws.KxAt(n, base, b))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eb, ex}:
          Tuple{K.Kx{r, site, fn, callee, pos}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(r, base, eb), ex}}}
    case Inr{m}:
      Lift.kx(n => Laws.KxAt(n, base, b), K.Kx{r, site, fn, callee, pos}, t, ih(m))

def Kx.s(kxs: List<&2, K.Kx>, +base: U32, +b: H.Bs, h: Laws.MemBs(H.Ho.kx(kxs, base), b)) -> TL.Ex(K.Kx, n => TL.And(KL.MemKx(kxs, n), Laws.KxAt(n, base, b))):
  match kxs:
    case Nil{}:
      match h:
    case Con{K.Kx{+r, +site, +fn, +callee, +pos}, +t}:
      Kx.k(r, site, fn, callee, pos, t, base, b, BP.mem(U32.is_eq(r, base), H.Bs{site, fn}, H.Ho.kx(t, base), b, h), q => Kx.s(t, base, b, q))

def Kx.hit(n: K.Kx, +t: List<&2, K.Kx>, +base: U32, +b: H.Bs, at: Laws.KxAt(n, base, b)) -> Laws.MemBs(H.Ho.kx(Con{n, t}, base), b):
  match n:
    case K.Kx{+r, +site, +fn, +callee, +pos}:
      match at:
        case Tuple{er, eb}:
          %eb : Laws.MemBs(H.Ho.kx(Con{K.Kx{r, site, fn, callee, pos}, t}, base), _)
          BP.hit(U32.is_eq(r, base), H.Bs{site, fn}, H.Ho.kx(t, base), CP.U.eq_t(r, base, er))

def Kx.stay(h: K.Kx, +t: List<&2, K.Kx>, +base: U32, +b: H.Bs, m: Laws.MemBs(H.Ho.kx(t, base), b)) -> Laws.MemBs(H.Ho.kx(Con{h, t}, base), b):
  match h:
    case K.Kx{+r, +site, +fn, +callee, +pos}:
      BP.stay(U32.is_eq(r, base), H.Bs{site, fn}, H.Ho.kx(t, base), b, m)

def Kx.c(kxs: List<&2, K.Kx>, +base: U32, +b: H.Bs, +n: K.Kx, hm: KL.MemKx(kxs, n), at: Laws.KxAt(n, base, b)) -> Laws.MemBs(H.Ho.kx(kxs, base), b):
  match kxs:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(K.Kx, h, n, e) : Laws.MemBs(H.Ho.kx(Con{_, t}, base), b)
          Kx.hit(n, t, base, b, at)
        case Inr{q}:
          Kx.stay(h, t, base, b, Kx.c(t, base, b, n, q, at))

# ---- the lanes together -----------------------------------------------------------------------
def Base.l1(+lane: U32, +base: U32, +qs: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +b: H.Bs, w: TL.And({U32.is_eq(lane, 1) == True{} : Bool}, Laws.MemBs(H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base))), b))) -> TL.And({lane == 1 : U32}, Laws.SqlAt(qs, sxs, base, b)):
  match w:
    case Tuple{eb, m}:
      Tuple{L.U32.eq_sound(lane, 1, eb), Sql.s(qs, sxs, base, b, m)}

def Base.l2(+lane: U32, +base: U32, +nxs: List<&2, F.Nx>, +b: H.Bs, w: TL.And({U32.is_eq(lane, 2) == True{} : Bool}, Laws.MemBs(H.Ho.nx(nxs, base), b))) -> TL.And({lane == 2 : U32}, TL.Ex(F.Nx, n => TL.And(FL.MemNx(nxs, n), Laws.NxAt(n, base, b)))):
  match w:
    case Tuple{eb, m}:
      Tuple{L.U32.eq_sound(lane, 2, eb), Nx.s(nxs, base, b, m)}

def Base.l3(+lane: U32, +base: U32, +kxs: List<&2, K.Kx>, +b: H.Bs, w: TL.And({U32.is_eq(lane, 3) == True{} : Bool}, Laws.MemBs(H.Ho.kx(kxs, base), b))) -> TL.And({lane == 3 : U32}, TL.Ex(K.Kx, n => TL.And(KL.MemKx(kxs, n), Laws.KxAt(n, base, b)))):
  match w:
    case Tuple{eb, m}:
      Tuple{L.U32.eq_sound(lane, 3, eb), Kx.s(kxs, base, b, m)}

def Base.or2(+lane: U32, +base: U32, +nxs: List<&2, F.Nx>, +kxs: List<&2, K.Kx>, +b: H.Bs, o: Either<&2, &2, Laws.MemBs(H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), b), Laws.MemBs(H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base)), b)>) -> Either<&2, &2, TL.And({lane == 2 : U32}, TL.Ex(F.Nx, n => TL.And(FL.MemNx(nxs, n), Laws.NxAt(n, base, b)))), TL.And({lane == 3 : U32}, TL.Ex(K.Kx, n => TL.And(KL.MemKx(kxs, n), Laws.KxAt(n, base, b))))>:
  match o:
    case Inl{m}:
      Inl{Base.l2(lane, base, nxs, b, When.s(U32.is_eq(lane, 2), H.Ho.nx(nxs, base), b, m))}
    case Inr{m}:
      Inr{Base.l3(lane, base, kxs, b, When.s(U32.is_eq(lane, 3), H.Ho.kx(kxs, base), b, m))}

def Base.or(+lane: U32, +base: U32, +qs: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +nxs: List<&2, F.Nx>, +kxs: List<&2, K.Kx>, +b: H.Bs, o: Either<&2, &2, Laws.MemBs(H.Ho.when(U32.is_eq(lane, 1), H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base)))), b), Laws.MemBs(List.append(&2, H.Bs, H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base))), b)>) -> Laws.BaseAt(qs, sxs, nxs, kxs, lane, base, b):
  match o:
    case Inl{m}:
      Inl{Base.l1(lane, base, qs, sxs, b, When.s(U32.is_eq(lane, 1), H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base))), b, m))}
    case Inr{m}:
      Inr{Base.or2(lane, base, nxs, kxs, b, AB.split(H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base)), b, m))}

def Laws.ho_bases_sound(eps, ces, qs, sxs, nxs, kxs, rhs, lane, base, b, hm):
  Base.or(lane, base, qs, sxs, nxs, kxs, b, AB.split(H.Ho.when(U32.is_eq(lane, 1), H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base)))), List.append(&2, H.Bs, H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base))), b, hm))

def Base.c2(+lane: U32, +base: U32, +nxs: List<&2, F.Nx>, +kxs: List<&2, K.Kx>, +b: H.Bs, o: Either<&2, &2, TL.And({lane == 2 : U32}, TL.Ex(F.Nx, n => TL.And(FL.MemNx(nxs, n), Laws.NxAt(n, base, b)))), TL.And({lane == 3 : U32}, TL.Ex(K.Kx, n => TL.And(KL.MemKx(kxs, n), Laws.KxAt(n, base, b))))>) -> Laws.MemBs(List.append(&2, H.Bs, H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base))), b):
  match o:
    case Inl{Tuple{el, Tuple{+n, Tuple{mn, at}}}}:
      AB.l(H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base)), b, When.c(U32.is_eq(lane, 2), H.Ho.nx(nxs, base), b, CP.U.eq_t(lane, 2, el), Nx.c(nxs, base, b, n, mn, at)))
    case Inr{Tuple{el, Tuple{+n, Tuple{mn, at}}}}:
      AB.r(H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base)), b, When.c(U32.is_eq(lane, 3), H.Ho.kx(kxs, base), b, CP.U.eq_t(lane, 3, el), Kx.c(kxs, base, b, n, mn, at)))

def Laws.ho_bases_complete(eps, ces, qs, sxs, nxs, kxs, rhs, lane, base, b, w):
  match w:
    case Inl{Tuple{el, sa}}:
      AB.l(H.Ho.when(U32.is_eq(lane, 1), H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base)))), List.append(&2, H.Bs, H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base))), b, When.c(U32.is_eq(lane, 1), H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base))), b, CP.U.eq_t(lane, 1, el), Sql.c(qs, sxs, base, b, sa)))
    case Inr{o}:
      AB.r(H.Ho.when(U32.is_eq(lane, 1), H.Ho.sql(qs, S.Scope.set(H.Ho.sids(sxs, base)))), List.append(&2, H.Bs, H.Ho.when(U32.is_eq(lane, 2), H.Ho.nx(nxs, base)), H.Ho.when(U32.is_eq(lane, 3), H.Ho.kx(kxs, base))), b, Base.c2(lane, base, nxs, kxs, b, o))

# ---- the hot filter ---------------------------------------------------------------------------
def Hot.k(+site: U32, +fn: U32, +t: List<&2, H.Bs>, +r: U32, +lane: U32, +base: U32, +rch: List<&2, U32>, +y: H.Hx, o: Either<&2, &2, TL.And({S.Scope.has(S.Scope.set(rch), fn) == True{} : Bool}, {H.Hx{r, lane, base, site, fn} == y : H.Hx}), Laws.MemHx(H.Ho.hot(t, r, lane, base, S.Scope.set(rch)), y)>, ih: Laws.MemHx(H.Ho.hot(t, r, lane, base, S.Scope.set(rch)), y) -> TL.Ex(H.Bs, b => TL.And(Laws.MemBs(t, b), TL.And(TL.Mem(rch, Laws.BsFn(b)), {H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)} == y : H.Hx})))) -> TL.Ex(H.Bs, b => TL.And(Laws.MemBs(Con{H.Bs{site, fn}, t}, b), TL.And(TL.Mem(rch, Laws.BsFn(b)), {H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)} == y : H.Hx}))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eh, ex}:
          Tuple{H.Bs{site, fn}, Tuple{Inl{{==}}, Tuple{SL.scope_set_sound(rch, fn, eh), ex}}}
    case Inr{m}:
      Lift.bs(b => TL.And(TL.Mem(rch, Laws.BsFn(b)), {H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)} == y : H.Hx}), H.Bs{site, fn}, t, ih(m))

def Hot.s(bs: List<&2, H.Bs>, +r: U32, +lane: U32, +base: U32, +rch: List<&2, U32>, +y: H.Hx, h: Laws.MemHx(H.Ho.hot(bs, r, lane, base, S.Scope.set(rch)), y)) -> TL.Ex(H.Bs, b => TL.And(Laws.MemBs(bs, b), TL.And(TL.Mem(rch, Laws.BsFn(b)), {H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)} == y : H.Hx}))):
  match bs:
    case Nil{}:
      match h:
    case Con{H.Bs{+site, +fn}, +t}:
      Hot.k(site, fn, t, r, lane, base, rch, y, HK.mem(S.Scope.has(S.Scope.set(rch), fn), H.Hx{r, lane, base, site, fn}, H.Ho.hot(t, r, lane, base, S.Scope.set(rch)), y, h), q => Hot.s(t, r, lane, base, rch, y, q))

def Hot.hit(b: H.Bs, +t: List<&2, H.Bs>, +r: U32, +lane: U32, +base: U32, +rch: List<&2, U32>, mr: TL.Mem(rch, Laws.BsFn(b))) -> Laws.MemHx(H.Ho.hot(Con{b, t}, r, lane, base, S.Scope.set(rch)), H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)}):
  match b:
    case H.Bs{+site, +fn}:
      HK.hit(S.Scope.has(S.Scope.set(rch), fn), H.Hx{r, lane, base, site, fn}, H.Ho.hot(t, r, lane, base, S.Scope.set(rch)), SL.scope_set_complete(rch, fn, mr))

def Hot.stay(h: H.Bs, +t: List<&2, H.Bs>, +r: U32, +lane: U32, +base: U32, +hset: G.Tr, +y: H.Hx, m: Laws.MemHx(H.Ho.hot(t, r, lane, base, hset), y)) -> Laws.MemHx(H.Ho.hot(Con{h, t}, r, lane, base, hset), y):
  match h:
    case H.Bs{+site, +fn}:
      HK.stay(S.Scope.has(hset, fn), H.Hx{r, lane, base, site, fn}, H.Ho.hot(t, r, lane, base, hset), y, m)

def Hot.c(bs: List<&2, H.Bs>, +r: U32, +lane: U32, +base: U32, +rch: List<&2, U32>, +b: H.Bs, hm: Laws.MemBs(bs, b), mr: TL.Mem(rch, Laws.BsFn(b))) -> Laws.MemHx(H.Ho.hot(bs, r, lane, base, S.Scope.set(rch)), H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)}):
  match bs:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(H.Bs, h, b, e) : Laws.MemHx(H.Ho.hot(Con{_, t}, r, lane, base, S.Scope.set(rch)), H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)})
          Hot.hit(b, t, r, lane, base, rch, mr)
        case Inr{q}:
          Hot.stay(h, t, r, lane, base, S.Scope.set(rch), H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)}, Hot.c(t, r, lane, base, rch, b, q, mr))

# ---- one rule row -----------------------------------------------------------------------------
def Rule.s(+eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +qs: List<&2, Q.Qs>, +sxs: List<&2, Q.Sx>, +nxs: List<&2, F.Nx>, +kxs: List<&2, K.Kx>, +rhs: List<&2, H.Rh>, +r: U32, +lane: U32, +base: U32, +depth: U32, +y: H.Hx, w: TL.Ex(H.Bs, b => TL.And(Laws.MemBs(H.Ho.bases(lane, base, H.HF{eps, ces, qs, sxs, nxs, kxs, rhs}), b), TL.And(TL.Mem(H.Ho.reach(U32.to_nat(depth), ces, H.Ho.seed(eps)), Laws.BsFn(b)), {H.Hx{r, lane, base, Laws.BsSite(b), Laws.BsFn(b)} == y : H.Hx})))) -> Laws.HotAt(eps, ces, qs, sxs, nxs, kxs, r, lane, base, depth, y):
  match w:
    case Tuple{+b, q}:
      match q:
        case Tuple{mb, q2}:
          match q2:
            case Tuple{mr, ey}:
              Tuple{b, Tuple{Laws.ho_bases_sound(eps, ces, qs, sxs, nxs, kxs, rhs, lane, base, b, mb), Tuple{Laws.ho_reach_sound(U32.to_nat(depth), eps, ces, Laws.BsFn(b), mr), ey}}}

def Laws.ho_rule_sound(eps, ces, qs, sxs, nxs, kxs, rhs, r, lane, base, depth, y, hm):
  Rule.s(eps, ces, qs, sxs, nxs, kxs, rhs, r, lane, base, depth, y, Hot.s(H.Ho.bases(lane, base, H.HF{eps, ces, qs, sxs, nxs, kxs, rhs}), r, lane, base, H.Ho.reach(U32.to_nat(depth), ces, H.Ho.seed(eps)), y, hm))

def Laws.ho_rule_complete(eps, ces, qs, sxs, nxs, kxs, rhs, r, lane, base, depth, y, w):
  match w:
    case Tuple{+b, q}:
      match q:
        case Tuple{ba, q2}:
          match q2:
            case Tuple{hr, ey}:
              %ey : Laws.MemHx(H.Ho.rule(H.HF{eps, ces, qs, sxs, nxs, kxs, rhs}, H.Rh{r, lane, base, depth}), _)
              Hot.c(H.Ho.bases(lane, base, H.HF{eps, ces, qs, sxs, nxs, kxs, rhs}), r, lane, base, H.Ho.reach(U32.to_nat(depth), ces, H.Ho.seed(eps)), b, Laws.ho_bases_complete(eps, ces, qs, sxs, nxs, kxs, rhs, lane, base, b, ba), Laws.ho_reach_complete(U32.to_nat(depth), eps, ces, Laws.BsFn(b), hr))

# ---- every rule row ---------------------------------------------------------------------------
def Rules.up(+k: H.Rh, +t: List<&2, H.Rh>, +f: H.HF, +y: H.Hx, w: TL.Ex(H.Rh, g => TL.And(Laws.MemRh(t, g), Laws.MemHx(H.Ho.rule(f, g), y)))) -> TL.Ex(H.Rh, g => TL.And(Laws.MemRh(Con{k, t}, g), Laws.MemHx(H.Ho.rule(f, g), y))):
  match w:
    case Tuple{g, q}:
      match q:
        case Tuple{mg, m}:
          Tuple{g, Tuple{Inr{mg}, m}}

def Rules.s2(+k: H.Rh, +t: List<&2, H.Rh>, +f: H.HF, +y: H.Hx, o: Either<&2, &2, Laws.MemHx(H.Ho.rule(f, k), y), Laws.MemHx(H.Ho.rules(f, t), y)>, ih: Laws.MemHx(H.Ho.rules(f, t), y) -> TL.Ex(H.Rh, g => TL.And(Laws.MemRh(t, g), Laws.MemHx(H.Ho.rule(f, g), y)))) -> TL.Ex(H.Rh, g => TL.And(Laws.MemRh(Con{k, t}, g), Laws.MemHx(H.Ho.rule(f, g), y))):
  match o:
    case Inl{m}:
      Tuple{k, Tuple{Inl{{==}}, m}}
    case Inr{m}:
      Rules.up(k, t, f, y, ih(m))

def Rules.s(rhs: List<&2, H.Rh>, +f: H.HF, +y: H.Hx, h: Laws.MemHx(H.Ho.rules(f, rhs), y)) -> TL.Ex(H.Rh, g => TL.And(Laws.MemRh(rhs, g), Laws.MemHx(H.Ho.rule(f, g), y))):
  match rhs:
    case Nil{}:
      match h:
    case Con{+k, +t}:
      Rules.s2(k, t, f, y, AH.split(H.Ho.rule(f, k), H.Ho.rules(f, t), y, h), m => Rules.s(t, f, y, m))

def Laws.ho_findings_sound(f, y, hm):
  Rules.s(H.Ho.rhs(f), f, y, hm)

def Rules.c(rhs: List<&2, H.Rh>, +f: H.HF, +k: H.Rh, +y: H.Hx, hk: Laws.MemRh(rhs, k), hm: Laws.MemHx(H.Ho.rule(f, k), y)) -> Laws.MemHx(H.Ho.rules(f, rhs), y):
  match rhs:
    case Nil{}:
      match hk:
    case Con{h, +t}:
      match hk:
        case Inl{e}:
          %Equal.sym(H.Rh, h, k, e) : Laws.MemHx(H.Ho.rules(f, Con{_, t}), y)
          AH.l(H.Ho.rule(f, k), H.Ho.rules(f, t), y, hm)
        case Inr{q}:
          AH.r(H.Ho.rule(f, h), H.Ho.rules(f, t), y, Rules.c(t, f, k, y, q, hm))

def Laws.ho_findings_complete(f, h, y, hh, hm):
  Rules.c(H.Ho.rhs(f), f, h, y, hh, hm)

def Laws.ho_lines_shape(f):
  {==}
