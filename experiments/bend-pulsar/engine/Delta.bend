# Delta.bend - the per-sha delta: which findings a change added, allowed, listed for
# coverage or removed, and which measures worsened or improved (FACTS.md "Delta").
#
# Input rows (the CLI writes them for `pulsar delta`, from the two shas' findings):
#   KD 0              the switch: without it there is no delta section
#   KB hi lo          a base finding key (rename-matched keys already mapped to head)
#   KH hi lo cls      a head finding key; cls 0 plain, 1 needs coverage, 2 allowed by
#                     a committed head decision
#   MB hi lo m v      measure m of function (hi lo) at base; MH the same at head.
#                     Higher v is worse for every m.
#
# Each side is sorted by an untrusted merge sort (membership is proven preserved), checked
# strictly ascending by (hi, lo, m) at run time, then compared by one walk over both sides
# (Dw.walk). A side that is not strictly ascending (a repeated key, or a wrong sort), or a
# walk that runs out of fuel, refuses the run. Delta-LAWS.bend: every reported line is
# sound, and every key that should be reported is.

import Base
import ./Rows.bend as W

# A row: key (hi, lo, m) and value v (cls for KH, 0 for KB, the measure for MB/MH).
type Kr is Data:
  Kr{hi: U32, lo: U32, m: U32, v: U32}

type Ev is Data:
  OA{a: Kr}
  OB{b: Kr}
  BT{a: Kr, b: Kr}
  ST{}
type DD is Data:
  DD{bad: U32, kd: U32, kb: List<&2, Kr>, kh: List<&2, Kr>, mb: List<&2, Kr>, mh: List<&2, Kr>}
type Mv is Data:
  Mv{a: Kr, b: Kr}
def Kr.v(k: Kr) -> U32:
  match k:
    case Kr{hi, lo, m, v}:
      v

def Kr.hi(k: Kr) -> U32:
  match k:
    case Kr{hi, lo, m, v}:
      hi

def Kr.lo(k: Kr) -> U32:
  match k:
    case Kr{hi, lo, m, v}:
      lo

def Kr.m(k: Kr) -> U32:
  match k:
    case Kr{hi, lo, m, v}:
      m

def Kc.then(c: Cmp, d: Cmp) -> Cmp:
  match c:
    case LT{}:
      LT{}
    case EQ{}:
      d
    case GT{}:
      GT{}

# Key order: hi, then lo, then m. The value is not part of the key.
def Kr.cmp(a: Kr, b: Kr) -> Cmp:
  match a b:
    case Kr{ah, al, am, av} Kr{bh, bl, bm, bv}:
      Kc.then(U32.cmp(ah, bh), Kc.then(U32.cmp(al, bl), U32.cmp(am, bm)))

# A measure that moved: base row a, head row b, same key.

# ---- sort (untrusted order, proven membership) ---------------------------------------------
def Ks.hd(+b: Bool, x: Kr, y: Kr) -> Kr:
  match b:
    case True{}:
      x
    case False{}:
      y

def Ks.pl(+b: Bool, x: Kr, xt: List<&2, Kr>) -> List<&2, Kr>:
  match b:
    case True{}:
      xt
    case False{}:
      Con{x, xt}

def Ks.pr(+b: Bool, y: Kr, yt: List<&2, Kr>) -> List<&2, Kr>:
  match b:
    case True{}:
      Con{y, yt}
    case False{}:
      yt

def Ks.merge(fuel: Nat, xs: List<&2, Kr>, ys: List<&2, Kr>) -> List<&2, Kr>:
  match fuel:
    case 0n:
      List.append(&2, Kr, xs, ys)
    case 1n+p:
      match xs ys:
        case Nil{} ys2:
          ys2
        case xs2 Nil{}:
          xs2
        case Con{+x, xt} Con{+y, yt}:
          +b = Cmp.is_lt(Kr.cmp(x, y))
          Con{Ks.hd(b, x, y), Ks.merge(p, Ks.pl(b, x, xt), Ks.pr(b, y, yt))}

