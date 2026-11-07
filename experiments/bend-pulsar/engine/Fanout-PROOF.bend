# engine/Fanout-PROOF.bend - proofs of Fanout-LAWS.bend. Gate: bend Fanout-PROOF.bend --verdict
import Base
import ../LAWS.bend as TL
import ./Metrics-NAT.bend as N
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./ClassCtx.bend as X
import ./ClassCtx-LAWS.bend as CL
import ./ClassCtx-PROOF.bend as CP
import ./Hotspot-PROOF.bend as HP
import ./Sql-PROOF.bend as QP
import ./Fanout.bend as F
import ./Fanout-LAWS.bend as Laws

# ---- list lemmas ------------------------------------------------------------------------------
def AU.sh(+a: U32, +t: List<&2, U32>, +ys: List<&2, U32>, +x: U32, o: Either<&2, &2, TL.Mem(t, x), TL.Mem(ys, x)>) -> Either<&2, &2, TL.Mem(Con{a, t}, x), TL.Mem(ys, x)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def AU.split(xs: List<&2, U32>, +ys: List<&2, U32>, +x: U32, h: TL.Mem(List.append(&2, U32, xs, ys), x)) -> Either<&2, &2, TL.Mem(xs, x), TL.Mem(ys, x)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AU.sh(a, t, ys, x, AU.split(t, ys, x, q))

def AU.l(xs: List<&2, U32>, +ys: List<&2, U32>, +x: U32, h: TL.Mem(xs, x)) -> TL.Mem(List.append(&2, U32, xs, ys), x):
  match xs:
    case Nil{}:
      Empty.absurd(TL.Mem(ys, x), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AU.l(t, ys, x, q)}

def AU.r(xs: List<&2, U32>, +ys: List<&2, U32>, +x: U32, h: TL.Mem(ys, x)) -> TL.Mem(List.append(&2, U32, xs, ys), x):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{AU.r(t, ys, x, h)}

