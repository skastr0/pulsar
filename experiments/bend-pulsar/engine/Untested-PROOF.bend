# engine/Untested-PROOF.bend - proofs of Untested-LAWS.bend. Gate: bend Untested-PROOF.bend --verdict
import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./ClassCtx-PROOF.bend as CP
import ./Hotspot-PROOF.bend as HP
import ./Sql-PROOF.bend as QP
import ./Fanout-PROOF.bend as FP
import ./Metrics.bend as M
import ./Metrics-LAWS.bend as ML
import ./Crap.bend as C
import ./Untested.bend as U
import ./Untested-LAWS.bend as Laws

# ---- helpers ----------------------------------------------------------------------------------
def Not.f(x: Bool, e: {Bool.not(x) == True{} : Bool}) -> {x == False{} : Bool}:
  match x:
    case True{}:
      Empty.absurd({True{} == False{} : Bool}, L.Bool.ff_tt(e))
    case False{}:
      {==}

def UP.mem(b: Bool, +x: U.Ux, +rest: List<&2, U.Ux>, +y: U.Ux, h: Laws.MemUx(U.Un.push(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : U.Ux}), Laws.MemUx(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def UP.stay(b: Bool, +x: U.Ux, +rest: List<&2, U.Ux>, +y: U.Ux, h: Laws.MemUx(rest, y)) -> Laws.MemUx(U.Un.push(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def UP.hit(b: Bool, +x: U.Ux, +rest: List<&2, U.Ux>, hb: {b == True{} : Bool}) -> Laws.MemUx(U.Un.push(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemUx(U.Un.push(_, x, rest), x)
  Inl{{==}}

def AX.sh(+a: U.Ux, +t: List<&2, U.Ux>, +ys: List<&2, U.Ux>, +y: U.Ux, o: Either<&2, &2, Laws.MemUx(t, y), Laws.MemUx(ys, y)>) -> Either<&2, &2, Laws.MemUx(Con{a, t}, y), Laws.MemUx(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def AX.split(xs: List<&2, U.Ux>, +ys: List<&2, U.Ux>, +y: U.Ux, h: Laws.MemUx(List.append(&2, U.Ux, xs, ys), y)) -> Either<&2, &2, Laws.MemUx(xs, y), Laws.MemUx(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AX.sh(a, t, ys, y, AX.split(t, ys, y, q))

def AX.l(xs: List<&2, U.Ux>, +ys: List<&2, U.Ux>, +y: U.Ux, h: Laws.MemUx(xs, y)) -> Laws.MemUx(List.append(&2, U.Ux, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemUx(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AX.l(t, ys, y, q)}

def AX.r(xs: List<&2, U.Ux>, +ys: List<&2, U.Ux>, +y: U.Ux, h: Laws.MemUx(ys, y)) -> Laws.MemUx(List.append(&2, U.Ux, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{AX.r(t, ys, y, h)}

def Lift.m(-P: @m: M.FnM -> Data, +h: M.FnM, +t: List<&2, M.FnM>, w: TL.Ex(M.FnM, m => TL.And(ML.MemM(t, m), P(m)))) -> TL.Ex(M.FnM, m => TL.And(ML.MemM(Con{h, t}, m), P(m))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.f(-P: @x: M.Finding -> Data, +h: M.Finding, +t: List<&2, M.Finding>, w: TL.Ex(M.Finding, x => TL.And(ML.MemF(t, x), P(x)))) -> TL.Ex(M.Finding, x => TL.And(ML.MemF(Con{h, t}, x), P(x))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

# ---- the CRAP-finding functions and the functions with coverage data --------------------------
def FF.s(crs: List<&2, M.Finding>, +fn: U32, h: TL.Mem(U.Un.ffns(crs), fn)) -> Laws.CrapAt(crs, fn):
  match crs:
    case Nil{}:
      match h:
    case Con{M.Finding{+rule, +f, +v, +thr}, +t}:
      match h:
        case Inl{e}:
          Tuple{M.Finding{rule, f, v, thr}, Tuple{Inl{{==}}, e}}
        case Inr{q}:
          Lift.f(x => {Laws.FFn(x) == fn : U32}, M.Finding{rule, f, v, thr}, t, FF.s(t, fn, q))

def FF.hit(x: M.Finding, +t: List<&2, M.Finding>, +fn: U32, e: {Laws.FFn(x) == fn : U32}) -> TL.Mem(U.Un.ffns(Con{x, t}), fn):
  match x:
    case M.Finding{+rule, +f, +v, +thr}:
      Inl{e}

def FF.stay(h: M.Finding, +t: List<&2, M.Finding>, +fn: U32, m: TL.Mem(U.Un.ffns(t), fn)) -> TL.Mem(U.Un.ffns(Con{h, t}), fn):
  match h:
    case M.Finding{+rule, +f, +v, +thr}:
      Inr{m}

def FF.c(crs: List<&2, M.Finding>, +fn: U32, +x: M.Finding, hm: ML.MemF(crs, x), e: {Laws.FFn(x) == fn : U32}) -> TL.Mem(U.Un.ffns(crs), fn):
  match crs:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{q}:
          %Equal.sym(M.Finding, h, x, q) : TL.Mem(U.Un.ffns(Con{_, t}), fn)
          FF.hit(x, t, fn, e)
        case Inr{q}:
          FF.stay(h, t, fn, FF.c(t, fn, x, q, e))

def FF.from(+crs: List<&2, M.Finding>, +fn: U32, w: Laws.CrapAt(crs, fn)) -> TL.Mem(U.Un.ffns(crs), fn):
  match w:
    case Tuple{+x, q}:
      match q:
        case Tuple{mx, ex}:
          FF.c(crs, fn, x, mx, ex)

# Not in the coverage set means every record names another function, and back.
def NR.head(b: Bool, +f: U32, +fn: U32, +t: List<&2, C.CrM>, hb: {U32.is_eq(f, fn) == b : Bool}, hf: {S.Scope.has(S.Scope.set(Con{f, U.Un.dfns(t)}), fn) == False{} : Bool}) -> {U32.is_eq(f, fn) == False{} : Bool}:
  match b:
    case True{}:
      Empty.absurd({U32.is_eq(f, fn) == False{} : Bool}, CP.B.clash(S.Scope.has(S.Scope.set(Con{f, U.Un.dfns(t)}), fn), hf, SL.scope_set_complete(Con{f, U.Un.dfns(t)}, fn, Inl{L.U32.eq_sound(f, fn, hb)})))
    case False{}:
      hb

def NR.tail(b: Bool, +f: U32, +fn: U32, +t: List<&2, C.CrM>, hb: {S.Scope.has(S.Scope.set(U.Un.dfns(t)), fn) == b : Bool}, hf: {S.Scope.has(S.Scope.set(Con{f, U.Un.dfns(t)}), fn) == False{} : Bool}) -> {S.Scope.has(S.Scope.set(U.Un.dfns(t)), fn) == False{} : Bool}:
  match b:
    case True{}:
      Empty.absurd({S.Scope.has(S.Scope.set(U.Un.dfns(t)), fn) == False{} : Bool}, CP.B.clash(S.Scope.has(S.Scope.set(Con{f, U.Un.dfns(t)}), fn), hf, SL.scope_set_complete(Con{f, U.Un.dfns(t)}, fn, Inr{SL.scope_set_sound(U.Un.dfns(t), fn, hb)})))
    case False{}:
      hb

def NR.s(cms: List<&2, C.CrM>, +fn: U32, +hf: {S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn) == False{} : Bool}) -> Laws.NoRec(cms, fn):
  match cms:
    case Nil{}:
      {==}
    case Con{C.CrM{+f, +c, +covered, +n, +v, +test}, +t}:
      Tuple{NR.head(U32.is_eq(f, fn), f, fn, t, {==}, hf), NR.s(t, fn, NR.tail(S.Scope.has(S.Scope.set(U.Un.dfns(t)), fn), f, fn, t, {==}, hf))}

def NR.c(cms: List<&2, C.CrM>, +fn: U32, nr: Laws.NoRec(cms, fn), m: TL.Mem(U.Un.dfns(cms), fn)) -> Empty:
  match cms:
    case Nil{}:
      match m:
    case Con{C.CrM{+f, +c, +covered, +n, +v, +test}, +t}:
      match nr:
        case Tuple{ef, nt}:
          match m:
            case Inl{e}:
              CP.B.clash(U32.is_eq(f, fn), ef, CP.U.eq_t(f, fn, e))
            case Inr{q}:
              NR.c(t, fn, nt, q)

def ND.c(b: Bool, +cms: List<&2, C.CrM>, +fn: U32, hb: {S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn) == b : Bool}, nr: Laws.NoRec(cms, fn)) -> {S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn) == False{} : Bool}:
  match b:
    case True{}:
      Empty.absurd({S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn) == False{} : Bool}, NR.c(cms, fn, nr, SL.scope_set_sound(U.Un.dfns(cms), fn, hb)))
    case False{}:
      hb

# ---- one rule row: sound ----------------------------------------------------------------------
def Rule.k2(+fn: U32, +cc: Nat, +nest: Nat, +np: Nat, +loc: Nat, +test: Bool, +t: List<&2, M.FnM>, +qfns: List<&2, U32>, +crs: List<&2, M.Finding>, +cms: List<&2, C.CrM>, +r: U32, +y: U.Ux, o: Either<&2, &2, TL.And({Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn))) == True{} : Bool}, {U.Ux{r, fn, 2} == y : U.Ux}), Laws.MemUx(U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y)>, ih: Laws.MemUx(U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y) -> TL.Ex(M.FnM, m => TL.And(ML.MemM(t, m), Laws.UAt(m, qfns, crs, cms, r, y)))) -> TL.Ex(M.FnM, m => TL.And(ML.MemM(Con{M.FnM{fn, cc, nest, np, loc, test}, t}, m), Laws.UAt(m, qfns, crs, cms, r, y))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{+eb, ey}:
          +ea = QP.And.l(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn)), eb)
          +hf = Not.f(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn), QP.And.r(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn)), eb))
          Tuple{M.FnM{fn, cc, nest, np, loc, test}, Tuple{Inl{{==}}, Tuple{Not.f(test, QP.And.l(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn), ea)), Tuple{SL.scope_set_sound(qfns, fn, QP.And.r(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn), ea)), Inr{Tuple{ey, NR.s(cms, fn, hf)}}}}}}
    case Inr{m}:
      Lift.m(m => Laws.UAt(m, qfns, crs, cms, r, y), M.FnM{fn, cc, nest, np, loc, test}, t, ih(m))

def Rule.k(+fn: U32, +cc: Nat, +nest: Nat, +np: Nat, +loc: Nat, +test: Bool, +t: List<&2, M.FnM>, +qfns: List<&2, U32>, +crs: List<&2, M.Finding>, +cms: List<&2, C.CrM>, +r: U32, +y: U.Ux, o: Either<&2, &2, TL.And({Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), S.Scope.has(S.Scope.set(U.Un.ffns(crs)), fn)) == True{} : Bool}, {U.Ux{r, fn, 1} == y : U.Ux}), Laws.MemUx(U.Un.push(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn))), U.Ux{r, fn, 2}, U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms)))), y)>, ih: Laws.MemUx(U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y) -> TL.Ex(M.FnM, m => TL.And(ML.MemM(t, m), Laws.UAt(m, qfns, crs, cms, r, y)))) -> TL.Ex(M.FnM, m => TL.And(ML.MemM(Con{M.FnM{fn, cc, nest, np, loc, test}, t}, m), Laws.UAt(m, qfns, crs, cms, r, y))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{+eb, ey}:
          +ea = QP.And.l(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), S.Scope.has(S.Scope.set(U.Un.ffns(crs)), fn), eb)
          Tuple{M.FnM{fn, cc, nest, np, loc, test}, Tuple{Inl{{==}}, Tuple{Not.f(test, QP.And.l(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn), ea)), Tuple{SL.scope_set_sound(qfns, fn, QP.And.r(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn), ea)), Inl{Tuple{ey, FF.s(crs, fn, SL.scope_set_sound(U.Un.ffns(crs), fn, QP.And.r(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), S.Scope.has(S.Scope.set(U.Un.ffns(crs)), fn), eb)))}}}}}}
    case Inr{m}:
      Rule.k2(fn, cc, nest, np, loc, test, t, qfns, crs, cms, r, y, UP.mem(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn))), U.Ux{r, fn, 2}, U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y, m), ih)

