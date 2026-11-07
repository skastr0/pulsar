# engine/Grow-PROOF.bend - proofs of Grow-LAWS.bend. Gate: bend Grow-PROOF.bend --verdict
import Base
import ../LAWS.bend as TL
import ../Lemmas.bend as L
import ../Lemmas2.bend as L2
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Scope-PROOF.bend as SP
import ./Sql.bend as Q
import ./Sql-LAWS.bend as QL
import ./Fanout.bend as F
import ./Hot.bend as H
import ./Hot-LAWS.bend as HL
import ./Hot-PROOF.bend as HP
import ./Grow.bend as R
import ./Grow-LAWS.bend as Laws

# ---- Bool and U32 -----------------------------------------------------------------------------
def B.l(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {a == True{} : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      Empty.absurd({False{} == True{} : Bool}, L.Bool.ff_tt(e))

def B.r(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {b == True{} : Bool}:
  match a:
    case True{}:
      e
    case False{}:
      Empty.absurd({b == True{} : Bool}, L.Bool.ff_tt(e))

def B.tt(a: Bool, b: Bool, ha: {a == True{} : Bool}, hb: {b == True{} : Bool}) -> {Bool.and(a, b) == True{} : Bool}:
  match a:
    case True{}:
      hb
    case False{}:
      Empty.absurd({False{} == True{} : Bool}, L.Bool.ff_tt(ha))

def B.ol(a: Bool, b: Bool, ha: {a == True{} : Bool}) -> {Bool.or(a, b) == True{} : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      Empty.absurd({b == True{} : Bool}, L.Bool.ff_tt(ha))

def B.or(a: Bool, b: Bool, hb: {b == True{} : Bool}) -> {Bool.or(a, b) == True{} : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      hb

def B.nt(x: Bool, e: {Bool.not(x) == True{} : Bool}) -> {x == False{} : Bool}:
  match x:
    case True{}:
      Empty.absurd({True{} == False{} : Bool}, L.Bool.ff_tt(e))
    case False{}:
      {==}

def B.nf(x: Bool, e: {x == False{} : Bool}) -> {Bool.not(x) == True{} : Bool}:
  match x:
    case True{}:
      Empty.absurd({False{} == True{} : Bool}, L.Bool.tt_ff(e))
    case False{}:
      {==}

def B.clash(t: Bool, hf: {t == False{} : Bool}, ht: {t == True{} : Bool}) -> Empty:
  match t:
    case True{}:
      L.Bool.tt_ff(hf)
    case False{}:
      L.Bool.ff_tt(ht)

def U.eq_t(+a: U32, +b: U32, e: {a == b : U32}) -> {U32.is_eq(a, b) == True{} : Bool}:
  %e : {U32.is_eq(a, _) == True{} : Bool}
  L2.U32.eq_refl(a)

# ---- lifting a witness past a head ------------------------------------------------------------
def Lift.qu(-P: @x: Q.Qu -> Data, +h: Q.Qu, +t: List<&2, Q.Qu>, w: TL.Ex(Q.Qu, x => TL.And(QL.MemQu(t, x), P(x)))) -> TL.Ex(Q.Qu, x => TL.And(QL.MemQu(Con{h, t}, x), P(x))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{m, p}:
          Tuple{a, Tuple{Inr{m}, p}}

def Lift.di(-P: @x: Q.Di -> Data, +h: Q.Di, +t: List<&2, Q.Di>, w: TL.Ex(Q.Di, x => TL.And(Laws.MemDi(t, x), P(x)))) -> TL.Ex(Q.Di, x => TL.And(Laws.MemDi(Con{h, t}, x), P(x))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{m, p}:
          Tuple{a, Tuple{Inr{m}, p}}

def Lift.dc(-P: @x: Q.Dc -> Data, +h: Q.Dc, +t: List<&2, Q.Dc>, w: TL.Ex(Q.Dc, x => TL.And(Laws.MemDc(t, x), P(x)))) -> TL.Ex(Q.Dc, x => TL.And(Laws.MemDc(Con{h, t}, x), P(x))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{m, p}:
          Tuple{a, Tuple{Inr{m}, p}}

def Lift.qs(-P: @x: Q.Qs -> Data, +h: Q.Qs, +t: List<&2, Q.Qs>, w: TL.Ex(Q.Qs, x => TL.And(QL.MemQs(t, x), P(x)))) -> TL.Ex(Q.Qs, x => TL.And(QL.MemQs(Con{h, t}, x), P(x))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{m, p}:
          Tuple{a, Tuple{Inr{m}, p}}

def Lift.qt(-P: @x: Q.Qt -> Data, +h: Q.Qt, +t: List<&2, Q.Qt>, w: TL.Ex(Q.Qt, x => TL.And(QL.MemQt(t, x), P(x)))) -> TL.Ex(Q.Qt, x => TL.And(QL.MemQt(Con{h, t}, x), P(x))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{m, p}:
          Tuple{a, Tuple{Inr{m}, p}}

def Lift.rg(-P: @x: R.Rg -> Data, +h: R.Rg, +t: List<&2, R.Rg>, w: TL.Ex(R.Rg, x => TL.And(Laws.MemRg(t, x), P(x)))) -> TL.Ex(R.Rg, x => TL.And(Laws.MemRg(Con{h, t}, x), P(x))):
  match w:
    case Tuple{a, q}:
      match q:
        case Tuple{m, p}:
          Tuple{a, Tuple{Inr{m}, p}}

# ---- bound columns ----------------------------------------------------------------------------
def Bind.s(+role: U32, o: Either<&2, &2, {U32.is_eq(role, 1) == True{} : Bool}, {U32.is_eq(role, 3) == True{} : Bool}>) -> Laws.BindR(role):
  match o:
    case Inl{e}:
      Inl{L.U32.eq_sound(role, 1, e)}
    case Inr{e}:
      Inr{L.U32.eq_sound(role, 3, e)}

def Bind.c(+role: U32, w: Laws.BindR(role)) -> {R.Gr.bind(role) == True{} : Bool}:
  match w:
    case Inl{e}:
      B.ol(U32.is_eq(role, 1), U32.is_eq(role, 3), U.eq_t(role, 1, e))
    case Inr{e}:
      B.or(U32.is_eq(role, 1), U32.is_eq(role, 3), U.eq_t(role, 3, e))

def Eq.k(+s: U32, +t: U32, +c: U32, +role: U32, +rest: List<&2, Q.Qu>, +site: U32, +table: U32, +col: U32, o: Either<&2, &2, {Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role)))) == True{} : Bool}, {R.Gr.eq(site, table, col, rest) == True{} : Bool}>, ih: {R.Gr.eq(site, table, col, rest) == True{} : Bool} -> Laws.EqW(site, table, col, rest)) -> Laws.EqW(site, table, col, Con{Q.Qu{s, t, c, role}, rest}):
  match o:
    case Inl{+a}:
      +a2 = B.r(U32.is_eq(s, site), Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role))), a)
      +a3 = B.r(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role)), a2)
      Tuple{Q.Qu{s, t, c, role}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(s, site, B.l(U32.is_eq(s, site), Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role))), a)), Tuple{L.U32.eq_sound(t, table, B.l(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role)), a2)), Tuple{L.U32.eq_sound(c, col, B.l(U32.is_eq(c, col), R.Gr.bind(role), a3)), Bind.s(role, L.Bool.or_true(U32.is_eq(role, 1), U32.is_eq(role, 3), B.r(U32.is_eq(c, col), R.Gr.bind(role), a3)))}}}}}
    case Inr{m}:
      Lift.qu(u => Laws.EqAt(u, site, table, col), Q.Qu{s, t, c, role}, rest, ih(m))

def Eq.s(+site: U32, +table: U32, +col: U32, qus: List<&2, Q.Qu>, e: {R.Gr.eq(site, table, col, qus) == True{} : Bool}) -> Laws.EqW(site, table, col, qus):
  match qus:
    case Nil{}:
      Empty.absurd(Laws.EqW(site, table, col, Nil{}), L.Bool.ff_tt(e))
    case Con{Q.Qu{+s, +t, +c, +role}, +rest}:
      Eq.k(s, t, c, role, rest, site, table, col, L.Bool.or_true(Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role)))), R.Gr.eq(site, table, col, rest), e), q => Eq.s(site, table, col, rest, q))

def Eq.hit(u: Q.Qu, +rest: List<&2, Q.Qu>, +site: U32, +table: U32, +col: U32, w: Laws.EqAt(u, site, table, col)) -> {R.Gr.eq(site, table, col, Con{u, rest}) == True{} : Bool}:
  match u:
    case Q.Qu{+s, +t, +c, +role}:
      match w:
        case Tuple{es, q1}:
          match q1:
            case Tuple{et, q2}:
              match q2:
                case Tuple{ec, wb}:
                  B.ol(Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role)))), R.Gr.eq(site, table, col, rest), B.tt(U32.is_eq(s, site), Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role))), U.eq_t(s, site, es), B.tt(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role)), U.eq_t(t, table, et), B.tt(U32.is_eq(c, col), R.Gr.bind(role), U.eq_t(c, col, ec), Bind.c(role, wb)))))

def Eq.stay(h: Q.Qu, +rest: List<&2, Q.Qu>, +site: U32, +table: U32, +col: U32, m: {R.Gr.eq(site, table, col, rest) == True{} : Bool}) -> {R.Gr.eq(site, table, col, Con{h, rest}) == True{} : Bool}:
  match h:
    case Q.Qu{+s, +t, +c, +role}:
      B.or(Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), R.Gr.bind(role)))), R.Gr.eq(site, table, col, rest), m)