def Ks.half_k(k: Bool, x: Kr, r: List<&2, Kr>) -> List<&2, Kr>:
  match k:
    case True{}:
      Con{x, r}
    case False{}:
      r

# Every other element, starting with the first when k.
def Ks.half(xs: List<&2, Kr>, +k: Bool) -> List<&2, Kr>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{x, t}:
      Ks.half_k(k, x, Ks.half(t, Bool.not(k)))

def Ks.sort(fuel: Nat, xs: List<&2, Kr>) -> List<&2, Kr>:
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
          Ks.merge(Nat.add(2n, List.length(&2, Kr, t)), Ks.sort(q, Ks.half(Con{x, Con{y, t}}, True{})), Ks.sort(q, Ks.half(Con{x, Con{y, t}}, False{})))

# p comes strictly before x (no p: the first element).
def Ks.gt(p: Maybe<Kr>, +x: Kr) -> Bool:
  match p:
    case None{}:
      True{}
    case Some{q}:
      Cmp.is_lt(Kr.cmp(q, x))

# Strictly ascending by key: sorted, and no key twice.
def Ks.asc(xs: List<&2, Kr>, p: Maybe<Kr>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+x, t}:
      Bool.and(Ks.gt(p, x), Ks.asc(t, Some{x}))

# ---- the walk ---------------------------------------------------------------------------------
# OA: a base key with no head row. OB: a head key with no base row. BT: the same key on
# both sides. ST: the walk ran out of fuel (never, with the fuel Dl.run gives; refused).

def Dw.ev(c: Cmp, a: Kr, b: Kr) -> Ev:
  match c:
    case LT{}:
      OA{a}
    case EQ{}:
      BT{a, b}
    case GT{}:
      OB{b}

def Dw.na(c: Cmp, a: Kr, ta: List<&2, Kr>) -> List<&2, Kr>:
  match c:
    case LT{}:
      ta
    case EQ{}:
      ta
    case GT{}:
      Con{a, ta}

def Dw.nb(c: Cmp, b: Kr, tb: List<&2, Kr>) -> List<&2, Kr>:
  match c:
    case LT{}:
      Con{b, tb}
    case EQ{}:
      tb
    case GT{}:
      tb

def Dw.oa(xs: List<&2, Kr>) -> List<&2, Ev>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{x, t}:
      Con{OA{x}, Dw.oa(t)}

def Dw.ob(ys: List<&2, Kr>) -> List<&2, Ev>:
  match ys:
    case Nil{}:
      Nil{}
    case Con{y, t}:
      Con{OB{y}, Dw.ob(t)}

def Dw.st(xs: List<&2, Kr>, ys: List<&2, Kr>) -> List<&2, Ev>:
  match xs ys:
    case Nil{} Nil{}:
      Nil{}
    case _ _:
      Con{ST{}, Nil{}}

def Dw.walk(fuel: Nat, xs: List<&2, Kr>, ys: List<&2, Kr>) -> List<&2, Ev>:
  match fuel:
    case 0n:
      Dw.st(xs, ys)
    case 1n+p:
      match xs ys:
        case Nil{} ys2:
          Dw.ob(ys2)
        case xs2 Nil{}:
          Dw.oa(xs2)
        case Con{+a, ta} Con{+b, tb}:
          +c = Kr.cmp(a, b)
          Con{Dw.ev(c, a, b), Dw.walk(p, Dw.na(c, a, ta), Dw.nb(c, b, tb))}

def Dw.stuck(es: List<&2, Ev>) -> Bool:
  match es:
    case Nil{}:
      False{}
    case Con{ST{}, t}:
      True{}
    case Con{e, t}:
      Dw.stuck(t)

# ---- the report -------------------------------------------------------------------------------
def Dr.push(b: Bool, x: Kr, acc: List<&2, Kr>) -> List<&2, Kr>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Dr.ev_new(+c: U32, e: Ev) -> List<&2, Kr>:
  match e:
    case OB{+b}:
      Dr.push(U32.is_eq(Kr.v(b), c), b, Nil{})
    case _:
      Nil{}