def AN.sh(+a: F.Nx, +t: List<&2, F.Nx>, +ys: List<&2, F.Nx>, +y: F.Nx, o: Either<&2, &2, Laws.MemNx(t, y), Laws.MemNx(ys, y)>) -> Either<&2, &2, Laws.MemNx(Con{a, t}, y), Laws.MemNx(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def AN.split(xs: List<&2, F.Nx>, +ys: List<&2, F.Nx>, +y: F.Nx, h: Laws.MemNx(List.append(&2, F.Nx, xs, ys), y)) -> Either<&2, &2, Laws.MemNx(xs, y), Laws.MemNx(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AN.sh(a, t, ys, y, AN.split(t, ys, y, q))

def AN.l(xs: List<&2, F.Nx>, +ys: List<&2, F.Nx>, +y: F.Nx, h: Laws.MemNx(xs, y)) -> Laws.MemNx(List.append(&2, F.Nx, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemNx(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AN.l(t, ys, y, q)}

def AN.r(xs: List<&2, F.Nx>, +ys: List<&2, F.Nx>, +y: F.Nx, h: Laws.MemNx(ys, y)) -> Laws.MemNx(List.append(&2, F.Nx, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{AN.r(t, ys, y, h)}

def PU.mem(b: Bool, +s: U32, +rest: List<&2, U32>, +x: U32, h: TL.Mem(X.Cx.push_u(b, s, rest), x)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {s == x : U32}), TL.Mem(rest, x)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def PU.hit(b: Bool, +s: U32, +rest: List<&2, U32>, hb: {b == True{} : Bool}) -> TL.Mem(X.Cx.push_u(b, s, rest), s):
  %Equal.sym(Bool, b, True{}, hb) : TL.Mem(X.Cx.push_u(_, s, rest), s)
  Inl{{==}}

def KN.mem(b: Bool, +x: F.Nx, +rest: List<&2, F.Nx>, +y: F.Nx, h: Laws.MemNx(F.Fo.keep(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : F.Nx}), Laws.MemNx(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def KN.stay(b: Bool, +x: F.Nx, +rest: List<&2, F.Nx>, +y: F.Nx, h: Laws.MemNx(rest, y)) -> Laws.MemNx(F.Fo.keep(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def KN.hit(b: Bool, +x: F.Nx, +rest: List<&2, F.Nx>, hb: {b == True{} : Bool}) -> Laws.MemNx(F.Fo.keep(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemNx(F.Fo.keep(_, x, rest), x)
  Inl{{==}}

def Lift.cs(-P: @s: X.Cs -> Data, +h: X.Cs, +t: List<&2, X.Cs>, w: TL.Ex(X.Cs, s => TL.And(Laws.MemCs(t, s), P(s)))) -> TL.Ex(X.Cs, s => TL.And(Laws.MemCs(Con{h, t}, s), P(s))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.ce(-P: @e: F.Ce -> Data, +h: F.Ce, +t: List<&2, F.Ce>, w: TL.Ex(F.Ce, e => TL.And(Laws.MemCe(t, e), P(e)))) -> TL.Ex(F.Ce, e => TL.And(Laws.MemCe(Con{h, t}, e), P(e))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Not.tt(x: Bool, e: {x == False{} : Bool}) -> {Bool.not(x) == True{} : Bool}:
  %Equal.sym(Bool, x, False{}, e) : {Bool.not(_) == True{} : Bool}
  {==}

def At.of(+ld: U32, +ctx: U32, +none: U32, +e: {F.Fo.at(ld, ctx, none) == True{} : Bool}) -> Laws.AtLoop(ld, ctx, none):
  Tuple{QP.Not.ff(U32.is_eq(ld, 0), QP.And.l(Bool.not(U32.is_eq(ld, 0)), U32.is_eq(U32.and(ctx, none), 0), e)), QP.And.r(Bool.not(U32.is_eq(ld, 0)), U32.is_eq(U32.and(ctx, none), 0), e)}

def At.to(+ld: U32, +ctx: U32, +none: U32, a: Laws.AtLoop(ld, ctx, none)) -> {F.Fo.at(ld, ctx, none) == True{} : Bool}:
  match a:
    case Tuple{e1, e2}:
      HP.And.both(Bool.not(U32.is_eq(ld, 0)), U32.is_eq(U32.and(ctx, none), 0), Not.tt(U32.is_eq(ld, 0), e1), e2)

# ---- the seed set: functions holding a call of the class ------------------------------------------
def Seed.k(+site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, +t: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +x: U32, o: Either<&2, &2, TL.And({S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee) == True{} : Bool}, {fn == x : U32}), TL.Mem(F.Fo.seed(t, S.Scope.set(X.Cx.ids(cls, c))), x)>, ih: TL.Mem(F.Fo.seed(t, S.Scope.set(X.Cx.ids(cls, c))), x) -> TL.Ex(X.Cs, s => TL.And(Laws.MemCs(t, s), Laws.SeedAt(s, cls, c, x)))) -> TL.Ex(X.Cs, s => TL.And(Laws.MemCs(Con{X.Cs{site, fn, callee, ld, ctx}, t}, s), Laws.SeedAt(s, cls, c, x))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eh, ef}:
          Tuple{X.Cs{site, fn, callee, ld, ctx}, Tuple{Inl{{==}}, Tuple{ef, CP.IS(cls, c, callee, SL.scope_set_sound(X.Cx.ids(cls, c), callee, eh))}}}
    case Inr{m}:
      Lift.cs(s => Laws.SeedAt(s, cls, c, x), X.Cs{site, fn, callee, ld, ctx}, t, ih(m))

def Seed.s(css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +x: U32, h: TL.Mem(F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))), x)) -> TL.Ex(X.Cs, s => TL.And(Laws.MemCs(css, s), Laws.SeedAt(s, cls, c, x))):
  match css:
    case Nil{}:
      match h:
    case Con{X.Cs{+site, +fn, +callee, +ld, +ctx}, +t}:
      Seed.k(site, fn, callee, ld, ctx, t, cls, c, x, PU.mem(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), fn, F.Fo.seed(t, S.Scope.set(X.Cx.ids(cls, c))), x, h), q => Seed.s(t, cls, c, x, q))

def Seed.hit(s: X.Cs, +t: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +x: U32, at: Laws.SeedAt(s, cls, c, x)) -> TL.Mem(F.Fo.seed(Con{s, t}, S.Scope.set(X.Cx.ids(cls, c))), x):
  match s:
    case X.Cs{+site, +fn, +callee, +ld, +ctx}:
      match at:
        case Tuple{ef, hc}:
          %ef : TL.Mem(F.Fo.seed(Con{X.Cs{site, fn, callee, ld, ctx}, t}, S.Scope.set(X.Cx.ids(cls, c))), _)
          PU.hit(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), fn, F.Fo.seed(t, S.Scope.set(X.Cx.ids(cls, c))), SL.scope_set_complete(X.Cx.ids(cls, c), callee, CP.IC(cls, c, callee, hc)))

def Seed.stay(h: X.Cs, +t: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +x: U32, m: TL.Mem(F.Fo.seed(t, S.Scope.set(X.Cx.ids(cls, c))), x)) -> TL.Mem(F.Fo.seed(Con{h, t}, S.Scope.set(X.Cx.ids(cls, c))), x):
  match h:
    case X.Cs{+site, +fn, +callee, +ld, +ctx}:
      CP.PU.keep(S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), fn, F.Fo.seed(t, S.Scope.set(X.Cx.ids(cls, c))), x, m)

def Seed.c(css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +x: U32, +s: X.Cs, hm: Laws.MemCs(css, s), at: Laws.SeedAt(s, cls, c, x)) -> TL.Mem(F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))), x):
  match css:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(X.Cs, h, s, e) : TL.Mem(F.Fo.seed(Con{_, t}, S.Scope.set(X.Cx.ids(cls, c))), x)
          Seed.hit(s, t, cls, c, x, at)
        case Inr{q}:
          Seed.stay(h, t, cls, c, x, Seed.c(t, cls, c, x, s, q, at))

def Seed.from(+css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +y: U32, r: Laws.Rch(0n, css, ces, cls, c, y)) -> TL.Mem(F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))), y):
  match r:
    case Tuple{w, q}:
      match q:
        case Tuple{ms, at}:
          Seed.c(css, cls, c, y, w, ms, at)

# ---- one step: the callers of a set -----------------------------------------------------------
def Step.k(+site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, +t: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, o: Either<&2, &2, TL.And({S.Scope.has(S.Scope.set(cur), target) == True{} : Bool}, {fn == x : U32}), TL.Mem(F.Fo.step(t, S.Scope.set(cur)), x)>, ih: TL.Mem(F.Fo.step(t, S.Scope.set(cur)), x) -> TL.Ex(F.Ce, e => TL.And(Laws.MemCe(t, e), TL.And({F.Ce.fn(e) == x : U32}, TL.Mem(cur, F.Ce.target(e)))))) -> TL.Ex(F.Ce, e => TL.And(Laws.MemCe(Con{F.Ce{site, fn, target, node, ld, ctx}, t}, e), TL.And({F.Ce.fn(e) == x : U32}, TL.Mem(cur, F.Ce.target(e))))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eh, ef}:
          Tuple{F.Ce{site, fn, target, node, ld, ctx}, Tuple{Inl{{==}}, Tuple{ef, SL.scope_set_sound(cur, target, eh)}}}
    case Inr{m}:
      Lift.ce(e => TL.And({F.Ce.fn(e) == x : U32}, TL.Mem(cur, F.Ce.target(e))), F.Ce{site, fn, target, node, ld, ctx}, t, ih(m))

def Step.s(ces: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, h: TL.Mem(F.Fo.step(ces, S.Scope.set(cur)), x)) -> TL.Ex(F.Ce, e => TL.And(Laws.MemCe(ces, e), TL.And({F.Ce.fn(e) == x : U32}, TL.Mem(cur, F.Ce.target(e))))):
  match ces:
    case Nil{}:
      match h:
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t}:
      Step.k(site, fn, target, node, ld, ctx, t, cur, x, PU.mem(S.Scope.has(S.Scope.set(cur), target), fn, F.Fo.step(t, S.Scope.set(cur)), x, h), q => Step.s(t, cur, x, q))

