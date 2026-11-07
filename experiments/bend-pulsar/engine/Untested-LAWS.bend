# engine/Untested-LAWS.bend - laws about Untested.bend. Proofs: Untested-PROOF.bend.
# Gate: `bend engine/Untested-PROOF.bend --verdict`.
#
# UAt(m, y) is what "y is an untested-data-access finding of rule r for the function m" means
# in the facts: m is not a test function, a QS fact names it, and either y is reason 1 and
# a core.crap finding names it, or y is reason 2 and every coverage record names another
# function (NoRec). The laws:
# every finding of a rule row is UAt for some function of Metrics' records (sound), and
# every such y is a finding (complete); over all RU rows, the findings are exactly the
# union of the rows'. Not covered, by design: decoding the rows.

import Base
import ../LAWS.bend as TL
import ./Metrics.bend as M
import ./Metrics-LAWS.bend as ML
import ./Crap.bend as C
import ./Scope.bend as S
import ./Untested.bend as U

def MemUx(xs: List<&2, U.Ux>, m: U.Ux) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : U.Ux}, MemUx(t, m)>

def FFn(x: M.Finding) -> U32:
  match x:
    case M.Finding{rule, fn, v, thr}:
      fn

def CFn(x: C.CrM) -> U32:
  match x:
    case C.CrM{fn, c, covered, n, v, test}:
      fn

# A core.crap finding names fn.
def CrapAt(+crs: List<&2, M.Finding>, +fn: U32) -> Data:
  TL.Ex(M.Finding, x => TL.And(ML.MemF(crs, x), {FFn(x) == fn : U32}))

# No coverage record names fn: every record's function is another one.
def NoRec(cms: List<&2, C.CrM>, +fn: U32) -> Data:
  match cms:
    case Nil{}:
      {True{} == True{} : Bool}
    case Con{h, t}:
      TL.And({U32.is_eq(CFn(h), fn) == False{} : Bool}, NoRec(t, fn))

def UAt(m: M.FnM, +qfns: List<&2, U32>, +crs: List<&2, M.Finding>, +cms: List<&2, C.CrM>, +r: U32, +y: U.Ux) -> Data:
  match m:
    case M.FnM{fn, cc, nest, np, loc, test}:
      TL.And({test == False{} : Bool}, TL.And(TL.Mem(qfns, fn), Either<&2, &2, TL.And({U.Ux{r, fn, 1} == y : U.Ux}, CrapAt(crs, fn)), TL.And({U.Ux{r, fn, 2} == y : U.Ux}, NoRec(cms, fn))>))

# ---- one rule row -----------------------------------------------------------------------------
law un_rule_sound:
  for +ms: List<&2, M.FnM>
  for +qfns: List<&2, U32>
  for +crs: List<&2, M.Finding>
  for +cms: List<&2, C.CrM>
  for +r: U32
  for +y: U.Ux
  for hm: MemUx(U.Un.rule(ms, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y)
  TL.Ex(M.FnM, m => TL.And(ML.MemM(ms, m), UAt(m, qfns, crs, cms, r, y)))

law un_rule_complete:
  for +ms: List<&2, M.FnM>
  for +qfns: List<&2, U32>
  for +crs: List<&2, M.Finding>
  for +cms: List<&2, C.CrM>
  for +r: U32
  for +y: U.Ux
  for +m: M.FnM
  for hm: ML.MemM(ms, m)
  for w: UAt(m, qfns, crs, cms, r, y)
  MemUx(U.Un.rule(ms, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y)

# ---- every rule row ---------------------------------------------------------------------------
law un_findings_sound:
  for +ms: List<&2, M.FnM>
  for +crs: List<&2, M.Finding>
  for +cms: List<&2, C.CrM>
  for +qfns: List<&2, U32>
  for +rus: List<&2, U32>
  for +y: U.Ux
  for hm: MemUx(U.Untested.findings(ms, crs, cms, U.UF{qfns, rus}), y)
  TL.Ex(U32, r => TL.And(TL.Mem(rus, r), MemUx(U.Un.rule(ms, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y)))

law un_findings_complete:
  for +ms: List<&2, M.FnM>
  for +crs: List<&2, M.Finding>
  for +cms: List<&2, C.CrM>
  for +qfns: List<&2, U32>
  for +rus: List<&2, U32>
  for +r: U32
  for +y: U.Ux
  for hr: TL.Mem(rus, r)
  for hm: MemUx(U.Un.rule(ms, r, S.Scope.set(qfns), S.Scope.set(U.Un.ffns(crs)), S.Scope.set(U.Un.dfns(cms))), y)
  MemUx(U.Untested.findings(ms, crs, cms, U.UF{qfns, rus}), y)

# ---- output -----------------------------------------------------------------------------------
law un_lines_off:
  for +ms: List<&2, M.FnM>
  for +crs: List<&2, M.Finding>
  for +cms: List<&2, C.CrM>
  for +qfns: List<&2, U32>
  {U.Untested.lines(ms, crs, cms, U.UF{qfns, Nil{}}) == Nil{} : List<&2, String>}

law un_lines_shape:
  for +ms: List<&2, M.FnM>
  for +crs: List<&2, M.Finding>
  for +cms: List<&2, C.CrM>
  for +qfns: List<&2, U32>
  for +r: U32
  for +t: List<&2, U32>
  {U.Untested.lines(ms, crs, cms, U.UF{qfns, Con{r, t}}) == Con{"pulsar-untested 0", List.append(&2, String, U.Un.lines(U.Untested.findings(ms, crs, cms, U.UF{qfns, Con{r, t}})), ["UXS " ++ Nat.show(List.length(&2, U.Ux, U.Untested.findings(ms, crs, cms, U.UF{qfns, Con{r, t}})))])} : List<&2, String>}
