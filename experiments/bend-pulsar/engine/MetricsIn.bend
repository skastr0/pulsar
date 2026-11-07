# MetricsIn.bend - FN and CT rows (Rows.bend) to Metrics' facts and output lines.
#
#   MetricsIn.lines(r, rows)   Some{lines}, or None when an FN or CT row does not
#                              have exactly 4 fields, a TF row 1 field, a CV or CO row 3,
#                              a TF or CV id is not a function in id order, a CO row
#                              names no kind-6 CT node in order,
#                              Metrics.run refuses the facts (see Metrics.bend), or
#                              Crap.join refuses the CV rows (see Crap.bend)
#
# The lines are FM lines (Metrics' measures, then cognitive), Metrics' FX lines, then core.cognitive findings (Cognitive.bend,
# from the CT tree and the CO operators), then core.crap findings (Crap.bend, from
# the CV rows), then core.hotspot and core.risky-change (Hotspot.bend, from the
# churn of A/C/CFN rows, Churn.bend), then untested data access (Untested.bend, from the
# QS functions and RU rows, over Metrics' records and CRAP). A function with a TF row is a
# test function: it gets its FM line, no finding.
#
# Rows with other tags are skipped. A decoder: unproven, like Rows.bend; the laws
# start at Metrics.run, Crap.join and Churn.of (MetricsIn-LAWS.bend).

import Base
import ./Rows.bend as R
import ./Metrics.bend as M
import ./Crap.bend as C
import ./Hotspot.bend as H
import ./Churn.bend as Ch
import ./Cognitive.bend as G
import ./Untested.bend as U

# Tags packed big-endian, as Rows.bend does: "FN" = 70*256+78, "CT" = 67*256+84.
def In.tag_fn() -> U32:
  17998

def In.tag_ct() -> U32:
  17236

# "TF" = 84*256+70.
def In.tag_tf() -> U32:
  21574

def In.cons_fn(x: M.Fn, m: Maybe<&2, List<&2, M.Fn>>) -> Maybe<&2, List<&2, M.Fn>>:
  match m:
    case None{}:
      None{}
    case Some{l}:
      Some{Con{x, l}}

def In.cons_ct(x: M.CtRow, m: Maybe<&2, List<&2, M.CtRow>>) -> Maybe<&2, List<&2, M.CtRow>>:
  match m:
    case None{}:
      None{}
    case Some{l}:
      Some{Con{x, l}}

def In.fn4(fs: List<&2, U32>, rest: Maybe<&2, List<&2, M.Fn>>) -> Maybe<&2, List<&2, M.Fn>>:
  match fs:
    case Con{a, Con{b, Con{c, Con{d, Nil{}}}}}:
      In.cons_fn(M.Fn{a, b, c, d, False{}}, rest)
    case _:
      None{}

def In.ct4(fs: List<&2, U32>, rest: Maybe<&2, List<&2, M.CtRow>>) -> Maybe<&2, List<&2, M.CtRow>>:
  match fs:
    case Con{a, Con{b, Con{c, Con{d, Nil{}}}}}:
      In.cons_ct(M.CtRow{a, b, c, d}, rest)
    case _:
      None{}

def In.fn_pick(hit: Bool, fs: List<&2, U32>, rest: Maybe<&2, List<&2, M.Fn>>) -> Maybe<&2, List<&2, M.Fn>>:
  match hit:
    case True{}:
      In.fn4(fs, rest)
    case False{}:
      rest

def In.ct_pick(hit: Bool, fs: List<&2, U32>, rest: Maybe<&2, List<&2, M.CtRow>>) -> Maybe<&2, List<&2, M.CtRow>>:
  match hit:
    case True{}:
      In.ct4(fs, rest)
    case False{}:
      rest

# The FN rows, in file order.
def In.fns(rows: List<&2, R.Row>) -> Maybe<&2, List<&2, M.Fn>>:
  match rows:
    case Nil{}:
      Some{Nil{}}
    case Con{R.Row{tag, fs}, t}:
      In.fn_pick(U32.is_eq(tag, In.tag_fn()), fs, In.fns(t))

# The CT rows, in file order.
def In.cts(rows: List<&2, R.Row>) -> Maybe<&2, List<&2, M.CtRow>>:
  match rows:
    case Nil{}:
      Some{Nil{}}
    case Con{R.Row{tag, fs}, t}:
      In.ct_pick(U32.is_eq(tag, In.tag_ct()), fs, In.cts(t))