def Step.hit(e: F.Ce, +t: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, ef: {F.Ce.fn(e) == x : U32}, mt: TL.Mem(cur, F.Ce.target(e))) -> TL.Mem(F.Fo.step(Con{e, t}, S.Scope.set(cur)), x):
  match e:
    case F.Ce{+site, +fn, +target, +node, +ld, +ctx}:
      %ef : TL.Mem(F.Fo.step(Con{F.Ce{site, fn, target, node, ld, ctx}, t}, S.Scope.set(cur)), _)
      PU.hit(S.Scope.has(S.Scope.set(cur), target), fn, F.Fo.step(t, S.Scope.set(cur)), SL.scope_set_complete(cur, target, mt))

def Step.stay(h: F.Ce, +t: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, m: TL.Mem(F.Fo.step(t, S.Scope.set(cur)), x)) -> TL.Mem(F.Fo.step(Con{h, t}, S.Scope.set(cur)), x):
  match h:
    case F.Ce{+site, +fn, +target, +node, +ld, +ctx}:
      CP.PU.keep(S.Scope.has(S.Scope.set(cur), target), fn, F.Fo.step(t, S.Scope.set(cur)), x, m)

def Step.c(ces: List<&2, F.Ce>, +cur: List<&2, U32>, +x: U32, +e: F.Ce, hm: Laws.MemCe(ces, e), ef: {F.Ce.fn(e) == x : U32}, mt: TL.Mem(cur, F.Ce.target(e))) -> TL.Mem(F.Fo.step(ces, S.Scope.set(cur)), x):
  match ces:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{q}:
          %Equal.sym(F.Ce, h, e, q) : TL.Mem(F.Fo.step(Con{_, t}, S.Scope.set(cur)), x)
          Step.hit(e, t, cur, x, ef, mt)
        case Inr{q}:
          Step.stay(h, t, cur, x, Step.c(t, cur, x, e, q, ef, mt))

