# MetricsIn.bend - FN and CT rows (Rows.bend) to Metrics' facts and output lines.
#
#   MetricsIn.lines(r, rows)   Some{lines}, or None when an FN or CT row does not
#                              have exactly 4 fields, a TF row 1 field, a CV row 3,
#                              a TF or CV id is not a function in id order,
#                              Metrics.run refuses the facts (see Metrics.bend), or
#                              Crap.join refuses the CV rows (see Crap.bend)
#
# The lines are Metrics' FM and FX lines, then core.crap findings (Crap.bend, from
# the CV rows), then core.hotspot and core.risky-change (Hotspot.bend, from the
# churn of A/C/CFN rows, Churn.bend). A function with a TF row is a test function:
# it gets its FM line, no finding.
#
# Rows with other tags are skipped. A decoder: unproven, like Rows.bend; the laws
# start at Metrics.run, Crap.join and Churn.of (MetricsIn-LAWS.bend).

import Base
import ./Rows.bend as R
import ./Metrics.bend as M
import ./Crap.bend as C
import ./Hotspot.bend as H
import ./Churn.bend as Ch

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

# Metrics' lines, then CRAP's, then the composites over both sets of findings.
def In.all(+r: M.Rules, +ms: List<&2, M.FnM>, +chs: List<&2, H.Ch>, +cs: List<&2, C.CrM>) -> List<&2, String>:
  List.append(&2, String, M.Metrics.lines(r, ms), List.append(&2, String, C.Crap.lines(C.Crap.default_thr(), cs), H.Hotspot.lines(H.Hs.default_thr(), chs, M.Metrics.findings(r, ms), C.Crap.findings(C.Crap.default_thr(), cs))))

def In.comp(+r: M.Rules, +ms: List<&2, M.FnM>, +chs: List<&2, H.Ch>, j: Maybe<&2, List<&2, C.Cr>>) -> Maybe<&2, List<&2, String>>:
  match j:
    case None{}:
      None{}
    case Some{xs}:
      Some{In.all(r, ms, chs, C.Crap.measure_all(xs))}

def In.out(+r: M.Rules, cv: Maybe<&2, List<&2, C.Cv>>, +chs: List<&2, H.Ch>, m: Maybe<&2, List<&2, M.FnM>>) -> Maybe<&2, List<&2, String>>:
  match cv m:
    case Some{cvs} Some{+ms}:
      In.comp(r, ms, chs, C.Crap.join(ms, cvs))
    case _ _:
      None{}

def In.go(+r: M.Rules, cv: Maybe<&2, List<&2, C.Cv>>, +chs: List<&2, H.Ch>, fm: Maybe<&2, List<&2, M.Fn>>, cm: Maybe<&2, List<&2, M.CtRow>>) -> Maybe<&2, List<&2, String>>:
  match fm cm:
    case Some{fns} Some{cts}:
      In.out(r, cv, chs, M.Metrics.run(r, fns, cts))
    case _ _:
      None{}

def MetricsIn.lines(+r: M.Rules, +rows: List<&2, R.Row>) -> Maybe<&2, List<&2, String>>:
  In.go(r, In.cvs(rows), Ch.Churn.of(rows), In.marked(In.fns(rows), In.tfs(rows)), In.cts(rows))