# Head keys with no base row and class c (0 added, 2 allowed).
def Dr.new(es: List<&2, Ev>, +c: U32) -> List<&2, Kr>:
  match es:
    case Nil{}:
      Nil{}
    case Con{e, t}:
      List.append(&2, Kr, Dr.ev_new(c, e), Dr.new(t, c))

def Dr.ev_cov(e: Ev) -> List<&2, Kr>:
  match e:
    case OB{+b}:
      Dr.push(U32.is_eq(Kr.v(b), 1), b, Nil{})
    case BT{a, +b}:
      Dr.push(U32.is_eq(Kr.v(b), 1), b, Nil{})
    case _:
      Nil{}

# Head keys of class 1, with or without a base row.
def Dr.cov(es: List<&2, Ev>) -> List<&2, Kr>:
  match es:
    case Nil{}:
      Nil{}
    case Con{e, t}:
      List.append(&2, Kr, Dr.ev_cov(e), Dr.cov(t))

def Dr.ev_rem(e: Ev) -> List<&2, Kr>:
  match e:
    case OA{a}:
      Con{a, Nil{}}
    case _:
      Nil{}

def Dr.rem(es: List<&2, Ev>) -> List<&2, Kr>:
  match es:
    case Nil{}:
      Nil{}
    case Con{e, t}:
      List.append(&2, Kr, Dr.ev_rem(e), Dr.rem(t))

def Dr.same2(cov: Bool) -> U32:
  match cov:
    case True{}:
      0
    case False{}:
      1

def Dr.ev_same(e: Ev) -> U32:
  match e:
    case BT{a, +b}:
      Dr.same2(U32.is_eq(Kr.v(b), 1))
    case _:
      0

# Matched head keys that are not coverage findings.
def Dr.same(es: List<&2, Ev>) -> U32:
  match es:
    case Nil{}:
      0
    case Con{e, t}:
      U32.add(Dr.ev_same(e), Dr.same(t))

def Dr.pick(b: Bool, x: Kr, y: Kr, acc: List<&2, Mv>) -> List<&2, Mv>:
  match b:
    case True{}:
      Con{Mv{x, y}, acc}
    case False{}:
      acc

# w: worsened (head value above base); otherwise improved (below).
def Dr.dir(w: Bool, +va: U32, +vb: U32) -> Bool:
  match w:
    case True{}:
      U32.is_gt(vb, va)
    case False{}:
      U32.is_lt(vb, va)

def Dr.ev_move(+w: Bool, e: Ev) -> List<&2, Mv>:
  match e:
    case BT{+a, +b}:
      Dr.pick(Dr.dir(w, Kr.v(a), Kr.v(b)), a, b, Nil{})
    case _:
      Nil{}

def Dr.moves(es: List<&2, Ev>, +w: Bool) -> List<&2, Mv>:
  match es:
    case Nil{}:
      Nil{}
    case Con{e, t}:
      List.append(&2, Mv, Dr.ev_move(w, e), Dr.moves(t, w))

type DOut is Data:
  DOut{added: List<&2, Kr>, allowed: List<&2, Kr>, cov: List<&2, Kr>, removed: List<&2, Kr>, same: U32, worse: List<&2, Mv>, better: List<&2, Mv>}

type DIn is Data:
  DIn{kb: List<&2, Kr>, kh: List<&2, Kr>, mb: List<&2, Kr>, mh: List<&2, Kr>}

def DIn.kb(d: DIn) -> List<&2, Kr>:
  match d:
    case DIn{kb, kh, mb, mh}:
      kb

def DIn.kh(d: DIn) -> List<&2, Kr>:
  match d:
    case DIn{kb, kh, mb, mh}:
      kh

def DIn.mb(d: DIn) -> List<&2, Kr>:
  match d:
    case DIn{kb, kh, mb, mh}:
      mb

def DIn.mh(d: DIn) -> List<&2, Kr>:
  match d:
    case DIn{kb, kh, mb, mh}:
      mh

def Dl.fuel(+xs: List<&2, Kr>, +ys: List<&2, Kr>) -> Nat:
  Nat.add(List.length(&2, Kr, xs), List.length(&2, Kr, ys))

