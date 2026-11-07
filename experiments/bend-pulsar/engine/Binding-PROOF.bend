# engine/Binding-PROOF.bend - proofs of Binding-LAWS.bend. Gate: bend Binding-PROOF.bend --verdict
import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ./Metrics-NAT.bend as N
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./ClassCtx-PROOF.bend as CP
import ./Hotspot-PROOF.bend as HP
import ./Fanout-PROOF.bend as FP
import ./Sql-PROOF.bend as QP
import ./Layers-PROOF.bend as LP
import ./Binding.bend as B
import ./Binding-LAWS.bend as Laws

# ---- push_u membership (Bd.push_u has the same shape as the other lanes' push_u) --------------
def PU.mem(b: Bool, +s: U32, +rest: List<&2, U32>, +x: U32, h: TL.Mem(B.Bd.push_u(b, s, rest), x)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {s == x : U32}), TL.Mem(rest, x)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def PU.hit(b: Bool, +s: U32, +rest: List<&2, U32>, hb: {b == True{} : Bool}) -> TL.Mem(B.Bd.push_u(b, s, rest), s):
  %Equal.sym(Bool, b, True{}, hb) : TL.Mem(B.Bd.push_u(_, s, rest), s)
  Inl{{==}}

def PU.keep(b: Bool, +y: U32, acc: List<&2, U32>, +x: U32, h: TL.Mem(acc, x)) -> TL.Mem(B.Bd.push_u(b, y, acc), x):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

