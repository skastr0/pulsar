# engine/Crap-PROOF.bend - proofs of Crap-LAWS.bend. Gate: bend Crap-PROOF.bend --verdict
import Base
import ./Metrics.bend as M
import ./Crap.bend as C
import ./Metrics-NAT.bend as N
import ./Metrics-LAWS.bend as ML
import ./Metrics-PROOF.bend as MP
import ./Crap-LAWS.bend as Laws

# ---- E. the entry point -----------------------------------------------------------------------
def Laws.crap_run(thr, ms, cvs):
  {==}

def Laws.crap_out_lines(thr, xs):
  {==}

def Laws.crap_out_refuses(thr):
  {==}

def Laws.crap_measure(fn, c, cov, n, test):
  {==}

def Laws.crap_measure_all_cons(x, xs):
  {==}

def Laws.crap_lines_shape(thr, ms):
  {==}

def Laws.crap_value(c, cov, n):
  {==}

# ---- the comparison ---------------------------------------------------------------------------
def Ge.true(+a: Nat, +b: Nat, e: {C.Crap.ge(a, b) == True{} : Bool}) -> N.Le(b, a):
  match a b:
    case 0n 0n:
      N.Le.refl(0n)
    case 0n 1n+q:
      Empty.absurd(N.Le(1n+q, 0n), N.Bool.ff_tt(e))
    case 1n+p 0n:
      N.Le.zero(1n+p)
    case 1n+p 1n+q:
      N.Le.succ(q, p, Ge.true(p, q, e))

def Ge.false(+a: Nat, +b: Nat, e: {C.Crap.ge(a, b) == False{} : Bool}) -> N.Le(1n+a, b):
  match a b:
    case 0n 0n:
      Empty.absurd(N.Le(1n, 0n), N.Bool.tt_ff(e))
    case 0n 1n+q:
      N.Le.succ(0n, q, N.Le.zero(q))
    case 1n+p 0n:
      Empty.absurd(N.Le(1n+(1n+p), 0n), N.Bool.tt_ff(e))
    case 1n+p 1n+q:
      N.Le.succ(1n+p, q, Ge.false(p, q, e))

# ---- the remainder loop -----------------------------------------------------------------------
# (Q + (r + b)) + P = (Q + r) + (b + P)
def Ar.tail(+q: Nat, +r: Nat, +b: Nat, +p: Nat) -> {Nat.add(Nat.add(q, Nat.add(r, b)), p) == Nat.add(Nat.add(q, r), Nat.add(b, p)) : Nat}:
  %Equal.sym(Nat, Nat.add(Nat.add(q, r), Nat.add(b, p)), Nat.add(q, Nat.add(r, Nat.add(b, p))), N.Nat.add_assoc(q, r, Nat.add(b, p))) : {Nat.add(Nat.add(q, Nat.add(r, b)), p) == _ : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(q, Nat.add(r, b)), p), Nat.add(q, Nat.add(Nat.add(r, b), p)), N.Nat.add_assoc(q, Nat.add(r, b), p)) : {_ == Nat.add(q, Nat.add(r, Nat.add(b, p))) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(r, b), p), Nat.add(r, Nat.add(b, p)), N.Nat.add_assoc(r, b, p)) : {Nat.add(q, _) == Nat.add(q, Nat.add(r, Nat.add(b, p))) : Nat}
  {==}

# ((c + Q) + s) + P = (Q + r) + (b + P), when c + s = r + b
def Ar.step(+c: Nat, +q: Nat, +s: Nat, +r: Nat, +b: Nat, +p: Nat, h: {Nat.add(c, s) == Nat.add(r, b) : Nat}) -> {Nat.add(Nat.add(Nat.add(c, q), s), p) == Nat.add(Nat.add(q, r), Nat.add(b, p)) : Nat}:
  %Equal.sym(Nat, Nat.add(c, q), Nat.add(q, c), N.Nat.add_comm(c, q)) : {Nat.add(Nat.add(_, s), p) == Nat.add(Nat.add(q, r), Nat.add(b, p)) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(q, c), s), Nat.add(q, Nat.add(c, s)), N.Nat.add_assoc(q, c, s)) : {Nat.add(_, p) == Nat.add(Nat.add(q, r), Nat.add(b, p)) : Nat}
  %Equal.sym(Nat, Nat.add(c, s), Nat.add(r, b), h) : {Nat.add(Nat.add(q, _), p) == Nat.add(Nat.add(q, r), Nat.add(b, p)) : Nat}
  Ar.tail(q, r, b, p)