def In.cons_tf(x: U32, m: Maybe<&2, List<&2, U32>>) -> Maybe<&2, List<&2, U32>>:
  match m:
    case None{}:
      None{}
    case Some{l}:
      Some{Con{x, l}}

def In.tf1(fs: List<&2, U32>, rest: Maybe<&2, List<&2, U32>>) -> Maybe<&2, List<&2, U32>>:
  match fs:
    case Con{a, Nil{}}:
      In.cons_tf(a, rest)
    case _:
      None{}

def In.tf_pick(hit: Bool, fs: List<&2, U32>, rest: Maybe<&2, List<&2, U32>>) -> Maybe<&2, List<&2, U32>>:
  match hit:
    case True{}:
      In.tf1(fs, rest)
    case False{}:
      rest

# The TF rows' function ids, in file order (FACTS.md: sorted by fn).
def In.tfs(rows: List<&2, R.Row>) -> Maybe<&2, List<&2, U32>>:
  match rows:
    case Nil{}:
      Some{Nil{}}
    case Con{R.Row{tag, fs}, t}:
      In.tf_pick(U32.is_eq(tag, In.tag_tf()), fs, In.tfs(t))

def In.rest(hit: Bool, x: U32, xs: List<&2, U32>) -> List<&2, U32>:
  match hit:
    case True{}:
      xs
    case False{}:
      Con{x, xs}

# Mark each function whose id is the next TF id. Both lists are in id order, so a
# TF id left over at the end is not a function, or is out of order: refuse.
def In.mark(fns: List<&2, M.Fn>, tf: List<&2, U32>) -> Maybe<&2, List<&2, M.Fn>>:
  match fns tf:
    case Nil{} Nil{}:
      Some{Nil{}}
    case Nil{} Con{x, xs}:
      None{}
    case Con{M.Fn{fn, file, parent, loc, test}, t} Nil{}:
      In.cons_fn(M.Fn{fn, file, parent, loc, False{}}, In.mark(t, Nil{}))
    case Con{M.Fn{+fn, file, parent, loc, test}, t} Con{+x, xs}:
      In.cons_fn(M.Fn{fn, file, parent, loc, U32.is_eq(x, fn)}, In.mark(t, In.rest(U32.is_eq(x, fn), x, xs)))

def In.marked(fm: Maybe<&2, List<&2, M.Fn>>, tm: Maybe<&2, List<&2, U32>>) -> Maybe<&2, List<&2, M.Fn>>:
  match fm tm:
    case Some{fns} Some{tf}:
      In.mark(fns, tf)
    case _ _:
      None{}

# "CV" = 67*256+86.
def In.tag_cv() -> U32:
  17238

def In.cons_cv(x: C.Cv, m: Maybe<&2, List<&2, C.Cv>>) -> Maybe<&2, List<&2, C.Cv>>:
  match m:
    case None{}:
      None{}
    case Some{l}:
      Some{Con{x, l}}

def In.cv3(fs: List<&2, U32>, rest: Maybe<&2, List<&2, C.Cv>>) -> Maybe<&2, List<&2, C.Cv>>:
  match fs:
    case Con{a, Con{b, Con{c, Nil{}}}}:
      In.cons_cv(C.Cv{a, b, c}, rest)
    case _:
      None{}

def In.cv_pick(hit: Bool, fs: List<&2, U32>, rest: Maybe<&2, List<&2, C.Cv>>) -> Maybe<&2, List<&2, C.Cv>>:
  match hit:
    case True{}:
      In.cv3(fs, rest)
    case False{}:
      rest

# The CV rows, in file order (FACTS.md: sorted by fn).
def In.cvs(rows: List<&2, R.Row>) -> Maybe<&2, List<&2, C.Cv>>:
  match rows:
    case Nil{}:
      Some{Nil{}}
    case Con{R.Row{tag, fs}, t}:
      In.cv_pick(U32.is_eq(tag, In.tag_cv()), fs, In.cvs(t))

# ---- CO: the operator of each short-circuit node ----------------------------------------------
type Co is Data:
  Co{fn: U32, node: U32, op: U32}

# "CO" = 67*256+79.
def In.tag_co() -> U32:
  17231

def In.cons_co(x: Co, m: Maybe<&2, List<&2, Co>>) -> Maybe<&2, List<&2, Co>>:
  match m:
    case None{}:
      None{}
    case Some{l}:
      Some{Con{x, l}}

def In.co3(fs: List<&2, U32>, rest: Maybe<&2, List<&2, Co>>) -> Maybe<&2, List<&2, Co>>:
  match fs:
    case Con{a, Con{b, Con{c, Nil{}}}}:
      In.cons_co(Co{a, b, c}, rest)
    case _:
      None{}