def Eq.c(+site: U32, +table: U32, +col: U32, qus: List<&2, Q.Qu>, +u: Q.Qu, hm: QL.MemQu(qus, u), w: Laws.EqAt(u, site, table, col)) -> {R.Gr.eq(site, table, col, qus) == True{} : Bool}:
  match qus:
    case Nil{}:
      match hm:
    case Con{h, +rest}:
      match hm:
        case Inl{e}:
          %Equal.sym(Q.Qu, h, u, e) : {R.Gr.eq(site, table, col, Con{_, rest}) == True{} : Bool}
          Eq.hit(u, rest, site, table, col, w)
        case Inr{q}:
          Eq.stay(h, rest, site, table, col, Eq.c(site, table, col, rest, u, q, w))

def Eq.from(+site: U32, +table: U32, +col: U32, +qus: List<&2, Q.Qu>, w: Laws.EqW(site, table, col, qus)) -> {R.Gr.eq(site, table, col, qus) == True{} : Bool}:
  match w:
    case Tuple{+u, q}:
      match q:
        case Tuple{mu, au}:
          Eq.c(site, table, col, qus, u, mu, au)

# ---- index terms ------------------------------------------------------------------------------
def Cov.one(+x: U32, +i: U32, +c: U32, +site: U32, +table: U32, +qus: List<&2, Q.Qu>, o: Either<&2, &2, {Bool.not(U32.is_eq(x, i)) == True{} : Bool}, {Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus)) == True{} : Bool}>) -> Either<&2, &2, {U32.is_eq(x, i) == False{} : Bool}, TL.And({U32.is_eq(c, Q.Sq.none()) == False{} : Bool}, Laws.EqW(site, table, c, qus))>:
  match o:
    case Inl{n}:
      Inl{B.nt(U32.is_eq(x, i), n)}
    case Inr{+a}:
      Inr{Tuple{B.nt(U32.is_eq(c, Q.Sq.none()), B.l(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus), a)), Eq.s(site, table, c, qus, B.r(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus), a))}}

def Cov.s(+site: U32, +table: U32, +i: U32, dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, +e: {R.Gr.covers(site, table, i, dxs, qus) == True{} : Bool}) -> Laws.AllCov(site, table, i, dxs, qus):
  match dxs:
    case Nil{}:
      {==}
    case Con{Q.Dx{+x, +p, +c}, +rest}:
      Tuple{Cov.one(x, i, c, site, table, qus, L.Bool.or_true(Bool.not(U32.is_eq(x, i)), Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus)), B.l(Bool.or(Bool.not(U32.is_eq(x, i)), Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus))), R.Gr.covers(site, table, i, rest, qus), e))), Cov.s(site, table, i, rest, qus, B.r(Bool.or(Bool.not(U32.is_eq(x, i)), Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus))), R.Gr.covers(site, table, i, rest, qus), e))}

def Cov.onec(+x: U32, +i: U32, +c: U32, +site: U32, +table: U32, +qus: List<&2, Q.Qu>, w: Either<&2, &2, {U32.is_eq(x, i) == False{} : Bool}, TL.And({U32.is_eq(c, Q.Sq.none()) == False{} : Bool}, Laws.EqW(site, table, c, qus))>) -> {Bool.or(Bool.not(U32.is_eq(x, i)), Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus))) == True{} : Bool}:
  match w:
    case Inl{n}:
      B.ol(Bool.not(U32.is_eq(x, i)), Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus)), B.nf(U32.is_eq(x, i), n))
    case Inr{q}:
      match q:
        case Tuple{nc, ew}:
          B.or(Bool.not(U32.is_eq(x, i)), Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus)), B.tt(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus), B.nf(U32.is_eq(c, Q.Sq.none()), nc), Eq.from(site, table, c, qus, ew)))

def Cov.c(+site: U32, +table: U32, +i: U32, dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, w: Laws.AllCov(site, table, i, dxs, qus)) -> {R.Gr.covers(site, table, i, dxs, qus) == True{} : Bool}:
  match dxs:
    case Nil{}:
      {==}
    case Con{Q.Dx{+x, +p, +c}, +rest}:
      match w:
        case Tuple{w1, w2}:
          B.tt(Bool.or(Bool.not(U32.is_eq(x, i)), Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), R.Gr.eq(site, table, c, qus))), R.Gr.covers(site, table, i, rest, qus), Cov.onec(x, i, c, site, table, qus, w1), Cov.c(site, table, i, rest, qus, w2))

# ---- unique indexes ---------------------------------------------------------------------------
def Ux.k(+i: U32, +t: U32, +f: U32, +rest: List<&2, Q.Di>, +site: U32, +table: U32, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, o: Either<&2, &2, {Bool.and(U32.is_eq(t, table), Bool.and(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus)))) == True{} : Bool}, {R.Gr.uidx(site, table, rest, dxs, qus) == True{} : Bool}>, ih: {R.Gr.uidx(site, table, rest, dxs, qus) == True{} : Bool} -> TL.Ex(Q.Di, d => TL.And(Laws.MemDi(rest, d), Laws.UKeyAt(d, site, table, dxs, qus)))) -> TL.Ex(Q.Di, d => TL.And(Laws.MemDi(Con{Q.Di{i, t, f}, rest}, d), Laws.UKeyAt(d, site, table, dxs, qus))):
  match o:
    case Inl{+a}:
      +a2 = B.r(U32.is_eq(t, table), Bool.and(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus))), a)
      +a3 = B.r(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus)), a2)
      Tuple{Q.Di{i, t, f}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(t, table, B.l(U32.is_eq(t, table), Bool.and(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus))), a)), Tuple{B.l(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus)), a2), Tuple{B.nt(Q.Sq.bit(f, 2), B.l(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus), a3)), Cov.s(site, table, i, dxs, qus, B.r(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus), a3))}}}}}
    case Inr{m}:
      Lift.di(d => Laws.UKeyAt(d, site, table, dxs, qus), Q.Di{i, t, f}, rest, ih(m))

def Ux.s(+site: U32, +table: U32, dis: List<&2, Q.Di>, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, e: {R.Gr.uidx(site, table, dis, dxs, qus) == True{} : Bool}) -> TL.Ex(Q.Di, d => TL.And(Laws.MemDi(dis, d), Laws.UKeyAt(d, site, table, dxs, qus))):
  match dis:
    case Nil{}:
      Empty.absurd(TL.Ex(Q.Di, d => TL.And(Laws.MemDi(Nil{}, d), Laws.UKeyAt(d, site, table, dxs, qus))), L.Bool.ff_tt(e))
    case Con{Q.Di{+i, +t, +f}, +rest}:
      Ux.k(i, t, f, rest, site, table, dxs, qus, L.Bool.or_true(Bool.and(U32.is_eq(t, table), Bool.and(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus)))), R.Gr.uidx(site, table, rest, dxs, qus), e), q => Ux.s(site, table, rest, dxs, qus, q))

def Ux.hit(d: Q.Di, +rest: List<&2, Q.Di>, +site: U32, +table: U32, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, w: Laws.UKeyAt(d, site, table, dxs, qus)) -> {R.Gr.uidx(site, table, Con{d, rest}, dxs, qus) == True{} : Bool}:
  match d:
    case Q.Di{+i, +t, +f}:
      match w:
        case Tuple{et, q1}:
          match q1:
            case Tuple{e1, q2}:
              match q2:
                case Tuple{e2, ac}:
                  B.ol(Bool.and(U32.is_eq(t, table), Bool.and(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus)))), R.Gr.uidx(site, table, rest, dxs, qus), B.tt(U32.is_eq(t, table), Bool.and(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus))), U.eq_t(t, table, et), B.tt(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus)), e1, B.tt(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus), B.nf(Q.Sq.bit(f, 2), e2), Cov.c(site, table, i, dxs, qus, ac)))))

def Ux.stay(h: Q.Di, +rest: List<&2, Q.Di>, +site: U32, +table: U32, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, m: {R.Gr.uidx(site, table, rest, dxs, qus) == True{} : Bool}) -> {R.Gr.uidx(site, table, Con{h, rest}, dxs, qus) == True{} : Bool}:
  match h:
    case Q.Di{+i, +t, +f}:
      B.or(Bool.and(U32.is_eq(t, table), Bool.and(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), R.Gr.covers(site, table, i, dxs, qus)))), R.Gr.uidx(site, table, rest, dxs, qus), m)

def Ux.c(+site: U32, +table: U32, dis: List<&2, Q.Di>, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, +d: Q.Di, hm: Laws.MemDi(dis, d), w: Laws.UKeyAt(d, site, table, dxs, qus)) -> {R.Gr.uidx(site, table, dis, dxs, qus) == True{} : Bool}:
  match dis:
    case Nil{}:
      match hm:
    case Con{h, +rest}:
      match hm:
        case Inl{e}:
          %Equal.sym(Q.Di, h, d, e) : {R.Gr.uidx(site, table, Con{_, rest}, dxs, qus) == True{} : Bool}
          Ux.hit(d, rest, site, table, dxs, qus, w)
        case Inr{q}:
          Ux.stay(h, rest, site, table, dxs, qus, Ux.c(site, table, rest, dxs, qus, d, q, w))