# r < c and b <= c and c + s = r + b  ->  s < c
def Md.bound2(+c: Nat, +r: Nat, +b: Nat, +s: Nat, h: {Nat.add(c, s) == Nat.add(r, b) : Nat}, hr: N.Le(1n+r, c), hb: N.Le(b, c)) -> N.Le(Nat.add(c, 1n+s), Nat.add(c, c)):
  %Equal.sym(Nat, Nat.add(c, 1n+s), 1n+Nat.add(c, s), N.Nat.add_succ_r(c, s)) : N.Le(_, Nat.add(c, c))
  %Equal.sym(Nat, Nat.add(c, s), Nat.add(r, b), h) : N.Le(1n+_, Nat.add(c, c))
  N.Le.add_both(1n+r, c, b, c, hr, hb)

# After k steps from (q, r): Q c + R = (q c + r) + k b, and R < c.

def Md.bound(+c: Nat, +r: Nat, +b: Nat, +s: Nat, h: {Nat.add(c, s) == Nat.add(r, b) : Nat}, hr: N.Le(1n+r, c), hb: N.Le(b, c)) -> N.Le(1n+s, c):
  N.Le.cancel_l(c, 1n+s, c, Md.bound2(c, r, b, s, h, hr, hb))

def Inv(+k: Nat, +b: Nat, +c: Nat, +q: Nat, +r: Nat) -> Data:
  ML.And({Nat.add(Nat.mul(C.QR.q(C.Md.go(k, b, c, C.QR{q, r})), c), C.QR.r(C.Md.go(k, b, c, C.QR{q, r}))) == Nat.add(Nat.add(Nat.mul(q, c), r), Nat.mul(k, b)) : Nat}, N.Le(1n+C.QR.r(C.Md.go(k, b, c, C.QR{q, r})), c))

def Md.close(+lhs: Nat, +mid: Nat, +rhs: Nat, +rr: Nat, +c: Nat, ih: ML.And({lhs == mid : Nat}, N.Le(1n+rr, c)), e2: {mid == rhs : Nat}) -> ML.And({lhs == rhs : Nat}, N.Le(1n+rr, c)):
  match ih:
    case Tuple{e1, l}:
      Tuple{Equal.trans(Nat, lhs, mid, rhs, e1, e2), l}

