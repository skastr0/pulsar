# MetricsIn.bend - FN and CT rows (Rows.bend) to Metrics' facts and output lines.
#
#   MetricsIn.lines(r, rows)   Some{FM and FX lines}, or None when an FN or CT row
#                              does not have exactly 4 fields, or Metrics.run
#                              refuses the facts (see Metrics.bend)
#
# Rows with other tags are skipped. A decoder: unproven, like Rows.bend; the laws
# start at Metrics.run.

import Base
import ./Rows.bend as R
import ./Metrics.bend as M

# Tags packed big-endian, as Rows.bend does: "FN" = 70*256+78, "CT" = 67*256+84.
def In.tag_fn() -> U32:
  17998

def In.tag_ct() -> U32:
  17236

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
      In.cons_fn(M.Fn{a, b, c, d}, rest)
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

def In.out(+r: M.Rules, m: Maybe<&2, List<&2, M.FnM>>) -> Maybe<&2, List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{ms}:
      Some{M.Metrics.lines(r, ms)}

def In.go(+r: M.Rules, fm: Maybe<&2, List<&2, M.Fn>>, cm: Maybe<&2, List<&2, M.CtRow>>) -> Maybe<&2, List<&2, String>>:
  match fm cm:
    case Some{fns} Some{cts}:
      In.out(r, M.Metrics.run(r, fns, cts))
    case _ _:
      None{}

def MetricsIn.lines(+r: M.Rules, +rows: List<&2, R.Row>) -> Maybe<&2, List<&2, String>>:
  In.go(r, In.fns(rows), In.cts(rows))