def Ux.from(+site: U32, +table: U32, +dis: List<&2, Q.Di>, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, w: TL.Ex(Q.Di, d => TL.And(Laws.MemDi(dis, d), Laws.UKeyAt(d, site, table, dxs, qus)))) -> {R.Gr.uidx(site, table, dis, dxs, qus) == True{} : Bool}:
  match w:
    case Tuple{+d, q}:
      match q:
        case Tuple{md, ad}:
          Ux.c(site, table, dis, dxs, qus, d, md, ad)

# ---- primary key ------------------------------------------------------------------------------
def Hp.k(+t: U32, +c: U32, +p: U32, +f: U32, +rest: List<&2, Q.Dc>, +table: U32, o: Either<&2, &2, {Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)) == True{} : Bool}, {R.Gr.haspk(table, rest) == True{} : Bool}>, ih: {R.Gr.haspk(table, rest) == True{} : Bool} -> TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(rest, d), Laws.PkAt(d, table)))) -> TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(Con{Q.Dc{t, c, p, f}, rest}, d), Laws.PkAt(d, table))):
  match o:
    case Inl{+a}:
      Tuple{Q.Dc{t, c, p, f}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(t, table, B.l(U32.is_eq(t, table), Q.Sq.bit(f, 1), a)), B.r(U32.is_eq(t, table), Q.Sq.bit(f, 1), a)}}}
    case Inr{m}:
      Lift.dc(d => Laws.PkAt(d, table), Q.Dc{t, c, p, f}, rest, ih(m))

def Hp.s(+table: U32, dcs: List<&2, Q.Dc>, e: {R.Gr.haspk(table, dcs) == True{} : Bool}) -> TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(dcs, d), Laws.PkAt(d, table))):
  match dcs:
    case Nil{}:
      Empty.absurd(TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(Nil{}, d), Laws.PkAt(d, table))), L.Bool.ff_tt(e))
    case Con{Q.Dc{+t, +c, +p, +f}, +rest}:
      Hp.k(t, c, p, f, rest, table, L.Bool.or_true(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)), R.Gr.haspk(table, rest), e), q => Hp.s(table, rest, q))

def Hp.hit(d: Q.Dc, +rest: List<&2, Q.Dc>, +table: U32, w: Laws.PkAt(d, table)) -> {R.Gr.haspk(table, Con{d, rest}) == True{} : Bool}:
  match d:
    case Q.Dc{+t, +c, +p, +f}:
      match w:
        case Tuple{et, e1}:
          B.ol(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)), R.Gr.haspk(table, rest), B.tt(U32.is_eq(t, table), Q.Sq.bit(f, 1), U.eq_t(t, table, et), e1))

def Hp.stay(h: Q.Dc, +rest: List<&2, Q.Dc>, +table: U32, m: {R.Gr.haspk(table, rest) == True{} : Bool}) -> {R.Gr.haspk(table, Con{h, rest}) == True{} : Bool}:
  match h:
    case Q.Dc{+t, +c, +p, +f}:
      B.or(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)), R.Gr.haspk(table, rest), m)

def Hp.c(+table: U32, dcs: List<&2, Q.Dc>, +d: Q.Dc, hm: Laws.MemDc(dcs, d), w: Laws.PkAt(d, table)) -> {R.Gr.haspk(table, dcs) == True{} : Bool}:
  match dcs:
    case Nil{}:
      match hm:
    case Con{h, +rest}:
      match hm:
        case Inl{e}:
          %Equal.sym(Q.Dc, h, d, e) : {R.Gr.haspk(table, Con{_, rest}) == True{} : Bool}
          Hp.hit(d, rest, table, w)
        case Inr{q}:
          Hp.stay(h, rest, table, Hp.c(table, rest, d, q, w))

def Hp.from(+table: U32, +dcs: List<&2, Q.Dc>, w: TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(dcs, d), Laws.PkAt(d, table)))) -> {R.Gr.haspk(table, dcs) == True{} : Bool}:
  match w:
    case Tuple{+d, q}:
      match q:
        case Tuple{md, ad}:
          Hp.c(table, dcs, d, md, ad)

def Pa.one(+t: U32, +c: U32, +f: U32, +site: U32, +table: U32, +qus: List<&2, Q.Qu>, o: Either<&2, &2, {Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))) == True{} : Bool}, {R.Gr.eq(site, table, c, qus) == True{} : Bool}>) -> Either<&2, &2, {Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)) == False{} : Bool}, Laws.EqW(site, table, c, qus)>:
  match o:
    case Inl{n}:
      Inl{B.nt(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)), n)}
    case Inr{a}:
      Inr{Eq.s(site, table, c, qus, a)}

def Pa.s(+site: U32, +table: U32, dcs: List<&2, Q.Dc>, +qus: List<&2, Q.Qu>, +e: {R.Gr.pkcov(site, table, dcs, qus) == True{} : Bool}) -> Laws.PkAll(site, table, dcs, qus):
  match dcs:
    case Nil{}:
      {==}
    case Con{Q.Dc{+t, +c, +p, +f}, +rest}:
      Tuple{Pa.one(t, c, f, site, table, qus, L.Bool.or_true(Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))), R.Gr.eq(site, table, c, qus), B.l(Bool.or(Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))), R.Gr.eq(site, table, c, qus)), R.Gr.pkcov(site, table, rest, qus), e))), Pa.s(site, table, rest, qus, B.r(Bool.or(Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))), R.Gr.eq(site, table, c, qus)), R.Gr.pkcov(site, table, rest, qus), e))}

def Pa.onec(+t: U32, +c: U32, +f: U32, +site: U32, +table: U32, +qus: List<&2, Q.Qu>, w: Either<&2, &2, {Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)) == False{} : Bool}, Laws.EqW(site, table, c, qus)>) -> {Bool.or(Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))), R.Gr.eq(site, table, c, qus)) == True{} : Bool}:
  match w:
    case Inl{n}:
      B.ol(Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))), R.Gr.eq(site, table, c, qus), B.nf(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)), n))
    case Inr{ew}:
      B.or(Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))), R.Gr.eq(site, table, c, qus), Eq.from(site, table, c, qus, ew))

def Pa.c(+site: U32, +table: U32, dcs: List<&2, Q.Dc>, +qus: List<&2, Q.Qu>, w: Laws.PkAll(site, table, dcs, qus)) -> {R.Gr.pkcov(site, table, dcs, qus) == True{} : Bool}:
  match dcs:
    case Nil{}:
      {==}
    case Con{Q.Dc{+t, +c, +p, +f}, +rest}:
      match w:
        case Tuple{w1, w2}:
          B.tt(Bool.or(Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))), R.Gr.eq(site, table, c, qus)), R.Gr.pkcov(site, table, rest, qus), Pa.onec(t, c, f, site, table, qus, w1), Pa.c(site, table, rest, qus, w2))

# ---- unique columns ---------------------------------------------------------------------------
def Uf.s(+f: U32, o: Either<&2, &2, {Q.Sq.bit(f, 4) == True{} : Bool}, {Q.Sq.bit(f, 32) == True{} : Bool}>) -> Either<&2, &2, {Q.Sq.bit(f, 4) == True{} : Bool}, {Q.Sq.bit(f, 32) == True{} : Bool}>:
  o

def Uc.k(+t: U32, +c: U32, +p: U32, +f: U32, +rest: List<&2, Q.Dc>, +site: U32, +table: U32, +qus: List<&2, Q.Qu>, o: Either<&2, &2, {Bool.and(U32.is_eq(t, table), Bool.and(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus))) == True{} : Bool}, {R.Gr.ucol(site, table, rest, qus) == True{} : Bool}>, ih: {R.Gr.ucol(site, table, rest, qus) == True{} : Bool} -> TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(rest, d), Laws.UColAt(d, site, table, qus)))) -> TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(Con{Q.Dc{t, c, p, f}, rest}, d), Laws.UColAt(d, site, table, qus))):
  match o:
    case Inl{+a}:
      +a2 = B.r(U32.is_eq(t, table), Bool.and(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus)), a)
      Tuple{Q.Dc{t, c, p, f}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(t, table, B.l(U32.is_eq(t, table), Bool.and(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus)), a)), Tuple{L.Bool.or_true(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32), B.l(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus), a2)), Eq.s(site, table, c, qus, B.r(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus), a2))}}}}
    case Inr{m}:
      Lift.dc(d => Laws.UColAt(d, site, table, qus), Q.Dc{t, c, p, f}, rest, ih(m))

def Uc.s(+site: U32, +table: U32, dcs: List<&2, Q.Dc>, +qus: List<&2, Q.Qu>, e: {R.Gr.ucol(site, table, dcs, qus) == True{} : Bool}) -> TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(dcs, d), Laws.UColAt(d, site, table, qus))):
  match dcs:
    case Nil{}:
      Empty.absurd(TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(Nil{}, d), Laws.UColAt(d, site, table, qus))), L.Bool.ff_tt(e))
    case Con{Q.Dc{+t, +c, +p, +f}, +rest}:
      Uc.k(t, c, p, f, rest, site, table, qus, L.Bool.or_true(Bool.and(U32.is_eq(t, table), Bool.and(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus))), R.Gr.ucol(site, table, rest, qus), e), q => Uc.s(site, table, rest, qus, q))

