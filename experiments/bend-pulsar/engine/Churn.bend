# Churn.bend - per-function churn from the git-history rows (A, C, CFN), for Hotspot.bend.
#
#   Churn.of(rows)   one Ch{fn, n} per function with n > 0, in function-id order, where
#                    n = CFN rows for fn with touched > 0 whose commit's author is not
#                    a bot. Rows with a wrong field count are ignored, and so are
#                    function ids of 2^24 or more (FACTS.md's id range).
#
# Churn-LAWS.bend: every reported count is that number of rows (CH1), and every
# function with such a row is reported (CH2). The counted rows are Churn.list:
#   bot authors   the author of every `A a 1` row (Churn.bot_as)
#   bot commits   the commit of every `C c a d` row whose author is a bot (Churn.bot_cs)
#   counted rows  the fn of every `CFN c fn t` row with t > 0, fn < 2^24 and c not a
#                 bot commit (Churn.fns)
# The sets are Scope.set tries, whose membership is exact (Scope-LAWS SC1-SC2), and
# the tally is Graph.cnt_all, whose count is exact (Lemmas3 Cnt.sound).

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./Rows.bend as R
import ./Hotspot.bend as H

# Row tags, packed as Rows.bend does: "A" 65, "C" 67, "CFN" 67*65536+70*256+78.
def Churn.tag_a() -> U32:
  65

def Churn.tag_c() -> U32:
  67

def Churn.tag_cfn() -> U32:
  4408910

def Churn.ok2(fs: List<&2, U32>) -> Bool:
  match fs:
    case Con{a, Con{b, Nil{}}}:
      True{}
    case _:
      False{}

def Churn.ok3(fs: List<&2, U32>) -> Bool:
  match fs:
    case Con{a, Con{b, Con{c, Nil{}}}}:
      True{}
    case _:
      False{}

def Churn.f0(fs: List<&2, U32>) -> U32:
  match fs:
    case Con{a, t}:
      a
    case Nil{}:
      0

def Churn.f1(fs: List<&2, U32>) -> U32:
  match fs:
    case Con{a, Con{b, t}}:
      b
    case _:
      0

def Churn.f2(fs: List<&2, U32>) -> U32:
  match fs:
    case Con{a, Con{b, Con{c, t}}}:
      c
    case _:
      0

def Churn.push_u(c: Bool, x: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# The author of every `A a 1` row.
def Churn.bot_as(rows: List<&2, R.Row>) -> List<&2, U32>:
  match rows:
    case Nil{}:
      Nil{}
    case Con{R.Row{+tag, +fs}, rest}:
      Churn.push_u(Bool.and(U32.is_eq(tag, Churn.tag_a()), Bool.and(Churn.ok2(fs), U32.is_eq(Churn.f1(fs), 1))), Churn.f0(fs), Churn.bot_as(rest))

# The commit of every `C c a d` row whose author is in ba.
def Churn.bot_cs(rows: List<&2, R.Row>, +ba: G.Tr) -> List<&2, U32>:
  match rows:
    case Nil{}:
      Nil{}
    case Con{R.Row{+tag, +fs}, rest}:
      Churn.push_u(Bool.and(U32.is_eq(tag, Churn.tag_c()), Bool.and(Churn.ok3(fs), S.Scope.has(ba, Churn.f1(fs)))), Churn.f0(fs), Churn.bot_cs(rest, ba))

# The fn of every `CFN c fn t` row with t > 0, fn < 2^24 and c not in bc.
def Churn.fns(rows: List<&2, R.Row>, +bc: G.Tr) -> List<&2, U32>:
  match rows:
    case Nil{}:
      Nil{}
    case Con{R.Row{+tag, +fs}, rest}:
      Churn.push_u(Bool.and(U32.is_eq(tag, Churn.tag_cfn()), Bool.and(Churn.ok3(fs), Bool.and(Bool.and(U32.is_gt(Churn.f2(fs), 0), U32.is_lt(Churn.f1(fs), 16777216)), Bool.not(S.Scope.has(bc, Churn.f0(fs)))))), Churn.f1(fs), Churn.fns(rest, bc))

def Churn.bc(+rows: List<&2, R.Row>) -> G.Tr:
  S.Scope.set(Churn.bot_cs(rows, S.Scope.set(Churn.bot_as(rows))))

# The counted rows, one entry per row (the fn it names).
def Churn.list(+rows: List<&2, R.Row>) -> List<&2, U32>:
  Churn.fns(rows, Churn.bc(rows))

# ---- reporting --------------------------------------------------------------------------
def Churn.cnt(+t: G.Tr, +x: U32) -> Nat:
  G.Graph.cnt_of(G.Tr.getu(t, x))

def Churn.push3(z: Bool, +x: U32, +k: Nat, acc: List<&2, H.Ch>) -> List<&2, H.Ch>:
  match z:
    case True{}:
      acc
    case False{}:
      Con{H.Ch{x, k}, acc}

def Churn.push(+t: G.Tr, +x: U32, acc: List<&2, H.Ch>) -> List<&2, H.Ch>:
  Churn.push3(Nat.is_eq(Churn.cnt(t, x), 0n), x, Churn.cnt(t, x), acc)

# Ch{x, count} for every x of xs with a non-zero count, in the order of xs.
def Churn.all(xs: List<&2, U32>, +t: G.Tr) -> List<&2, H.Ch>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+x, rest}:
      Churn.push(t, x, Churn.all(rest, t))