# ---- existential lifting ----------------------------------------------------------------------
def Lift.ie(-P: @e: B.Ie -> Data, +h: B.Ie, +t: List<&2, B.Ie>, w: TL.Ex(B.Ie, e => TL.And(Laws.MemIe(t, e), P(e)))) -> TL.Ex(B.Ie, e => TL.And(Laws.MemIe(Con{h, t}, e), P(e))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.ib(-P: @e: B.Ib -> Data, +h: B.Ib, +t: List<&2, B.Ib>, w: TL.Ex(B.Ib, e => TL.And(Laws.MemIb(t, e), P(e)))) -> TL.Ex(B.Ib, e => TL.And(Laws.MemIb(Con{h, t}, e), P(e))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.iu(-P: @e: B.Iu -> Data, +h: B.Iu, +t: List<&2, B.Iu>, w: TL.Ex(B.Iu, e => TL.And(Laws.MemIu(t, e), P(e)))) -> TL.Ex(B.Iu, e => TL.And(Laws.MemIu(Con{h, t}, e), P(e))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

def Lift.ix(-P: @e: B.Ix -> Data, +h: B.Ix, +t: List<&2, B.Ix>, w: TL.Ex(B.Ix, e => TL.And(Laws.MemIx(t, e), P(e)))) -> TL.Ex(B.Ix, e => TL.And(Laws.MemIx(Con{h, t}, e), P(e))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{ms, at}:
          Tuple{a, Tuple{Inr{ms}, at}}

# ---- one step: the successors of a set --------------------------------------------------------
def Step.k(+src: U32, +dst: U32, +t: List<&2, B.Ix>, +cur: List<&2, U32>, +x: U32, o: Either<&2, &2, TL.And({S.Scope.has(S.Scope.set(cur), src) == True{} : Bool}, {dst == x : U32}), TL.Mem(B.Bd.step(t, S.Scope.set(cur)), x)>, ih: TL.Mem(B.Bd.step(t, S.Scope.set(cur)), x) -> TL.Ex(B.Ix, e => TL.And(Laws.MemIx(t, e), TL.And({Laws.IxDst(e) == x : U32}, TL.Mem(cur, Laws.IxSrc(e)))))) -> TL.Ex(B.Ix, e => TL.And(Laws.MemIx(Con{B.Ix{src, dst}, t}, e), TL.And({Laws.IxDst(e) == x : U32}, TL.Mem(cur, Laws.IxSrc(e))))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eh, et}:
          Tuple{B.Ix{src, dst}, Tuple{Inl{{==}}, Tuple{et, SL.scope_set_sound(cur, src, eh)}}}
    case Inr{m}:
      Lift.ix(e => TL.And({Laws.IxDst(e) == x : U32}, TL.Mem(cur, Laws.IxSrc(e))), B.Ix{src, dst}, t, ih(m))

def Step.s(ixs: List<&2, B.Ix>, +cur: List<&2, U32>, +x: U32, h: TL.Mem(B.Bd.step(ixs, S.Scope.set(cur)), x)) -> TL.Ex(B.Ix, e => TL.And(Laws.MemIx(ixs, e), TL.And({Laws.IxDst(e) == x : U32}, TL.Mem(cur, Laws.IxSrc(e))))):
  match ixs:
    case Nil{}:
      Empty.absurd(TL.Ex(B.Ix, e => TL.And(Laws.MemIx(Nil{}, e), TL.And({Laws.IxDst(e) == x : U32}, TL.Mem(cur, Laws.IxSrc(e))))), h)
    case Con{B.Ix{+src, +dst}, +t}:
      Step.k(src, dst, t, cur, x, PU.mem(S.Scope.has(S.Scope.set(cur), src), dst, B.Bd.step(t, S.Scope.set(cur)), x, h), q => Step.s(t, cur, x, q))

def Step.hit(e: B.Ix, +t: List<&2, B.Ix>, +cur: List<&2, U32>, +x: U32, et: {Laws.IxDst(e) == x : U32}, mf: TL.Mem(cur, Laws.IxSrc(e))) -> TL.Mem(B.Bd.step(Con{e, t}, S.Scope.set(cur)), x):
  match e:
    case B.Ix{+src, +dst}:
      %et : TL.Mem(B.Bd.step(Con{B.Ix{src, dst}, t}, S.Scope.set(cur)), _)
      PU.hit(S.Scope.has(S.Scope.set(cur), src), dst, B.Bd.step(t, S.Scope.set(cur)), SL.scope_set_complete(cur, src, mf))

def Step.stay(h: B.Ix, +t: List<&2, B.Ix>, +cur: List<&2, U32>, +x: U32, m: TL.Mem(B.Bd.step(t, S.Scope.set(cur)), x)) -> TL.Mem(B.Bd.step(Con{h, t}, S.Scope.set(cur)), x):
  match h:
    case B.Ix{+src, +dst}:
      PU.keep(S.Scope.has(S.Scope.set(cur), src), dst, B.Bd.step(t, S.Scope.set(cur)), x, m)

def Step.c(ixs: List<&2, B.Ix>, +cur: List<&2, U32>, +x: U32, +e: B.Ix, hm: Laws.MemIx(ixs, e), et: {Laws.IxDst(e) == x : U32}, mf: TL.Mem(cur, Laws.IxSrc(e))) -> TL.Mem(B.Bd.step(ixs, S.Scope.set(cur)), x):
  match ixs:
    case Nil{}:
      Empty.absurd(TL.Mem(B.Bd.step(Nil{}, S.Scope.set(cur)), x), hm)
    case Con{h, +t}:
      match hm:
        case Inl{q}:
          %Equal.sym(B.Ix, h, e, q) : TL.Mem(B.Bd.step(Con{_, t}, S.Scope.set(cur)), x)
          Step.hit(e, t, cur, x, et, mf)
        case Inr{q}:
          Step.stay(h, t, cur, x, Step.c(t, cur, x, e, q, et, mf))

# ---- reach ------------------------------------------------------------------------------------
def Inv.down(+ixs: List<&2, B.Ix>, +starts: List<&2, U32>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> Laws.BR(j, ixs, starts, y) -> TL.Mem(cur, y), +y: U32, w: Laws.BR(1n+j, ixs, starts, y)) -> TL.Mem(List.append(&2, U32, cur, B.Bd.step(ixs, S.Scope.set(cur))), y):
  match w:
    case Inl{r}:
      FP.AU.l(cur, B.Bd.step(ixs, S.Scope.set(cur)), y, inv(y, r))
    case Inr{Tuple{+e, Tuple{me, Tuple{et, rf}}}}:
      FP.AU.r(cur, B.Bd.step(ixs, S.Scope.set(cur)), y, Step.c(ixs, cur, y, e, me, et, inv(Laws.IxSrc(e), rf)))

def Inv.s2(+ixs: List<&2, B.Ix>, +starts: List<&2, U32>, +cur: List<&2, U32>, +j: Nat, inv: @q: U32 -> TL.Mem(cur, q) -> Laws.BR(j, ixs, starts, q), +y: U32, w: TL.Ex(B.Ix, e => TL.And(Laws.MemIx(ixs, e), TL.And({Laws.IxDst(e) == y : U32}, TL.Mem(cur, Laws.IxSrc(e)))))) -> Laws.BR(1n+j, ixs, starts, y):
  match w:
    case Tuple{+e, q}:
      match q:
        case Tuple{me, q2}:
          match q2:
            case Tuple{et, mf}:
              Inr{Tuple{e, Tuple{me, Tuple{et, inv(Laws.IxSrc(e), mf)}}}}

def Inv.up1(+ixs: List<&2, B.Ix>, +starts: List<&2, U32>, +cur: List<&2, U32>, +j: Nat, inv: @q: U32 -> TL.Mem(cur, q) -> Laws.BR(j, ixs, starts, q), +y: U32, sp: Either<&2, &2, TL.Mem(cur, y), TL.Mem(B.Bd.step(ixs, S.Scope.set(cur)), y)>) -> Laws.BR(1n+j, ixs, starts, y):
  match sp:
    case Inl{r}:
      Inl{inv(y, r)}
    case Inr{q}:
      Inv.s2(ixs, starts, cur, j, inv, y, Step.s(ixs, cur, y, q))

def Inv.up(+ixs: List<&2, B.Ix>, +starts: List<&2, U32>, +cur: List<&2, U32>, +j: Nat, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.BR(j, ixs, starts, y), +y: U32, h: TL.Mem(List.append(&2, U32, cur, B.Bd.step(ixs, S.Scope.set(cur))), y)) -> Laws.BR(1n+j, ixs, starts, y):
  Inv.up1(ixs, starts, cur, j, inv, y, FP.AU.split(cur, B.Bd.step(ixs, S.Scope.set(cur)), y, h))

def RS(k: Nat, +ixs: List<&2, B.Ix>, +starts: List<&2, U32>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> TL.Mem(cur, y) -> Laws.BR(j, ixs, starts, y), +x: U32, hm: TL.Mem(B.Bd.reach(k, ixs, cur), x)) -> Laws.BR(Nat.add(k, j), ixs, starts, x):
  match k:
    case 0n:
      inv(x, hm)
    case 1n+p:
      +q = p
      %N.Nat.add_succ_r(q, j) : Laws.BR(_, ixs, starts, x)
      RS(q, ixs, starts, 1n+j, List.append(&2, U32, cur, B.Bd.step(ixs, S.Scope.set(cur))), y => h => Inv.up(ixs, starts, cur, j, inv, y, h), x, hm)

def Rw.br(+a: Nat, +b: Nat, +ixs: List<&2, B.Ix>, +starts: List<&2, U32>, +x: U32, e: {b == a : Nat}, w: Laws.BR(b, ixs, starts, x)) -> Laws.BR(a, ixs, starts, x):
  %e : Laws.BR(_, ixs, starts, x)
  w

def RC(k: Nat, +ixs: List<&2, B.Ix>, +starts: List<&2, U32>, +j: Nat, +cur: List<&2, U32>, inv: @y: U32 -> Laws.BR(j, ixs, starts, y) -> TL.Mem(cur, y), +x: U32, w: Laws.BR(Nat.add(k, j), ixs, starts, x)) -> TL.Mem(B.Bd.reach(k, ixs, cur), x):
  match k:
    case 0n:
      inv(x, w)
    case 1n+p:
      +q = p
      RC(q, ixs, starts, 1n+j, List.append(&2, U32, cur, B.Bd.step(ixs, S.Scope.set(cur))), y => r => Inv.down(ixs, starts, j, cur, inv, y, r), x, Rw.br(Nat.add(q, 1n+j), 1n+Nat.add(q, j), ixs, starts, x, Equal.sym(Nat, Nat.add(q, 1n+j), 1n+Nat.add(q, j), N.Nat.add_succ_r(q, j)), w))

def Laws.bd_reach_sound(k, ixs, starts, x, hm):
  %N.Nat.add_zero_r(k) : Laws.BR(_, ixs, starts, x)
  RS(k, ixs, starts, 0n, starts, y => h => h, x, hm)

def Laws.bd_reach_complete(k, ixs, starts, x, w):
  RC(k, ixs, starts, 0n, starts, y => r => r, x, Rw.br(Nat.add(k, 0n), k, ixs, starts, x, Equal.sym(Nat, Nat.add(k, 0n), k, N.Nat.add_zero_r(k)), w))

# Transport a membership across an equality of the element.
def RW.u(+xs: List<&2, U32>, +a: U32, +b: U32, h: TL.Mem(xs, a), e: {a == b : U32}) -> TL.Mem(xs, b):
  %e : TL.Mem(xs, _)
  h

# ---- the deployable's entry files --------------------------------------------------------------
def FS.k(+d: U32, +fi: U32, +t: List<&2, B.Ie>, +dep: U32, +f: U32, o: Either<&2, &2, TL.And({U32.is_eq(d, dep) == True{} : Bool}, {fi == f : U32}), TL.Mem(B.Bd.files(t, dep), f)>, ih: TL.Mem(B.Bd.files(t, dep), f) -> TL.Ex(B.Ie, e => TL.And(Laws.MemIe(t, e), TL.And({Laws.IeDep(e) == dep : U32}, {Laws.IeFile(e) == f : U32})))) -> TL.Ex(B.Ie, e => TL.And(Laws.MemIe(Con{B.Ie{d, fi}, t}, e), TL.And({Laws.IeDep(e) == dep : U32}, {Laws.IeFile(e) == f : U32}))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eb, ef}:
          Tuple{B.Ie{d, fi}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(d, dep, eb), ef}}}
    case Inr{m}:
      Lift.ie(e => TL.And({Laws.IeDep(e) == dep : U32}, {Laws.IeFile(e) == f : U32}), B.Ie{d, fi}, t, ih(m))

def FS.s(ies: List<&2, B.Ie>, +dep: U32, +f: U32, hm: TL.Mem(B.Bd.files(ies, dep), f)) -> TL.Ex(B.Ie, e => TL.And(Laws.MemIe(ies, e), TL.And({Laws.IeDep(e) == dep : U32}, {Laws.IeFile(e) == f : U32}))):
  match ies:
    case Nil{}:
      Empty.absurd(TL.Ex(B.Ie, e => TL.And(Laws.MemIe(Nil{}, e), TL.And({Laws.IeDep(e) == dep : U32}, {Laws.IeFile(e) == f : U32}))), hm)
    case Con{B.Ie{+d, +fi}, +t}:
      FS.k(d, fi, t, dep, f, PU.mem(U32.is_eq(d, dep), fi, B.Bd.files(t, dep), f, hm), q => FS.s(t, dep, f, q))

def FS.c2(h: B.Ie, +t: List<&2, B.Ie>, +dep: U32, +f: U32, he: Laws.MemIe(Con{h, t}, B.Ie{dep, f}), ih: Laws.MemIe(t, B.Ie{dep, f}) -> TL.Mem(B.Bd.files(t, dep), f)) -> TL.Mem(B.Bd.files(Con{h, t}, dep), f):
  match h:
    case B.Ie{+d, +fi}:
      match he:
        case Inl{+q}:
          +ed = Equal.cong(B.Ie, U32, Laws.IeDep, B.Ie{d, fi}, B.Ie{dep, f}, q)
          +ef = Equal.cong(B.Ie, U32, Laws.IeFile, B.Ie{d, fi}, B.Ie{dep, f}, q)
          %Equal.sym(U32, fi, f, ef) : TL.Mem(B.Bd.push_u(U32.is_eq(d, dep), _, B.Bd.files(t, dep)), f)
          PU.hit(U32.is_eq(d, dep), f, B.Bd.files(t, dep), CP.U.eq_t(d, dep, ed))
        case Inr{r}:
          PU.keep(U32.is_eq(d, dep), fi, B.Bd.files(t, dep), f, ih(r))

def FS.c(ies: List<&2, B.Ie>, +dep: U32, +f: U32, he: Laws.MemIe(ies, B.Ie{dep, f})) -> TL.Mem(B.Bd.files(ies, dep), f):
  match ies:
    case Nil{}:
      Empty.absurd(TL.Mem(B.Bd.files(Nil{}, dep), f), he)
    case Con{h, +t}:
      FS.c2(h, t, dep, f, he, r => FS.c(t, dep, f, r))

def Laws.bd_files_sound(ies, dep, f, hm):
  FS.s(ies, dep, f, hm)

def Laws.bd_files_complete(ies, dep, f, he):
  FS.c(ies, dep, f, he)

# ---- the deployable's declared bindings -------------------------------------------------------
def DC.k(+d: U32, +bi: U32, +t: List<&2, B.Ib>, +dep: U32, +b: U32, o: Either<&2, &2, TL.And({U32.is_eq(d, dep) == True{} : Bool}, {bi == b : U32}), TL.Mem(B.Bd.decl(t, dep), b)>, ih: TL.Mem(B.Bd.decl(t, dep), b) -> TL.Ex(B.Ib, e => TL.And(Laws.MemIb(t, e), TL.And({Laws.IbDep(e) == dep : U32}, {Laws.IbBind(e) == b : U32})))) -> TL.Ex(B.Ib, e => TL.And(Laws.MemIb(Con{B.Ib{d, bi}, t}, e), TL.And({Laws.IbDep(e) == dep : U32}, {Laws.IbBind(e) == b : U32}))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{eb, ef}:
          Tuple{B.Ib{d, bi}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(d, dep, eb), ef}}}
    case Inr{m}:
      Lift.ib(e => TL.And({Laws.IbDep(e) == dep : U32}, {Laws.IbBind(e) == b : U32}), B.Ib{d, bi}, t, ih(m))

def DC.s(ibs: List<&2, B.Ib>, +dep: U32, +b: U32, hm: TL.Mem(B.Bd.decl(ibs, dep), b)) -> TL.Ex(B.Ib, e => TL.And(Laws.MemIb(ibs, e), TL.And({Laws.IbDep(e) == dep : U32}, {Laws.IbBind(e) == b : U32}))):
  match ibs:
    case Nil{}:
      Empty.absurd(TL.Ex(B.Ib, e => TL.And(Laws.MemIb(Nil{}, e), TL.And({Laws.IbDep(e) == dep : U32}, {Laws.IbBind(e) == b : U32}))), hm)
    case Con{B.Ib{+d, +bi}, +t}:
      DC.k(d, bi, t, dep, b, PU.mem(U32.is_eq(d, dep), bi, B.Bd.decl(t, dep), b, hm), q => DC.s(t, dep, b, q))

def DC.c2(h: B.Ib, +t: List<&2, B.Ib>, +dep: U32, +b: U32, he: Laws.MemIb(Con{h, t}, B.Ib{dep, b}), ih: Laws.MemIb(t, B.Ib{dep, b}) -> TL.Mem(B.Bd.decl(t, dep), b)) -> TL.Mem(B.Bd.decl(Con{h, t}, dep), b):
  match h:
    case B.Ib{+d, +bi}:
      match he:
        case Inl{+q}:
          +ed = Equal.cong(B.Ib, U32, Laws.IbDep, B.Ib{d, bi}, B.Ib{dep, b}, q)
          +ef = Equal.cong(B.Ib, U32, Laws.IbBind, B.Ib{d, bi}, B.Ib{dep, b}, q)
          %Equal.sym(U32, bi, b, ef) : TL.Mem(B.Bd.push_u(U32.is_eq(d, dep), _, B.Bd.decl(t, dep)), b)
          PU.hit(U32.is_eq(d, dep), b, B.Bd.decl(t, dep), CP.U.eq_t(d, dep, ed))
        case Inr{r}:
          PU.keep(U32.is_eq(d, dep), bi, B.Bd.decl(t, dep), b, ih(r))

def DC.c(ibs: List<&2, B.Ib>, +dep: U32, +b: U32, he: Laws.MemIb(ibs, B.Ib{dep, b})) -> TL.Mem(B.Bd.decl(ibs, dep), b):
  match ibs:
    case Nil{}:
      Empty.absurd(TL.Mem(B.Bd.decl(Nil{}, dep), b), he)
    case Con{h, +t}:
      DC.c2(h, t, dep, b, he, r => DC.c(t, dep, b, r))

def Laws.bd_decl_sound(ibs, dep, b, hm):
  DC.s(ibs, dep, b, hm)

def Laws.bd_decl_complete(ibs, dep, b, he):
  DC.c(ibs, dep, b, he)

# ---- reads ------------------------------------------------------------------------------------
def RD.k2(+file: U32, +bind: U32, +ius: List<&2, B.Iu>, +reach: G.Tr, +b: U32, p: TL.And({U32.is_eq(bind, b) == True{} : Bool}, {S.Scope.has(reach, file) == True{} : Bool})) -> TL.Ex(B.Iu, e => TL.And(Laws.MemIu(Con{B.Iu{file, bind}, ius}, e), TL.And({Laws.IuBind(e) == b : U32}, {S.Scope.has(reach, Laws.IuFile(e)) == True{} : Bool}))):
  match p:
    case Tuple{ee, eh}:
      Tuple{B.Iu{file, bind}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(bind, b, ee), eh}}}

