# engine/FnCtx-PROOF.bend - proofs of FnCtx-LAWS.bend. Gate: bend FnCtx-PROOF.bend --verdict
import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./ClassCtx.bend as X
import ./ClassCtx-PROOF.bend as CP
import ./Hotspot-PROOF.bend as HP
import ./Sql-PROOF.bend as QP
import ./Fanout.bend as F
import ./Fanout-LAWS.bend as FL
import ./Fanout-PROOF.bend as FP
import ./FnCtx.bend as N
import ./FnCtx-LAWS.bend as Laws
import ./Rows.bend as W
import ./Delta-PROOF.bend as DP

# ---- list lemmas ------------------------------------------------------------------------------

def EA.sh(+a: N.Ex, +t: List<&2, N.Ex>, +ys: List<&2, N.Ex>, +y: N.Ex, o: Either<&2, &2, Laws.MemEx(t, y), Laws.MemEx(ys, y)>) -> Either<&2, &2, Laws.MemEx(Con{a, t}, y), Laws.MemEx(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def EA.split(xs: List<&2, N.Ex>, +ys: List<&2, N.Ex>, +y: N.Ex, h: Laws.MemEx(List.append(&2, N.Ex, xs, ys), y)) -> Either<&2, &2, Laws.MemEx(xs, y), Laws.MemEx(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          EA.sh(a, t, ys, y, EA.split(t, ys, y, q))

def EA.l(xs: List<&2, N.Ex>, +ys: List<&2, N.Ex>, +y: N.Ex, h: Laws.MemEx(xs, y)) -> Laws.MemEx(List.append(&2, N.Ex, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemEx(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{EA.l(t, ys, y, q)}

def EA.r(xs: List<&2, N.Ex>, +ys: List<&2, N.Ex>, +y: N.Ex, h: Laws.MemEx(ys, y)) -> Laws.MemEx(List.append(&2, N.Ex, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{EA.r(t, ys, y, h)}

def MA.sh(+a: N.Mx, +t: List<&2, N.Mx>, +ys: List<&2, N.Mx>, +y: N.Mx, o: Either<&2, &2, Laws.MemMx(t, y), Laws.MemMx(ys, y)>) -> Either<&2, &2, Laws.MemMx(Con{a, t}, y), Laws.MemMx(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def MA.split(xs: List<&2, N.Mx>, +ys: List<&2, N.Mx>, +y: N.Mx, h: Laws.MemMx(List.append(&2, N.Mx, xs, ys), y)) -> Either<&2, &2, Laws.MemMx(xs, y), Laws.MemMx(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          MA.sh(a, t, ys, y, MA.split(t, ys, y, q))

def MA.l(xs: List<&2, N.Mx>, +ys: List<&2, N.Mx>, +y: N.Mx, h: Laws.MemMx(xs, y)) -> Laws.MemMx(List.append(&2, N.Mx, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemMx(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{MA.l(t, ys, y, q)}

def MA.r(xs: List<&2, N.Mx>, +ys: List<&2, N.Mx>, +y: N.Mx, h: Laws.MemMx(ys, y)) -> Laws.MemMx(List.append(&2, N.Mx, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{MA.r(t, ys, y, h)}

def KE.mem(b: Bool, +x: N.Ex, +rest: List<&2, N.Ex>, +y: N.Ex, h: Laws.MemEx(N.Nc.keep_e(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : N.Ex}), Laws.MemEx(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def KE.stay(b: Bool, +x: N.Ex, +rest: List<&2, N.Ex>, +y: N.Ex, h: Laws.MemEx(rest, y)) -> Laws.MemEx(N.Nc.keep_e(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def KE.hit(b: Bool, +x: N.Ex, +rest: List<&2, N.Ex>, hb: {b == True{} : Bool}) -> Laws.MemEx(N.Nc.keep_e(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemEx(N.Nc.keep_e(_, x, rest), x)
  Inl{{==}}

def KM.mem(b: Bool, +x: N.Mx, +rest: List<&2, N.Mx>, +y: N.Mx, h: Laws.MemMx(N.Nc.keep_m(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : N.Mx}), Laws.MemMx(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def KM.stay(b: Bool, +x: N.Mx, +rest: List<&2, N.Mx>, +y: N.Mx, h: Laws.MemMx(rest, y)) -> Laws.MemMx(N.Nc.keep_m(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def KM.hit(b: Bool, +x: N.Mx, +rest: List<&2, N.Mx>, hb: {b == True{} : Bool}) -> Laws.MemMx(N.Nc.keep_m(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemMx(N.Nc.keep_m(_, x, rest), x)
  Inl{{==}}

def Lift.fc(-P: @g: N.Fc -> Data, +h: N.Fc, +t: List<&2, N.Fc>, w: TL.Ex(N.Fc, g => TL.And(Laws.MemFc(t, g), P(g)))) -> TL.Ex(N.Fc, g => TL.And(Laws.MemFc(Con{h, t}, g), P(g))):
  match w:
    case Tuple{g, Tuple{ms, at}}:
      Tuple{g, Tuple{Inr{ms}, at}}

# ---- the functions and files whose context passes the masks -----------------------------------

def Fns.k(+fn: U32, +file: U32, +ctx: U32, +t: List<&2, N.Fc>, +all: U32, +none: U32, +x: U32, o: Either<&2, &2, TL.And({N.Nc.ok(all, none, ctx) == True{} : Bool}, {fn == x : U32}), TL.Mem(N.Nc.fns(t, all, none), x)>, ih: TL.Mem(N.Nc.fns(t, all, none), x) -> Laws.FnHas(t, x, all, none)) -> Laws.FnHas(Con{N.Fc{fn, file, ctx}, t}, x, all, none):
  match o:
    case Inl{Tuple{eo, ef}}:
      Tuple{N.Fc{fn, file, ctx}, Tuple{Inl{{==}}, Tuple{ef, eo}}}
    case Inr{m}:
      Lift.fc(g => Laws.FnAt(g, x, all, none), N.Fc{fn, file, ctx}, t, ih(m))

def Fns.s(fcs: List<&2, N.Fc>, +all: U32, +none: U32, +x: U32, h: TL.Mem(N.Nc.fns(fcs, all, none), x)) -> Laws.FnHas(fcs, x, all, none):
  match fcs:
    case Nil{}:
      match h:
    case Con{N.Fc{+fn, +file, +ctx}, +t}:
      Fns.k(fn, file, ctx, t, all, none, x, FP.PU.mem(N.Nc.ok(all, none, ctx), fn, N.Nc.fns(t, all, none), x, h), q => Fns.s(t, all, none, x, q))

def Fns.stay(h: N.Fc, +t: List<&2, N.Fc>, +all: U32, +none: U32, +x: U32, m: TL.Mem(N.Nc.fns(t, all, none), x)) -> TL.Mem(N.Nc.fns(Con{h, t}, all, none), x):
  match h:
    case N.Fc{+fn, +file, +ctx}:
      CP.PU.keep(N.Nc.ok(all, none, ctx), fn, N.Nc.fns(t, all, none), x, m)

def Fns.c(fcs: List<&2, N.Fc>, +x: U32, +file: U32, +c: U32, +all: U32, +none: U32, hm: Laws.MemFc(fcs, N.Fc{x, file, c}), +hx: {N.Nc.ok(all, none, c) == True{} : Bool}) -> TL.Mem(N.Nc.fns(fcs, all, none), x):
  match fcs:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(N.Fc, h, N.Fc{x, file, c}, e) : TL.Mem(N.Nc.fns(Con{_, t}, all, none), x)
          FP.PU.hit(N.Nc.ok(all, none, c), x, N.Nc.fns(t, all, none), hx)
        case Inr{q}:
          Fns.stay(h, t, all, none, x, Fns.c(t, x, file, c, all, none, q, hx))

def Fok.k(+fn: U32, +file: U32, +ctx: U32, +t: List<&2, N.Fc>, +all: U32, +none: U32, +x: U32, o: Either<&2, &2, TL.And({N.Nc.ok(all, none, ctx) == True{} : Bool}, {file == x : U32}), TL.Mem(N.Nc.files_ok(t, all, none), x)>, ih: TL.Mem(N.Nc.files_ok(t, all, none), x) -> Laws.FileHas(t, x, all, none)) -> Laws.FileHas(Con{N.Fc{fn, file, ctx}, t}, x, all, none):
  match o:
    case Inl{Tuple{eo, ef}}:
      Tuple{N.Fc{fn, file, ctx}, Tuple{Inl{{==}}, Tuple{ef, eo}}}
    case Inr{m}:
      Lift.fc(g => Laws.FileAt(g, x, all, none), N.Fc{fn, file, ctx}, t, ih(m))

def Fok.s(fcs: List<&2, N.Fc>, +all: U32, +none: U32, +x: U32, h: TL.Mem(N.Nc.files_ok(fcs, all, none), x)) -> Laws.FileHas(fcs, x, all, none):
  match fcs:
    case Nil{}:
      match h:
    case Con{N.Fc{+fn, +file, +ctx}, +t}:
      Fok.k(fn, file, ctx, t, all, none, x, FP.PU.mem(N.Nc.ok(all, none, ctx), file, N.Nc.files_ok(t, all, none), x, h), q => Fok.s(t, all, none, x, q))

def Fok.stay(h: N.Fc, +t: List<&2, N.Fc>, +all: U32, +none: U32, +x: U32, m: TL.Mem(N.Nc.files_ok(t, all, none), x)) -> TL.Mem(N.Nc.files_ok(Con{h, t}, all, none), x):
  match h:
    case N.Fc{+fn, +file, +ctx}:
      CP.PU.keep(N.Nc.ok(all, none, ctx), file, N.Nc.files_ok(t, all, none), x, m)

def Fok.c(fcs: List<&2, N.Fc>, +fn: U32, +x: U32, +c: U32, +all: U32, +none: U32, hm: Laws.MemFc(fcs, N.Fc{fn, x, c}), +hx: {N.Nc.ok(all, none, c) == True{} : Bool}) -> TL.Mem(N.Nc.files_ok(fcs, all, none), x):
  match fcs:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(N.Fc, h, N.Fc{fn, x, c}, e) : TL.Mem(N.Nc.files_ok(Con{_, t}, all, none), x)
          FP.PU.hit(N.Nc.ok(all, none, c), x, N.Nc.files_ok(t, all, none), hx)
        case Inr{q}:
          Fok.stay(h, t, all, none, x, Fok.c(t, fn, x, c, all, none, q, hx))

# ---- every FC row's file is in Nc.files ----------------------------------------------------------
def FG.t(+f1: U32, +prev: U32, +t2: List<&2, N.Fc>, +f: U32, o: Either<&2, &2, {f1 == f : U32}, TL.Mem(N.Nc.files_go(t2, f1), f)>) -> Either<&2, &2, {prev == f : U32}, TL.Mem(X.Cx.push_u(Bool.not(U32.is_eq(f1, prev)), f1, N.Nc.files_go(t2, f1)), f)>:
  match o:
    case Inl{e}:
      CP.RG.h(U32.is_eq(f1, prev), f1, prev, N.Nc.files_go(t2, f1), f, {==}, e)
    case Inr{m}:
      Inr{CP.PU.keep(Bool.not(U32.is_eq(f1, prev)), f1, N.Nc.files_go(t2, f1), f, m)}

def FG(t: List<&2, N.Fc>, +prev: U32, +fn: U32, +f: U32, +c: U32, h: Laws.MemFc(t, N.Fc{fn, f, c})) -> Either<&2, &2, {prev == f : U32}, TL.Mem(N.Nc.files_go(t, prev), f)>:
  match t:
    case Nil{}:
      Empty.absurd(Either<&2, &2, {prev == f : U32}, TL.Mem(Nil{}, f)>, h)
    case Con{N.Fc{+fn1, +f1, +c1}, +t2}:
      match h:
        case Inl{e}:
          %Equal.sym(N.Fc, N.Fc{fn1, f1, c1}, N.Fc{fn, f, c}, e) : Either<&2, &2, {prev == f : U32}, TL.Mem(N.Nc.files_go(Con{_, t2}, prev), f)>
          CP.RG.h(U32.is_eq(f, prev), f, prev, N.Nc.files_go(t2, f), f, {==}, {==})
        case Inr{q}:
          FG.t(f1, prev, t2, f, FG(t2, f1, fn, f, c, q))

def FL1.o(+f1: U32, +t: List<&2, N.Fc>, +f: U32, o: Either<&2, &2, {f1 == f : U32}, TL.Mem(N.Nc.files_go(t, f1), f)>) -> TL.Mem(Con{f1, N.Nc.files_go(t, f1)}, f):
  match o:
    case Inl{e}:
      Inl{e}
    case Inr{m}:
      Inr{m}

def FL1.u(g: N.Fc, +t: List<&2, N.Fc>, +fn: U32, +f: U32, +c: U32, q: Laws.MemFc(t, N.Fc{fn, f, c})) -> TL.Mem(N.Nc.files(Con{g, t}), f):
  match g:
    case N.Fc{+fn1, +f1, +c1}:
      FL1.o(f1, t, f, FG(t, f1, fn, f, c, q))

def FL1(fcs: List<&2, N.Fc>, +fn: U32, +f: U32, +c: U32, h: Laws.MemFc(fcs, N.Fc{fn, f, c})) -> TL.Mem(N.Nc.files(fcs), f):
  match fcs:
    case Nil{}:
      match h:
    case Con{g, +t}:
      match h:
        case Inl{e}:
          %Equal.sym(N.Fc, g, N.Fc{fn, f, c}, e) : TL.Mem(N.Nc.files(Con{_, t}), f)
          Inl{{==}}
        case Inr{q}:
          FL1.u(g, t, fn, f, c, q)

# ---- edge rules: one row ----------------------------------------------------------------------

def Ed.k(+site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, +t: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +r: U32, +all: U32, +none: U32, +tall: U32, +tnone: U32, +y: N.Ex, o: Either<&2, &2, TL.And({Bool.and(N.Nc.ok(all, none, ctx), S.Scope.has(S.Scope.set(N.Nc.fns(fcs, tall, tnone)), target)) == True{} : Bool}, {N.Ex{r, site, fn, target} == y : N.Ex}), Laws.MemEx(N.Nc.edges(t, r, all, none, S.Scope.set(N.Nc.fns(fcs, tall, tnone))), y)>, ih: Laws.MemEx(N.Nc.edges(t, r, all, none, S.Scope.set(N.Nc.fns(fcs, tall, tnone))), y) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(t, e), Laws.EAt(e, fcs, r, all, none, tall, tnone, y)))) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(Con{F.Ce{site, fn, target, node, ld, ctx}, t}, e), Laws.EAt(e, fcs, r, all, none, tall, tnone, y))):
  match o:
    case Inl{Tuple{+eb, ex}}:
      Tuple{F.Ce{site, fn, target, node, ld, ctx}, Tuple{Inl{{==}}, Tuple{QP.And.l(N.Nc.ok(all, none, ctx), S.Scope.has(S.Scope.set(N.Nc.fns(fcs, tall, tnone)), target), eb), Tuple{Fns.s(fcs, tall, tnone, target, SL.scope_set_sound(N.Nc.fns(fcs, tall, tnone), target, QP.And.r(N.Nc.ok(all, none, ctx), S.Scope.has(S.Scope.set(N.Nc.fns(fcs, tall, tnone)), target), eb))), ex}}}}
    case Inr{m}:
      FP.Lift.ce(e => Laws.EAt(e, fcs, r, all, none, tall, tnone, y), F.Ce{site, fn, target, node, ld, ctx}, t, ih(m))

def Ed.s(ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +r: U32, +all: U32, +none: U32, +tall: U32, +tnone: U32, +y: N.Ex, h: Laws.MemEx(N.Nc.edges(ces, r, all, none, S.Scope.set(N.Nc.fns(fcs, tall, tnone))), y)) -> TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), Laws.EAt(e, fcs, r, all, none, tall, tnone, y))):
  match ces:
    case Nil{}:
      match h:
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t}:
      Ed.k(site, fn, target, node, ld, ctx, t, fcs, r, all, none, tall, tnone, y, KE.mem(Bool.and(N.Nc.ok(all, none, ctx), S.Scope.has(S.Scope.set(N.Nc.fns(fcs, tall, tnone)), target)), N.Ex{r, site, fn, target}, N.Nc.edges(t, r, all, none, S.Scope.set(N.Nc.fns(fcs, tall, tnone))), y, h), q => Ed.s(t, fcs, r, all, none, tall, tnone, y, q))

def Laws.nc_erule_sound(ces, fcs, r, all, none, tall, tnone, y, hm):
  Ed.s(ces, fcs, r, all, none, tall, tnone, y, hm)

def Ed.stay(h: F.Ce, +t: List<&2, F.Ce>, +r: U32, +all: U32, +none: U32, +tset: G.Tr, +y: N.Ex, m: Laws.MemEx(N.Nc.edges(t, r, all, none, tset), y)) -> Laws.MemEx(N.Nc.edges(Con{h, t}, r, all, none, tset), y):
  match h:
    case F.Ce{+site, +fn, +target, +node, +ld, +ctx}:
      KE.stay(Bool.and(N.Nc.ok(all, none, ctx), S.Scope.has(tset, target)), N.Ex{r, site, fn, target}, N.Nc.edges(t, r, all, none, tset), y, m)

def Ed.c(ces: List<&2, F.Ce>, +r: U32, +all: U32, +none: U32, +tset: G.Tr, +site: U32, +fn: U32, +target: U32, +node: U32, +ld: U32, +ctx: U32, hm: FL.MemCe(ces, F.Ce{site, fn, target, node, ld, ctx}), +hb: {Bool.and(N.Nc.ok(all, none, ctx), S.Scope.has(tset, target)) == True{} : Bool}) -> Laws.MemEx(N.Nc.edges(ces, r, all, none, tset), N.Ex{r, site, fn, target}):
  match ces:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(F.Ce, h, F.Ce{site, fn, target, node, ld, ctx}, e) : Laws.MemEx(N.Nc.edges(Con{_, t}, r, all, none, tset), N.Ex{r, site, fn, target})
          KE.hit(Bool.and(N.Nc.ok(all, none, ctx), S.Scope.has(tset, target)), N.Ex{r, site, fn, target}, N.Nc.edges(t, r, all, none, tset), hb)
        case Inr{q}:
          Ed.stay(h, t, r, all, none, tset, N.Ex{r, site, fn, target}, Ed.c(t, r, all, none, tset, site, fn, target, node, ld, ctx, q, hb))

def Laws.nc_erule_complete(ces, fcs, r, all, none, tall, tnone, site, fn, target, node, ld, ctx, file, tctx, he, hx, hf, ht):
  Ed.c(ces, r, all, none, S.Scope.set(N.Nc.fns(fcs, tall, tnone)), site, fn, target, node, ld, ctx, he, HP.And.both(N.Nc.ok(all, none, ctx), S.Scope.has(S.Scope.set(N.Nc.fns(fcs, tall, tnone)), target), hx, SL.scope_set_complete(N.Nc.fns(fcs, tall, tnone), target, Fns.c(fcs, target, file, tctx, tall, tnone, hf, ht))))

# ---- module rules: one row --------------------------------------------------------------------

def Md.k(+f: U32, +t: List<&2, U32>, +r: U32, +sa: G.Tr, +sb: G.Tr, +y: N.Mx, o: Either<&2, &2, TL.And({Bool.and(S.Scope.has(sa, f), S.Scope.has(sb, f)) == True{} : Bool}, {N.Mx{r, f} == y : N.Mx}), Laws.MemMx(N.Nc.mods(t, r, sa, sb), y)>, ih: Laws.MemMx(N.Nc.mods(t, r, sa, sb), y) -> TL.Ex(U32, f => TL.And({N.Mx{r, f} == y : N.Mx}, TL.And({S.Scope.has(sa, f) == True{} : Bool}, {S.Scope.has(sb, f) == True{} : Bool})))) -> TL.Ex(U32, f => TL.And({N.Mx{r, f} == y : N.Mx}, TL.And({S.Scope.has(sa, f) == True{} : Bool}, {S.Scope.has(sb, f) == True{} : Bool}))):
  match o:
    case Inl{Tuple{+eb, ex}}:
      Tuple{f, Tuple{ex, Tuple{QP.And.l(S.Scope.has(sa, f), S.Scope.has(sb, f), eb), QP.And.r(S.Scope.has(sa, f), S.Scope.has(sb, f), eb)}}}
    case Inr{m}:
      ih(m)

def Md.s(fs: List<&2, U32>, +r: U32, +sa: G.Tr, +sb: G.Tr, +y: N.Mx, h: Laws.MemMx(N.Nc.mods(fs, r, sa, sb), y)) -> TL.Ex(U32, f => TL.And({N.Mx{r, f} == y : N.Mx}, TL.And({S.Scope.has(sa, f) == True{} : Bool}, {S.Scope.has(sb, f) == True{} : Bool}))):
  match fs:
    case Nil{}:
      match h:
    case Con{+f, +t}:
      Md.k(f, t, r, sa, sb, y, KM.mem(Bool.and(S.Scope.has(sa, f), S.Scope.has(sb, f)), N.Mx{r, f}, N.Nc.mods(t, r, sa, sb), y, h), q => Md.s(t, r, sa, sb, y, q))

def MR.s(+fcs: List<&2, N.Fc>, +r: U32, +aall: U32, +anone: U32, +ball: U32, +bnone: U32, +y: N.Mx, w: TL.Ex(U32, f => TL.And({N.Mx{r, f} == y : N.Mx}, TL.And({S.Scope.has(S.Scope.set(N.Nc.files_ok(fcs, aall, anone)), f) == True{} : Bool}, {S.Scope.has(S.Scope.set(N.Nc.files_ok(fcs, ball, bnone)), f) == True{} : Bool})))) -> Laws.MAt(fcs, r, aall, anone, ball, bnone, y):
  match w:
    case Tuple{+f, Tuple{ex, Tuple{ha, hb}}}:
      Tuple{f, Tuple{ex, Tuple{Fok.s(fcs, aall, anone, f, SL.scope_set_sound(N.Nc.files_ok(fcs, aall, anone), f, ha)), Fok.s(fcs, ball, bnone, f, SL.scope_set_sound(N.Nc.files_ok(fcs, ball, bnone), f, hb))}}}

def Laws.nc_mrule_sound(fcs, r, aall, anone, ball, bnone, y, hm):
  MR.s(fcs, r, aall, anone, ball, bnone, y, Md.s(N.Nc.files(fcs), r, S.Scope.set(N.Nc.files_ok(fcs, aall, anone)), S.Scope.set(N.Nc.files_ok(fcs, ball, bnone)), y, hm))

def Md.stay(+x: U32, +t: List<&2, U32>, +r: U32, +sa: G.Tr, +sb: G.Tr, +y: N.Mx, m: Laws.MemMx(N.Nc.mods(t, r, sa, sb), y)) -> Laws.MemMx(N.Nc.mods(Con{x, t}, r, sa, sb), y):
  KM.stay(Bool.and(S.Scope.has(sa, x), S.Scope.has(sb, x)), N.Mx{r, x}, N.Nc.mods(t, r, sa, sb), y, m)

def Md.c(fs: List<&2, U32>, +r: U32, +sa: G.Tr, +sb: G.Tr, +f: U32, hm: TL.Mem(fs, f), +hb: {Bool.and(S.Scope.has(sa, f), S.Scope.has(sb, f)) == True{} : Bool}) -> Laws.MemMx(N.Nc.mods(fs, r, sa, sb), N.Mx{r, f}):
  match fs:
    case Nil{}:
      match hm:
    case Con{+x, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(U32, x, f, e) : Laws.MemMx(N.Nc.mods(Con{_, t}, r, sa, sb), N.Mx{r, f})
          KM.hit(Bool.and(S.Scope.has(sa, f), S.Scope.has(sb, f)), N.Mx{r, f}, N.Nc.mods(t, r, sa, sb), hb)
        case Inr{q}:
          Md.stay(x, t, r, sa, sb, N.Mx{r, f}, Md.c(t, r, sa, sb, f, q, hb))

def Laws.nc_mrule_complete(fcs, r, aall, anone, ball, bnone, f, fa, ca, fb, cb, ha, hxa, hb, hxb):
  Md.c(N.Nc.files(fcs), r, S.Scope.set(N.Nc.files_ok(fcs, aall, anone)), S.Scope.set(N.Nc.files_ok(fcs, ball, bnone)), f, FL1(fcs, fa, f, ca, ha), HP.And.both(S.Scope.has(S.Scope.set(N.Nc.files_ok(fcs, aall, anone)), f), S.Scope.has(S.Scope.set(N.Nc.files_ok(fcs, ball, bnone)), f), SL.scope_set_complete(N.Nc.files_ok(fcs, aall, anone), f, Fok.c(fcs, fa, f, ca, aall, anone, ha, hxa)), SL.scope_set_complete(N.Nc.files_ok(fcs, ball, bnone), f, Fok.c(fcs, fb, f, cb, ball, bnone, hb, hxb))))

# ---- every rule row ---------------------------------------------------------------------------

def ER.up(+k: N.Re, +t: List<&2, N.Re>, +ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +y: N.Ex, w: TL.Ex(N.Re, g => TL.And(Laws.MemRe(t, g), Laws.MemEx(N.Nc.erule(ces, fcs, g), y)))) -> TL.Ex(N.Re, g => TL.And(Laws.MemRe(Con{k, t}, g), Laws.MemEx(N.Nc.erule(ces, fcs, g), y))):
  match w:
    case Tuple{g, Tuple{mg, m}}:
      Tuple{g, Tuple{Inr{mg}, m}}

def ER.s2(+k: N.Re, +t: List<&2, N.Re>, +ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +y: N.Ex, o: Either<&2, &2, Laws.MemEx(N.Nc.erule(ces, fcs, k), y), Laws.MemEx(N.Nc.erules(ces, fcs, t), y)>, ih: Laws.MemEx(N.Nc.erules(ces, fcs, t), y) -> TL.Ex(N.Re, g => TL.And(Laws.MemRe(t, g), Laws.MemEx(N.Nc.erule(ces, fcs, g), y)))) -> TL.Ex(N.Re, g => TL.And(Laws.MemRe(Con{k, t}, g), Laws.MemEx(N.Nc.erule(ces, fcs, g), y))):
  match o:
    case Inl{m}:
      Tuple{k, Tuple{Inl{{==}}, m}}
    case Inr{m}:
      ER.up(k, t, ces, fcs, y, ih(m))

def ER.s(rs: List<&2, N.Re>, +ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +y: N.Ex, h: Laws.MemEx(N.Nc.erules(ces, fcs, rs), y)) -> TL.Ex(N.Re, g => TL.And(Laws.MemRe(rs, g), Laws.MemEx(N.Nc.erule(ces, fcs, g), y))):
  match rs:
    case Nil{}:
      match h:
    case Con{+k, +t}:
      ER.s2(k, t, ces, fcs, y, EA.split(N.Nc.erule(ces, fcs, k), N.Nc.erules(ces, fcs, t), y, h), m => ER.s(t, ces, fcs, y, m))

def ER.c(rs: List<&2, N.Re>, +ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +k: N.Re, +y: N.Ex, hk: Laws.MemRe(rs, k), hm: Laws.MemEx(N.Nc.erule(ces, fcs, k), y)) -> Laws.MemEx(N.Nc.erules(ces, fcs, rs), y):
  match rs:
    case Nil{}:
      match hk:
    case Con{h, +t}:
      match hk:
        case Inl{e}:
          %Equal.sym(N.Re, h, k, e) : Laws.MemEx(N.Nc.erules(ces, fcs, Con{_, t}), y)
          EA.l(N.Nc.erule(ces, fcs, k), N.Nc.erules(ces, fcs, t), y, hm)
        case Inr{q}:
          EA.r(N.Nc.erule(ces, fcs, h), N.Nc.erules(ces, fcs, t), y, ER.c(t, ces, fcs, k, y, q, hm))

def MR2.up(+k: N.Rm, +t: List<&2, N.Rm>, +fcs: List<&2, N.Fc>, +y: N.Mx, w: TL.Ex(N.Rm, g => TL.And(Laws.MemRm(t, g), Laws.MemMx(N.Nc.mrule(fcs, g), y)))) -> TL.Ex(N.Rm, g => TL.And(Laws.MemRm(Con{k, t}, g), Laws.MemMx(N.Nc.mrule(fcs, g), y))):
  match w:
    case Tuple{g, Tuple{mg, m}}:
      Tuple{g, Tuple{Inr{mg}, m}}

def MR2.s2(+k: N.Rm, +t: List<&2, N.Rm>, +fcs: List<&2, N.Fc>, +y: N.Mx, o: Either<&2, &2, Laws.MemMx(N.Nc.mrule(fcs, k), y), Laws.MemMx(N.Nc.mrules(fcs, t), y)>, ih: Laws.MemMx(N.Nc.mrules(fcs, t), y) -> TL.Ex(N.Rm, g => TL.And(Laws.MemRm(t, g), Laws.MemMx(N.Nc.mrule(fcs, g), y)))) -> TL.Ex(N.Rm, g => TL.And(Laws.MemRm(Con{k, t}, g), Laws.MemMx(N.Nc.mrule(fcs, g), y))):
  match o:
    case Inl{m}:
      Tuple{k, Tuple{Inl{{==}}, m}}
    case Inr{m}:
      MR2.up(k, t, fcs, y, ih(m))

def MR2.s(rs: List<&2, N.Rm>, +fcs: List<&2, N.Fc>, +y: N.Mx, h: Laws.MemMx(N.Nc.mrules(fcs, rs), y)) -> TL.Ex(N.Rm, g => TL.And(Laws.MemRm(rs, g), Laws.MemMx(N.Nc.mrule(fcs, g), y))):
  match rs:
    case Nil{}:
      match h:
    case Con{+k, +t}:
      MR2.s2(k, t, fcs, y, MA.split(N.Nc.mrule(fcs, k), N.Nc.mrules(fcs, t), y, h), m => MR2.s(t, fcs, y, m))

def MR2.c(rs: List<&2, N.Rm>, +fcs: List<&2, N.Fc>, +k: N.Rm, +y: N.Mx, hk: Laws.MemRm(rs, k), hm: Laws.MemMx(N.Nc.mrule(fcs, k), y)) -> Laws.MemMx(N.Nc.mrules(fcs, rs), y):
  match rs:
    case Nil{}:
      match hk:
    case Con{h, +t}:
      match hk:
        case Inl{e}:
          %Equal.sym(N.Rm, h, k, e) : Laws.MemMx(N.Nc.mrules(fcs, Con{_, t}), y)
          MA.l(N.Nc.mrule(fcs, k), N.Nc.mrules(fcs, t), y, hm)
        case Inr{q}:
          MA.r(N.Nc.mrule(fcs, h), N.Nc.mrules(fcs, t), y, MR2.c(t, fcs, k, y, q, hm))

def Laws.nc_edges_sound(ces, fcs, res, rms, y, hm):
  ER.s(res, ces, fcs, y, hm)

def Laws.nc_edges_complete(ces, fcs, res, rms, k, y, hk, hm):
  ER.c(res, ces, fcs, k, y, hk, hm)

def Laws.nc_mods_sound(ces, fcs, res, rms, y, hm):
  MR2.s(rms, fcs, y, hm)

def Laws.nc_mods_complete(ces, fcs, res, rms, k, y, hk, hm):
  MR2.c(rms, fcs, k, y, hk, hm)

def Laws.nc_ok_is_masks(all, none, ctx):
  {==}

def Laws.nc_lines_shape(f):
  {==}

def Laws.fnctx_on(rows, on):
  %Equal.sym(Bool, N.FnCtxIn.on(rows), True{}, on) : {N.FnCtxIn.go1(_, rows) == N.FnCtxIn.go(N.FnCtx.decode(rows)) : Maybe<List<&2, String>>}
  {==}

def Laws.fnctx_go_lines(ces, fcs, res, rms, h, hc):
  %Equal.sym(Bool, N.Nc.sorted(fcs), True{}, h) : {N.FnCtxIn.ok(Bool.and(_, N.Nc.ce_sorted(ces)), N.NF{ces, fcs, res, rms}) == Some{N.FnCtx.lines(N.NF{ces, fcs, res, rms})} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, N.Nc.ce_sorted(ces), True{}, hc) : {N.FnCtxIn.ok(Bool.and(True{}, _), N.NF{ces, fcs, res, rms}) == Some{N.FnCtx.lines(N.NF{ces, fcs, res, rms})} : Maybe<List<&2, String>>}
  {==}

def Laws.fnctx_unsorted_refuses(ces, fcs, res, rms, h):
  %Equal.sym(Bool, N.Nc.sorted(fcs), False{}, h) : {N.FnCtxIn.ok(Bool.and(_, N.Nc.ce_sorted(ces)), N.NF{ces, fcs, res, rms}) == None{} : Maybe<List<&2, String>>}
  {==}

def AndF(+a: Bool) -> {Bool.and(a, False{}) == False{} : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      {==}

def Laws.fnctx_ce_unsorted_refuses(ces, fcs, res, rms, h):
  %Equal.sym(Bool, N.Nc.ce_sorted(ces), False{}, h) : {N.FnCtxIn.ok(Bool.and(N.Nc.sorted(fcs), _), N.NF{ces, fcs, res, rms}) == None{} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, Bool.and(N.Nc.sorted(fcs), False{}), False{}, AndF(N.Nc.sorted(fcs))) : {N.FnCtxIn.ok(_, N.NF{ces, fcs, res, rms}) == None{} : Maybe<List<&2, String>>}
  {==}

def Laws.fnctx_go_refuses():
  {==}

def Laws.fnctx_off(rows, off):
  %Equal.sym(Bool, N.FnCtxIn.on(rows), False{}, off) : {N.FnCtxIn.go1(_, rows) == Some{Nil{}} : Maybe<List<&2, String>>}
  {==}

# ---- the order of FC ----------------------------------------------------------------------------
# p below file, or equal to it: file is not below p.
def SC.nl(+p: U32, +file: U32, o: Either<&2, &2, {U32.cmp(p, file) == LT{} : Cmp}, {p == file : U32}>) -> {Cmp.is_lt(U32.cmp(file, p)) == False{} : Bool}:
  match o:
    case Inl{lt}:
      %Equal.sym(Cmp, U32.cmp(file, p), DP.Fl(U32.cmp(p, file)), DP.USym(p, file)) : {Cmp.is_lt(_) == False{} : Bool}
      %Equal.sym(Cmp, U32.cmp(p, file), LT{}, lt) : {Cmp.is_lt(DP.Fl(_)) == False{} : Bool}
      {==}
    case Inr{eq}:
      %eq : {Cmp.is_lt(U32.cmp(_, p)) == False{} : Bool}
      %Equal.sym(Cmp, U32.cmp(p, p), EQ{}, DP.URefl(p)) : {Cmp.is_lt(_) == False{} : Bool}
      {==}

def SC.go(t: List<&2, N.Fc>, +p: U32, h: Laws.NonDec(t, p)) -> {N.Nc.sorted_go(t, p) == True{} : Bool}:
  match t:
    case Nil{}:
      {==}
    case Con{N.Fc{+fn, +file, +ctx}, +t2}:
      match h:
        case Tuple{o, h2}:
          %Equal.sym(Bool, Cmp.is_lt(U32.cmp(file, p)), False{}, SC.nl(p, file, o)) : {Bool.and(Bool.not(_), N.Nc.sorted_go(t2, file)) == True{} : Bool}
          %Equal.sym(Bool, N.Nc.sorted_go(t2, file), True{}, SC.go(t2, file, h2)) : {Bool.and(True{}, _) == True{} : Bool}
          {==}

def Laws.nc_sorted_complete(fcs, h):
  match fcs:
    case Nil{}:
      {==}
    case Con{N.Fc{+fn, +file, +ctx}, +t}:
      SC.go(t, file, h)

# Not equal and not below: above.
def GtOf(+c: Cmp, hq: {Cmp.is_eq(c) == False{} : Bool}, nl: {Cmp.is_lt(c) == False{} : Bool}) -> {DP.Fl(c) == LT{} : Cmp}:
  match c:
    case LT{}:
      Empty.absurd({DP.Fl(LT{}) == LT{} : Cmp}, DP.TF(nl))
    case EQ{}:
      Empty.absurd({DP.Fl(EQ{}) == LT{} : Cmp}, DP.TF(hq))
    case GT{}:
      {==}

def FA.k(q: Bool, +file: U32, +p: U32, +rest: List<&2, U32>, hq: {U32.is_eq(file, p) == q : Bool}, nl: {Cmp.is_lt(U32.cmp(file, p)) == False{} : Bool}, ih: Laws.AscU(rest, file)) -> Laws.AscU(X.Cx.push_u(Bool.not(q), file, rest), p):
  match q:
    case True{}:
      %L.U32.eq_sound(file, p, hq) : Laws.AscU(rest, _)
      ih
    case False{}:
      Tuple{Equal.trans(Cmp, U32.cmp(p, file), DP.Fl(U32.cmp(file, p)), LT{}, DP.USym(file, p), GtOf(U32.cmp(file, p), hq, nl)), ih}

def FA.go(t: List<&2, N.Fc>, +p: U32, +h: {N.Nc.sorted_go(t, p) == True{} : Bool}) -> Laws.AscU(N.Nc.files_go(t, p), p):
  match t:
    case Nil{}:
      Unit{}
    case Con{N.Fc{+fn, +file, +ctx}, +t2}:
      FA.k(U32.is_eq(file, p), file, p, N.Nc.files_go(t2, file), {==}, DP.NotT(Cmp.is_lt(U32.cmp(file, p)), DP.AL(Bool.not(Cmp.is_lt(U32.cmp(file, p))), N.Nc.sorted_go(t2, file), h)), FA.go(t2, file, DP.AR(Bool.not(Cmp.is_lt(U32.cmp(file, p))), N.Nc.sorted_go(t2, file), h)))

def FA.top(fcs: List<&2, N.Fc>, h: {N.Nc.sorted(fcs) == True{} : Bool}) -> Laws.Asc(N.Nc.files(fcs)):
  match fcs:
    case Nil{}:
      Unit{}
    case Con{N.Fc{+fn, +file, +ctx}, +t}:
      FA.go(t, file, h)

def Laws.nc_files_asc(fcs, h):
  FA.top(fcs, h)

# A lower start keeps a strictly ascending list strictly ascending.
def WkMx(xs: List<&2, N.Mx>, +p: U32, +q: U32, lt: {U32.cmp(q, p) == LT{} : Cmp}, h: Laws.AscMxU(xs, p)) -> Laws.AscMxU(xs, q):
  match xs:
    case Nil{}:
      Unit{}
    case Con{N.Mx{+r, +f}, +t}:
      match h:
        case Tuple{a, b}:
          Tuple{DP.UTrans(q, p, f, lt, a), b}

def UpMx(xs: List<&2, N.Mx>, +p: U32, h: Laws.AscMxU(xs, p)) -> Laws.AscMx(xs):
  match xs:
    case Nil{}:
      Unit{}
    case Con{N.Mx{+r, +f}, +t}:
      match h:
        case Tuple{a, b}:
          b

def MD.k(k: Bool, +r: U32, +f: U32, +rest: List<&2, N.Mx>, +p: U32, a: {U32.cmp(p, f) == LT{} : Cmp}, ih: Laws.AscMxU(rest, f)) -> Laws.AscMxU(N.Nc.keep_m(k, N.Mx{r, f}, rest), p):
  match k:
    case True{}:
      Tuple{a, ih}
    case False{}:
      WkMx(rest, f, p, a, ih)

def MD.go(fs: List<&2, U32>, +r: U32, +sa: G.Tr, +sb: G.Tr, +p: U32, h: Laws.AscU(fs, p)) -> Laws.AscMxU(N.Nc.mods(fs, r, sa, sb), p):
  match fs:
    case Nil{}:
      Unit{}
    case Con{+f, +t}:
      match h:
        case Tuple{a, b}:
          MD.k(Bool.and(S.Scope.has(sa, f), S.Scope.has(sb, f)), r, f, N.Nc.mods(t, r, sa, sb), p, a, MD.go(t, r, sa, sb, f, b))

def MT.k(k: Bool, +r: U32, +f: U32, +rest: List<&2, N.Mx>, ih: Laws.AscMxU(rest, f)) -> Laws.AscMx(N.Nc.keep_m(k, N.Mx{r, f}, rest)):
  match k:
    case True{}:
      ih
    case False{}:
      UpMx(rest, f, ih)

def MD.top(fs: List<&2, U32>, +r: U32, +sa: G.Tr, +sb: G.Tr, h: Laws.Asc(fs)) -> Laws.AscMx(N.Nc.mods(fs, r, sa, sb)):
  match fs:
    case Nil{}:
      Unit{}
    case Con{+f, +t}:
      MT.k(Bool.and(S.Scope.has(sa, f), S.Scope.has(sb, f)), r, f, N.Nc.mods(t, r, sa, sb), MD.go(t, r, sa, sb, f, h))

def Laws.nc_mrule_asc(fcs, r, aall, anone, ball, bnone, h):
  MD.top(N.Nc.files(fcs), r, S.Scope.set(N.Nc.files_ok(fcs, aall, anone)), S.Scope.set(N.Nc.files_ok(fcs, ball, bnone)), FA.top(fcs, h))

# ---- the order of CE ----------------------------------------------------------------------------
def CC.go(t: List<&2, F.Ce>, +p: U32, h: Laws.CeAscU(t, p)) -> {N.Nc.ce_go(t, p) == True{} : Bool}:
  match t:
    case Nil{}:
      {==}
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t2}:
      match h:
        case Tuple{a, h2}:
          %Equal.sym(Cmp, U32.cmp(p, site), LT{}, a) : {Bool.and(Cmp.is_lt(_), N.Nc.ce_go(t2, site)) == True{} : Bool}
          %Equal.sym(Bool, N.Nc.ce_go(t2, site), True{}, CC.go(t2, site, h2)) : {Bool.and(True{}, _) == True{} : Bool}
          {==}

def Laws.nc_ce_sorted_complete(ces, h):
  match ces:
    case Nil{}:
      {==}
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t}:
      CC.go(t, site, h)

def LtOf(+c: Cmp, h: {Cmp.is_lt(c) == True{} : Bool}) -> {c == LT{} : Cmp}:
  match c:
    case LT{}:
      {==}
    case EQ{}:
      Empty.absurd({EQ{} == LT{} : Cmp}, DP.TF(Equal.sym(Bool, False{}, True{}, h)))
    case GT{}:
      Empty.absurd({GT{} == LT{} : Cmp}, DP.TF(Equal.sym(Bool, False{}, True{}, h)))

def WkEx(xs: List<&2, N.Ex>, +p: U32, +q: U32, lt: {U32.cmp(q, p) == LT{} : Cmp}, h: Laws.AscExU(xs, p)) -> Laws.AscExU(xs, q):
  match xs:
    case Nil{}:
      Unit{}
    case Con{N.Ex{+r, +site, +fn, +target}, +t}:
      match h:
        case Tuple{a, b}:
          Tuple{DP.UTrans(q, p, site, lt, a), b}

def UpEx(xs: List<&2, N.Ex>, +p: U32, h: Laws.AscExU(xs, p)) -> Laws.AscEx(xs):
  match xs:
    case Nil{}:
      Unit{}
    case Con{N.Ex{+r, +site, +fn, +target}, +t}:
      match h:
        case Tuple{a, b}:
          b

def ED.k(k: Bool, +r: U32, +site: U32, +fn: U32, +target: U32, +rest: List<&2, N.Ex>, +p: U32, a: {U32.cmp(p, site) == LT{} : Cmp}, ih: Laws.AscExU(rest, site)) -> Laws.AscExU(N.Nc.keep_e(k, N.Ex{r, site, fn, target}, rest), p):
  match k:
    case True{}:
      Tuple{a, ih}
    case False{}:
      WkEx(rest, site, p, a, ih)

def ED.go(ces: List<&2, F.Ce>, +r: U32, +all: U32, +none: U32, +tset: G.Tr, +p: U32, +h: {N.Nc.ce_go(ces, p) == True{} : Bool}) -> Laws.AscExU(N.Nc.edges(ces, r, all, none, tset), p):
  match ces:
    case Nil{}:
      Unit{}
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t}:
      ED.k(Bool.and(N.Nc.ok(all, none, ctx), S.Scope.has(tset, target)), r, site, fn, target, N.Nc.edges(t, r, all, none, tset), p, LtOf(U32.cmp(p, site), DP.AL(Cmp.is_lt(U32.cmp(p, site)), N.Nc.ce_go(t, site), h)), ED.go(t, r, all, none, tset, site, DP.AR(Cmp.is_lt(U32.cmp(p, site)), N.Nc.ce_go(t, site), h)))

def ET.k(k: Bool, +r: U32, +site: U32, +fn: U32, +target: U32, +rest: List<&2, N.Ex>, ih: Laws.AscExU(rest, site)) -> Laws.AscEx(N.Nc.keep_e(k, N.Ex{r, site, fn, target}, rest)):
  match k:
    case True{}:
      ih
    case False{}:
      UpEx(rest, site, ih)

def ED.top(ces: List<&2, F.Ce>, +r: U32, +all: U32, +none: U32, +tset: G.Tr, h: {N.Nc.ce_sorted(ces) == True{} : Bool}) -> Laws.AscEx(N.Nc.edges(ces, r, all, none, tset)):
  match ces:
    case Nil{}:
      Unit{}
    case Con{F.Ce{+site, +fn, +target, +node, +ld, +ctx}, +t}:
      ET.k(Bool.and(N.Nc.ok(all, none, ctx), S.Scope.has(tset, target)), r, site, fn, target, N.Nc.edges(t, r, all, none, tset), ED.go(t, r, all, none, tset, site, h))

def Laws.nc_erule_asc(ces, fcs, r, all, none, tall, tnone, h):
  ED.top(ces, r, all, none, S.Scope.set(N.Nc.fns(fcs, tall, tnone)), h)