def Rule.s(ms: List<&2, M.FnM>, +qfns: List<&2, U32>, +crs: List<&2, M.Finding>, +cms: List<&2, C.CrM>, +r: U32, +y: U.Ux, h: Laws.MemUx(U.Un.rule(ms, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y)) -> TL.Ex(M.FnM, m => TL.And(ML.MemM(ms, m), Laws.UAt(m, qfns, crs, cms, r, y))):
  match ms:
    case Nil{}:
      match h:
    case Con{M.FnM{+fn, +cc, +nest, +np, +loc, +test}, +t}:
      Rule.k(fn, cc, nest, np, loc, test, t, qfns, crs, cms, r, y, UP.mem(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), S.Scope.has(S.Scope.set(U.Un.ffns(crs)), fn)), U.Ux{r, fn, 1}, U.Un.push(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn))), U.Ux{r, fn, 2}, U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms)))), y, h), q => Rule.s(t, qfns, crs, cms, r, y, q))

def Laws.un_rule_sound(ms, qfns, crs, cms, r, y, hm):
  Rule.s(ms, qfns, crs, cms, r, y, hm)

# ---- one rule row: complete -------------------------------------------------------------------
def Rule.hit(m: M.FnM, +t: List<&2, M.FnM>, +qfns: List<&2, U32>, +crs: List<&2, M.Finding>, +cms: List<&2, C.CrM>, +r: U32, +y: U.Ux, w: Laws.UAt(m, qfns, crs, cms, r, y)) -> Laws.MemUx(U.Un.rule(Con{m, t}, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y):
  match m:
    case M.FnM{+fn, +cc, +nest, +np, +loc, +test}:
      match w:
        case Tuple{+et, q}:
          match q:
            case Tuple{+mq, o}:
              match o:
                case Inl{Tuple{ey, ca}}:
                  +ga = HP.And.both(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn), FP.Not.tt(test, et), SL.scope_set_complete(qfns, fn, mq))
                  %ey : Laws.MemUx(U.Un.rule(Con{M.FnM{fn, cc, nest, np, loc, test}, t}, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), _)
                  UP.hit(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), S.Scope.has(S.Scope.set(U.Un.ffns(crs)), fn)), U.Ux{r, fn, 1}, U.Un.push(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn))), U.Ux{r, fn, 2}, U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms)))), HP.And.both(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), S.Scope.has(S.Scope.set(U.Un.ffns(crs)), fn), ga, SL.scope_set_complete(U.Un.ffns(crs), fn, FF.from(crs, fn, ca))))
                case Inr{Tuple{ey, nd}}:
                  +ga = HP.And.both(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn), FP.Not.tt(test, et), SL.scope_set_complete(qfns, fn, mq))
                  %ey : Laws.MemUx(U.Un.rule(Con{M.FnM{fn, cc, nest, np, loc, test}, t}, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), _)
                  UP.stay(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), S.Scope.has(S.Scope.set(U.Un.ffns(crs)), fn)), U.Ux{r, fn, 1}, U.Un.push(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn))), U.Ux{r, fn, 2}, U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms)))), U.Ux{r, fn, 2}, UP.hit(Bool.and(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn))), U.Ux{r, fn, 2}, U.Un.rule(t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), HP.And.both(Bool.and(Bool.not(test), S.Scope.has(S.Scope.set(qfns), fn)), Bool.not(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn)), ga, FP.Not.tt(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn), ND.c(S.Scope.has(S.Scope.set(U.Un.dfns(cms)), fn), cms, fn, {==}, nd)))))