def Md.at(+p: Nat, +b: Nat, +c: Nat, +q: Nat, +r: Nat, g: Bool, +e: {C.Crap.ge(Nat.add(r, b), c) == g : Bool}, +hb: N.Le(b, c), hr: N.Le(1n+r, c), iht: N.Le(1n+Nat.sub(Nat.add(r, b), c), c) -> Inv(p, b, c, 1n+q, Nat.sub(Nat.add(r, b), c)), ihf: N.Le(1n+Nat.add(r, b), c) -> Inv(p, b, c, q, Nat.add(r, b))) -> Inv(1n+p, b, c, q, r):
  match g:
    case True{}:
      %Equal.sym(Bool, C.Crap.ge(Nat.add(r, b), c), True{}, e) : ML.And({Nat.add(Nat.mul(C.QR.q(C.Md.go(p, b, c, C.Md.step(_, q, Nat.add(r, b), c))), c), C.QR.r(C.Md.go(p, b, c, C.Md.step(_, q, Nat.add(r, b), c)))) == Nat.add(Nat.add(Nat.mul(q, c), r), Nat.add(b, Nat.mul(p, b))) : Nat}, N.Le(1n+C.QR.r(C.Md.go(p, b, c, C.Md.step(_, q, Nat.add(r, b), c))), c))
      Md.close(Nat.add(Nat.mul(C.QR.q(C.Md.go(p, b, c, C.QR{1n+q, Nat.sub(Nat.add(r, b), c)})), c), C.QR.r(C.Md.go(p, b, c, C.QR{1n+q, Nat.sub(Nat.add(r, b), c)}))), Nat.add(Nat.add(Nat.mul(1n+q, c), Nat.sub(Nat.add(r, b), c)), Nat.mul(p, b)), Nat.add(Nat.add(Nat.mul(q, c), r), Nat.add(b, Nat.mul(p, b))), C.QR.r(C.Md.go(p, b, c, C.QR{1n+q, Nat.sub(Nat.add(r, b), c)})), c, iht(Md.bound(c, r, b, Nat.sub(Nat.add(r, b), c), N.Nat.add_sub_of_le(Nat.add(r, b), c, Ge.true(Nat.add(r, b), c, e)), hr, hb)), Ar.step(c, Nat.mul(q, c), Nat.sub(Nat.add(r, b), c), r, b, Nat.mul(p, b), N.Nat.add_sub_of_le(Nat.add(r, b), c, Ge.true(Nat.add(r, b), c, e))))
    case False{}:
      %Equal.sym(Bool, C.Crap.ge(Nat.add(r, b), c), False{}, e) : ML.And({Nat.add(Nat.mul(C.QR.q(C.Md.go(p, b, c, C.Md.step(_, q, Nat.add(r, b), c))), c), C.QR.r(C.Md.go(p, b, c, C.Md.step(_, q, Nat.add(r, b), c)))) == Nat.add(Nat.add(Nat.mul(q, c), r), Nat.add(b, Nat.mul(p, b))) : Nat}, N.Le(1n+C.QR.r(C.Md.go(p, b, c, C.Md.step(_, q, Nat.add(r, b), c))), c))
      Md.close(Nat.add(Nat.mul(C.QR.q(C.Md.go(p, b, c, C.QR{q, Nat.add(r, b)})), c), C.QR.r(C.Md.go(p, b, c, C.QR{q, Nat.add(r, b)}))), Nat.add(Nat.add(Nat.mul(q, c), Nat.add(r, b)), Nat.mul(p, b)), Nat.add(Nat.add(Nat.mul(q, c), r), Nat.add(b, Nat.mul(p, b))), C.QR.r(C.Md.go(p, b, c, C.QR{q, Nat.add(r, b)})), c, ihf(Ge.false(Nat.add(r, b), c, e)), Ar.tail(Nat.mul(q, c), r, b, Nat.mul(p, b)))

def Md.inv(+k: Nat, +b: Nat, +c: Nat, +q: Nat, +r: Nat, +hb: N.Le(b, c), hr: N.Le(1n+r, c)) -> Inv(k, b, c, q, r):
  match k:
    case 0n:
      %Equal.sym(Nat, Nat.add(Nat.add(Nat.mul(q, c), r), 0n), Nat.add(Nat.mul(q, c), r), N.Nat.add_zero_r(Nat.add(Nat.mul(q, c), r))) : ML.And({Nat.add(Nat.mul(q, c), r) == _ : Nat}, N.Le(1n+r, c))
      Tuple{{==}, hr}
    case 1n+p:
      Md.at(p, b, c, q, r, C.Crap.ge(Nat.add(r, b), c), {==}, hb, hr, h => Md.inv(p, b, c, 1n+q, Nat.sub(Nat.add(r, b), c), hb, h), h => Md.inv(p, b, c, q, Nat.add(r, b), hb, h))

# ---- V2. floor division -----------------------------------------------------------------------
def Cube.mono(+u: Nat, +n: Nat, +h: N.Le(u, n)) -> N.Le(C.Crap.cube(u), C.Crap.cube(n)):
  N.Le.trans(Nat.mul(u, Nat.mul(u, u)), Nat.mul(n, Nat.mul(u, u)), Nat.mul(n, Nat.mul(n, n)), N.Le.mul_mono(u, n, Nat.mul(u, u), h), N.Le.mul_mono_l(n, Nat.mul(u, u), Nat.mul(n, n), N.Le.trans(Nat.mul(u, u), Nat.mul(n, u), Nat.mul(n, n), N.Le.mul_mono(u, n, u, h), N.Le.mul_mono_l(n, u, n, h))))