def Uc.bits(+f: U32, w: Either<&2, &2, {Q.Sq.bit(f, 4) == True{} : Bool}, {Q.Sq.bit(f, 32) == True{} : Bool}>) -> {Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)) == True{} : Bool}:
  match w:
    case Inl{e}:
      B.ol(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32), e)
    case Inr{e}:
      B.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32), e)

def Uc.hit(d: Q.Dc, +rest: List<&2, Q.Dc>, +site: U32, +table: U32, +qus: List<&2, Q.Qu>, w: Laws.UColAt(d, site, table, qus)) -> {R.Gr.ucol(site, table, Con{d, rest}, qus) == True{} : Bool}:
  match d:
    case Q.Dc{+t, +c, +p, +f}:
      match w:
        case Tuple{et, q1}:
          match q1:
            case Tuple{wb, ew}:
              B.ol(Bool.and(U32.is_eq(t, table), Bool.and(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus))), R.Gr.ucol(site, table, rest, qus), B.tt(U32.is_eq(t, table), Bool.and(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus)), U.eq_t(t, table, et), B.tt(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus), Uc.bits(f, wb), Eq.from(site, table, c, qus, ew))))

def Uc.stay(h: Q.Dc, +rest: List<&2, Q.Dc>, +site: U32, +table: U32, +qus: List<&2, Q.Qu>, m: {R.Gr.ucol(site, table, rest, qus) == True{} : Bool}) -> {R.Gr.ucol(site, table, Con{h, rest}, qus) == True{} : Bool}:
  match h:
    case Q.Dc{+t, +c, +p, +f}:
      B.or(Bool.and(U32.is_eq(t, table), Bool.and(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), R.Gr.eq(site, table, c, qus))), R.Gr.ucol(site, table, rest, qus), m)

def Uc.c(+site: U32, +table: U32, dcs: List<&2, Q.Dc>, +qus: List<&2, Q.Qu>, +d: Q.Dc, hm: Laws.MemDc(dcs, d), w: Laws.UColAt(d, site, table, qus)) -> {R.Gr.ucol(site, table, dcs, qus) == True{} : Bool}:
  match dcs:
    case Nil{}:
      match hm:
    case Con{h, +rest}:
      match hm:
        case Inl{e}:
          %Equal.sym(Q.Dc, h, d, e) : {R.Gr.ucol(site, table, Con{_, rest}, qus) == True{} : Bool}
          Uc.hit(d, rest, site, table, qus, w)
        case Inr{q}:
          Uc.stay(h, rest, site, table, qus, Uc.c(site, table, rest, qus, d, q, w))

def Uc.from(+site: U32, +table: U32, +dcs: List<&2, Q.Dc>, +qus: List<&2, Q.Qu>, w: TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(dcs, d), Laws.UColAt(d, site, table, qus)))) -> {R.Gr.ucol(site, table, dcs, qus) == True{} : Bool}:
  match w:
    case Tuple{+d, q}:
      match q:
        case Tuple{md, ad}:
          Uc.c(site, table, dcs, qus, d, md, ad)

# ---- keyed ------------------------------------------------------------------------------------
def Ky.s2(+site: U32, +table: U32, +dcs: List<&2, Q.Dc>, +dis: List<&2, Q.Di>, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, o: Either<&2, &2, {Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)) == True{} : Bool}, {R.Gr.ucol(site, table, dcs, qus) == True{} : Bool}>) -> Either<&2, &2, TL.Ex(Q.Di, d => TL.And(Laws.MemDi(dis, d), Laws.UKeyAt(d, site, table, dxs, qus))), Either<&2, &2, TL.And(TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(dcs, d), Laws.PkAt(d, table))), Laws.PkAll(site, table, dcs, qus)), TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(dcs, d), Laws.UColAt(d, site, table, qus)))>>:
  match o:
    case Inl{+a}:
      Inr{Inl{Tuple{Hp.s(table, dcs, B.l(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus), a)), Pa.s(site, table, dcs, qus, B.r(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus), a))}}}
    case Inr{b}:
      Inr{Inr{Uc.s(site, table, dcs, qus, b)}}

def Ky.s(+site: U32, +table: U32, +dcs: List<&2, Q.Dc>, +dis: List<&2, Q.Di>, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>, o: Either<&2, &2, {R.Gr.uidx(site, table, dis, dxs, qus) == True{} : Bool}, {Bool.or(Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)), R.Gr.ucol(site, table, dcs, qus)) == True{} : Bool}>) -> Either<&2, &2, TL.Ex(Q.Di, d => TL.And(Laws.MemDi(dis, d), Laws.UKeyAt(d, site, table, dxs, qus))), Either<&2, &2, TL.And(TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(dcs, d), Laws.PkAt(d, table))), Laws.PkAll(site, table, dcs, qus)), TL.Ex(Q.Dc, d => TL.And(Laws.MemDc(dcs, d), Laws.UColAt(d, site, table, qus)))>>:
  match o:
    case Inl{a}:
      Inl{Ux.s(site, table, dis, dxs, qus, a)}
    case Inr{b}:
      Ky.s2(site, table, dcs, dis, dxs, qus, L.Bool.or_true(Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)), R.Gr.ucol(site, table, dcs, qus), b))

def Laws.gr_keyed_sound(site, table, s, qus, e):
  match s:
    case Q.Schema{+ok, +sk, +dts, +dcs, +dis, +dxs, +dfs, +dgs}:
      Ky.s(site, table, dcs, dis, dxs, qus, L.Bool.or_true(R.Gr.uidx(site, table, dis, dxs, qus), Bool.or(Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)), R.Gr.ucol(site, table, dcs, qus)), e))

def Laws.gr_keyed_complete(site, table, s, qus, w):
  match s:
    case Q.Schema{+ok, +sk, +dts, +dcs, +dis, +dxs, +dfs, +dgs}:
      match w:
        case Inl{a}:
          B.ol(R.Gr.uidx(site, table, dis, dxs, qus), Bool.or(Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)), R.Gr.ucol(site, table, dcs, qus)), Ux.from(site, table, dis, dxs, qus, a))
        case Inr{b}:
          match b:
            case Inl{p}:
              match p:
                case Tuple{hp, pa}:
                  B.or(R.Gr.uidx(site, table, dis, dxs, qus), Bool.or(Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)), R.Gr.ucol(site, table, dcs, qus)), B.ol(Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)), R.Gr.ucol(site, table, dcs, qus), B.tt(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus), Hp.from(table, dcs, hp), Pa.c(site, table, dcs, qus, pa))))
            case Inr{u}:
              B.or(R.Gr.uidx(site, table, dis, dxs, qus), Bool.or(Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)), R.Gr.ucol(site, table, dcs, qus)), B.or(Bool.and(R.Gr.haspk(table, dcs), R.Gr.pkcov(site, table, dcs, qus)), R.Gr.ucol(site, table, dcs, qus), Uc.from(site, table, dcs, qus, u)))

# ---- the read ---------------------------------------------------------------------------------
def Se.k(+s: U32, +file: U32, +fn: U32, +node: U32, +kind: U32, +flags: U32, +rest: List<&2, Q.Qs>, +site: U32, o: Either<&2, &2, {Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1)))) == True{} : Bool}, {R.Gr.sel(site, rest) == True{} : Bool}>, ih: {R.Gr.sel(site, rest) == True{} : Bool} -> TL.Ex(Q.Qs, x => TL.And(QL.MemQs(rest, x), Laws.SelAt(x, site)))) -> TL.Ex(Q.Qs, x => TL.And(QL.MemQs(Con{Q.Qs{s, file, fn, node, kind, flags}, rest}, x), Laws.SelAt(x, site))):
  match o:
    case Inl{+a}:
      +a2 = B.r(U32.is_eq(s, site), Bool.and(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1))), a)
      Tuple{Q.Qs{s, file, fn, node, kind, flags}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(s, site, B.l(U32.is_eq(s, site), Bool.and(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1))), a)), Tuple{L.U32.eq_sound(kind, 1, B.l(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1)), a2)), B.nt(Q.Sq.bit(flags, 1), B.r(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1)), a2))}}}}
    case Inr{m}:
      Lift.qs(x => Laws.SelAt(x, site), Q.Qs{s, file, fn, node, kind, flags}, rest, ih(m))

def Se.s(+site: U32, qs: List<&2, Q.Qs>, e: {R.Gr.sel(site, qs) == True{} : Bool}) -> TL.Ex(Q.Qs, x => TL.And(QL.MemQs(qs, x), Laws.SelAt(x, site))):
  match qs:
    case Nil{}:
      Empty.absurd(TL.Ex(Q.Qs, x => TL.And(QL.MemQs(Nil{}, x), Laws.SelAt(x, site))), L.Bool.ff_tt(e))
    case Con{Q.Qs{+s, +file, +fn, +node, +kind, +flags}, +rest}:
      Se.k(s, file, fn, node, kind, flags, rest, site, L.Bool.or_true(Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1)))), R.Gr.sel(site, rest), e), q => Se.s(site, rest, q))

def Laws.gr_sel_sound(site, qs, e):
  Se.s(site, qs, e)

def Se.hit(x: Q.Qs, +rest: List<&2, Q.Qs>, +site: U32, w: Laws.SelAt(x, site)) -> {R.Gr.sel(site, Con{x, rest}) == True{} : Bool}:
  match x:
    case Q.Qs{+s, +file, +fn, +node, +kind, +flags}:
      match w:
        case Tuple{es, q1}:
          match q1:
            case Tuple{ek, ef}:
              B.ol(Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1)))), R.Gr.sel(site, rest), B.tt(U32.is_eq(s, site), Bool.and(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1))), U.eq_t(s, site, es), B.tt(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1)), U.eq_t(kind, 1, ek), B.nf(Q.Sq.bit(flags, 1), ef))))