# ---- the reach set ----------------------------------------------------------------------------
def Inv.edge(+css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.Rch(j, css, ces, cls, c, y), +y: U32, w: TL.Ex(F.Ce, e => TL.And(Laws.MemCe(ces, e), TL.And({F.Ce.fn(e) == y : U32}, TL.Mem(cur, F.Ce.target(e)))))) -> Laws.Rch(1n+j, css, ces, cls, c, y):
  match w:
    case Tuple{+e, q}:
      match q:
        case Tuple{me, q2}:
          match q2:
            case Tuple{ef, mt}:
              Inr{Tuple{e, Tuple{me, Tuple{ef, inv(F.Ce.target(e), mt)}}}}

def Inv.up2(+css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.Rch(j, css, ces, cls, c, y), +y: U32, o: Either<&2, &2, TL.Mem(cur, y), TL.Mem(F.Fo.step(ces, S.Scope.set(cur)), y)>) -> Laws.Rch(1n+j, css, ces, cls, c, y):
  match o:
    case Inl{m}:
      Inl{inv(y, m)}
    case Inr{m}:
      Inv.edge(css, ces, cls, c, j, cur, inv, y, Step.s(ces, cur, y, m))

def Inv.up(+css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.Rch(j, css, ces, cls, c, y), +y: U32, h: TL.Mem(List.append(&2, U32, cur, F.Fo.step(ces, S.Scope.set(cur))), y)) -> Laws.Rch(1n+j, css, ces, cls, c, y):
  Inv.up2(css, ces, cls, c, j, cur, inv, y, AU.split(cur, F.Fo.step(ces, S.Scope.set(cur)), y, h))

def RS(k: Nat, +css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.Rch(j, css, ces, cls, c, y), +x: U32, hm: TL.Mem(F.Fo.reach(k, ces, cur), x)) -> Laws.Rch(Nat.add(k, j), css, ces, cls, c, x):
  match k:
    case 0n:
      inv(x, hm)
    case 1n+p:
      +q = p
      %N.Nat.add_succ_r(q, j) : Laws.Rch(_, css, ces, cls, c, x)
      RS(q, css, ces, cls, c, 1n+j, List.append(&2, U32, cur, F.Fo.step(ces, S.Scope.set(cur))), y => h => Inv.up(css, ces, cls, c, j, cur, inv, y, h), x, hm)

def Inv.down(+css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> Laws.Rch(j, css, ces, cls, c, y) -> TL.Mem(cur, y), +y: U32, w: Laws.Rch(1n+j, css, ces, cls, c, y)) -> TL.Mem(List.append(&2, U32, cur, F.Fo.step(ces, S.Scope.set(cur))), y):
  match w:
    case Inl{r}:
      AU.l(cur, F.Fo.step(ces, S.Scope.set(cur)), y, inv(y, r))
    case Inr{Tuple{+e, Tuple{me, Tuple{ef, rt}}}}:
      AU.r(cur, F.Fo.step(ces, S.Scope.set(cur)), y, Step.c(ces, cur, y, e, me, ef, inv(F.Ce.target(e), rt)))

def Rw.rch(+a: Nat, +b: Nat, +css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +x: U32, e: {b == a : Nat}, w: Laws.Rch(b, css, ces, cls, c, x)) -> Laws.Rch(a, css, ces, cls, c, x):
  %e : Laws.Rch(_, css, ces, cls, c, x)
  w

