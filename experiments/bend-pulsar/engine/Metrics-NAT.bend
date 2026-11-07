# engine/Metrics-NAT.bend - Nat lemmas for Metrics-PROOF.bend (no laws here).
#
# Le(a, b) is a + d = b for some d. The two capping lemmas at the end are what
# the NPath proof needs: capping the operands of + or x before capping the result
# changes nothing.

import Base

def Le(a: Nat, b: Nat) -> Data:
  Sigma<&2, &2, Nat, d => {Nat.add(a, d) == b : Nat}>

def Disc.Nat(n: Nat) -> Type:
  match n:
    case 0n:
      Empty
    case 1n+p:
      Unit

def Nat.succ_ne_zero(+p: Nat, e: {1n+p == 0n : Nat}) -> Empty:
  %e : Disc.Nat(_)
  Unit{}

def Nat.pred(n: Nat) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+p:
      p

def Nat.succ_inj(+a: Nat, +b: Nat, e: {1n+a == 1n+b : Nat}) -> {a == b : Nat}:
  Equal.cong(Nat, Nat, Nat.pred, 1n+a, 1n+b, e)

# ---- addition ---------------------------------------------------------------------------------
def Nat.add_zero_r(+a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Nat.add_zero_r(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def Nat.add_succ_r(+a: Nat, +b: Nat) -> {Nat.add(a, 1n+b) == 1n+Nat.add(a, b) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Nat.add_succ_r(p, b) : {1n+Nat.add(p, 1n+b) == 1n+_ : Nat}
      {==}

def Nat.add_assoc(+a: Nat, +b: Nat, +c: Nat) -> {Nat.add(Nat.add(a, b), c) == Nat.add(a, Nat.add(b, c)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Nat.add_assoc(p, b, c) : {1n+Nat.add(Nat.add(p, b), c) == 1n+_ : Nat}
      {==}

def Nat.add_comm(+a: Nat, +b: Nat) -> {Nat.add(a, b) == Nat.add(b, a) : Nat}:
  match a:
    case 0n:
      Equal.sym(Nat, Nat.add(b, 0n), b, Nat.add_zero_r(b))
    case 1n+p:
      %Equal.sym(Nat, Nat.add(p, b), Nat.add(b, p), Nat.add_comm(p, b)) : {1n+_ == Nat.add(b, 1n+p) : Nat}
      Equal.sym(Nat, Nat.add(b, 1n+p), 1n+Nat.add(b, p), Nat.add_succ_r(b, p))

# ---- multiplication -----------------------------------------------------------------------------
def Nat.mul_zero_r(+a: Nat) -> {Nat.mul(a, 0n) == 0n : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      Nat.mul_zero_r(p)

def Nat.mul_one_l(+a: Nat) -> {Nat.mul(1n, a) == a : Nat}:
  Nat.add_zero_r(a)

# a(1+b) = a + ab
def Nat.mul_succ_r(+a: Nat, +b: Nat) -> {Nat.mul(a, 1n+b) == Nat.add(a, Nat.mul(a, b)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Equal.sym(Nat, Nat.mul(p, 1n+b), Nat.add(p, Nat.mul(p, b)), Nat.mul_succ_r(p, b)) : {1n+Nat.add(b, _) == 1n+Nat.add(p, Nat.add(b, Nat.mul(p, b))) : Nat}
      %Nat.add_assoc(b, p, Nat.mul(p, b)) : {1n+_ == 1n+Nat.add(p, Nat.add(b, Nat.mul(p, b))) : Nat}
      %Nat.add_comm(p, b) : {1n+Nat.add(_, Nat.mul(p, b)) == 1n+Nat.add(p, Nat.add(b, Nat.mul(p, b))) : Nat}
      %Equal.sym(Nat, Nat.add(Nat.add(p, b), Nat.mul(p, b)), Nat.add(p, Nat.add(b, Nat.mul(p, b))), Nat.add_assoc(p, b, Nat.mul(p, b))) : {1n+_ == 1n+Nat.add(p, Nat.add(b, Nat.mul(p, b))) : Nat}
      {==}

def Nat.mul_comm(+a: Nat, +b: Nat) -> {Nat.mul(a, b) == Nat.mul(b, a) : Nat}:
  match a:
    case 0n:
      Equal.sym(Nat, Nat.mul(b, 0n), 0n, Nat.mul_zero_r(b))
    case 1n+p:
      %Equal.sym(Nat, Nat.mul(p, b), Nat.mul(b, p), Nat.mul_comm(p, b)) : {Nat.add(b, _) == Nat.mul(b, 1n+p) : Nat}
      Equal.sym(Nat, Nat.mul(b, 1n+p), Nat.add(b, Nat.mul(b, p)), Nat.mul_succ_r(b, p))

# (a + b)c = ac + bc
def Nat.mul_add_r(+a: Nat, +b: Nat, +c: Nat) -> {Nat.mul(Nat.add(a, b), c) == Nat.add(Nat.mul(a, c), Nat.mul(b, c)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Equal.sym(Nat, Nat.mul(Nat.add(p, b), c), Nat.add(Nat.mul(p, c), Nat.mul(b, c)), Nat.mul_add_r(p, b, c)) : {Nat.add(c, _) == Nat.add(Nat.add(c, Nat.mul(p, c)), Nat.mul(b, c)) : Nat}
      Equal.sym(Nat, Nat.add(Nat.add(c, Nat.mul(p, c)), Nat.mul(b, c)), Nat.add(c, Nat.add(Nat.mul(p, c), Nat.mul(b, c))), Nat.add_assoc(c, Nat.mul(p, c), Nat.mul(b, c)))

def Nat.mul_assoc(+a: Nat, +b: Nat, +c: Nat) -> {Nat.mul(Nat.mul(a, b), c) == Nat.mul(a, Nat.mul(b, c)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Nat.mul_assoc(p, b, c) : {Nat.mul(Nat.add(b, Nat.mul(p, b)), c) == Nat.add(Nat.mul(b, c), _) : Nat}
      Nat.mul_add_r(b, Nat.mul(p, b), c)

# ---- order --------------------------------------------------------------------------------------
def Le.refl(+a: Nat) -> Le(a, a):
  Tuple{0n, Nat.add_zero_r(a)}

def Le.zero(+a: Nat) -> Le(0n, a):
  Tuple{a, {==}}

def Le.succ(+a: Nat, +b: Nat, h: Le(a, b)) -> Le(1n+a, 1n+b):
  match h:
    case Tuple{+d, e}:
      Tuple{d, Equal.cong(Nat, Nat, x => 1n+x, Nat.add(a, d), b, e)}

def Le.unsucc(+a: Nat, +b: Nat, h: Le(1n+a, 1n+b)) -> Le(a, b):
  match h:
    case Tuple{+d, e}:
      Tuple{d, Nat.succ_inj(Nat.add(a, d), b, e)}

def Le.trans(+a: Nat, +b: Nat, +c: Nat, h1: Le(a, b), h2: Le(b, c)) -> Le(a, c):
  match h1 h2:
    case Tuple{+d1, e1} Tuple{+d2, e2}:
      %e2 : Le(a, _)
      %e1 : Le(a, Nat.add(_, d2))
      Tuple{Nat.add(d1, d2), Equal.sym(Nat, Nat.add(Nat.add(a, d1), d2), Nat.add(a, Nat.add(d1, d2)), Nat.add_assoc(a, d1, d2))}

def Le.add_r(+a: Nat, +b: Nat) -> Le(a, Nat.add(a, b)):
  Tuple{b, {==}}

def Le.add_l(+a: Nat, +b: Nat) -> Le(a, Nat.add(b, a)):
  %Nat.add_comm(a, b) : Le(a, _)
  Le.add_r(a, b)

# a <= b  ->  a + c <= b + c
def Le.add_mono(+a: Nat, +b: Nat, +c: Nat, h: Le(a, b)) -> Le(Nat.add(a, c), Nat.add(b, c)):
  match h:
    case Tuple{+d, e}:
      %e : Le(Nat.add(a, c), Nat.add(_, c))
      %Equal.sym(Nat, Nat.add(Nat.add(a, d), c), Nat.add(a, Nat.add(d, c)), Nat.add_assoc(a, d, c)) : Le(Nat.add(a, c), _)
      %Nat.add_comm(c, d) : Le(Nat.add(a, c), Nat.add(a, _))
      %Nat.add_assoc(a, c, d) : Le(Nat.add(a, c), _)
      Le.add_r(Nat.add(a, c), d)

# c + a <= c + b
def Le.add_mono_l(+c: Nat, +a: Nat, +b: Nat, h: Le(a, b)) -> Le(Nat.add(c, a), Nat.add(c, b)):
  %Nat.add_comm(a, c) : Le(_, Nat.add(c, b))
  %Nat.add_comm(b, c) : Le(Nat.add(a, c), _)
  Le.add_mono(a, b, c, h)

def Le.add_both(+a: Nat, +b: Nat, +c: Nat, +d: Nat, h1: Le(a, b), h2: Le(c, d)) -> Le(Nat.add(a, c), Nat.add(b, d)):
  Le.trans(Nat.add(a, c), Nat.add(b, c), Nat.add(b, d), Le.add_mono(a, b, c, h1), Le.add_mono_l(b, c, d, h2))

# a <= b  ->  ac <= bc
def Le.mul_mono(+a: Nat, +b: Nat, +c: Nat, h: Le(a, b)) -> Le(Nat.mul(a, c), Nat.mul(b, c)):
  match h:
    case Tuple{+d, e}:
      %e : Le(Nat.mul(a, c), Nat.mul(_, c))
      %Equal.sym(Nat, Nat.mul(Nat.add(a, d), c), Nat.add(Nat.mul(a, c), Nat.mul(d, c)), Nat.mul_add_r(a, d, c)) : Le(Nat.mul(a, c), _)
      Le.add_r(Nat.mul(a, c), Nat.mul(d, c))

# 1 <= c  ->  a <= ac
def Le.mul_pos(+a: Nat, +c: Nat, h: Le(1n, c)) -> Le(a, Nat.mul(a, c)):
  match h:
    case Tuple{+d, e}:
      %e : Le(a, Nat.mul(a, _))
      %Equal.sym(Nat, Nat.mul(a, 1n+d), Nat.add(a, Nat.mul(a, d)), Nat.mul_succ_r(a, d)) : Le(a, _)
      Le.add_r(a, Nat.mul(a, d))

def Le.total2(+p: Nat, +q: Nat, o: Either<&2, &2, Le(p, q), Le(q, p)>) -> Either<&2, &2, Le(1n+p, 1n+q), Le(1n+q, 1n+p)>:
  match o:
    case Inl{h}:
      Inl{Le.succ(p, q, h)}
    case Inr{h}:
      Inr{Le.succ(q, p, h)}

def Le.total(+a: Nat, +b: Nat) -> Either<&2, &2, Le(a, b), Le(b, a)>:
  match a b:
    case 0n _:
      Inl{Le.zero(b)}
    case 1n+p 0n:
      Inr{Le.zero(1n+p)}
    case 1n+p 1n+q:
      Le.total2(p, q, Le.total(p, q))

# ---- min ----------------------------------------------------------------------------------------
def Nat.min_zero_r(+a: Nat) -> {Nat.min(a, 0n) == 0n : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      {==}

def Nat.min_le(+z: Nat, +c: Nat, h: Le(z, c)) -> {Nat.min(z, c) == z : Nat}:
  match z:
    case 0n:
      {==}
    case 1n+p:
      match h:
        case Tuple{+d, e}:
          %e : {Nat.min(1n+p, _) == 1n+p : Nat}
          %Equal.sym(Nat, Nat.min(p, Nat.add(p, d)), p, Nat.min_le(p, Nat.add(p, d), Le.add_r(p, d))) : {1n+_ == 1n+p : Nat}
          {==}

def Nat.min_ge(+c: Nat, +z: Nat, h: Le(c, z)) -> {Nat.min(z, c) == c : Nat}:
  match c:
    case 0n:
      Nat.min_zero_r(z)
    case 1n+q:
      match h:
        case Tuple{+d, e}:
          %e : {Nat.min(_, 1n+q) == 1n+q : Nat}
          %Equal.sym(Nat, Nat.min(Nat.add(q, d), q), q, Nat.min_ge(q, Nat.add(q, d), Le.add_r(q, d))) : {1n+_ == 1n+q : Nat}
          {==}

def Nat.min_idem(+a: Nat, +c: Nat) -> {Nat.min(Nat.min(a, c), c) == Nat.min(a, c) : Nat}:
  match a c:
    case 0n _:
      {==}
    case 1n+p 0n:
      {==}
    case 1n+p 1n+q:
      %Equal.sym(Nat, Nat.min(Nat.min(p, q), q), Nat.min(p, q), Nat.min_idem(p, q)) : {1n+_ == 1n+Nat.min(p, q) : Nat}
      {==}

def Nat.min_le_r(+a: Nat, +c: Nat) -> Le(Nat.min(a, c), c):
  match a c:
    case 0n _:
      Le.zero(c)
    case 1n+p 0n:
      Le.refl(0n)
    case 1n+p 1n+q:
      Le.succ(Nat.min(p, q), q, Nat.min_le_r(p, q))

# a <= b  ->  min(a, c) <= min(b, c)
def Nat.min_mono(+a: Nat, +b: Nat, +c: Nat, h: Le(a, b)) -> Le(Nat.min(a, c), Nat.min(b, c)):
  match a b c:
    case 0n _ _:
      Le.zero(Nat.min(b, c))
    case 1n+p _ 0n:
      %Nat.min_zero_r(b) : Le(0n, _)
      Le.refl(0n)
    case 1n+p 0n 1n+r:
      match h:
        case Tuple{d, e}:
          Empty.absurd(Le(Nat.min(1n+p, 1n+r), Nat.min(0n, 1n+r)), Nat.succ_ne_zero(Nat.add(p, d), e))
    case 1n+p 1n+q 1n+r:
      Le.succ(Nat.min(p, r), Nat.min(q, r), Nat.min_mono(p, q, r, Le.unsucc(p, q, h)))

# Capping an operand of + first changes nothing: min(min(a,c) + b, c) = min(a + b, c).
def Cap.add_l(+a: Nat, +b: Nat, +c: Nat) -> {Nat.min(Nat.add(Nat.min(a, c), b), c) == Nat.min(Nat.add(a, b), c) : Nat}:
  match a c:
    case 0n _:
      {==}
    case 1n+p 0n:
      Nat.min_zero_r(b)
    case 1n+p 1n+q:
      %Equal.sym(Nat, Nat.min(Nat.add(Nat.min(p, q), b), q), Nat.min(Nat.add(p, b), q), Cap.add_l(p, b, q)) : {1n+_ == 1n+Nat.min(Nat.add(p, b), q) : Nat}
      {==}

def Cap.add(+a: Nat, +b: Nat, +c: Nat) -> {Nat.min(Nat.add(Nat.min(a, c), Nat.min(b, c)), c) == Nat.min(Nat.add(a, b), c) : Nat}:
  %Equal.sym(Nat, Nat.min(Nat.add(Nat.min(a, c), Nat.min(b, c)), c), Nat.min(Nat.add(a, Nat.min(b, c)), c), Cap.add_l(a, Nat.min(b, c), c)) : {_ == Nat.min(Nat.add(a, b), c) : Nat}
  %Nat.add_comm(Nat.min(b, c), a) : {Nat.min(_, c) == Nat.min(Nat.add(a, b), c) : Nat}
  %Equal.sym(Nat, Nat.min(Nat.add(Nat.min(b, c), a), c), Nat.min(Nat.add(b, a), c), Cap.add_l(b, a, c)) : {_ == Nat.min(Nat.add(a, b), c) : Nat}
  %Nat.add_comm(b, a) : {Nat.min(Nat.add(b, a), c) == Nat.min(_, c) : Nat}
  {==}

def Cap.mul_hi(+a: Nat, +c: Nat, +h: Le(c, a), +b: Nat) -> {Nat.min(Nat.mul(Nat.min(a, c), b), c) == Nat.min(Nat.mul(a, b), c) : Nat}:
  match b:
    case 0n:
      %Equal.sym(Nat, Nat.min(a, c), c, Nat.min_ge(c, a, h)) : {Nat.min(Nat.mul(_, 0n), c) == Nat.min(Nat.mul(a, 0n), c) : Nat}
      %Equal.sym(Nat, Nat.mul(c, 0n), 0n, Nat.mul_zero_r(c)) : {Nat.min(_, c) == Nat.min(Nat.mul(a, 0n), c) : Nat}
      %Equal.sym(Nat, Nat.mul(a, 0n), 0n, Nat.mul_zero_r(a)) : {Nat.min(0n, c) == Nat.min(_, c) : Nat}
      {==}
    case 1n+q:
      %Equal.sym(Nat, Nat.min(a, c), c, Nat.min_ge(c, a, h)) : {Nat.min(Nat.mul(_, 1n+q), c) == Nat.min(Nat.mul(a, 1n+q), c) : Nat}
      Equal.trans(Nat, Nat.min(Nat.mul(c, 1n+q), c), c, Nat.min(Nat.mul(a, 1n+q), c), Nat.min_ge(c, Nat.mul(c, 1n+q), Le.mul_pos(c, 1n+q, Le.succ(0n, q, Le.zero(q)))), Equal.sym(Nat, Nat.min(Nat.mul(a, 1n+q), c), c, Nat.min_ge(c, Nat.mul(a, 1n+q), Le.trans(c, a, Nat.mul(a, 1n+q), h, Le.mul_pos(a, 1n+q, Le.succ(0n, q, Le.zero(q)))))))

def Cap.mul_go(+a: Nat, +c: Nat, o: Either<&2, &2, Le(a, c), Le(c, a)>, +b: Nat) -> {Nat.min(Nat.mul(Nat.min(a, c), b), c) == Nat.min(Nat.mul(a, b), c) : Nat}:
  match o:
    case Inl{h}:
      %Equal.sym(Nat, Nat.min(a, c), a, Nat.min_le(a, c, h)) : {Nat.min(Nat.mul(_, b), c) == Nat.min(Nat.mul(a, b), c) : Nat}
      {==}
    case Inr{h}:
      Cap.mul_hi(a, c, h, b)

# Capping an operand of x first changes nothing: min(min(a,c) x b, c) = min(a x b, c).
def Cap.mul_l(+a: Nat, +b: Nat, +c: Nat) -> {Nat.min(Nat.mul(Nat.min(a, c), b), c) == Nat.min(Nat.mul(a, b), c) : Nat}:
  Cap.mul_go(a, c, Le.total(a, c), b)

def Cap.mul(+a: Nat, +b: Nat, +c: Nat) -> {Nat.min(Nat.mul(Nat.min(a, c), Nat.min(b, c)), c) == Nat.min(Nat.mul(a, b), c) : Nat}:
  %Equal.sym(Nat, Nat.min(Nat.mul(Nat.min(a, c), Nat.min(b, c)), c), Nat.min(Nat.mul(a, Nat.min(b, c)), c), Cap.mul_l(a, Nat.min(b, c), c)) : {_ == Nat.min(Nat.mul(a, b), c) : Nat}
  %Nat.mul_comm(Nat.min(b, c), a) : {Nat.min(_, c) == Nat.min(Nat.mul(a, b), c) : Nat}
  %Equal.sym(Nat, Nat.min(Nat.mul(Nat.min(b, c), a), c), Nat.min(Nat.mul(b, a), c), Cap.mul_l(b, a, c)) : {_ == Nat.min(Nat.mul(a, b), c) : Nat}
  %Nat.mul_comm(b, a) : {Nat.min(Nat.mul(b, a), c) == Nat.min(_, c) : Nat}
  {==}