def Rule.stay(h: M.FnM, +t: List<&2, M.FnM>, +r: U32, +qset: G.Tr, +cset: G.Tr, +dset: G.Tr, +y: U.Ux, m: Laws.MemUx(U.Un.rule(t, r, qset, cset, dset), y)) -> Laws.MemUx(U.Un.rule(Con{h, t}, r, qset, cset, dset), y):
  match h:
    case M.FnM{+fn, +cc, +nest, +np, +loc, +test}:
      UP.stay(Bool.and(Bool.and(Bool.not(test), S.Scope.has(qset, fn)), S.Scope.has(cset, fn)), U.Ux{r, fn, 1}, U.Un.push(Bool.and(Bool.and(Bool.not(test), S.Scope.has(qset, fn)), Bool.not(S.Scope.has(dset, fn))), U.Ux{r, fn, 2}, U.Un.rule(t, r, qset, cset, dset)), y, UP.stay(Bool.and(Bool.and(Bool.not(test), S.Scope.has(qset, fn)), Bool.not(S.Scope.has(dset, fn))), U.Ux{r, fn, 2}, U.Un.rule(t, r, qset, cset, dset), y, m))

def Rule.c(ms: List<&2, M.FnM>, +qfns: List<&2, U32>, +crs: List<&2, M.Finding>, +cms: List<&2, C.CrM>, +r: U32, +y: U.Ux, +m: M.FnM, hm: ML.MemM(ms, m), w: Laws.UAt(m, qfns, crs, cms, r, y)) -> Laws.MemUx(U.Un.rule(ms, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y):
  match ms:
    case Nil{}:
      match hm:
    case Con{h, +t}:
      match hm:
        case Inl{e}:
          %Equal.sym(M.FnM, h, m, e) : Laws.MemUx(U.Un.rule(Con{_, t}, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y)
          Rule.hit(m, t, qfns, crs, cms, r, y, w)
        case Inr{q}:
          Rule.stay(h, t, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms)), y, Rule.c(t, qfns, crs, cms, r, y, m, q, w))