def RD.k(+file: U32, +bind: U32, +ius: List<&2, B.Iu>, +reach: G.Tr, +b: U32, o: Either<&2, &2, {Bool.and(U32.is_eq(bind, b), S.Scope.has(reach, file)) == True{} : Bool}, {B.Bd.read(ius, reach, b) == True{} : Bool}>, ih: {B.Bd.read(ius, reach, b) == True{} : Bool} -> TL.Ex(B.Iu, e => TL.And(Laws.MemIu(ius, e), TL.And({Laws.IuBind(e) == b : U32}, {S.Scope.has(reach, Laws.IuFile(e)) == True{} : Bool})))) -> TL.Ex(B.Iu, e => TL.And(Laws.MemIu(Con{B.Iu{file, bind}, ius}, e), TL.And({Laws.IuBind(e) == b : U32}, {S.Scope.has(reach, Laws.IuFile(e)) == True{} : Bool}))):
  match o:
    case Inl{hc}:
      RD.k2(file, bind, ius, reach, b, L.Bool.and_true(U32.is_eq(bind, b), S.Scope.has(reach, file), hc))
    case Inr{hr}:
      Lift.iu(e => TL.And({Laws.IuBind(e) == b : U32}, {S.Scope.has(reach, Laws.IuFile(e)) == True{} : Bool}), B.Iu{file, bind}, ius, ih(hr))

