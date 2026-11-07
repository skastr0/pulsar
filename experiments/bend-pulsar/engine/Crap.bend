# Crap.bend - CRAP (Savoia and Evans) from Metrics' cyclomatic and CV line coverage.
#
#   CRAP = c^2 x u^3 / n^3 + c       c cyclomatic, n coverable lines, u = n - covered,
#                                    `/` integer (floor) division  (FACTS.md "Coverage")
#
# The quotient is computed by Md.go, which adds u^3 c^2 times and carries the
# remainder below n^3, so no intermediate exceeds 2 n^3. With n <= 32768, that is
# under 2^46, inside the runtime's immediate Nat range (2^48). Crap-LAWS.bend proves
# the quotient q and remainder r satisfy q n^3 + r = c^2 u^3 and r < n^3, which is
# exactly floor division.
#
# Coverage data per function:
#   no CV row                       no data: no finding (distinct from 0%)
#   coverable = 0 or > 32768        no data either (no lines to cover / out of range)
#   covered > coverable             invalid facts: the run is refused
#   covered = 0                     0%: CRAP = c^2 + c
#
#   FX core.crap <fn> <crap> <threshold> cyclomatic=<c> covered=<covered> coverable=<n> cause=<complexity-only|coverage>
#        CRAP strictly over the threshold, test functions (TF) excluded; the tail is
#        the finding's input facts (FM cyclomatic and the CV row)
#        cause: complexity-only iff c u^3 <= n^3 (u = n - covered), else coverage
# The join of FnM and CV rows (Crap.join) is unproven, like the builder in
# Metrics.bend; the laws start at the joined records.

import Base
import ./Metrics.bend as M

type Cv is Data:
  Cv{fn: U32, covered: U32, coverable: U32}

# A function with coverage data, as the laws see it.
type Cr is Data:
  Cr{fn: U32, c: Nat, covered: Nat, coverable: Nat, test: Bool}

type CrM is Data:
  CrM{fn: U32, c: Nat, covered: Nat, coverable: Nat, crap: Nat, test: Bool}

type QR is Data:
  QR{q: Nat, r: Nat}

# Rule id 5 is core.crap.
def Crap.default_thr() -> Nat:
  30n

# ---- the formula ------------------------------------------------------------------------------
# a >= b
def Crap.ge(+a: Nat, +b: Nat) -> Bool:
  match a b:
    case 0n 0n:
      True{}
    case 0n 1n+q:
      False{}
    case 1n+p 0n:
      True{}
    case 1n+p 1n+q:
      Crap.ge(p, q)

def Md.step(ge: Bool, +q: Nat, +r2: Nat, +c: Nat) -> QR:
  match ge:
    case True{}:
      QR{1n+q, Nat.sub(r2, c)}
    case False{}:
      QR{q, r2}

# Add b to the remainder k times, moving each whole c into the quotient.
def Md.go(k: Nat, +b: Nat, +c: Nat, s: QR) -> QR:
  match k s:
    case 0n QR{q, r}:
      QR{q, r}
    case 1n+p QR{+q, +r}:
      Md.go(p, b, c, Md.step(Crap.ge(Nat.add(r, b), c), q, Nat.add(r, b), c))

def QR.q(s: QR) -> Nat:
  match s:
    case QR{q, r}:
      q

def QR.r(s: QR) -> Nat:
  match s:
    case QR{q, r}:
      r

def Crap.cube(+x: Nat) -> Nat:
  Nat.mul(x, Nat.mul(x, x))

# floor(c^2 u^3 / n^3)
def Crap.term(+c: Nat, +u: Nat, +n: Nat) -> Nat:
  QR.q(Md.go(Nat.mul(c, c), Crap.cube(u), Crap.cube(n), QR{0n, 0n}))

def Crap.value(+c: Nat, +covered: Nat, +n: Nat) -> Nat:
  Nat.add(Crap.term(c, Nat.sub(n, covered), n), c)

# The cause of a function's CRAP: complexity-only when the coverage term c^2 u^3 / n^3 is at
# most c, that is c u^3 <= n^3 in integers (u = n - covered); otherwise coverage. Delta lists
# complexity-only CRAP under the function's cyclomatic finding, not as a test priority.
def Crap.cause(+c: Nat, +covered: Nat, +n: Nat) -> Bool:
  Crap.ge(Crap.cube(n), Nat.mul(c, Crap.cube(Nat.sub(n, covered))))

def Crap.cause_name(b: Bool) -> String:
  match b:
    case True{}:
      "complexity-only"
    case False{}:
      "coverage"

# ---- measures and findings --------------------------------------------------------------------
def Crap.measure(x: Cr) -> CrM:
  match x:
    case Cr{fn, +c, +covered, +n, test}:
      CrM{fn, c, covered, n, Crap.value(c, covered, n), test}

def Crap.measure_all(xs: List<&2, Cr>) -> List<&2, CrM>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Crap.measure(h), Crap.measure_all(t)}