# ---- id order: a sorted, deduplicated copy of the counted list (untrusted) ------------------
def Uu.hd(+b: Bool, x: U32, y: U32) -> U32:
  match b:
    case True{}:
      x
    case False{}:
      y

def Uu.pl(+b: Bool, x: U32, xt: List<&2, U32>) -> List<&2, U32>:
  match b:
    case True{}:
      xt
    case False{}:
      Con{x, xt}

def Uu.pr(+b: Bool, y: U32, yt: List<&2, U32>) -> List<&2, U32>:
  match b:
    case True{}:
      Con{y, yt}
    case False{}:
      yt

def Uu.merge(fuel: Nat, xs: List<&2, U32>, ys: List<&2, U32>) -> List<&2, U32>:
  match fuel:
    case 0n:
      List.append(&2, U32, xs, ys)
    case 1n+p:
      match xs ys:
        case Nil{} ys2:
          ys2
        case xs2 Nil{}:
          xs2
        case Con{+x, xt} Con{+y, yt}:
          +b = U32.is_lt(x, y)
          Con{Uu.hd(b, x, y), Uu.merge(p, Uu.pl(b, x, xt), Uu.pr(b, y, yt))}

def Uu.half_k(k: Bool, x: U32, r: List<&2, U32>) -> List<&2, U32>:
  match k:
    case True{}:
      Con{x, r}
    case False{}:
      r

# Every other element, starting with the first when k.
def Uu.half(xs: List<&2, U32>, +k: Bool) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{x, t}:
      Uu.half_k(k, x, Uu.half(t, Bool.not(k)))

def Uu.sort(fuel: Nat, xs: List<&2, U32>) -> List<&2, U32>:
  match fuel:
    case 0n:
      xs
    case 1n+p:
      match xs:
        case Nil{}:
          Nil{}
        case Con{x, Nil{}}:
          Con{x, Nil{}}
        case Con{+x, Con{+y, +t}}:
          +q = p
          Uu.merge(Nat.add(2n, List.length(&2, U32, t)), Uu.sort(q, Uu.half(Con{x, Con{y, t}}, True{})), Uu.sort(q, Uu.half(Con{x, Con{y, t}}, False{})))

# Drops repeats of the previous element.
def Uu.uniq(xs: List<&2, U32>, +prev: U32, first: Bool) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+x, t}:
      Churn.push_u(Bool.or(first, Bool.not(U32.is_eq(x, prev))), x, Uu.uniq(t, x, False{}))

# Every element of l is in s.
def Churn.covers(l: List<&2, U32>, +s: G.Tr) -> Bool:
  match l:
    case Nil{}:
      True{}
    case Con{+x, t}:
      Bool.and(S.Scope.has(s, x), Churn.covers(t, s))

# The id-ordered copy when it covers the counted list (it always does when the
# sort is right); otherwise the counted list itself. Either way every counted
# function is iterated, so CH2 needs no certificate.
def Churn.go2(ok: Bool, cs: List<&2, U32>, l: List<&2, U32>, +t: G.Tr) -> List<&2, H.Ch>:
  match ok:
    case True{}:
      Churn.all(cs, t)
    case False{}:
      Churn.all(l, t)

def Churn.go3(+cs: List<&2, U32>, +l: List<&2, U32>) -> List<&2, H.Ch>:
  Churn.go2(Churn.covers(l, S.Scope.set(cs)), cs, l, G.Graph.cnt_all(l, G.TE{}))

def Churn.go(+l: List<&2, U32>) -> List<&2, H.Ch>:
  Churn.go3(Uu.uniq(Uu.sort(64n, l), 0, True{}), l)

# Every function with churn > 0, in id order.
def Churn.of(+rows: List<&2, R.Row>) -> List<&2, H.Ch>:
  Churn.go(Churn.list(rows))