def Cube.pos(+n: Nat, +h: N.Le(1n, n)) -> N.Le(1n, C.Crap.cube(n)):
  N.Le.trans(1n, n, Nat.mul(n, Nat.mul(n, n)), h, N.Le.mul_pos(n, Nat.mul(n, n), N.Le.trans(1n, n, Nat.mul(n, n), h, N.Le.mul_pos(n, n, h))))

def Floor.pack(+qq: Nat, +rr: Nat, +cn: Nat, +ab: Nat, i: ML.And({Nat.add(Nat.mul(qq, cn), rr) == ab : Nat}, N.Le(1n+rr, cn))) -> Sigma<&2, &2, Nat, r => ML.And({Nat.add(Nat.mul(qq, cn), r) == ab : Nat}, N.Le(1n+r, cn))>:
  match i:
    case Tuple{e, l}:
      Tuple{rr, Tuple{e, l}}

def Laws.crap_term_is_floor(c, u, n, hu, hn):
  Floor.pack(C.Crap.term(c, u, n), C.QR.r(C.Md.go(Nat.mul(c, c), C.Crap.cube(u), C.Crap.cube(n), C.QR{0n, 0n})), C.Crap.cube(n), Nat.mul(Nat.mul(c, c), C.Crap.cube(u)), Md.inv(Nat.mul(c, c), C.Crap.cube(u), C.Crap.cube(n), 0n, 0n, Cube.mono(u, n, hu), Cube.pos(n, hn)))

# ---- V3. monotone in coverage -----------------------------------------------------------------
def Le.sub_le(+n: Nat, +a: Nat) -> N.Le(Nat.sub(n, a), n):
  match n a:
    case 0n _:
      N.Le.refl(0n)
    case 1n+p 0n:
      N.Le.refl(1n+p)
    case 1n+p 1n+q:
      N.Le.trans(Nat.sub(p, q), p, 1n+p, Le.sub_le(p, q), N.Le.add_l(p, 1n))

def Mono.eq_le(+x: Nat, +y: Nat, e: {x == y : Nat}) -> N.Le(y, x):
  %e : N.Le(_, x)
  N.Le.refl(x)

def Mono.le_sum(+x: Nat, +r: Nat, +y: Nat, e: {Nat.add(x, r) == y : Nat}) -> N.Le(x, y):
  %e : N.Le(x, _)
  N.Le.add_r(x, r)

# 1 + (Q1 + r1) <= c + Q1, when r1 < c
def Mono.top(+q1: Nat, +r1: Nat, +c: Nat, l1: N.Le(1n+r1, c)) -> N.Le(1n+Nat.add(q1, r1), Nat.add(c, q1)):
  %N.Nat.add_succ_r(q1, r1) : N.Le(_, Nat.add(c, q1))
  %N.Nat.add_comm(q1, c) : N.Le(Nat.add(q1, 1n+r1), _)
  N.Le.add_mono_l(q1, 1n+r1, c, l1)

def Mono.contra(+q1: Nat, +q2: Nat, +r1: Nat, +r2: Nat, +a: Nat, +b1: Nat, +b2: Nat, +c: Nat, e1: {Nat.add(Nat.mul(q1, c), r1) == Nat.mul(a, b1) : Nat}, l1: N.Le(1n+r1, c), e2: {Nat.add(Nat.mul(q2, c), r2) == Nat.mul(a, b2) : Nat}, hb: N.Le(b2, b1), h: N.Le(1n+q1, q2)) -> Empty:
  N.Le.irrefl(Nat.add(Nat.mul(q1, c), r1), N.Le.trans(1n+Nat.add(Nat.mul(q1, c), r1), Nat.mul(1n+q1, c), Nat.add(Nat.mul(q1, c), r1), Mono.top(Nat.mul(q1, c), r1, c, l1), N.Le.trans(Nat.mul(1n+q1, c), Nat.mul(q2, c), Nat.add(Nat.mul(q1, c), r1), N.Le.mul_mono(1n+q1, q2, c, h), N.Le.trans(Nat.mul(q2, c), Nat.mul(a, b2), Nat.add(Nat.mul(q1, c), r1), Mono.le_sum(Nat.mul(q2, c), r2, Nat.mul(a, b2), e2), N.Le.trans(Nat.mul(a, b2), Nat.mul(a, b1), Nat.add(Nat.mul(q1, c), r1), N.Le.mul_mono_l(a, b2, b1, hb), Mono.eq_le(Nat.add(Nat.mul(q1, c), r1), Nat.mul(a, b1), e1))))))