def In.co_pick(hit: Bool, fs: List<&2, U32>, rest: Maybe<&2, List<&2, Co>>) -> Maybe<&2, List<&2, Co>>:
  match hit:
    case True{}:
      In.co3(fs, rest)
    case False{}:
      rest

# The CO and CB rows of one input, each in file order (FACTS.md: sorted by (fn, node)), from a
# single pass over the rows. "CB" = 67*256+66; a CB row has the shape of a CO row
# (`fn node flavor`), so both decode as `Co`.
def In.tag_cb() -> U32:
  17218

type Cr is Data:
  Cr{co: List<&2, Co>, cb: List<&2, Co>}

def In.cr_cons_co(x: Co, m: Maybe<&2, Cr>) -> Maybe<&2, Cr>:
  match m:
    case None{}:
      None{}
    case Some{Cr{co, cb}}:
      Some{Cr{Con{x, co}, cb}}

def In.cr_cons_cb(x: Co, m: Maybe<&2, Cr>) -> Maybe<&2, Cr>:
  match m:
    case None{}:
      None{}
    case Some{Cr{co, cb}}:
      Some{Cr{co, Con{x, cb}}}

def In.cr3_co(fs: List<&2, U32>, rest: Maybe<&2, Cr>) -> Maybe<&2, Cr>:
  match fs:
    case Con{a, Con{b, Con{c, Nil{}}}}:
      In.cr_cons_co(Co{a, b, c}, rest)
    case _:
      None{}

def In.cr3_cb(fs: List<&2, U32>, rest: Maybe<&2, Cr>) -> Maybe<&2, Cr>:
  match fs:
    case Con{a, Con{b, Con{c, Nil{}}}}:
      In.cr_cons_cb(Co{a, b, c}, rest)
    case _:
      None{}

def In.cr_pick_cb(hit: Bool, fs: List<&2, U32>, rest: Maybe<&2, Cr>) -> Maybe<&2, Cr>:
  match hit:
    case True{}:
      In.cr3_cb(fs, rest)
    case False{}:
      rest

def In.cr_pick(hit_co: Bool, hit_cb: Bool, fs: List<&2, U32>, rest: Maybe<&2, Cr>) -> Maybe<&2, Cr>:
  match hit_co:
    case True{}:
      In.cr3_co(fs, rest)
    case False{}:
      In.cr_pick_cb(hit_cb, fs, rest)

def In.crs(rows: List<&2, R.Row>) -> Maybe<&2, Cr>:
  match rows:
    case Nil{}:
      Some{Cr{Nil{}, Nil{}}}
    case Con{R.Row{+tag, fs}, t}:
      In.cr_pick(U32.is_eq(tag, In.tag_co()), U32.is_eq(tag, In.tag_cb()), fs, In.crs(t))

def In.op(+op: U32) -> G.Op:
  match op:
    case 1:
      G.OAnd{}
    case 2:
      G.OOr{}
    case _:
      G.ONone{}

# A CB flavor: 1 conditional expression, 2 `if`, 3 `if` with a plain else, 4 `if` with an `else if`,
# 5 a labelled `break` or `continue` (on a kind-7 node).
def In.flav(+f: U32) -> G.Op:
  match f:
    case 1:
      G.FTern{}
    case 2:
      G.FIf{}
    case 3:
      G.FIfE{}
    case 4:
      G.FIfEl{}
    case 5:
      G.FLab{}
    case _:
      G.ONone{}

def In.tok(+kind: U32, +op: U32) -> G.Op:
  match kind:
    case 6:
      In.op(op)
    case _:
      In.flav(op)

def In.op_pick(hit: Bool, +kind: U32, +op: U32) -> G.Op:
  match hit:
    case True{}:
      In.tok(kind, op)
    case False{}:
      G.ONone{}

# The head row of a CO or CB list against the CT row at `(fn, node)`: whether there is a head and
# whether it is that row's, its fields, and the tail.
type Pk is Data:
  Pk{hit: Bool, has: Bool, f: U32, n: U32, op: U32, tl: List<&2, Co>}

def In.peek(xs: List<&2, Co>, +fn: U32, +node: U32) -> Pk:
  match xs:
    case Nil{}:
      Pk{False{}, False{}, 0, 0, 0, Nil{}}
    case Con{Co{+f, +n, +op}, t}:
      Pk{Bool.and(U32.is_eq(f, fn), U32.is_eq(n, node)), True{}, f, n, op, t}