def RD.s(ius: List<&2, B.Iu>, +reach: G.Tr, +b: U32, hr: {B.Bd.read(ius, reach, b) == True{} : Bool}) -> TL.Ex(B.Iu, e => TL.And(Laws.MemIu(ius, e), TL.And({Laws.IuBind(e) == b : U32}, {S.Scope.has(reach, Laws.IuFile(e)) == True{} : Bool}))):
  match ius:
    case Nil{}:
      Empty.absurd(TL.Ex(B.Iu, e => TL.And(Laws.MemIu(Nil{}, e), TL.And({Laws.IuBind(e) == b : U32}, {S.Scope.has(reach, Laws.IuFile(e)) == True{} : Bool}))), L.Bool.ff_tt(hr))
    case Con{B.Iu{+file, +bind}, +t}:
      RD.k(file, bind, t, reach, b, L.Bool.or_true(Bool.and(U32.is_eq(bind, b), S.Scope.has(reach, file)), B.Bd.read(t, reach, b), hr), q => RD.s(t, reach, b, q))

def Laws.bd_read_sound(ius, reach, b, hr):
  RD.s(ius, reach, b, hr)

def Has.rw(+reach: G.Tr, +fi: U32, +file: U32, ef: {fi == file : U32}, hf: {S.Scope.has(reach, file) == True{} : Bool}) -> {S.Scope.has(reach, fi) == True{} : Bool}:
  %Equal.sym(U32, fi, file, ef) : {S.Scope.has(reach, _) == True{} : Bool}
  hf