def Mono.pick(+q1: Nat, +q2: Nat, +r1: Nat, +r2: Nat, +a: Nat, +b1: Nat, +b2: Nat, +c: Nat, e1: {Nat.add(Nat.mul(q1, c), r1) == Nat.mul(a, b1) : Nat}, l1: N.Le(1n+r1, c), e2: {Nat.add(Nat.mul(q2, c), r2) == Nat.mul(a, b2) : Nat}, hb: N.Le(b2, b1), o: Either<&2, &2, N.Le(q2, q1), N.Le(1n+q1, q2)>) -> N.Le(q2, q1):
  match o:
    case Inl{h}:
      h
    case Inr{h}:
      Empty.absurd(N.Le(q2, q1), Mono.contra(q1, q2, r1, r2, a, b1, b2, c, e1, l1, e2, hb, h))

# Two floor quotients of a x b1 and a x b2 by c, with b2 <= b1: q2 <= q1.
def Mono.go(+q1: Nat, +q2: Nat, +a: Nat, +b1: Nat, +b2: Nat, +c: Nat, f1: Sigma<&2, &2, Nat, r => ML.And({Nat.add(Nat.mul(q1, c), r) == Nat.mul(a, b1) : Nat}, N.Le(1n+r, c))>, f2: Sigma<&2, &2, Nat, r => ML.And({Nat.add(Nat.mul(q2, c), r) == Nat.mul(a, b2) : Nat}, N.Le(1n+r, c))>, hb: N.Le(b2, b1)) -> N.Le(q2, q1):
  match f1 f2:
    case Tuple{+r1, Tuple{e1, l1}} Tuple{+r2, Tuple{e2, l2}}:
      Mono.pick(q1, q2, r1, r2, a, b1, b2, c, e1, l1, e2, hb, N.Le.lt_or_le(q2, q1))

def Laws.crap_monotone_coverage(c, a, b, n, hab, hbn, hn):
  N.Le.add_mono(C.Crap.term(c, Nat.sub(n, b), n), C.Crap.term(c, Nat.sub(n, a), n), c, Mono.go(C.Crap.term(c, Nat.sub(n, a), n), C.Crap.term(c, Nat.sub(n, b), n), Nat.mul(c, c), C.Crap.cube(Nat.sub(n, a)), C.Crap.cube(Nat.sub(n, b)), C.Crap.cube(n), Laws.crap_term_is_floor(c, Nat.sub(n, a), n, Le.sub_le(n, a), hn), Laws.crap_term_is_floor(c, Nat.sub(n, b), n, Le.sub_le(n, b), hn), Cube.mono(Nat.sub(n, b), Nat.sub(n, a), N.Le.sub_mono(a, b, n, hab, hbn))))

# ---- V4, V5 -----------------------------------------------------------------------------------
def Laws.crap_at_least_c(c, cov, n):
  N.Le.add_l(c, C.Crap.term(c, Nat.sub(n, cov), n))

def Nat.add_eq_zero_l(+x: Nat, +y: Nat, e: {Nat.add(x, y) == 0n : Nat}) -> {x == 0n : Nat}:
  match x:
    case 0n:
      {==}
    case 1n+p:
      Empty.absurd({1n+p == 0n : Nat}, N.Nat.succ_ne_zero(Nat.add(p, y), e))

def Zero.cast(+c: Nat, ez: {c == 0n : Nat}, h: N.Le(1n, c)) -> N.Le(1n, 0n):
  %ez : N.Le(1n, _)
  h

