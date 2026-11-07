# engine/ClassCtx-LAWS.bend - laws for ClassCtx.bend, the class-in-context detector.
# (The <Module>.LAWS.bend pair, spelled with a hyphen: a module path is plain
# names.) Filled in ClassCtx-PROOF.bend; gate: `bend engine/ClassCtx-PROOF.bend --verdict`.
#
# Every law is about the functions pulsar-classctx runs: ClassCtx.run, the
# finding function it calls (ClassCtx.findings) and the output (ClassCtx.lines).
# Soundness and completeness are stated in fact membership, never in terms of
# the class tables (Scope.set) the detector builds.
#
# The words here:
#   - "a CS fact at site, fn, callee with context ctx": some `CS site fn callee _ ctx`.
#   - "rule r covers class c with masks any, none": some `RL r c any none`.
#   - "the context matches": X.Cx.ctx_ok(any, none, ctx), that is
#       (any == 0 or ctx & any != 0) and ctx & none == 0.
#   - "a finding r site fn callee": some RCX record with those fields.
#
# Not covered by any law, by design: Rows.bend and ClassCtx.decode (bytes and
# rows to fact lists; shown against engine/fixtures/classctx), the decimal
# formatting inside ClassCtx.lines, and what ClassCtx.valid accepts (X1 and X2
# hold for any fact lists, sorted or not; E2 only says invalid input is refused;
# the invalid fixtures show which inputs are). One finding per (rule, site) holds by
# construction (each rule id is visited once, each site once per rule) and is
# checked by the fixtures, not proven.

import Base
import ../LAWS.bend as TL
import ./ClassCtx.bend as X

# ---- fact membership ---------------------------------------------------------------------------
# Some `CS site fn callee _ ctx` fact.
def CsAt(css: List<&2, X.Cs>, site: U32, fn: U32, callee: U32, ctx: U32) -> Data:
  match css:
    case Nil{}:
      Empty
    case Con{X.Cs{s2, f2, c2, ld, x2}, t}:
      Either<&2, &2, TL.And({s2 == site : U32}, TL.And({f2 == fn : U32}, TL.And({c2 == callee : U32}, {x2 == ctx : U32}))), CsAt(t, site, fn, callee, ctx)>

# Some `CL sym c` fact.
def ClHas(cls: List<&2, X.Cl>, sym: U32, c: U32) -> Data:
  match cls:
    case Nil{}:
      Empty
    case Con{X.Cl{s2, c2}, t}:
      Either<&2, &2, TL.And({s2 == sym : U32}, {c2 == c : U32}), ClHas(t, sym, c)>

# Some `RL r c any none` fact.
def RlHas(rls: List<&2, X.Rl>, r: U32, c: U32, any: U32, none: U32) -> Data:
  match rls:
    case Nil{}:
      Empty
    case Con{X.Rl{r2, c2, a2, n2}, t}:
      Either<&2, &2, TL.And({r2 == r : U32}, TL.And({c2 == c : U32}, TL.And({a2 == any : U32}, {n2 == none : U32}))), RlHas(t, r, c, any, none)>

# Some finding with these fields in the list.
def FdAt(fs: List<&2, X.Fd>, r: U32, site: U32, fn: U32, callee: U32) -> Data:
  match fs:
    case Nil{}:
      Empty
    case Con{X.Fd{r2, s2, f2, c2}, t}:
      Either<&2, &2, TL.And({r2 == r : U32}, TL.And({s2 == site : U32}, TL.And({f2 == fn : U32}, {c2 == callee : U32}))), FdAt(t, r, site, fn, callee)>

# The facts that justify a finding r site fn callee: a CS fact at that site
# with some context ctx, and an RL row of r for a class c of the callee whose
# masks match ctx.
def Why(cf: X.CF, r: U32, site: U32, fn: U32, callee: U32) -> Data:
  TL.Ex(U32, ctx => TL.And(CsAt(X.CF.css(cf), site, fn, callee, ctx), TL.Ex(U32, c => TL.Ex(U32, any => TL.Ex(U32, none => TL.And(RlHas(X.CF.rls(cf), r, c, any, none), TL.And(ClHas(X.CF.cls(cf), callee, c), {X.Cx.ctx_ok(any, none, ctx) == True{} : Bool})))))))

# ---- the detector ------------------------------------------------------------------------------
# X1. soundness: every finding is justified by the facts.
law classctx_sound:
  for +cf: X.CF
  for +r: U32
  for +site: U32
  for +fn: U32
  for +callee: U32
  for h: FdAt(X.ClassCtx.findings(cf), r, site, fn, callee)
  Why(cf, r, site, fn, callee)

# X2. completeness: every site the facts justify for a rule is reported.
law classctx_complete:
  for +cf: X.CF
  for +site: U32
  for +fn: U32
  for +callee: U32
  for +ctx: U32
  for +r: U32
  for +c: U32
  for +any: U32
  for +none: U32
  for hs: CsAt(X.CF.css(cf), site, fn, callee, ctx)
  for hr: RlHas(X.CF.rls(cf), r, c, any, none)
  for hc: ClHas(X.CF.cls(cf), callee, c)
  for hx: {X.Cx.ctx_ok(any, none, ctx) == True{} : Bool}
  FdAt(X.ClassCtx.findings(cf), r, site, fn, callee)

# X3. the context test is the mask formula, written out over U32 bit operations:
# some bit of any (or any = 0), and no bit of none. X1 and X2 name the test as
# X.Cx.ctx_ok; this law pins what that function computes.
law ctx_ok_is_masks:
  for +any: U32
  for +none: U32
  for +ctx: U32
  {X.Cx.ctx_ok(any, none, ctx) == Bool.and(Bool.or(U32.is_eq(any, 0), Bool.not(U32.is_eq((ctx .&. any : U32), 0))), U32.is_eq((ctx .&. none : U32), 0)) : Bool}

# ---- the entry point -----------------------------------------------------------------------------
# E1. valid facts: the binary's result is exactly the finding function.
law run_is_findings:
  for +cf: X.CF
  for ok: {X.ClassCtx.valid(cf) == True{} : Bool}
  {X.ClassCtx.run(cf) == Some{X.ClassCtx.findings(cf)} : Maybe<List<&2, X.Fd>>}

# E2. invalid facts (a relation not strictly ascending) are refused, never analysed.
law run_refuses_invalid:
  for +cf: X.CF
  for bad: {X.ClassCtx.valid(cf) == False{} : Bool}
  {X.ClassCtx.run(cf) == None{} : Maybe<List<&2, X.Fd>>}

# E3. the printed lines are built from the findings and nothing else: the
# header, one RCX line per finding in order, and the count.
law lines_shape:
  for +fs: List<&2, X.Fd>
  {X.ClassCtx.lines(fs) == Con{"pulsar-classctx 0", List.append(&2, String, X.CRep.fd(fs), Con{X.CRep.summary(fs), Nil{}})} : List<&2, String>}