def RC.h(+fi: U32, +bi: U32, +t: List<&2, B.Iu>, +reach: G.Tr, +file: U32, +b: U32, ef: {fi == file : U32}, eb: {bi == b : U32}, hf: {S.Scope.has(reach, file) == True{} : Bool}) -> {B.Bd.read(Con{B.Iu{fi, bi}, t}, reach, b) == True{} : Bool}:
  CP.B.or_l(Bool.and(U32.is_eq(bi, b), S.Scope.has(reach, fi)), B.Bd.read(t, reach, b), CP.B.and_tt(U32.is_eq(bi, b), S.Scope.has(reach, fi), CP.U.eq_t(bi, b, eb), Has.rw(reach, fi, file, ef, hf)))

def RC.r2(h: B.Iu, +t: List<&2, B.Iu>, +reach: G.Tr, +file: U32, +b: U32, he: Laws.MemIu(Con{h, t}, B.Iu{file, b}), +hf: {S.Scope.has(reach, file) == True{} : Bool}, ih: Laws.MemIu(t, B.Iu{file, b}) -> {B.Bd.read(t, reach, b) == True{} : Bool}) -> {B.Bd.read(Con{h, t}, reach, b) == True{} : Bool}:
  match h:
    case B.Iu{+fi, +bi}:
      match he:
        case Inl{+q}:
          +ef = Equal.cong(B.Iu, U32, Laws.IuFile, B.Iu{fi, bi}, B.Iu{file, b}, q)
          +eb = Equal.cong(B.Iu, U32, Laws.IuBind, B.Iu{fi, bi}, B.Iu{file, b}, q)
          RC.h(fi, bi, t, reach, file, b, ef, eb, hf)
        case Inr{r}:
          HP.Or.r(Bool.and(U32.is_eq(bi, b), S.Scope.has(reach, fi)), B.Bd.read(t, reach, b), ih(r))