def RC(k: Nat, +css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> Laws.Rch(j, css, ces, cls, c, y) -> TL.Mem(cur, y), +x: U32, w: Laws.Rch(Nat.add(k, j), css, ces, cls, c, x)) -> TL.Mem(F.Fo.reach(k, ces, cur), x):
  match k:
    case 0n:
      inv(x, w)
    case 1n+p:
      +q = p
      RC(q, css, ces, cls, c, 1n+j, List.append(&2, U32, cur, F.Fo.step(ces, S.Scope.set(cur))), y => r => Inv.down(css, ces, cls, c, j, cur, inv, y, r), x, Rw.rch(Nat.add(q, 1n+j), 1n+Nat.add(q, j), css, ces, cls, c, x, Equal.sym(Nat, Nat.add(q, 1n+j), 1n+Nat.add(q, j), N.Nat.add_succ_r(q, j)), w))

def Laws.fo_reach_sound(k, css, ces, cls, c, x, hm):
  %N.Nat.add_zero_r(k) : Laws.Rch(_, css, ces, cls, c, x)
  RS(k, css, ces, cls, c, 0n, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))), y => h => Seed.s(css, cls, c, y, h), x, hm)

def Laws.fo_reach_complete(k, css, ces, cls, c, x, w):
  RC(k, css, ces, cls, c, 0n, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))), y => r => Seed.from(css, ces, cls, c, y, r), x, Rw.rch(Nat.add(k, 0n), k, css, ces, cls, c, x, Equal.sym(Nat, Nat.add(k, 0n), k, N.Nat.add_zero_r(k)), w))

# ---- one rule row -----------------------------------------------------------------------------
def Dir.k(+site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, +t: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +r: U32, +none: U32, +y: F.Nx, o: Either<&2, &2, TL.And({Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee)) == True{} : Bool}, {F.Nx{r, site, fn, callee, 0} == y : F.Nx}), Laws.MemNx(F.Fo.direct(t, r, none, S.Scope.set(X.Cx.ids(cls, c))), y)>, ih: Laws.MemNx(F.Fo.direct(t, r, none, S.Scope.set(X.Cx.ids(cls, c))), y) -> TL.Ex(X.Cs, s => TL.And(Laws.MemCs(t, s), Laws.DirAt(s, cls, c, r, none, y)))) -> TL.Ex(X.Cs, s => TL.And(Laws.MemCs(Con{X.Cs{site, fn, callee, ld, ctx}, t}, s), Laws.DirAt(s, cls, c, r, none, y))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{+eb, ex}:
          Tuple{X.Cs{site, fn, callee, ld, ctx}, Tuple{Inl{{==}}, Tuple{At.of(ld, ctx, none, QP.And.l(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), eb)), Tuple{CP.IS(cls, c, callee, SL.scope_set_sound(X.Cx.ids(cls, c), callee, QP.And.r(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), eb))), ex}}}}
    case Inr{m}:
      Lift.cs(s => Laws.DirAt(s, cls, c, r, none, y), X.Cs{site, fn, callee, ld, ctx}, t, ih(m))

def Dir.s(css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +r: U32, +none: U32, +y: F.Nx, h: Laws.MemNx(F.Fo.direct(css, r, none, S.Scope.set(X.Cx.ids(cls, c))), y)) -> TL.Ex(X.Cs, s => TL.And(Laws.MemCs(css, s), Laws.DirAt(s, cls, c, r, none, y))):
  match css:
    case Nil{}:
      match h:
    case Con{X.Cs{+site, +fn, +callee, +ld, +ctx}, +t}:
      Dir.k(site, fn, callee, ld, ctx, t, cls, c, r, none, y, KN.mem(Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee)), F.Nx{r, site, fn, callee, 0}, F.Fo.direct(t, r, none, S.Scope.set(X.Cx.ids(cls, c))), y, h), q => Dir.s(t, cls, c, r, none, y, q))