def Se.stay(h: Q.Qs, +rest: List<&2, Q.Qs>, +site: U32, m: {R.Gr.sel(site, rest) == True{} : Bool}) -> {R.Gr.sel(site, Con{h, rest}) == True{} : Bool}:
  match h:
    case Q.Qs{+s, +file, +fn, +node, +kind, +flags}:
      B.or(Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1)))), R.Gr.sel(site, rest), m)

def Se.c(+site: U32, qs: List<&2, Q.Qs>, +x: Q.Qs, hm: QL.MemQs(qs, x), w: Laws.SelAt(x, site)) -> {R.Gr.sel(site, qs) == True{} : Bool}:
  match qs:
    case Nil{}:
      match hm:
    case Con{h, +rest}:
      match hm:
        case Inl{e}:
          %Equal.sym(Q.Qs, h, x, e) : {R.Gr.sel(site, Con{_, rest}) == True{} : Bool}
          Se.hit(x, rest, site, w)
        case Inr{q}:
          Se.stay(h, rest, site, Se.c(site, rest, x, q, w))

def Laws.gr_sel_complete(site, qs, w):
  match w:
    case Tuple{+x, q}:
      match q:
        case Tuple{mx, ax}:
          Se.c(site, qs, x, mx, ax)

# ---- the hot insert ---------------------------------------------------------------------------
def Hw.k(+s: U32, +file: U32, +fn: U32, +node: U32, +kind: U32, +flags: U32, +rest: List<&2, Q.Qs>, +site: U32, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, o: Either<&2, &2, {Bool.and(U32.is_eq(s, site), S.Scope.has(R.Gr.hset(eps, ces, depth), fn)) == True{} : Bool}, {R.Gr.hotw(site, rest, R.Gr.hset(eps, ces, depth)) == True{} : Bool}>, ih: {R.Gr.hotw(site, rest, R.Gr.hset(eps, ces, depth)) == True{} : Bool} -> TL.Ex(Q.Qs, x => TL.And(QL.MemQs(rest, x), Laws.HotAt(x, site, eps, ces, depth)))) -> TL.Ex(Q.Qs, x => TL.And(QL.MemQs(Con{Q.Qs{s, file, fn, node, kind, flags}, rest}, x), Laws.HotAt(x, site, eps, ces, depth))):
  match o:
    case Inl{+a}:
      Tuple{Q.Qs{s, file, fn, node, kind, flags}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(s, site, B.l(U32.is_eq(s, site), S.Scope.has(R.Gr.hset(eps, ces, depth), fn), a)), HL.ho_reach_sound(U32.to_nat(depth), eps, ces, fn, SL.scope_set_sound(H.Ho.reach(U32.to_nat(depth), ces, H.Ho.seed(eps)), fn, B.r(U32.is_eq(s, site), S.Scope.has(R.Gr.hset(eps, ces, depth), fn), a)))}}}
    case Inr{m}:
      Lift.qs(x => Laws.HotAt(x, site, eps, ces, depth), Q.Qs{s, file, fn, node, kind, flags}, rest, ih(m))

def Hw.s(+site: U32, qs: List<&2, Q.Qs>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, e: {R.Gr.hotw(site, qs, R.Gr.hset(eps, ces, depth)) == True{} : Bool}) -> TL.Ex(Q.Qs, x => TL.And(QL.MemQs(qs, x), Laws.HotAt(x, site, eps, ces, depth))):
  match qs:
    case Nil{}:
      Empty.absurd(TL.Ex(Q.Qs, x => TL.And(QL.MemQs(Nil{}, x), Laws.HotAt(x, site, eps, ces, depth))), L.Bool.ff_tt(e))
    case Con{Q.Qs{+s, +file, +fn, +node, +kind, +flags}, +rest}:
      Hw.k(s, file, fn, node, kind, flags, rest, site, eps, ces, depth, L.Bool.or_true(Bool.and(U32.is_eq(s, site), S.Scope.has(R.Gr.hset(eps, ces, depth), fn)), R.Gr.hotw(site, rest, R.Gr.hset(eps, ces, depth)), e), q => Hw.s(site, rest, eps, ces, depth, q))

def Laws.gr_hot_sound(site, qs, eps, ces, depth, e):
  Hw.s(site, qs, eps, ces, depth, e)

def Hw.hit(x: Q.Qs, +rest: List<&2, Q.Qs>, +site: U32, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, w: Laws.HotAt(x, site, eps, ces, depth)) -> {R.Gr.hotw(site, Con{x, rest}, R.Gr.hset(eps, ces, depth)) == True{} : Bool}:
  match x:
    case Q.Qs{+s, +file, +fn, +node, +kind, +flags}:
      match w:
        case Tuple{es, hr}:
          B.ol(Bool.and(U32.is_eq(s, site), S.Scope.has(R.Gr.hset(eps, ces, depth), fn)), R.Gr.hotw(site, rest, R.Gr.hset(eps, ces, depth)), B.tt(U32.is_eq(s, site), S.Scope.has(R.Gr.hset(eps, ces, depth), fn), U.eq_t(s, site, es), SL.scope_set_complete(H.Ho.reach(U32.to_nat(depth), ces, H.Ho.seed(eps)), fn, HL.ho_reach_complete(U32.to_nat(depth), eps, ces, fn, hr))))

def Hw.stay(h: Q.Qs, +rest: List<&2, Q.Qs>, +site: U32, +hset: G.Tr, m: {R.Gr.hotw(site, rest, hset) == True{} : Bool}) -> {R.Gr.hotw(site, Con{h, rest}, hset) == True{} : Bool}:
  match h:
    case Q.Qs{+s, +file, +fn, +node, +kind, +flags}:
      B.or(Bool.and(U32.is_eq(s, site), S.Scope.has(hset, fn)), R.Gr.hotw(site, rest, hset), m)

def Hw.c(+site: U32, qs: List<&2, Q.Qs>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +x: Q.Qs, hm: QL.MemQs(qs, x), w: Laws.HotAt(x, site, eps, ces, depth)) -> {R.Gr.hotw(site, qs, R.Gr.hset(eps, ces, depth)) == True{} : Bool}:
  match qs:
    case Nil{}:
      match hm:
    case Con{h, +rest}:
      match hm:
        case Inl{e}:
          %Equal.sym(Q.Qs, h, x, e) : {R.Gr.hotw(site, Con{_, rest}, R.Gr.hset(eps, ces, depth)) == True{} : Bool}
          Hw.hit(x, rest, site, eps, ces, depth, w)
        case Inr{q}:
          Hw.stay(h, rest, site, R.Gr.hset(eps, ces, depth), Hw.c(site, rest, eps, ces, depth, x, q, w))

def Laws.gr_hot_complete(site, qs, eps, ces, depth, w):
  match w:
    case Tuple{+x, q}:
      match q:
        case Tuple{mx, ax}:
          Hw.c(site, qs, eps, ces, depth, x, mx, ax)

# ---- unbounded --------------------------------------------------------------------------------
def Laws.gr_unb_complete(s, qs, qus, rs, table, ec, eb, es, ek):
  B.tt(Q.Sq.complete(s), Bool.and(R.Gr.base(table, s), Bool.and(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus)))), ec, B.tt(R.Gr.base(table, s), Bool.and(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus))), eb, B.tt(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus)), es, B.nf(R.Gr.keyed(rs, table, s, qus), ek))))

def Un.m(+s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +rs: U32, +table: U32, +e: {R.Gr.unb(s, qs, qus, rs, table) == True{} : Bool}) -> TL.And({Q.Sq.complete(s) == True{} : Bool}, TL.And({R.Gr.base(table, s) == True{} : Bool}, TL.And({R.Gr.sel(rs, qs) == True{} : Bool}, {R.Gr.keyed(rs, table, s, qus) == False{} : Bool}))):
  +e1 = B.r(Q.Sq.complete(s), Bool.and(R.Gr.base(table, s), Bool.and(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus)))), e)
  +e2 = B.r(R.Gr.base(table, s), Bool.and(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus))), e1)
  Tuple{B.l(Q.Sq.complete(s), Bool.and(R.Gr.base(table, s), Bool.and(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus)))), e), Tuple{B.l(R.Gr.base(table, s), Bool.and(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus))), e1), Tuple{B.l(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus)), e2), B.nt(R.Gr.keyed(rs, table, s, qus), B.r(R.Gr.sel(rs, qs), Bool.not(R.Gr.keyed(rs, table, s, qus)), e2))}}}

def Laws.gr_unb_means(s, qs, qus, rs, table, e):
  Un.m(s, qs, qus, rs, table, e)

# ---- finding lists ----------------------------------------------------------------------------
def GP.mem(b: Bool, +x: R.Gx, +rest: List<&2, R.Gx>, +y: R.Gx, h: Laws.MemGx(R.Gr.push(b, x, rest), y)) -> Either<&2, &2, TL.And({b == True{} : Bool}, {x == y : R.Gx}), Laws.MemGx(rest, y)>:
  match b:
    case True{}:
      match h:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{q}:
          Inr{q}
    case False{}:
      Inr{h}