def Crap.prod(test: Bool, +fn: U32, +v: Nat, +thr: Nat, rest: List<&2, M.Finding>) -> List<&2, M.Finding>:
  match test:
    case True{}:
      rest
    case False{}:
      M.Rule.check(5, fn, v, thr, rest)

def Crap.findings(+thr: Nat, ms: List<&2, CrM>) -> List<&2, M.Finding>:
  match ms:
    case Nil{}:
      Nil{}
    case Con{CrM{+fn, c, covered, n, +v, test}, t}:
      Crap.prod(test, fn, v, thr, Crap.findings(thr, t))

# ---- the join (unproven) ----------------------------------------------------------------------
def Crap.cons(x: Cr, m: Maybe<&2, List<&2, Cr>>) -> Maybe<&2, List<&2, Cr>>:
  match m:
    case None{}:
      None{}
    case Some{l}:
      Some{Con{x, l}}

# A CV row for a function: refuse covered > coverable; skip coverable 0 or > 32768.
def Crap.keep2(valid: Bool, inrange: Bool, x: Cr, rest: Maybe<&2, List<&2, Cr>>) -> Maybe<&2, List<&2, Cr>>:
  match valid inrange:
    case False{} _:
      None{}
    case True{} True{}:
      Crap.cons(x, rest)
    case True{} False{}:
      rest

def Crap.add(hit: Bool, +fn: U32, +c: Nat, +cov: U32, +n: U32, +test: Bool, rest: Maybe<&2, List<&2, Cr>>) -> Maybe<&2, List<&2, Cr>>:
  match hit:
    case True{}:
      Crap.keep2(U32.is_le(cov, n), Bool.and(U32.is_ge(n, 1), U32.is_le(n, 32768)), Cr{fn, c, U32.to_nat(cov), U32.to_nat(n), test}, rest)
    case False{}:
      rest

def Crap.rest(hit: Bool, x: Cv, xs: List<&2, Cv>) -> List<&2, Cv>:
  match hit:
    case True{}:
      xs
    case False{}:
      Con{x, xs}

# Both lists are in function-id order (FACTS.md sorts CV by fn); a CV row left over
# names no function, or is out of order: refuse.
def Crap.join(ms: List<&2, M.FnM>, cvs: List<&2, Cv>) -> Maybe<&2, List<&2, Cr>>:
  match ms cvs:
    case Nil{} Nil{}:
      Some{Nil{}}
    case Nil{} Con{x, xs}:
      None{}
    case Con{m, t} Nil{}:
      Crap.join(t, Nil{})
    case Con{M.FnM{+fn, +cc, nest, np, loc, +test}, t} Con{Cv{+f, +cov, +n}, xs}:
      Crap.add(U32.is_eq(f, fn), fn, cc, cov, n, test, Crap.join(t, Crap.rest(U32.is_eq(f, fn), Cv{f, cov, n}, xs)))

def Crap.ev_pick(hit: Bool, s: String, rest: String) -> String:
  match hit:
    case True{}:
      s
    case False{}:
      rest

# ---- output -----------------------------------------------------------------------------------
def Crap.tail(+c: Nat, +covered: Nat, +n: Nat) -> String:
  " cyclomatic=" ++ Nat.show(c) ++ " covered=" ++ Nat.show(covered) ++ " coverable=" ++ Nat.show(n) ++ " cause=" ++ Crap.cause_name(Crap.cause(c, covered, n))

# The evidence of a finding: the CrM record of its function (the first one, ids are unique).
# A function with no record (no coverage data) has no evidence, so no cause.
def Crap.ev(+fn: U32, ms: List<&2, CrM>) -> String:
  match ms:
    case Nil{}:
      ""
    case Con{CrM{+f, +c, +covered, +n, v, test}, t}:
      Crap.ev_pick(U32.is_eq(f, fn), Crap.tail(c, covered, n), Crap.ev(fn, t))

def Crap.fx_line(+ms: List<&2, CrM>, x: M.Finding) -> String:
  match x:
    case M.Finding{rule, +fn, v, thr}:
      "FX core.crap " ++ U32.show(fn) ++ " " ++ Nat.show(v) ++ " " ++ Nat.show(thr) ++ Crap.ev(fn, ms)

def Crap.fxs(+ms: List<&2, CrM>, xs: List<&2, M.Finding>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Crap.fx_line(ms, h), Crap.fxs(ms, t)}

def Crap.lines(+thr: Nat, +ms: List<&2, CrM>) -> List<&2, String>:
  Crap.fxs(ms, Crap.findings(thr, ms))

def Crap.out(+thr: Nat, m: Maybe<&2, List<&2, Cr>>) -> Maybe<&2, List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{xs}:
      Some{Crap.lines(thr, Crap.measure_all(xs))}

# The entry point: Metrics' measures and the CV rows to CR and FX lines.
def Crap.run(+thr: Nat, ms: List<&2, M.FnM>, cvs: List<&2, Cv>) -> Maybe<&2, List<&2, String>>:
  Crap.out(thr, Crap.join(ms, cvs))