def Nat.mul_eq_zero(+q: Nat, +c: Nat, e: {Nat.mul(q, c) == 0n : Nat}, h: N.Le(1n, c)) -> {q == 0n : Nat}:
  match q:
    case 0n:
      {==}
    case 1n+p:
      Empty.absurd({1n+p == 0n : Nat}, N.Le.irrefl(0n, Zero.cast(c, Nat.add_eq_zero_l(c, Nat.mul(p, c), e), h)))

def Zero.term(+q: Nat, +cn: Nat, +cc: Nat, f: Sigma<&2, &2, Nat, r => ML.And({Nat.add(Nat.mul(q, cn), r) == Nat.mul(cc, 0n) : Nat}, N.Le(1n+r, cn))>, h: N.Le(1n, cn)) -> {q == 0n : Nat}:
  match f:
    case Tuple{+r, Tuple{e, l}}:
      Nat.mul_eq_zero(q, cn, Nat.add_eq_zero_l(Nat.mul(q, cn), r, Equal.trans(Nat, Nat.add(Nat.mul(q, cn), r), Nat.mul(cc, 0n), 0n, e, N.Nat.mul_zero_r(cc))), h)

def Laws.crap_full_coverage(c, n, hn):
  %Equal.sym(Nat, Nat.sub(n, n), 0n, N.Nat.sub_self(n)) : {Nat.add(C.Crap.term(c, _, n), c) == c : Nat}
  %Equal.sym(Nat, C.Crap.term(c, 0n, n), 0n, Zero.term(C.Crap.term(c, 0n, n), C.Crap.cube(n), Nat.mul(c, c), Laws.crap_term_is_floor(c, 0n, n, N.Le.zero(n), hn), Cube.pos(n, hn))) : {Nat.add(_, c) == c : Nat}
  {==}

# ---- F. findings ------------------------------------------------------------------------------
def Snd.weak(+thr: Nat, m: C.CrM, +t: List<&2, C.CrM>, x: M.Finding, s: Laws.Sound(thr, t, x)) -> Laws.Sound(thr, Con{m, t}, x):
  match m x:
    case C.CrM{f, c, cov, n, v, test} M.Finding{rule, fn, vv, tt}:
      match s:
        case Tuple{a, q}:
          match q:
            case Tuple{b, q2}:
              match q2:
                case Tuple{d, w}:
                  Tuple{a, Tuple{b, Tuple{d, Inr{w}}}}

def Snd.hit(+thr: Nat, +f: U32, +c: Nat, +cov: Nat, +n: Nat, +v: Nat, +t: List<&2, C.CrM>, +x: M.Finding, p: ML.And({Nat.is_gt(v, thr) == True{} : Bool}, {M.Finding{5, f, v, thr} == x : M.Finding})) -> Laws.Sound(thr, Con{C.CrM{f, c, cov, n, v, False{}}, t}, x):
  match p:
    case Tuple{g, e}:
      %e : Laws.Sound(thr, Con{C.CrM{f, c, cov, n, v, False{}}, t}, _)
      Tuple{{==}, Tuple{g, Tuple{{==}, Inl{Tuple{{==}, Tuple{{==}, {==}}}}}}}

def Snd.pick(+thr: Nat, +f: U32, +c: Nat, +cov: Nat, +n: Nat, +v: Nat, +t: List<&2, C.CrM>, +x: M.Finding, o: Either<&2, &2, ML.And({Nat.is_gt(v, thr) == True{} : Bool}, {M.Finding{5, f, v, thr} == x : M.Finding}), ML.MemF(C.Crap.findings(thr, t), x)>, ih: ML.MemF(C.Crap.findings(thr, t), x) -> Laws.Sound(thr, t, x)) -> Laws.Sound(thr, Con{C.CrM{f, c, cov, n, v, False{}}, t}, x):
  match o:
    case Inl{p}:
      Snd.hit(thr, f, c, cov, n, v, t, x, p)
    case Inr{m}:
      Snd.weak(thr, C.CrM{f, c, cov, n, v, False{}}, t, x, ih(m))