def RC.r(ius: List<&2, B.Iu>, +reach: G.Tr, +file: U32, +b: U32, he: Laws.MemIu(ius, B.Iu{file, b}), +hf: {S.Scope.has(reach, file) == True{} : Bool}) -> {B.Bd.read(ius, reach, b) == True{} : Bool}:
  match ius:
    case Nil{}:
      Empty.absurd({B.Bd.read(Nil{}, reach, b) == True{} : Bool}, he)
    case Con{h, +t}:
      RC.r2(h, t, reach, file, b, he, hf, r => RC.r(t, reach, file, b, r, hf))

def Laws.bd_read_complete(ius, reach, file, b, he, hf):
  RC.r(ius, reach, file, b, he, hf)

# ---- unread -----------------------------------------------------------------------------------
def RW.ex(+a: U32, +b: U32, e: {a == b : U32}, -P: @x: U32 -> Data, w: P(a)) -> P(b):
  %e : P(_)
  w

def UN.k3(+d: U32, +bi: U32, +t: List<&2, B.Ib>, +ius: List<&2, B.Iu>, +reach: G.Tr, +dep: U32, +b: U32, p: TL.And({U32.is_eq(d, dep) == True{} : Bool}, {Bool.not(B.Bd.read(ius, reach, bi)) == True{} : Bool}), ebi: {bi == b : U32}) -> TL.Ex(B.Ib, e => TL.And(Laws.MemIb(Con{B.Ib{d, bi}, t}, e), TL.And({Laws.IbDep(e) == dep : U32}, TL.And({Laws.IbBind(e) == b : U32}, {B.Bd.read(ius, reach, b) == False{} : Bool})))):
  match p:
    case Tuple{ee, en}:
      RW.ex(bi, b, ebi, x => TL.Ex(B.Ib, e => TL.And(Laws.MemIb(Con{B.Ib{d, bi}, t}, e), TL.And({Laws.IbDep(e) == dep : U32}, TL.And({Laws.IbBind(e) == x : U32}, {B.Bd.read(ius, reach, x) == False{} : Bool})))), Tuple{B.Ib{d, bi}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(d, dep, ee), Tuple{{==}, LP.B.not_t(B.Bd.read(ius, reach, bi), en)}}}})

def UN.k(+d: U32, +bi: U32, +t: List<&2, B.Ib>, +ius: List<&2, B.Iu>, +reach: G.Tr, +dep: U32, +b: U32, o: Either<&2, &2, TL.And({Bool.and(U32.is_eq(d, dep), Bool.not(B.Bd.read(ius, reach, bi))) == True{} : Bool}, {bi == b : U32}), TL.Mem(B.Bd.unread(t, ius, reach, dep), b)>, ih: TL.Mem(B.Bd.unread(t, ius, reach, dep), b) -> TL.Ex(B.Ib, e => TL.And(Laws.MemIb(t, e), TL.And({Laws.IbDep(e) == dep : U32}, TL.And({Laws.IbBind(e) == b : U32}, {B.Bd.read(ius, reach, b) == False{} : Bool}))))) -> TL.Ex(B.Ib, e => TL.And(Laws.MemIb(Con{B.Ib{d, bi}, t}, e), TL.And({Laws.IbDep(e) == dep : U32}, TL.And({Laws.IbBind(e) == b : U32}, {B.Bd.read(ius, reach, b) == False{} : Bool})))):
  match o:
    case Inl{p}:
      match p:
        case Tuple{eb, ebi}:
          UN.k3(d, bi, t, ius, reach, dep, b, L.Bool.and_true(U32.is_eq(d, dep), Bool.not(B.Bd.read(ius, reach, bi)), eb), ebi)
    case Inr{m}:
      Lift.ib(e => TL.And({Laws.IbDep(e) == dep : U32}, TL.And({Laws.IbBind(e) == b : U32}, {B.Bd.read(ius, reach, b) == False{} : Bool})), B.Ib{d, bi}, t, ih(m))

def UN.s(ibs: List<&2, B.Ib>, +ius: List<&2, B.Iu>, +reach: G.Tr, +dep: U32, +b: U32, hm: TL.Mem(B.Bd.unread(ibs, ius, reach, dep), b)) -> TL.Ex(B.Ib, e => TL.And(Laws.MemIb(ibs, e), TL.And({Laws.IbDep(e) == dep : U32}, TL.And({Laws.IbBind(e) == b : U32}, {B.Bd.read(ius, reach, b) == False{} : Bool})))):
  match ibs:
    case Nil{}:
      Empty.absurd(TL.Ex(B.Ib, e => TL.And(Laws.MemIb(Nil{}, e), TL.And({Laws.IbDep(e) == dep : U32}, TL.And({Laws.IbBind(e) == b : U32}, {B.Bd.read(ius, reach, b) == False{} : Bool})))), hm)
    case Con{B.Ib{+d, +bi}, +t}:
      UN.k(d, bi, t, ius, reach, dep, b, PU.mem(Bool.and(U32.is_eq(d, dep), Bool.not(B.Bd.read(ius, reach, bi))), bi, B.Bd.unread(t, ius, reach, dep), b, hm), q => UN.s(t, ius, reach, dep, b, q))

def Laws.bd_unread_sound(ibs, ius, reach, dep, b, hm):
  UN.s(ibs, ius, reach, dep, b, hm)