def Dl.out(+wk: List<&2, Ev>, +wm: List<&2, Ev>) -> DOut:
  DOut{Dr.new(wk, 0), Dr.new(wk, 2), Dr.cov(wk), Dr.rem(wk), Dr.same(wk), Dr.moves(wm, True{}), Dr.moves(wm, False{})}

def Dl.r4(ok: Bool, +wk: List<&2, Ev>, +wm: List<&2, Ev>) -> Maybe<DOut>:
  match ok:
    case True{}:
      Some{Dl.out(wk, wm)}
    case False{}:
      None{}

# The certificate: all four sorted sides strictly ascending, and neither walk stuck.
def Dl.r3(asc: Bool, +wk: List<&2, Ev>, +wm: List<&2, Ev>) -> Maybe<DOut>:
  Dl.r4(Bool.and(asc, Bool.and(Bool.not(Dw.stuck(wk)), Bool.not(Dw.stuck(wm)))), wk, wm)

def Dl.asc4(+sb: List<&2, Kr>, +sh: List<&2, Kr>, +smb: List<&2, Kr>, +smh: List<&2, Kr>) -> Bool:
  Bool.and(Bool.and(Ks.asc(sb, None{}), Ks.asc(sh, None{})), Bool.and(Ks.asc(smb, None{}), Ks.asc(smh, None{})))

# Each side sorted once; the finding walk and the measure walk over the sorted sides,
# with fuel |base| + |head| (each step consumes a row).
def Dl.r2(+sb: List<&2, Kr>, +sh: List<&2, Kr>, +smb: List<&2, Kr>, +smh: List<&2, Kr>) -> Maybe<DOut>:
  Dl.r3(Dl.asc4(sb, sh, smb, smh), Dw.walk(Dl.fuel(sb, sh), sb, sh), Dw.walk(Dl.fuel(smb, smh), smb, smh))

def Dl.run(d: DIn) -> Maybe<DOut>:
  match d:
    case DIn{kb, kh, mb, mh}:
      Dl.r2(Ks.sort(64n, kb), Ks.sort(64n, kh), Ks.sort(64n, mb), Ks.sort(64n, mh))