def Laws.un_rule_complete(ms, qfns, crs, cms, r, y, m, hm, w):
  Rule.c(ms, qfns, crs, cms, r, y, m, hm, w)

# ---- every rule row ---------------------------------------------------------------------------
def Rs.up(+k: U32, +t: List<&2, U32>, +ms: List<&2, M.FnM>, +qset: G.Tr, +cset: G.Tr, +dset: G.Tr, +y: U.Ux, w: TL.Ex(U32, g => TL.And(TL.Mem(t, g), Laws.MemUx(U.Un.rule(ms, g, qset, cset, dset), y)))) -> TL.Ex(U32, g => TL.And(TL.Mem(Con{k, t}, g), Laws.MemUx(U.Un.rule(ms, g, qset, cset, dset), y))):
  match w:
    case Tuple{g, q}:
      match q:
        case Tuple{mg, m}:
          Tuple{g, Tuple{Inr{mg}, m}}

def Rs.s2(+k: U32, +t: List<&2, U32>, +ms: List<&2, M.FnM>, +qset: G.Tr, +cset: G.Tr, +dset: G.Tr, +y: U.Ux, o: Either<&2, &2, Laws.MemUx(U.Un.rule(ms, k, qset, cset, dset), y), Laws.MemUx(U.Un.rules(ms, t, qset, cset, dset), y)>, ih: Laws.MemUx(U.Un.rules(ms, t, qset, cset, dset), y) -> TL.Ex(U32, g => TL.And(TL.Mem(t, g), Laws.MemUx(U.Un.rule(ms, g, qset, cset, dset), y)))) -> TL.Ex(U32, g => TL.And(TL.Mem(Con{k, t}, g), Laws.MemUx(U.Un.rule(ms, g, qset, cset, dset), y))):
  match o:
    case Inl{m}:
      Tuple{k, Tuple{Inl{{==}}, m}}
    case Inr{m}:
      Rs.up(k, t, ms, qset, cset, dset, y, ih(m))