# The list after a row was (y) or was not taken.
def In.left(y: Bool, +has: Bool, +f: U32, +n: U32, +op: U32, tl: List<&2, Co>) -> List<&2, Co>:
  match y:
    case True{}:
      tl
    case False{}:
      match has:
        case True{}:
          Con{Co{f, n, op}, tl}
        case False{}:
          tl

def In.cons_op(emit: Bool, o: G.Op, m: Maybe<&2, List<&2, G.Op>>) -> Maybe<&2, List<&2, G.Op>>:
  match emit m:
    case True{} Some{l}:
      Some{Con{o, l}}
    case False{} Some{l}:
      Some{l}
    case _ None{}:
      None{}

# What one CT row takes: whether it emits a token, the token, and the CO and CB rows left. A
# kind-6 row takes the CO row at its (fn, node), a kind-1 or kind-7 row the CB row there.
type Stp is Data:
  Stp{emit: Bool, tok: G.Op, cos: List<&2, Co>, cbs: List<&2, Co>}

def Stp.emit(s: Stp) -> Bool:
  match s:
    case Stp{e, t, c, b}:
      e

def Stp.tok(s: Stp) -> G.Op:
  match s:
    case Stp{e, t, c, b}:
      t

def Stp.cos(s: Stp) -> List<&2, Co>:
  match s:
    case Stp{e, t, c, b}:
      c

def Stp.cbs(s: Stp) -> List<&2, Co>:
  match s:
    case Stp{e, t, c, b}:
      b

def In.step(+kind: U32, pc: Pk, pb: Pk) -> Stp:
  match pc pb:
    case Pk{+hc, +hasc, +fc, +nc, +oc, tc} Pk{+hb, +hasb, +fb, +nb, +ob, tb}:
      +sc = U32.is_eq(kind, 6)
      +br = Bool.pick(Bool, U32.is_eq(kind, 1), True{}, U32.is_eq(kind, 7))
      +yc = Bool.and(sc, hc)
      +yb = Bool.and(br, hb)
      Stp{Bool.pick(Bool, sc, True{}, br), Bool.pick(G.Op, yc, In.tok(kind, oc), Bool.pick(G.Op, yb, In.tok(kind, ob), G.ONone{})), In.left(yc, hasc, fc, nc, oc, tc), In.left(yb, hasb, fb, nb, ob, tb)}

# One token per kind-6, kind-1 or kind-7 CT row, in CT order, or ONone when its row is missing. A CO or
# CB row left over names no such node, or is out of order: refuse.
def In.align(cts: List<&2, M.CtRow>, cos: List<&2, Co>, cbs: List<&2, Co>) -> Maybe<&2, List<&2, G.Op>>:
  match cts:
    case Nil{}:
      match cos cbs:
        case Nil{} Nil{}:
          Some{Nil{}}
        case _ _:
          None{}
    case Con{M.CtRow{+fn, +node, p, +kind}, t}:
      +s = In.step(kind, In.peek(cos, fn, node), In.peek(cbs, fn, node))
      In.cons_op(Stp.emit(s), Stp.tok(s), In.align(t, Stp.cos(s), Stp.cbs(s)))

def In.ops(+cts: List<&2, M.CtRow>, om: Maybe<&2, Cr>) -> Maybe<&2, List<&2, G.Op>>:
  match om:
    case None{}:
      None{}
    case Some{Cr{cos, cbs}}:
      In.align(cts, cos, cbs)

# ---- the joined output ------------------------------------------------------------------------
# FM lines with cognitive, Metrics' FX lines, then cognitive's, then CRAP's, then the composites over Metrics' and
# CRAP's findings.
def In.all(+r: M.Rules, +ms: List<&2, M.FnM>, gs: List<&2, G.CgM>, gl: List<&2, String>, +chs: List<&2, H.Ch>, u: U.UF, +cs: List<&2, C.CrM>) -> List<&2, String>:
  List.append(&2, String, G.Cog.fms(ms, gs), List.append(&2, String, M.Report.fxs(M.Metrics.findings(r, ms)), List.append(&2, String, gl, List.append(&2, String, C.Crap.lines(C.Crap.default_thr(), cs), List.append(&2, String, H.Hotspot.lines(H.Hs.default_thr(), chs, M.Metrics.findings(r, ms), C.Crap.findings(C.Crap.default_thr(), cs)), U.Untested.lines(ms, C.Crap.findings(C.Crap.default_thr(), cs), cs, u))))))