def GP.hit(b: Bool, +x: R.Gx, +rest: List<&2, R.Gx>, hb: {b == True{} : Bool}) -> Laws.MemGx(R.Gr.push(b, x, rest), x):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemGx(R.Gr.push(_, x, rest), x)
  Inl{{==}}

def GP.stay(b: Bool, +x: R.Gx, +rest: List<&2, R.Gx>, +y: R.Gx, h: Laws.MemGx(rest, y)) -> Laws.MemGx(R.Gr.push(b, x, rest), y):
  match b:
    case True{}:
      Inr{h}
    case False{}:
      h

def AX.sh(+a: R.Gx, +t: List<&2, R.Gx>, +ys: List<&2, R.Gx>, +y: R.Gx, o: Either<&2, &2, Laws.MemGx(t, y), Laws.MemGx(ys, y)>) -> Either<&2, &2, Laws.MemGx(Con{a, t}, y), Laws.MemGx(ys, y)>:
  match o:
    case Inl{m}:
      Inl{Inr{m}}
    case Inr{m}:
      Inr{m}

def AX.split(xs: List<&2, R.Gx>, +ys: List<&2, R.Gx>, +y: R.Gx, h: Laws.MemGx(List.append(&2, R.Gx, xs, ys), y)) -> Either<&2, &2, Laws.MemGx(xs, y), Laws.MemGx(ys, y)>:
  match xs:
    case Nil{}:
      Inr{h}
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{Inl{e}}
        case Inr{q}:
          AX.sh(a, t, ys, y, AX.split(t, ys, y, q))

def AX.l(xs: List<&2, R.Gx>, +ys: List<&2, R.Gx>, +y: R.Gx, h: Laws.MemGx(xs, y)) -> Laws.MemGx(List.append(&2, R.Gx, xs, ys), y):
  match xs:
    case Nil{}:
      Empty.absurd(Laws.MemGx(ys, y), h)
    case Con{+a, +t}:
      match h:
        case Inl{e}:
          Inl{e}
        case Inr{q}:
          Inr{AX.l(t, ys, y, q)}

def AX.r(xs: List<&2, R.Gx>, +ys: List<&2, R.Gx>, +y: R.Gx, h: Laws.MemGx(ys, y)) -> Laws.MemGx(List.append(&2, R.Gx, xs, ys), y):
  match xs:
    case Nil{}:
      h
    case Con{+a, +t}:
      Inr{AX.r(t, ys, y, h)}

def When.s(b: Bool, +xs: List<&2, R.Gx>, +y: R.Gx, m: Laws.MemGx(R.Gr.when(b, xs), y)) -> TL.And({b == True{} : Bool}, Laws.MemGx(xs, y)):
  match b:
    case True{}:
      Tuple{{==}, m}
    case False{}:
      Empty.absurd(TL.And({False{} == True{} : Bool}, Laws.MemGx(xs, y)), m)

def When.hit(b: Bool, +xs: List<&2, R.Gx>, +y: R.Gx, hb: {b == True{} : Bool}, m: Laws.MemGx(xs, y)) -> Laws.MemGx(R.Gr.when(b, xs), y):
  %Equal.sym(Bool, b, True{}, hb) : Laws.MemGx(R.Gr.when(_, xs), y)
  m

# ---- the inserts for one read: sound and complete ---------------------------------------------
def WAt(b: Q.Qt, +qs: List<&2, Q.Qs>, +hset: G.Tr, +r: U32, +rs: U32, +table: U32, +y: R.Gx) -> Data:
  match b:
    case Q.Qt{ws, tb, mb}:
      TL.And({tb == table : U32}, TL.And({mb == 2 : U32}, TL.And({R.Gr.hotw(ws, qs, hset) == True{} : Bool}, {R.Gx{r, rs, table, ws} == y : R.Gx})))

def Ws.k(+ws: U32, +t: U32, +mode: U32, +rest: List<&2, Q.Qt>, +qs: List<&2, Q.Qs>, +hset: G.Tr, +r: U32, +rs: U32, +table: U32, +y: R.Gx, o: Either<&2, &2, TL.And({Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(mode, 2), R.Gr.hotw(ws, qs, hset))) == True{} : Bool}, {R.Gx{r, rs, table, ws} == y : R.Gx}), Laws.MemGx(R.Gr.ws(rest, qs, hset, r, rs, table), y)>, ih: Laws.MemGx(R.Gr.ws(rest, qs, hset, r, rs, table), y) -> TL.Ex(Q.Qt, b => TL.And(QL.MemQt(rest, b), WAt(b, qs, hset, r, rs, table, y)))) -> TL.Ex(Q.Qt, b => TL.And(QL.MemQt(Con{Q.Qt{ws, t, mode}, rest}, b), WAt(b, qs, hset, r, rs, table, y))):
  match o:
    case Inl{q}:
      match q:
        case Tuple{+eb, ex}:
          +e2 = B.r(U32.is_eq(t, table), Bool.and(U32.is_eq(mode, 2), R.Gr.hotw(ws, qs, hset)), eb)
          Tuple{Q.Qt{ws, t, mode}, Tuple{Inl{{==}}, Tuple{L.U32.eq_sound(t, table, B.l(U32.is_eq(t, table), Bool.and(U32.is_eq(mode, 2), R.Gr.hotw(ws, qs, hset)), eb)), Tuple{L.U32.eq_sound(mode, 2, B.l(U32.is_eq(mode, 2), R.Gr.hotw(ws, qs, hset), e2)), Tuple{B.r(U32.is_eq(mode, 2), R.Gr.hotw(ws, qs, hset), e2), ex}}}}}
    case Inr{m}:
      Lift.qt(b => WAt(b, qs, hset, r, rs, table, y), Q.Qt{ws, t, mode}, rest, ih(m))

def Ws.s(qts: List<&2, Q.Qt>, +qs: List<&2, Q.Qs>, +hset: G.Tr, +r: U32, +rs: U32, +table: U32, +y: R.Gx, h: Laws.MemGx(R.Gr.ws(qts, qs, hset, r, rs, table), y)) -> TL.Ex(Q.Qt, b => TL.And(QL.MemQt(qts, b), WAt(b, qs, hset, r, rs, table, y))):
  match qts:
    case Nil{}:
      match h:
    case Con{Q.Qt{+ws, +t, +mode}, +rest}:
      Ws.k(ws, t, mode, rest, qs, hset, r, rs, table, y, GP.mem(Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(mode, 2), R.Gr.hotw(ws, qs, hset))), R.Gx{r, rs, table, ws}, R.Gr.ws(rest, qs, hset, r, rs, table), y, h), q => Ws.s(rest, qs, hset, r, rs, table, y, q))

def Ws.hit(b: Q.Qt, +rest: List<&2, Q.Qt>, +qs: List<&2, Q.Qs>, +hset: G.Tr, +r: U32, +rs: U32, +table: U32, +y: R.Gx, w: WAt(b, qs, hset, r, rs, table, y)) -> Laws.MemGx(R.Gr.ws(Con{b, rest}, qs, hset, r, rs, table), y):
  match b:
    case Q.Qt{+ws, +tb, +mb}:
      match w:
        case Tuple{et, q1}:
          match q1:
            case Tuple{em, q2}:
              match q2:
                case Tuple{eh, ey}:
                  %ey : Laws.MemGx(R.Gr.ws(Con{Q.Qt{ws, tb, mb}, rest}, qs, hset, r, rs, table), _)
                  GP.hit(Bool.and(U32.is_eq(tb, table), Bool.and(U32.is_eq(mb, 2), R.Gr.hotw(ws, qs, hset))), R.Gx{r, rs, table, ws}, R.Gr.ws(rest, qs, hset, r, rs, table), B.tt(U32.is_eq(tb, table), Bool.and(U32.is_eq(mb, 2), R.Gr.hotw(ws, qs, hset)), U.eq_t(tb, table, et), B.tt(U32.is_eq(mb, 2), R.Gr.hotw(ws, qs, hset), U.eq_t(mb, 2, em), eh)))

def Ws.stay(h: Q.Qt, +rest: List<&2, Q.Qt>, +qs: List<&2, Q.Qs>, +hset: G.Tr, +r: U32, +rs: U32, +table: U32, +y: R.Gx, m: Laws.MemGx(R.Gr.ws(rest, qs, hset, r, rs, table), y)) -> Laws.MemGx(R.Gr.ws(Con{h, rest}, qs, hset, r, rs, table), y):
  match h:
    case Q.Qt{+ws, +t, +mode}:
      GP.stay(Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(mode, 2), R.Gr.hotw(ws, qs, hset))), R.Gx{r, rs, table, ws}, R.Gr.ws(rest, qs, hset, r, rs, table), y, m)

def Ws.c(qts: List<&2, Q.Qt>, +qs: List<&2, Q.Qs>, +hset: G.Tr, +r: U32, +rs: U32, +table: U32, +y: R.Gx, +b: Q.Qt, hb: QL.MemQt(qts, b), w: WAt(b, qs, hset, r, rs, table, y)) -> Laws.MemGx(R.Gr.ws(qts, qs, hset, r, rs, table), y):
  match qts:
    case Nil{}:
      match hb:
    case Con{h, +rest}:
      match hb:
        case Inl{e}:
          %Equal.sym(Q.Qt, h, b, e) : Laws.MemGx(R.Gr.ws(Con{_, rest}, qs, hset, r, rs, table), y)
          Ws.hit(b, rest, qs, hset, r, rs, table, y, w)
        case Inr{q}:
          Ws.stay(h, rest, qs, hset, r, rs, table, y, Ws.c(rest, qs, hset, r, rs, table, y, b, q, w))