def Edge.k(+site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, +t: List<&2, F.Ce>, +css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +r: U32, +none: U32, +p: Nat, +y: F.Nx, o: Either<&2, &2, TL.And({Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))))), target)) == True{} : Bool}, {F.Nx{r, site, fn, target, 1} == y : F.Nx}), Laws.MemNx(F.Fo.edges(t, r, none, S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))))), y)>, ih: Laws.MemNx(F.Fo.edges(t, r, none, S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))))), y) -> TL.Ex(F.Ce, e => TL.And(Laws.MemCe(t, e), Laws.ViaAt(e, css, ces, cls, c, r, none, p, y)))) -> TL.Ex(F.Ce, e => TL.And(Laws.MemCe(Con{F.Ce{site, fn, target, node, ld, ctx}, t}, e), Laws.ViaAt(e, css, ces, cls, c, r, none, p, y))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{+eb, ex}:
          Tuple{F.Ce{site, fn, target, node, ld, ctx}, Tuple{Inl{{==}}, Tuple{At.of(ld, ctx, none, QP.And.l(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))))), target), eb)), Tuple{Laws.fo_reach_sound(p, css, ces, cls, c, target, SL.scope_set_sound(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), target, QP.And.r(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))))), target), eb))), ex}}}}
    case Inr{m}:
      Lift.ce(e => Laws.ViaAt(e, css, ces, cls, c, r, none, p, y), F.Ce{site, fn, target, node, ld, ctx}, t, ih(m))

def Edge.s(es: List<&2, F.Ce>, +css: List<&2, X.Cs>, +ces: List<&2, F.Ce>, +cls: List<&2, X.Cl>, +c: U32, +r: U32, +none: U32, +p: Nat, +y: F.Nx, h: Laws.MemNx(F.Fo.edges(es, r, none, S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))))), y)) -> TL.Ex(F.Ce, e => TL.And(Laws.MemCe(es, e), Laws.ViaAt(e, css, ces, cls, c, r, none, p, y))):
  match es:
    case Nil{}:
      match h:
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t}:
      Edge.k(site, fn, target, node, ld, ctx, t, css, ces, cls, c, r, none, p, y, KN.mem(Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))))), target)), F.Nx{r, site, fn, target, 1}, F.Fo.edges(t, r, none, S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))))), y, h), q => Edge.s(t, css, ces, cls, c, r, none, p, y, q))

def Via.s(k: Nat, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, F.Ce>, +c: U32, +edges: U32, +r: U32, +none: U32, +y: F.Nx, ek: {U32.to_nat(edges) == k : Nat}, h: Laws.MemNx(F.Fo.via(k, ces, r, none, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), y)) -> TL.Ex(Nat, p => TL.And({U32.to_nat(edges) == 1n+p : Nat}, TL.Ex(F.Ce, e => TL.And(Laws.MemCe(ces, e), Laws.ViaAt(e, css, ces, cls, c, r, none, p, y))))):
  match k:
    case 0n:
      match h:
    case 1n+p:
      +q = p
      Tuple{q, Tuple{ek, Edge.s(ces, css, ces, cls, c, r, none, q, y, h)}}

def Rule.s2(+css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, F.Ce>, +r: U32, +c: U32, +edges: U32, +none: U32, +y: F.Nx, o: Either<&2, &2, Laws.MemNx(F.Fo.direct(css, r, none, S.Scope.set(X.Cx.ids(cls, c))), y), Laws.MemNx(F.Fo.via(U32.to_nat(edges), ces, r, none, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), y)>) -> Either<&2, &2, TL.Ex(X.Cs, s => TL.And(Laws.MemCs(css, s), Laws.DirAt(s, cls, c, r, none, y))), TL.Ex(Nat, p => TL.And({U32.to_nat(edges) == 1n+p : Nat}, TL.Ex(F.Ce, e => TL.And(Laws.MemCe(ces, e), Laws.ViaAt(e, css, ces, cls, c, r, none, p, y)))))>:
  match o:
    case Inl{m}:
      Inl{Dir.s(css, cls, c, r, none, y, m)}
    case Inr{m}:
      Inr{Via.s(U32.to_nat(edges), css, cls, ces, c, edges, r, none, y, {==}, m)}

def Laws.fo_rule_sound(css, cls, ces, r, c, edges, none, y, hm):
  Rule.s2(css, cls, ces, r, c, edges, none, y, AN.split(F.Fo.direct(css, r, none, S.Scope.set(X.Cx.ids(cls, c))), F.Fo.via(U32.to_nat(edges), ces, r, none, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), y, hm))

def Dir.stay(h: X.Cs, +t: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +r: U32, +none: U32, +y: F.Nx, m: Laws.MemNx(F.Fo.direct(t, r, none, S.Scope.set(X.Cx.ids(cls, c))), y)) -> Laws.MemNx(F.Fo.direct(Con{h, t}, r, none, S.Scope.set(X.Cx.ids(cls, c))), y):
  match h:
    case X.Cs{+site, +fn, +callee, +ld, +ctx}:
      KN.stay(Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee)), F.Nx{r, site, fn, callee, 0}, F.Fo.direct(t, r, none, S.Scope.set(X.Cx.ids(cls, c))), y, m)

