import Base

# ---- Nat arithmetic ----------------------------------------------------------------
def Nat.add_zero(+a: Nat) -> {Nat.add(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Nat.add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def Nat.add_succ_r(+a: Nat, +b: Nat) -> {Nat.add(a, 1n+b) == 1n+Nat.add(a, b) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Nat.add_succ_r(p, b) : {1n+Nat.add(p, 1n+b) == 1n+_ : Nat}
      {==}

# ---- U32 <-> Nat round trip ---------------------------------------------------------------
def Word.from(+n: Nat, m: Nat) -> Word(n):
  match m:
    case 0n:
      Word.zero(n)
    case 1n+q:
      Word.inc(n, Word.from(n, q))

def Word.from_double(+p: Nat, +a: Nat) -> {Word.from(1n+p, Nat.double(a)) == WCon{False{}, Word.from(p, a)} : Word.Con<p>}:
  match a:
    case 0n:
      {==}
    case 1n+a2:
      %Equal.sym(Word.Con<p>, Word.from(1n+p, Nat.double(a2)), WCon{False{}, Word.from(p, a2)}, Word.from_double(p, a2)) : {Word.inc(1n+p, Word.inc(1n+p, _)) == WCon{False{}, Word.inc(p, Word.from(p, a2))} : Word.Con<p>}
      {==}

def Word.round(+n: Nat, w: Word(n)) -> {Word.from(n, Word.to_nat(n, w)) == w : Word(n)}:
  match n:
    case 0n:
      match w:
        case WNil{}:
          {==}
    case 1n+p:
      match w:
        case WCon{False{}, +t}:
          %Equal.sym(Word.Con<p>, Word.from(1n+p, Nat.double(Word.to_nat(p, t))), WCon{False{}, Word.from(p, Word.to_nat(p, t))}, Word.from_double(p, Word.to_nat(p, t))) : {_ == WCon{False{}, t} : Word.Con<p>}
          %Equal.sym(Word(p), Word.from(p, Word.to_nat(p, t)), t, Word.round(p, t)) : {WCon{False{}, _} == WCon{False{}, t} : Word.Con<p>}
          {==}
        case WCon{True{}, +t}:
          %Equal.sym(Word.Con<p>, Word.from(1n+p, Nat.double(Word.to_nat(p, t))), WCon{False{}, Word.from(p, Word.to_nat(p, t))}, Word.from_double(p, Word.to_nat(p, t))) : {Word.inc(1n+p, _) == WCon{True{}, t} : Word.Con<p>}
          %Equal.sym(Word(p), Word.from(p, Word.to_nat(p, t)), t, Word.round(p, t)) : {Word.inc(1n+p, WCon{False{}, _}) == WCon{True{}, t} : Word.Con<p>}
          {==}

def U32.from_word(+m: Nat) -> {U32.from_nat(m) == U32{Word.from(32n, m)} : U32}:
  match m:
    case 0n:
      {==}
    case 1n+q:
      %Equal.sym(U32, U32.from_nat(q), U32{Word.from(32n, q)}, U32.from_word(q)) : {U32.inc(_) == U32{Word.inc(32n, Word.from(32n, q))} : U32}
      {==}

def U32.round(u: U32) -> {U32.from_nat(U32.to_nat(u)) == u : U32}:
  match u:
    case U32{+w}:
      %Equal.sym(U32, U32.from_nat(Word.to_nat(32n, w)), U32{Word.from(32n, Word.to_nat(32n, w))}, U32.from_word(Word.to_nat(32n, w))) : {_ == U32{w} : U32}
      %Equal.sym(Word(32n), Word.from(32n, Word.to_nat(32n, w)), w, Word.round(32n, w)) : {U32{_} == U32{w} : U32}
      {==}