def Snd.go(test: Bool, +thr: Nat, +f: U32, +c: Nat, +cov: Nat, +n: Nat, +v: Nat, +t: List<&2, C.CrM>, +x: M.Finding, hm: ML.MemF(C.Crap.findings(thr, Con{C.CrM{f, c, cov, n, v, test}, t}), x), ih: ML.MemF(C.Crap.findings(thr, t), x) -> Laws.Sound(thr, t, x)) -> Laws.Sound(thr, Con{C.CrM{f, c, cov, n, v, test}, t}, x):
  match test:
    case True{}:
      Snd.weak(thr, C.CrM{f, c, cov, n, v, True{}}, t, x, ih(hm))
    case False{}:
      Snd.pick(thr, f, c, cov, n, v, t, x, MP.Keep.mem(Nat.is_gt(v, thr), M.Finding{5, f, v, thr}, C.Crap.findings(thr, t), x, hm), ih)

def Laws.crap_findings_sound(thr, ms, x, hm):
  match ms:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match m:
        case C.CrM{+f, +c, +cov, +n, +v, test}:
          Snd.go(test, thr, f, c, cov, n, v, t, x, hm, mm => Laws.crap_findings_sound(thr, t, x, mm))

def Cmp.stay(+thr: Nat, m: C.CrM, +t: List<&2, C.CrM>, +y: M.Finding, mm: ML.MemF(C.Crap.findings(thr, t), y)) -> ML.MemF(C.Crap.findings(thr, Con{m, t}), y):
  match m:
    case C.CrM{+f, c, cov, n, +v, test}:
      match test:
        case True{}:
          mm
        case False{}:
          MP.Keep.stay(Nat.is_gt(v, thr), M.Finding{5, f, v, thr}, C.Crap.findings(thr, t), y, mm)

def Laws.crap_findings_complete(thr, ms, fn, c, cov, n, v, hm, h):
  match ms:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(C.CrM, m, C.CrM{fn, c, cov, n, v, False{}}, e) : ML.MemF(C.Crap.findings(thr, Con{_, t}), M.Finding{5, fn, v, thr})
          MP.Keep.hit(Nat.is_gt(v, thr), M.Finding{5, fn, v, thr}, C.Crap.findings(thr, t), h)
        case Inr{mm}:
          Cmp.stay(thr, m, t, M.Finding{5, fn, v, thr}, Laws.crap_findings_complete(thr, t, fn, c, cov, n, v, mm, h))

def Laws.crap_skips_tests(thr, fn, c, cov, n, v, ms):
  {==}

def Laws.crap_cause_complexity_only(c, cov, n, h):
  Ge.true(C.Crap.cube(n), Nat.mul(c, C.Crap.cube(Nat.sub(n, cov))), h)

def Laws.crap_cause_coverage(c, cov, n, h):
  Ge.false(C.Crap.cube(n), Nat.mul(c, C.Crap.cube(Nat.sub(n, cov))), h)

def Laws.crap_cause_name_complexity():
  {==}

def Laws.crap_cause_name_coverage():
  {==}

def Laws.crap_ev_none(fn):
  {==}

def Laws.crap_ev_skip(fn, f, c, cov, n, v, test, t, h):
  %Equal.sym(Bool, U32.is_eq(f, fn), False{}, h) : {C.Crap.ev_pick(_, C.Crap.tail(c, cov, n), C.Crap.ev(fn, t)) == C.Crap.ev(fn, t) : String}
  {==}

def Laws.crap_ev_hit(fn, f, c, cov, n, v, test, t, h):
  %Equal.sym(Bool, U32.is_eq(f, fn), True{}, h) : {C.Crap.ev_pick(_, C.Crap.tail(c, cov, n), C.Crap.ev(fn, t)) == " cyclomatic=" ++ Nat.show(c) ++ " covered=" ++ Nat.show(cov) ++ " coverable=" ++ Nat.show(n) ++ " cause=" ++ C.Crap.cause_name(C.Crap.cause(c, cov, n)) : String}
  {==}