def UN.c3(+d: U32, +bi: U32, +t: List<&2, B.Ib>, +ius: List<&2, B.Iu>, +reach: G.Tr, +dep: U32, +b: U32, ed: {d == dep : U32}, +eb: {bi == b : U32}, hn: {B.Bd.read(ius, reach, b) == False{} : Bool}) -> TL.Mem(B.Bd.unread(Con{B.Ib{d, bi}, t}, ius, reach, dep), b):
  RW.u(B.Bd.push_u(Bool.and(U32.is_eq(d, dep), Bool.not(B.Bd.read(ius, reach, bi))), bi, B.Bd.unread(t, ius, reach, dep)), bi, b, PU.hit(Bool.and(U32.is_eq(d, dep), Bool.not(B.Bd.read(ius, reach, bi))), bi, B.Bd.unread(t, ius, reach, dep), CP.B.and_tt(U32.is_eq(d, dep), Bool.not(B.Bd.read(ius, reach, bi)), CP.U.eq_t(d, dep, ed), LP.B.not_f(B.Bd.read(ius, reach, bi), RW.ex(b, bi, Equal.sym(U32, bi, b, eb), x => {B.Bd.read(ius, reach, x) == False{} : Bool}, hn)))), eb)

def UN.c2(h: B.Ib, +t: List<&2, B.Ib>, +ius: List<&2, B.Iu>, +reach: G.Tr, +dep: U32, +b: U32, he: Laws.MemIb(Con{h, t}, B.Ib{dep, b}), +hn: {B.Bd.read(ius, reach, b) == False{} : Bool}, ih: Laws.MemIb(t, B.Ib{dep, b}) -> TL.Mem(B.Bd.unread(t, ius, reach, dep), b)) -> TL.Mem(B.Bd.unread(Con{h, t}, ius, reach, dep), b):
  match h:
    case B.Ib{+d, +bi}:
      match he:
        case Inl{+q}:
          +ed = Equal.cong(B.Ib, U32, Laws.IbDep, B.Ib{d, bi}, B.Ib{dep, b}, q)
          +eb = Equal.cong(B.Ib, U32, Laws.IbBind, B.Ib{d, bi}, B.Ib{dep, b}, q)
          UN.c3(d, bi, t, ius, reach, dep, b, ed, eb, hn)
        case Inr{r}:
          PU.keep(Bool.and(U32.is_eq(d, dep), Bool.not(B.Bd.read(ius, reach, bi))), bi, B.Bd.unread(t, ius, reach, dep), b, ih(r))

def UN.c(ibs: List<&2, B.Ib>, +ius: List<&2, B.Iu>, +reach: G.Tr, +dep: U32, +b: U32, he: Laws.MemIb(ibs, B.Ib{dep, b}), +hn: {B.Bd.read(ius, reach, b) == False{} : Bool}) -> TL.Mem(B.Bd.unread(ibs, ius, reach, dep), b):
  match ibs:
    case Nil{}:
      Empty.absurd(TL.Mem(B.Bd.unread(Nil{}, ius, reach, dep), b), he)
    case Con{h, +t}:
      UN.c2(h, t, ius, reach, dep, b, he, hn, r => UN.c(t, ius, reach, dep, b, r, hn))

def Laws.bd_unread_complete(ibs, ius, reach, dep, b, he, hn):
  UN.c(ibs, ius, reach, dep, b, he, hn)

# ---- findings ---------------------------------------------------------------------------------
def MB.rw(+xs: List<&2, B.Bx>, +a: B.Bx, +b: B.Bx, h: Laws.MemBx(xs, a), e: {a == b : B.Bx}) -> Laws.MemBx(xs, b):
  %e : Laws.MemBx(xs, _)
  h
def MK.lift(+b0: U32, +t: List<&2, U32>, +dep: U32, +value: U32, +thr: U32, +declared: U32, +y: B.Bx, w: TL.Ex(U32, b => TL.And({Laws.BxBind(y) == b : U32}, TL.Mem(t, b)))) -> TL.Ex(U32, b => TL.And({Laws.BxBind(y) == b : U32}, TL.Mem(Con{b0, t}, b))):
  match w:
    case Tuple{+b, q}:
      match q:
        case Tuple{eb, mb}:
          Tuple{b, Tuple{eb, Inr{mb}}}

def MK.sk(+b0: U32, +t: List<&2, U32>, +dep: U32, +value: U32, +thr: U32, +declared: U32, +y: B.Bx, hm: Either<&2, &2, {B.Bx{dep, b0, value, thr, declared} == y : B.Bx}, Laws.MemBx(B.Bd.mks(t, dep, value, thr, declared), y)>, ih: Laws.MemBx(B.Bd.mks(t, dep, value, thr, declared), y) -> TL.Ex(U32, b => TL.And({Laws.BxBind(y) == b : U32}, TL.Mem(t, b)))) -> TL.Ex(U32, b => TL.And({Laws.BxBind(y) == b : U32}, TL.Mem(Con{b0, t}, b))):
  match y:
    case B.Bx{d2, b2, v2, t2, dc2}:
      match hm:
        case Inl{+e}:
          Tuple{b0, Tuple{Equal.sym(U32, b0, b2, Equal.cong(B.Bx, U32, Laws.BxBind, B.Bx{dep, b0, value, thr, declared}, B.Bx{d2, b2, v2, t2, dc2}, e)), Inl{{==}}}}
        case Inr{q}:
          MK.lift(b0, t, dep, value, thr, declared, y, ih(q))