def Dir.c(css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +c: U32, +r: U32, +none: U32, +site: U32, +fn: U32, +callee: U32, +ld: U32, +ctx: U32, hm: Laws.MemCs(css, X.Cs{site, fn, callee, ld, ctx}), +hb: {Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee)) == True{} : Bool}) -> Laws.MemNx(F.Fo.direct(css, r, none, S.Scope.set(X.Cx.ids(cls, c))), F.Nx{r, site, fn, callee, 0}):
  match css:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(X.Cs, h, X.Cs{site, fn, callee, ld, ctx}, e) : Laws.MemNx(F.Fo.direct(Con{_, t}, r, none, S.Scope.set(X.Cx.ids(cls, c))), F.Nx{r, site, fn, callee, 0})
          KN.hit(Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee)), F.Nx{r, site, fn, callee, 0}, F.Fo.direct(t, r, none, S.Scope.set(X.Cx.ids(cls, c))), hb)
        case Inr{q}:
          Dir.stay(h, t, cls, c, r, none, F.Nx{r, site, fn, callee, 0}, Dir.c(t, cls, c, r, none, site, fn, callee, ld, ctx, q, hb))

def Laws.fo_direct_complete(css, cls, ces, r, c, edges, none, site, fn, callee, ld, ctx, hm, ha, hc):
  AN.l(F.Fo.direct(css, r, none, S.Scope.set(X.Cx.ids(cls, c))), F.Fo.via(U32.to_nat(edges), ces, r, none, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), F.Nx{r, site, fn, callee, 0}, Dir.c(css, cls, c, r, none, site, fn, callee, ld, ctx, hm, HP.And.both(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(X.Cx.ids(cls, c)), callee), At.to(ld, ctx, none, ha), SL.scope_set_complete(X.Cx.ids(cls, c), callee, CP.IC(cls, c, callee, hc)))))

def Edge.stay(h: F.Ce, +t: List<&2, F.Ce>, +rt: G.Tr, +r: U32, +none: U32, +y: F.Nx, m: Laws.MemNx(F.Fo.edges(t, r, none, rt), y)) -> Laws.MemNx(F.Fo.edges(Con{h, t}, r, none, rt), y):
  match h:
    case F.Ce{+site, +fn, +target, +node, +ld, +ctx}:
      KN.stay(Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(rt, target)), F.Nx{r, site, fn, target, 1}, F.Fo.edges(t, r, none, rt), y, m)

def Edge.c(es: List<&2, F.Ce>, +rt: G.Tr, +r: U32, +none: U32, +site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, hm: Laws.MemCe(es, F.Ce{site, fn, target, node, ld, ctx}), +hb: {Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(rt, target)) == True{} : Bool}) -> Laws.MemNx(F.Fo.edges(es, r, none, rt), F.Nx{r, site, fn, target, 1}):
  match es:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(F.Ce, h, F.Ce{site, fn, target, node, ld, ctx}, e) : Laws.MemNx(F.Fo.edges(Con{_, t}, r, none, rt), F.Nx{r, site, fn, target, 1})
          KN.hit(Bool.and(F.Fo.at(ld, ctx, none), S.Scope.has(rt, target)), F.Nx{r, site, fn, target, 1}, F.Fo.edges(t, r, none, rt), hb)
        case Inr{q}:
          Edge.stay(h, t, rt, r, none, F.Nx{r, site, fn, target, 1}, Edge.c(t, rt, r, none, site, fn, target, node, ld, ctx, q, hb))

def Via.c(k: Nat, +p: Nat, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, F.Ce>, +c: U32, +r: U32, +none: U32, +site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, he: {k == 1n+p : Nat}, hm: Laws.MemCe(ces, F.Ce{site, fn, target, node, ld, ctx}), ha: {F.Fo.at(ld, ctx, none) == True{} : Bool}, w: Laws.Rch(p, css, ces, cls, c, target)) -> Laws.MemNx(F.Fo.via(k, ces, r, none, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), F.Nx{r, site, fn, target, 1}):
  %Equal.sym(Nat, k, 1n+p, he) : Laws.MemNx(F.Fo.via(_, ces, r, none, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), F.Nx{r, site, fn, target, 1})
  Edge.c(ces, S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))))), r, none, site, fn, target, node, ld, ctx, hm, HP.And.both(F.Fo.at(ld, ctx, none), S.Scope.has(S.Scope.set(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c))))), target), ha, SL.scope_set_complete(F.Fo.reach(p, ces, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), target, Laws.fo_reach_complete(p, css, ces, cls, c, target, w))))