# ---- the reads of one rule row ----------------------------------------------------------------
def Rd.pk(b: Q.Qt, +rs: U32, +t: U32, +ma: U32, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +r: U32, +y: R.Gx, mb: QL.MemQt(all, b), e1: {ma == 1 : U32}, eu: {R.Gr.unb(s, qs, qus, rs, t) == True{} : Bool}, wb: WAt(b, qs, R.Gr.hset(eps, ces, depth), r, rs, t, y)) -> TL.Ex(Q.Qt, x => TL.And(QL.MemQt(all, x), Laws.GPair(R.Rg{r, depth}, Q.Qt{rs, t, ma}, x, s, qs, qus, eps, ces, y))):
  match b:
    case Q.Qt{+ws, +tb, +mb2}:
      Tuple{Q.Qt{ws, tb, mb2}, Tuple{mb, Tuple{e1, Tuple{eu, wb}}}}

def Rd.w(+rs: U32, +t: U32, +ma: U32, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +r: U32, +y: R.Gx, e1: {ma == 1 : U32}, eu: {R.Gr.unb(s, qs, qus, rs, t) == True{} : Bool}, wx: TL.Ex(Q.Qt, b => TL.And(QL.MemQt(all, b), WAt(b, qs, R.Gr.hset(eps, ces, depth), r, rs, t, y)))) -> TL.Ex(Q.Qt, x => TL.And(QL.MemQt(all, x), Laws.GPair(R.Rg{r, depth}, Q.Qt{rs, t, ma}, x, s, qs, qus, eps, ces, y))):
  match wx:
    case Tuple{b, q}:
      match q:
        case Tuple{mb, wb}:
          Rd.pk(b, rs, t, ma, all, s, qs, qus, eps, ces, depth, r, y, mb, e1, eu, wb)

def Rd.wh(+rs: U32, +t: U32, +mode: U32, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +r: U32, +y: R.Gx, p: TL.And({Bool.and(U32.is_eq(mode, 1), R.Gr.unb(s, qs, qus, rs, t)) == True{} : Bool}, Laws.MemGx(R.Gr.ws(all, qs, R.Gr.hset(eps, ces, depth), r, rs, t), y))) -> TL.Ex(Q.Qt, x => TL.And(QL.MemQt(all, x), Laws.GPair(R.Rg{r, depth}, Q.Qt{rs, t, mode}, x, s, qs, qus, eps, ces, y))):
  match p:
    case Tuple{+eb, mw}:
      Rd.w(rs, t, mode, all, s, qs, qus, eps, ces, depth, r, y, L.U32.eq_sound(mode, 1, B.l(U32.is_eq(mode, 1), R.Gr.unb(s, qs, qus, rs, t), eb)), B.r(U32.is_eq(mode, 1), R.Gr.unb(s, qs, qus, rs, t), eb), Ws.s(all, qs, R.Gr.hset(eps, ces, depth), r, rs, t, y, mw))