def In.comp(+r: M.Rules, +ms: List<&2, M.FnM>, gs: List<&2, G.CgM>, gl: List<&2, String>, +chs: List<&2, H.Ch>, u: U.UF, j: Maybe<&2, List<&2, C.Cr>>) -> Maybe<&2, List<&2, String>>:
  match j:
    case None{}:
      None{}
    case Some{xs}:
      Some{In.all(r, ms, gs, gl, chs, u, C.Crap.measure_all(xs))}

# The trees measured once by Metrics and once by Cognitive, then joined with the CV rows.
# The cognitive measures give both the FM lines' fifth field and the core.cognitive findings.
def In.meas(+r: M.Rules, cvs: List<&2, C.Cv>, +chs: List<&2, H.Ch>, u: U.UF, +ops: List<&2, G.Op>, +fts: List<&2, M.FnT>) -> Maybe<&2, List<&2, String>>:
  +ms = M.Metrics.measure_all(fts, M.Rules.cap(r))
  +gs = G.Cog.measure_all(fts, ops)
  In.comp(r, ms, gs, G.Cog.fxs(G.Cog.findings(G.Cog.default_thr(), gs)), chs, u, C.Crap.join(ms, cvs))

def In.out(+r: M.Rules, cv: Maybe<&2, List<&2, C.Cv>>, +chs: List<&2, H.Ch>, u: U.UF, om: Maybe<&2, List<&2, G.Op>>, m: Maybe<&2, List<&2, M.FnT>>) -> Maybe<&2, List<&2, String>>:
  match cv om m:
    case Some{cvs} Some{ops} Some{fts}:
      In.meas(r, cvs, chs, u, ops, fts)
    case _ _ _:
      None{}

def In.go(+r: M.Rules, cv: Maybe<&2, List<&2, C.Cv>>, +chs: List<&2, H.Ch>, u: U.UF, om: Maybe<&2, Cr>, fm: Maybe<&2, List<&2, M.Fn>>, cm: Maybe<&2, List<&2, M.CtRow>>) -> Maybe<&2, List<&2, String>>:
  match fm cm:
    case Some{fns} Some{+cts}:
      In.out(r, cv, chs, u, In.ops(cts, om), M.Trees.of(fns, cts))
    case _ _:
      None{}

# ---- QS and RU: untested data access ----------------------------------------------------------
# "QS" = 81*256+83, "RU" = 82*256+85. A QS row is `site file fn node kind flags`; a QS or RU
# row with another field count is skipped here (the SQL section refuses it).
def In.tag_qs() -> U32:
  20819

def In.tag_ru() -> U32:
  21077

def In.qfn(fs: List<&2, U32>, rest: List<&2, U32>) -> List<&2, U32>:
  match fs:
    case Con{a, Con{b, Con{c, Con{d, Con{e, Con{f, Nil{}}}}}}}:
      Con{c, rest}
    case _:
      rest

def In.qpick(hit: Bool, fs: List<&2, U32>, rest: List<&2, U32>) -> List<&2, U32>:
  match hit:
    case True{}:
      In.qfn(fs, rest)
    case False{}:
      rest

def In.qfns(rows: List<&2, R.Row>) -> List<&2, U32>:
  match rows:
    case Nil{}:
      Nil{}
    case Con{R.Row{tag, fs}, t}:
      In.qpick(U32.is_eq(tag, In.tag_qs()), fs, In.qfns(t))

def In.ru1(fs: List<&2, U32>, rest: List<&2, U32>) -> List<&2, U32>:
  match fs:
    case Con{a, Nil{}}:
      Con{a, rest}
    case _:
      rest

def In.rpick(hit: Bool, fs: List<&2, U32>, rest: List<&2, U32>) -> List<&2, U32>:
  match hit:
    case True{}:
      In.ru1(fs, rest)
    case False{}:
      rest

def In.rus(rows: List<&2, R.Row>) -> List<&2, U32>:
  match rows:
    case Nil{}:
      Nil{}
    case Con{R.Row{tag, fs}, t}:
      In.rpick(U32.is_eq(tag, In.tag_ru()), fs, In.rus(t))

def In.un(+rows: List<&2, R.Row>) -> U.UF:
  U.UF{In.qfns(rows), In.rus(rows)}

def MetricsIn.lines(+r: M.Rules, +rows: List<&2, R.Row>) -> Maybe<&2, List<&2, String>>:
  In.go(r, In.cvs(rows), Ch.Churn.of(rows), In.un(rows), In.crs(rows), In.marked(In.fns(rows), In.tfs(rows)), In.cts(rows))