def Laws.fo_via_complete(css, cls, ces, r, c, edges, none, p, site, fn, target, node, ld, ctx, he, hm, ha, w):
  AN.r(F.Fo.direct(css, r, none, S.Scope.set(X.Cx.ids(cls, c))), F.Fo.via(U32.to_nat(edges), ces, r, none, F.Fo.seed(css, S.Scope.set(X.Cx.ids(cls, c)))), F.Nx{r, site, fn, target, 1}, Via.c(U32.to_nat(edges), p, css, cls, ces, c, r, none, site, fn, target, node, ld, ctx, he, hm, At.to(ld, ctx, none, ha), w))

# ---- every rule row ---------------------------------------------------------------------------
def Rules.up(+f: F.Rf, +t: List<&2, F.Rf>, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, F.Ce>, +y: F.Nx, w: TL.Ex(F.Rf, g => TL.And(Laws.MemRf(t, g), Laws.MemNx(F.Fo.rule(css, cls, ces, g), y)))) -> TL.Ex(F.Rf, g => TL.And(Laws.MemRf(Con{f, t}, g), Laws.MemNx(F.Fo.rule(css, cls, ces, g), y))):
  match w:
    case Tuple{g, q}:
      match q:
        case Tuple{mg, m}:
          Tuple{g, Tuple{Inr{mg}, m}}

def Rules.s2(+f: F.Rf, +t: List<&2, F.Rf>, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, F.Ce>, +y: F.Nx, o: Either<&2, &2, Laws.MemNx(F.Fo.rule(css, cls, ces, f), y), Laws.MemNx(F.Fo.rules(css, cls, ces, t), y)>, ih: Laws.MemNx(F.Fo.rules(css, cls, ces, t), y) -> TL.Ex(F.Rf, g => TL.And(Laws.MemRf(t, g), Laws.MemNx(F.Fo.rule(css, cls, ces, g), y)))) -> TL.Ex(F.Rf, g => TL.And(Laws.MemRf(Con{f, t}, g), Laws.MemNx(F.Fo.rule(css, cls, ces, g), y))):
  match o:
    case Inl{m}:
      Tuple{f, Tuple{Inl{{==}}, m}}
    case Inr{m}:
      Rules.up(f, t, css, cls, ces, y, ih(m))

def Rules.s(rfs: List<&2, F.Rf>, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, F.Ce>, +y: F.Nx, h: Laws.MemNx(F.Fo.rules(css, cls, ces, rfs), y)) -> TL.Ex(F.Rf, f => TL.And(Laws.MemRf(rfs, f), Laws.MemNx(F.Fo.rule(css, cls, ces, f), y))):
  match rfs:
    case Nil{}:
      match h:
    case Con{+f, +t}:
      Rules.s2(f, t, css, cls, ces, y, AN.split(F.Fo.rule(css, cls, ces, f), F.Fo.rules(css, cls, ces, t), y, h), m => Rules.s(t, css, cls, ces, y, m))

def Laws.fo_findings_sound(css, cls, ces, rfs, y, hm):
  Rules.s(rfs, css, cls, ces, y, hm)

def Rules.c(rfs: List<&2, F.Rf>, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +ces: List<&2, F.Ce>, +f: F.Rf, +y: F.Nx, hf: Laws.MemRf(rfs, f), hm: Laws.MemNx(F.Fo.rule(css, cls, ces, f), y)) -> Laws.MemNx(F.Fo.rules(css, cls, ces, rfs), y):
  match rfs:
    case Nil{}:
      match hf:
    case Con{h, +t}:
      match hf:
        case Inl{e}:
          %Equal.sym(F.Rf, h, f, e) : Laws.MemNx(F.Fo.rules(css, cls, ces, Con{_, t}), y)
          AN.l(F.Fo.rule(css, cls, ces, f), F.Fo.rules(css, cls, ces, t), y, hm)
        case Inr{q}:
          AN.r(F.Fo.rule(css, cls, ces, h), F.Fo.rules(css, cls, ces, t), y, Rules.c(t, css, cls, ces, f, y, q, hm))

def Laws.fo_findings_complete(css, cls, ces, rfs, f, y, hf, hm):
  Rules.c(rfs, css, cls, ces, f, y, hf, hm)

def Laws.fo_lines_shape(f):
  {==}