# ---- lines ------------------------------------------------------------------------------------
def Dp.ids(xs: List<&2, U32>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{U32.show(h), Dp.ids(t)}

def Dp.line(tag: String, xs: List<&2, U32>) -> String:
  tag ++ " " ++ String.join(Dp.ids(xs), " ")

def Dp.keys(+tag: String, ks: List<&2, Kr>) -> List<&2, String>:
  match ks:
    case Nil{}:
      Nil{}
    case Con{Kr{hi, lo, m, v}, t}:
      Con{Dp.line(tag, [hi, lo]), Dp.keys(tag, t)}

def Dp.moves(+tag: String, ps: List<&2, Mv>) -> List<&2, String>:
  match ps:
    case Nil{}:
      Nil{}
    case Con{Mv{Kr{hi, lo, m, va}, Kr{hi2, lo2, m2, vb}}, t}:
      Con{Dp.line(tag, [hi, lo, m, va, vb]), Dp.moves(tag, t)}

def Dp.len(+xs: List<&2, Kr>) -> U32:
  U32.from_nat(List.length(&2, Kr, xs))

def Dp.plen(+xs: List<&2, Mv>) -> U32:
  U32.from_nat(List.length(&2, Mv, xs))

def Dl.lines(o: DOut) -> List<&2, String>:
  match o:
    case DOut{+ad, +al, +cv, +rm, +sm, +wo, +be}:
      Con{"pulsar-delta 0", List.append(&2, String, Dp.keys("KDA", ad), List.append(&2, String, Dp.keys("KDL", al), List.append(&2, String, Dp.keys("KDC", cv), List.append(&2, String, Dp.keys("KDR", rm), List.append(&2, String, Dp.moves("KDW", wo), List.append(&2, String, Dp.moves("KDI", be), Con{Dp.line("KDS", [Dp.len(ad), Dp.len(al), Dp.len(cv), Dp.len(rm), sm, Dp.plen(wo), Dp.plen(be)]), Nil{}}))))))}

# ---- decoding (unproven, like Rows.bend; fixtures/delta*) ---------------------------------------

def Dd.bad(d: DD) -> DD:
  match d:
    case DD{bad, kd, kb, kh, mb, mh}:
      DD{U32.add(bad, 1), kd, kb, kh, mb, mh}

def Dd.kd(fs: List<&2, U32>, d: DD) -> DD:
  match fs d:
    case Con{z, Nil{}} DD{bad, kd, kb, kh, mb, mh}:
      DD{U32.add(bad, z), U32.add(kd, 1), kb, kh, mb, mh}
    case _ d2:
      Dd.bad(d2)

def Dd.kb(fs: List<&2, U32>, d: DD) -> DD:
  match fs d:
    case Con{a, Con{b, Nil{}}} DD{bad, kd, kb, kh, mb, mh}:
      DD{bad, kd, Con{Kr{a, b, 0, 0}, kb}, kh, mb, mh}
    case _ d2:
      Dd.bad(d2)

def Dd.cls2(b: Bool) -> U32:
  match b:
    case True{}:
      1
    case False{}:
      0

def Dd.cls(+c: U32) -> U32:
  Dd.cls2(U32.is_gt(c, 2))

def Dd.kh(fs: List<&2, U32>, d: DD) -> DD:
  match fs d:
    case Con{a, Con{b, Con{+c, Nil{}}}} DD{bad, kd, kb, kh, mb, mh}:
      DD{U32.add(bad, Dd.cls(c)), kd, kb, Con{Kr{a, b, 0, c}, kh}, mb, mh}
    case _ d2:
      Dd.bad(d2)

def Dd.mb(fs: List<&2, U32>, d: DD) -> DD:
  match fs d:
    case Con{a, Con{b, Con{m, Con{v, Nil{}}}}} DD{bad, kd, kb, kh, mb, mh}:
      DD{bad, kd, kb, kh, Con{Kr{a, b, m, v}, mb}, mh}
    case _ d2:
      Dd.bad(d2)

def Dd.mh(fs: List<&2, U32>, d: DD) -> DD:
  match fs d:
    case Con{a, Con{b, Con{m, Con{v, Nil{}}}}} DD{bad, kd, kb, kh, mb, mh}:
      DD{bad, kd, kb, kh, mb, Con{Kr{a, b, m, v}, mh}}
    case _ d2:
      Dd.bad(d2)

# Tags: KD 19268, KB 19266, KH 19272, MB 19778, MH 19784.
def Dd.add(tag: U32, fs: List<&2, U32>, d: DD) -> DD:
  match tag:
    case 19268:
      Dd.kd(fs, d)
    case 19266:
      Dd.kb(fs, d)
    case 19272:
      Dd.kh(fs, d)
    case 19778:
      Dd.mb(fs, d)
    case 19784:
      Dd.mh(fs, d)
    case _:
      d

def Dd.go(rows: List<&2, W.Row>, d: DD) -> DD:
  match rows:
    case Nil{}:
      d
    case Con{W.Row{tag, fs}, t}:
      Dd.go(t, Dd.add(tag, fs, d))

def Dd.fin2(ok: Bool, d: DIn) -> Maybe<DIn>:
  match ok:
    case True{}:
      Some{d}
    case False{}:
      None{}

# Exactly one KD row, `KD 0`; every K/M row of the right arity; cls at most 2.
def Dd.fin(d: DD) -> Maybe<DIn>:
  match d:
    case DD{bad, kd, kb, kh, mb, mh}:
      Dd.fin2(Bool.and(U32.is_eq(bad, 0), U32.is_eq(kd, 1)), DIn{kb, kh, mb, mh})

def Delta.decode(rows: List<&2, W.Row>) -> Maybe<DIn>:
  Dd.fin(Dd.go(rows, DD{0, 0, Nil{}, Nil{}, Nil{}, Nil{}}))

def Delta.lines2(m: Maybe<DOut>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{o}:
      Some{Dl.lines(o)}

def Delta.lines1(m: Maybe<DIn>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{+d}:
      Delta.lines2(Dl.run(d))