def Rd.k(+rs: U32, +t: U32, +mode: U32, +rest: List<&2, Q.Qt>, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +r: U32, +y: R.Gx, o: Either<&2, &2, Laws.MemGx(R.Gr.when(Bool.and(U32.is_eq(mode, 1), R.Gr.unb(s, qs, qus, rs, t)), R.Gr.ws(all, qs, R.Gr.hset(eps, ces, depth), r, rs, t)), y), Laws.MemGx(R.Gr.rd(rest, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y)>, ih: Laws.MemGx(R.Gr.rd(rest, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y) -> TL.Ex(Q.Qt, a => TL.And(QL.MemQt(rest, a), TL.Ex(Q.Qt, b => TL.And(QL.MemQt(all, b), Laws.GPair(R.Rg{r, depth}, a, b, s, qs, qus, eps, ces, y)))))) -> TL.Ex(Q.Qt, a => TL.And(QL.MemQt(Con{Q.Qt{rs, t, mode}, rest}, a), TL.Ex(Q.Qt, b => TL.And(QL.MemQt(all, b), Laws.GPair(R.Rg{r, depth}, a, b, s, qs, qus, eps, ces, y))))):
  match o:
    case Inl{m}:
      Tuple{Q.Qt{rs, t, mode}, Tuple{Inl{{==}}, Rd.wh(rs, t, mode, all, s, qs, qus, eps, ces, depth, r, y, When.s(Bool.and(U32.is_eq(mode, 1), R.Gr.unb(s, qs, qus, rs, t)), R.Gr.ws(all, qs, R.Gr.hset(eps, ces, depth), r, rs, t), y, m))}}
    case Inr{m}:
      Lift.qt(a => TL.Ex(Q.Qt, b => TL.And(QL.MemQt(all, b), Laws.GPair(R.Rg{r, depth}, a, b, s, qs, qus, eps, ces, y))), Q.Qt{rs, t, mode}, rest, ih(m))

def Rd.s(rd: List<&2, Q.Qt>, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +r: U32, +y: R.Gx, h: Laws.MemGx(R.Gr.rd(rd, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y)) -> TL.Ex(Q.Qt, a => TL.And(QL.MemQt(rd, a), TL.Ex(Q.Qt, b => TL.And(QL.MemQt(all, b), Laws.GPair(R.Rg{r, depth}, a, b, s, qs, qus, eps, ces, y))))):
  match rd:
    case Nil{}:
      match h:
    case Con{Q.Qt{+rs, +t, +mode}, +rest}:
      Rd.k(rs, t, mode, rest, all, s, qs, qus, eps, ces, depth, r, y, AX.split(R.Gr.when(Bool.and(U32.is_eq(mode, 1), R.Gr.unb(s, qs, qus, rs, t)), R.Gr.ws(all, qs, R.Gr.hset(eps, ces, depth), r, rs, t)), R.Gr.rd(rest, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y, h), q => Rd.s(rest, all, s, qs, qus, eps, ces, depth, r, y, q))

def Rd.hit2(b: Q.Qt, +rs: U32, +t: U32, +ma: U32, +rest: List<&2, Q.Qt>, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +r: U32, +y: R.Gx, mb: QL.MemQt(all, b), gp: Laws.GPair(R.Rg{r, depth}, Q.Qt{rs, t, ma}, b, s, qs, qus, eps, ces, y)) -> Laws.MemGx(R.Gr.rd(Con{Q.Qt{rs, t, ma}, rest}, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y):
  match b:
    case Q.Qt{+ws, +tb, +mb2}:
      match gp:
        case Tuple{e1, q1}:
          match q1:
            case Tuple{eu, wb}:
              AX.l(R.Gr.when(Bool.and(U32.is_eq(ma, 1), R.Gr.unb(s, qs, qus, rs, t)), R.Gr.ws(all, qs, R.Gr.hset(eps, ces, depth), r, rs, t)), R.Gr.rd(rest, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y, When.hit(Bool.and(U32.is_eq(ma, 1), R.Gr.unb(s, qs, qus, rs, t)), R.Gr.ws(all, qs, R.Gr.hset(eps, ces, depth), r, rs, t), y, B.tt(U32.is_eq(ma, 1), R.Gr.unb(s, qs, qus, rs, t), U.eq_t(ma, 1, e1), eu), Ws.c(all, qs, R.Gr.hset(eps, ces, depth), r, rs, t, y, Q.Qt{ws, tb, mb2}, mb, wb)))

def Rd.hit(a: Q.Qt, +rest: List<&2, Q.Qt>, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +r: U32, +y: R.Gx, w: TL.Ex(Q.Qt, b => TL.And(QL.MemQt(all, b), Laws.GPair(R.Rg{r, depth}, a, b, s, qs, qus, eps, ces, y)))) -> Laws.MemGx(R.Gr.rd(Con{a, rest}, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y):
  match a:
    case Q.Qt{+rs, +t, +ma}:
      match w:
        case Tuple{b, q}:
          match q:
            case Tuple{mb, gp}:
              Rd.hit2(b, rs, t, ma, rest, all, s, qs, qus, eps, ces, depth, r, y, mb, gp)

def Rd.stay(h: Q.Qt, +rest: List<&2, Q.Qt>, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +hset: G.Tr, +r: U32, +y: R.Gx, m: Laws.MemGx(R.Gr.rd(rest, all, s, qs, qus, hset, r), y)) -> Laws.MemGx(R.Gr.rd(Con{h, rest}, all, s, qs, qus, hset, r), y):
  match h:
    case Q.Qt{+rs, +t, +mode}:
      AX.r(R.Gr.when(Bool.and(U32.is_eq(mode, 1), R.Gr.unb(s, qs, qus, rs, t)), R.Gr.ws(all, qs, hset, r, rs, t)), R.Gr.rd(rest, all, s, qs, qus, hset, r), y, m)

def Rd.c(rd: List<&2, Q.Qt>, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32, +r: U32, +y: R.Gx, +a: Q.Qt, ha: QL.MemQt(rd, a), w: TL.Ex(Q.Qt, b => TL.And(QL.MemQt(all, b), Laws.GPair(R.Rg{r, depth}, a, b, s, qs, qus, eps, ces, y)))) -> Laws.MemGx(R.Gr.rd(rd, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y):
  match rd:
    case Nil{}:
      match ha:
    case Con{h, +rest}:
      match ha:
        case Inl{e}:
          %Equal.sym(Q.Qt, h, a, e) : Laws.MemGx(R.Gr.rd(Con{_, rest}, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y)
          Rd.hit(a, rest, all, s, qs, qus, eps, ces, depth, r, y, w)
        case Inr{q}:
          Rd.stay(h, rest, all, s, qs, qus, R.Gr.hset(eps, ces, depth), r, y, Rd.c(rest, all, s, qs, qus, eps, ces, depth, r, y, a, q, w))

# ---- every rule row ---------------------------------------------------------------------------
def Rs.k(+r: U32, +depth: U32, +rest: List<&2, R.Rg>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qts: List<&2, Q.Qt>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +y: R.Gx, o: Either<&2, &2, Laws.MemGx(R.Gr.rd(qts, qts, s, qs, qus, R.Gr.hset(eps, ces, depth), r), y), Laws.MemGx(R.Gr.rules(s, qs, qts, qus, eps, ces, rest), y)>, ih: Laws.MemGx(R.Gr.rules(s, qs, qts, qus, eps, ces, rest), y) -> Laws.GAt(s, qs, qts, qus, eps, ces, rest, y)) -> Laws.GAt(s, qs, qts, qus, eps, ces, Con{R.Rg{r, depth}, rest}, y):
  match o:
    case Inl{m}:
      Tuple{R.Rg{r, depth}, Tuple{Inl{{==}}, Rd.s(qts, qts, s, qs, qus, eps, ces, depth, r, y, m)}}
    case Inr{m}:
      Lift.rg(g => TL.Ex(Q.Qt, a => TL.And(QL.MemQt(qts, a), TL.Ex(Q.Qt, b => TL.And(QL.MemQt(qts, b), Laws.GPair(g, a, b, s, qs, qus, eps, ces, y))))), R.Rg{r, depth}, rest, ih(m))

def Rs.s(rgs: List<&2, R.Rg>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qts: List<&2, Q.Qt>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +y: R.Gx, h: Laws.MemGx(R.Gr.rules(s, qs, qts, qus, eps, ces, rgs), y)) -> Laws.GAt(s, qs, qts, qus, eps, ces, rgs, y):
  match rgs:
    case Nil{}:
      match h:
    case Con{R.Rg{+r, +depth}, +rest}:
      Rs.k(r, depth, rest, s, qs, qts, qus, eps, ces, y, AX.split(R.Gr.rd(qts, qts, s, qs, qus, R.Gr.hset(eps, ces, depth), r), R.Gr.rules(s, qs, qts, qus, eps, ces, rest), y, h), q => Rs.s(rest, s, qs, qts, qus, eps, ces, y, q))

def Laws.gr_findings_sound(s, qs, qts, qus, eps, ces, rgs, y, hm):
  Rs.s(rgs, s, qs, qts, qus, eps, ces, y, hm)

def Rs.hit(g: R.Rg, +rest: List<&2, R.Rg>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qts: List<&2, Q.Qt>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +y: R.Gx, wa: TL.Ex(Q.Qt, a => TL.And(QL.MemQt(qts, a), TL.Ex(Q.Qt, b => TL.And(QL.MemQt(qts, b), Laws.GPair(g, a, b, s, qs, qus, eps, ces, y)))))) -> Laws.MemGx(R.Gr.rules(s, qs, qts, qus, eps, ces, Con{g, rest}), y):
  match g:
    case R.Rg{+r, +depth}:
      match wa:
        case Tuple{+a, q}:
          match q:
            case Tuple{ma, wb}:
              AX.l(R.Gr.rd(qts, qts, s, qs, qus, R.Gr.hset(eps, ces, depth), r), R.Gr.rules(s, qs, qts, qus, eps, ces, rest), y, Rd.c(qts, qts, s, qs, qus, eps, ces, depth, r, y, a, ma, wb))

def Rs.stay(h: R.Rg, +rest: List<&2, R.Rg>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qts: List<&2, Q.Qt>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +y: R.Gx, m: Laws.MemGx(R.Gr.rules(s, qs, qts, qus, eps, ces, rest), y)) -> Laws.MemGx(R.Gr.rules(s, qs, qts, qus, eps, ces, Con{h, rest}), y):
  match h:
    case R.Rg{+r, +depth}:
      AX.r(R.Gr.rd(qts, qts, s, qs, qus, R.Gr.hset(eps, ces, depth), r), R.Gr.rules(s, qs, qts, qus, eps, ces, rest), y, m)

def Rs.c(rgs: List<&2, R.Rg>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qts: List<&2, Q.Qt>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +y: R.Gx, +g: R.Rg, hg: Laws.MemRg(rgs, g), wa: TL.Ex(Q.Qt, a => TL.And(QL.MemQt(qts, a), TL.Ex(Q.Qt, b => TL.And(QL.MemQt(qts, b), Laws.GPair(g, a, b, s, qs, qus, eps, ces, y)))))) -> Laws.MemGx(R.Gr.rules(s, qs, qts, qus, eps, ces, rgs), y):
  match rgs:
    case Nil{}:
      match hg:
    case Con{h, +rest}:
      match hg:
        case Inl{e}:
          %Equal.sym(R.Rg, h, g, e) : Laws.MemGx(R.Gr.rules(s, qs, qts, qus, eps, ces, Con{_, rest}), y)
          Rs.hit(g, rest, s, qs, qts, qus, eps, ces, y, wa)
        case Inr{q}:
          Rs.stay(h, rest, s, qs, qts, qus, eps, ces, y, Rs.c(rest, s, qs, qts, qus, eps, ces, y, g, q, wa))

def Laws.gr_findings_complete(s, qs, qts, qus, eps, ces, rgs, y, w):
  match w:
    case Tuple{+g, q}:
      match q:
        case Tuple{mg, wa}:
          Rs.c(rgs, s, qs, qts, qus, eps, ces, y, g, mg, wa)

# ---- a finding's read has no bound key --------------------------------------------------------
def NK.tr(+r: U32, +rs: U32, +t: U32, +ws: U32, +y: R.Gx, +s: Q.Schema, +qus: List<&2, Q.Qu>, e: {R.Gx{r, rs, t, ws} == y : R.Gx}, k: Laws.KeyW(Laws.GxRs(y), Laws.GxT(y), s, qus)) -> Laws.KeyW(rs, t, s, qus):
  %Equal.sym(R.Gx, R.Gx{r, rs, t, ws}, y, e) : Laws.KeyW(Laws.GxRs(_), Laws.GxT(_), s, qus)
  k

def NK.kf(+rs: U32, +t: U32, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, u: TL.And({Q.Sq.complete(s) == True{} : Bool}, TL.And({R.Gr.base(t, s) == True{} : Bool}, TL.And({R.Gr.sel(rs, qs) == True{} : Bool}, {R.Gr.keyed(rs, t, s, qus) == False{} : Bool}))), k: Laws.KeyW(rs, t, s, qus)) -> Empty:
  match u:
    case Tuple{c1, q1}:
      match q1:
        case Tuple{c2, q2}:
          match q2:
            case Tuple{c3, kf}:
              B.clash(R.Gr.keyed(rs, t, s, qus), kf, Laws.gr_keyed_complete(rs, t, s, qus, k))

def NK.pair(g: R.Rg, a: Q.Qt, b: Q.Qt, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +y: R.Gx, gp: Laws.GPair(g, a, b, s, qs, qus, eps, ces, y), k: Laws.KeyW(Laws.GxRs(y), Laws.GxT(y), s, qus)) -> Empty:
  match g:
    case R.Rg{+r, +depth}:
      match a:
        case Q.Qt{+rs, +t, +ma}:
          match b:
            case Q.Qt{+ws, +tb, +mb}:
              match gp:
                case Tuple{e1, q1}:
                  match q1:
                    case Tuple{eu, q2}:
                      match q2:
                        case Tuple{et, q3}:
                          match q3:
                            case Tuple{em, q4}:
                              match q4:
                                case Tuple{eh, ey}:
                                  NK.kf(rs, t, s, qs, qus, Laws.gr_unb_means(s, qs, qus, rs, t, eu), NK.tr(r, rs, t, ws, y, s, qus, ey, k))

def NK.at(+s: Q.Schema, +qs: List<&2, Q.Qs>, +qts: List<&2, Q.Qt>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +rgs: List<&2, R.Rg>, +y: R.Gx, w: Laws.GAt(s, qs, qts, qus, eps, ces, rgs, y), k: Laws.KeyW(Laws.GxRs(y), Laws.GxT(y), s, qus)) -> Empty:
  match w:
    case Tuple{g, q1}:
      match q1:
        case Tuple{mg, q2}:
          match q2:
            case Tuple{a, q3}:
              match q3:
                case Tuple{ma, q4}:
                  match q4:
                    case Tuple{b, q5}:
                      match q5:
                        case Tuple{mb, gp}:
                          NK.pair(g, a, b, s, qs, qus, eps, ces, y, gp, k)

def Laws.gr_no_key(s, qs, qts, qus, eps, ces, rgs, y, hm, k):
  NK.at(s, qs, qts, qus, eps, ces, rgs, y, Laws.gr_findings_sound(s, qs, qts, qus, eps, ces, rgs, y, hm), k)

def Laws.gr_lines_shape(s, qs, qts, qus, eps, ces, rgs):
  {==}
