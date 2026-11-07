# Hotspot.bend - composites of a finding and churn (research/thresholds.md).
#
#   core.hotspot       (rule 6)  a complexity finding (core.cyclomatic, core.nesting
#                                or core.npath) AND churn over the churn threshold
#   core.risky-change  (rule 7)  a core.crap finding AND churn over the threshold
#
# Churn of a function = the number of CFN rows for it whose commit's author is not
# a bot (A author 1), counting rows with touched > 0. CFN rows are distinct per
# (commit, fn) (FactWriter dedups), so this is the number of distinct non-bot
# commits that touched the function in the window the CLI chose (H, policy.toml).
# Default threshold: churn > 2, so at least 3 commits.
#
#   FX core.hotspot <fn> <churn> <threshold> churn=CFN <base-rule>=<value>/<thr> ...
#   FX core.risky-change <fn> <churn> <threshold> churn=CFN core.crap=<crap>/<thr>
# The tail names the finding's input facts: the CFN churn count, then every base
# finding of that function the composite accepts.
#
# Base findings already exclude test functions (TF), so test functions never get a
# composite. Churn counting (Churn.bend: rows -> sorted Ch list) is unproven, like the
# decoders; the laws in Hotspot-LAWS.bend start at the Ch list and the base findings.

import Base
import ./Metrics.bend as M

type Ch is Data:
  Ch{fn: U32, n: Nat}

def Hs.default_thr() -> Nat:
  2n

# ---- which base findings a composite needs ----------------------------------------------------
def Hs.comp(+rule: U32) -> Bool:
  Bool.or(U32.is_eq(rule, 1), Bool.or(U32.is_eq(rule, 2), U32.is_eq(rule, 3)))

# k = 6 hotspot: a complexity finding; k = 7 risky change: a CRAP finding.
def Hs.base_ok(+k: U32, +rule: U32) -> Bool:
  Bool.or(Bool.and(U32.is_eq(k, 6), Hs.comp(rule)), Bool.and(U32.is_eq(k, 7), U32.is_eq(rule, 5)))

# Some base finding for `fn` that composite `k` accepts.
def Hs.any(+k: U32, +fn: U32, base: List<&2, M.Finding>) -> Bool:
  match base:
    case Nil{}:
      False{}
    case Con{M.Finding{rule, f, v, t}, rest}:
      Bool.or(Bool.and(U32.is_eq(f, fn), Hs.base_ok(k, rule)), Hs.any(k, fn, rest))

# One composite finding per churned function over the threshold that has a base finding.
def Hs.find(+k: U32, +thr: Nat, chs: List<&2, Ch>, +base: List<&2, M.Finding>) -> List<&2, M.Finding>:
  match chs:
    case Nil{}:
      Nil{}
    case Con{Ch{+fn, +n}, t}:
      M.Rule.keep(Bool.and(Nat.is_gt(n, thr), Hs.any(k, fn, base)), M.Finding{k, fn, n, thr}, Hs.find(k, thr, t, base))

# ---- output -----------------------------------------------------------------------------------
def Hs.rid(+rule: U32) -> String:
  match rule:
    case 1:
      "core.cyclomatic"
    case 2:
      "core.nesting"
    case 3:
      "core.npath"
    case 4:
      "core.length"
    case 5:
      "core.crap"
    case 6:
      "core.hotspot"
    case _:
      "core.risky-change"

def Hs.ev_keep(hit: Bool, s: String, rest: String) -> String:
  match hit:
    case True{}:
      s ++ rest
    case False{}:
      rest

# The evidence tail: each accepted base finding of the function, as <rule>=<value>/<thr>.
def Hs.evs(+k: U32, +fn: U32, base: List<&2, M.Finding>) -> String:
  match base:
    case Nil{}:
      ""
    case Con{M.Finding{+rule, +f, +v, +t}, rest}:
      Hs.ev_keep(Bool.and(U32.is_eq(f, fn), Hs.base_ok(k, rule)), " " ++ Hs.rid(rule) ++ "=" ++ Nat.show(v) ++ "/" ++ Nat.show(t), Hs.evs(k, fn, rest))

def Hs.out(xs: List<&2, M.Finding>, +base: List<&2, M.Finding>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{M.Finding{+k, +fn, v, t}, rest}:
      Con{"FX " ++ Hs.rid(k) ++ " " ++ U32.show(fn) ++ " " ++ Nat.show(v) ++ " " ++ Nat.show(t) ++ " churn=CFN" ++ Hs.evs(k, fn, base), Hs.out(rest, base)}

# The entry point: churn, Metrics' findings and CRAP findings to composite lines.
def Hotspot.lines(+thr: Nat, +chs: List<&2, Ch>, +metrics: List<&2, M.Finding>, +crap: List<&2, M.Finding>) -> List<&2, String>:
  List.append(&2, String, Hs.out(Hs.find(6, thr, chs, metrics), metrics), Hs.out(Hs.find(7, thr, chs, crap), crap))