def MK.s(us: List<&2, U32>, +dep: U32, +value: U32, +thr: U32, +declared: U32, +y: B.Bx, hm: Laws.MemBx(B.Bd.mks(us, dep, value, thr, declared), y)) -> TL.Ex(U32, b => TL.And({Laws.BxBind(y) == b : U32}, TL.Mem(us, b))):
  match us:
    case Nil{}:
      Empty.absurd(TL.Ex(U32, b => TL.And({Laws.BxBind(y) == b : U32}, TL.Mem(Nil{}, b))), hm)
    case Con{+b0, +t}:
      MK.sk(b0, t, dep, value, thr, declared, y, hm, q => MK.s(t, dep, value, thr, declared, y, q))

def MK.k(+b0: U32, +t: List<&2, U32>, +dep: U32, +value: U32, +thr: U32, +declared: U32, +b: U32, hm: Either<&2, &2, {b0 == b : U32}, TL.Mem(t, b)>, ih: TL.Mem(t, b) -> Laws.MemBx(B.Bd.mks(t, dep, value, thr, declared), B.Bx{dep, b, value, thr, declared})) -> Laws.MemBx(B.Bd.mks(Con{b0, t}, dep, value, thr, declared), B.Bx{dep, b, value, thr, declared}):
  match hm:
    case Inl{+e}:
      +ec = Equal.cong(U32, B.Bx, x => B.Bx{dep, x, value, thr, declared}, b0, b, e)
      MB.rw(Con{B.Bx{dep, b0, value, thr, declared}, B.Bd.mks(t, dep, value, thr, declared)}, B.Bx{dep, b0, value, thr, declared}, B.Bx{dep, b, value, thr, declared}, Inl{{==}}, ec)
    case Inr{q}:
      Inr{ih(q)}

def MK.c(us: List<&2, U32>, +dep: U32, +value: U32, +thr: U32, +declared: U32, +b: U32, hm: TL.Mem(us, b)) -> Laws.MemBx(B.Bd.mks(us, dep, value, thr, declared), B.Bx{dep, b, value, thr, declared}):
  match us:
    case Nil{}:
      Empty.absurd(Laws.MemBx(B.Bd.mks(Nil{}, dep, value, thr, declared), B.Bx{dep, b, value, thr, declared}), hm)
    case Con{+b0, +t}:
      MK.k(b0, t, dep, value, thr, declared, b, hm, q => MK.c(t, dep, value, thr, declared, b, q))

def DP.on(on: Bool, +us: List<&2, U32>, +ibs: List<&2, B.Ib>, +ius: List<&2, B.Iu>, +reach: G.Tr, +dep: U32, +thr: U32, +y: B.Bx, hm: Laws.MemBx(B.Bd.dep2(on, us, ibs, ius, reach, dep, thr), y)) -> TL.Ex(U32, b => TL.And({Laws.BxBind(y) == b : U32}, TL.Mem(us, b))):
  match on:
    case False{}:
      Empty.absurd(TL.Ex(U32, b => TL.And({Laws.BxBind(y) == b : U32}, TL.Mem(us, b))), hm)
    case True{}:
      MK.s(us, dep, U32.from_nat(List.length(&2, U32, us)), thr, U32.from_nat(List.length(&2, U32, B.Bd.decl(ibs, dep))), y, hm)

def Laws.bd_dep_sound(h, t, ibs, ius, ixs, dep, thr, n, y, hm):
  +reach = S.Scope.set(B.Bd.reach(U32.to_nat(n), ixs, Con{h, t}))
  +us = B.Bd.unread(ibs, ius, reach, dep)
  DP.on(B.Bd.fires(thr, us), us, ibs, ius, reach, dep, thr, y, hm)

def DP.on2(on: Bool, +us: List<&2, U32>, +ibs: List<&2, B.Ib>, +ius: List<&2, B.Iu>, +reach: G.Tr, +dep: U32, +thr: U32, +b: U32, mb: TL.Mem(us, b), hg: {on == True{} : Bool}) -> Laws.MemBx(B.Bd.dep2(on, us, ibs, ius, reach, dep, thr), B.Bx{dep, b, U32.from_nat(List.length(&2, U32, us)), thr, U32.from_nat(List.length(&2, U32, B.Bd.decl(ibs, dep)))}):
  match on:
    case False{}:
      Empty.absurd(Laws.MemBx(B.Bd.dep2(False{}, us, ibs, ius, reach, dep, thr), B.Bx{dep, b, U32.from_nat(List.length(&2, U32, us)), thr, U32.from_nat(List.length(&2, U32, B.Bd.decl(ibs, dep)))}), L.Bool.ff_tt(hg))
    case True{}:
      MK.c(us, dep, U32.from_nat(List.length(&2, U32, us)), thr, U32.from_nat(List.length(&2, U32, B.Bd.decl(ibs, dep))), b, mb)

def Laws.bd_dep_complete(h, t, ibs, ius, ixs, dep, thr, n, b, mb, hg):
  +reach = S.Scope.set(B.Bd.reach(U32.to_nat(n), ixs, Con{h, t}))
  +us = B.Bd.unread(ibs, ius, reach, dep)
  DP.on2(B.Bd.fires(thr, us), us, ibs, ius, reach, dep, thr, b, mb, hg)

def Laws.bd_no_entry(ibs, ius, ixs, dep, thr, n):
  {==}

def Laws.bd_rule_off(ids, ies, ibs, ius, ixs, n):
  {==}

def Laws.bd_lines_shape(f):
  {==}