def Rs.s(rus: List<&2, U32>, +ms: List<&2, M.FnM>, +qset: G.Tr, +cset: G.Tr, +dset: G.Tr, +y: U.Ux, h: Laws.MemUx(U.Un.rules(ms, rus, qset, cset, dset), y)) -> TL.Ex(U32, g => TL.And(TL.Mem(rus, g), Laws.MemUx(U.Un.rule(ms, g, qset, cset, dset), y))):
  match rus:
    case Nil{}:
      match h:
    case Con{+k, +t}:
      Rs.s2(k, t, ms, qset, cset, dset, y, AX.split(U.Un.rule(ms, k, qset, cset, dset), U.Un.rules(ms, t, qset, cset, dset), y, h), q => Rs.s(t, ms, qset, cset, dset, y, q))

def Laws.un_findings_sound(ms, crs, cms, qfns, rus, y, hm):
  Rs.s(rus, ms, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms)), y, hm)

def Rs.c(rus: List<&2, U32>, +ms: List<&2, M.FnM>, +qset: G.Tr, +cset: G.Tr, +dset: G.Tr, +r: U32, +y: U.Ux, hr: TL.Mem(rus, r), hm: Laws.MemUx(U.Un.rule(ms, r, qset, cset, dset), y)) -> Laws.MemUx(U.Un.rules(ms, rus, qset, cset, dset), y):
  match rus:
    case Nil{}:
      match hr:
    case Con{h, +t}:
      match hr:
        case Inl{e}:
          %Equal.sym(U32, h, r, e) : Laws.MemUx(U.Un.rules(ms, Con{_, t}, qset, cset, dset), y)
          AX.l(U.Un.rule(ms, r, qset, cset, dset), U.Un.rules(ms, t, qset, cset, dset), y, hm)
        case Inr{q}:
          AX.r(U.Un.rule(ms, h, qset, cset, dset), U.Un.rules(ms, t, qset, cset, dset), y, Rs.c(t, ms, qset, cset, dset, r, y, q, hm))

def Laws.un_findings_complete(ms, crs, cms, qfns, rus, r, y, hr, hm):
  Rs.c(rus, ms, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms)), r, y, hr, hm)

def Laws.un_lines_off(ms, crs, cms, qfns):
  {==}

def Laws.un_lines_shape(ms, crs, cms, qfns, r, t):
  {==}
