# ClassCtx.bend - the class-in-context detector (core, generic; pure core).
#
# A call site whose callee belongs to class C, in a context that matches a
# rule's masks, is a finding of that rule. The mechanism names no technology:
# classes and contexts are numbers, and every rule instance is data from a pack
# catalog or the repo's policy.toml. The CLI emits RL rows only for the rules
# that are switched on, so classification alone never makes a finding.
#
# Input (FACTS.md, "Symbols, calls and catalogs" and "Class-in-context rules"):
#   CS site fn callee loop_depth ctx    a call site; ctx is a bit set
#   CL sym class                        sym belongs to class
#   RL rule class ctx_any ctx_none      rule fires on class in a context with
#                                       some bit of ctx_any (or ctx_any = 0) and
#                                       no bit of ctx_none
# A rule may have several RL rows; they are OR-ed, and a site is reported once
# per rule however many rows match it.
#
# Output (one finding per rule and site, rules ascending, sites ascending):
#   RCX rule site fn callee
#
# Generalisation: the mechanism is a filter over numbers (class, context bits,
# rule masks) and names no language, framework or incident; it encodes no taste,
# since it fires only on rules a pack or the repo switched on. The classes it
# reads already occur across unrelated repositories: the #660 reach run over
# junto bfc7b01, opencode 36234c4 and effect 9428e17 (cli/src/packs/effect/
# catalog/reach.py) found runtime-escape 913 / 187 / 2180 and error-erasing
# 162 / 517 / 517 call sites, and the always-on js-globals ambient-read class
# 1538 / 926 / 1573.
#
# The detector is a filter, so the laws (ClassCtx-LAWS.bend) state soundness and
# completeness against the fact lists directly. The class lookup goes through
# Scope.set / Scope.has, whose membership laws are proven (Scope-LAWS SC1, SC2).

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./Rows.bend as W

type Cs is Data:
  Cs{site: U32, fn: U32, callee: U32, ld: U32, ctx: U32}

type Cl is Data:
  Cl{sym: U32, c: U32}

type Rl is Data:
  Rl{r: U32, c: U32, any: U32, none: U32}

# One RL row with its class as a set of symbols.
type Rt is Data:
  Rt{r: U32, any: U32, none: U32, t: G.Tr}

type CF is Data:
  CF{css: List<&2, Cs>, cls: List<&2, Cl>, rls: List<&2, Rl>}

type Fd is Data:
  Fd{r: U32, site: U32, fn: U32, callee: U32}

type CD is Data:
  CD{bad: U32, f: CF}

def CF.css(cf: CF) -> List<&2, Cs>:
  match cf:
    case CF{css, cls, rls}:
      css

def CF.cls(cf: CF) -> List<&2, Cl>:
  match cf:
    case CF{css, cls, rls}:
      cls

def CF.rls(cf: CF) -> List<&2, Rl>:
  match cf:
    case CF{css, cls, rls}:
      rls

# ---- the rule's test --------------------------------------------------------------------------
# The context matches: some bit of `any` is set (or `any` is 0), and no bit of `none`.
def Cx.ctx_ok(+any: U32, +none: U32, +ctx: U32) -> Bool:
  Bool.and(Bool.or(U32.is_eq(any, 0), Bool.not(U32.is_eq(U32.and(ctx, any), 0))), U32.is_eq(U32.and(ctx, none), 0))

def Cx.push_u(b: Bool, x: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# The symbols of class c, from the CL facts.
def Cx.ids(cls: List<&2, Cl>, +c: U32) -> List<&2, U32>:
  match cls:
    case Nil{}:
      Nil{}
    case Con{Cl{s, c2}, t}:
      Cx.push_u(U32.is_eq(c2, c), s, Cx.ids(t, c))

# Each RL row with the set of its class's symbols.
def Cx.tables(rls: List<&2, Rl>, +cls: List<&2, Cl>) -> List<&2, Rt>:
  match rls:
    case Nil{}:
      Nil{}
    case Con{Rl{r, c, any, none}, t}:
      Con{Rt{r, any, none, S.Scope.set(Cx.ids(cls, c))}, Cx.tables(t, cls)}

# One row matches the site.
def Cx.row(+rt: Rt, +r: U32, +callee: U32, +ctx: U32) -> Bool:
  match rt:
    case Rt{+r2, +any, +none, +t}:
      Bool.and(U32.is_eq(r2, r), Bool.and(S.Scope.has(t, callee), Cx.ctx_ok(any, none, ctx)))

# Some row of rule r matches the site.
def Cx.hit(rts: List<&2, Rt>, +r: U32, +callee: U32, +ctx: U32) -> Bool:
  match rts:
    case Nil{}:
      False{}
    case Con{+h, t}:
      Bool.or(Cx.row(h, r, callee, ctx), Cx.hit(t, r, callee, ctx))

def Cx.push_f(b: Bool, x: Fd, acc: List<&2, Fd>) -> List<&2, Fd>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# The findings of rule r, in site order.
def Cx.sites(css: List<&2, Cs>, +rts: List<&2, Rt>, +r: U32) -> List<&2, Fd>:
  match css:
    case Nil{}:
      Nil{}
    case Con{Cs{+site, +fn, +callee, ld, +ctx}, t}:
      Cx.push_f(Cx.hit(rts, r, callee, ctx), Fd{r, site, fn, callee}, Cx.sites(t, rts, r))

# The distinct rule ids, in order (RL is sorted by rule first).
def Cx.rules_go(rls: List<&2, Rl>, +prev: U32) -> List<&2, U32>:
  match rls:
    case Nil{}:
      Nil{}
    case Con{Rl{+r, c, any, none}, t}:
      Cx.push_u(Bool.not(U32.is_eq(r, prev)), r, Cx.rules_go(t, r))

def Cx.rules(rls: List<&2, Rl>) -> List<&2, U32>:
  match rls:
    case Nil{}:
      Nil{}
    case Con{Rl{+r, c, any, none}, t}:
      Con{r, Cx.rules_go(t, r)}

def Cx.find(rs: List<&2, U32>, +css: List<&2, Cs>, +rts: List<&2, Rt>) -> List<&2, Fd>:
  match rs:
    case Nil{}:
      Nil{}
    case Con{+r, t}:
      List.append(&2, Fd, Cx.sites(css, rts, r), Cx.find(t, css, rts))

# Every finding of every rule.
def ClassCtx.findings(+cf: CF) -> List<&2, Fd>:
  Cx.find(Cx.rules(CF.rls(cf)), CF.css(cf), Cx.tables(CF.rls(cf), CF.cls(cf)))

# ---- validity ---------------------------------------------------------------------------------
# Every relation is strictly ascending (FACTS.md: sorted, duplicates removed).
# CS is checked on `site` alone, since a site id names one call.
def Cx.lt2(+a: U32, b: U32, +c: U32, d: U32) -> Bool:
  Bool.or(U32.is_lt(a, c), Bool.and(U32.is_eq(a, c), U32.is_lt(b, d)))

def Cx.lt4(+a: U32, +b: U32, c: U32, d: U32, +e: U32, +f: U32, g: U32, h: U32) -> Bool:
  Bool.or(U32.is_lt(a, e), Bool.and(U32.is_eq(a, e), Bool.or(U32.is_lt(b, f), Bool.and(U32.is_eq(b, f), Cx.lt2(c, d, g, h)))))

def Va.css(xs: List<&2, Cs>, pa: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Cs{+a, b, c, d, e}, t}:
      Bool.and(Bool.or(first, U32.is_lt(pa, a)), Va.css(t, a, False{}))

def Va.cls(xs: List<&2, Cl>, pa: U32, pb: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Cl{+a, +b}, t}:
      Bool.and(Bool.or(first, Cx.lt2(pa, pb, a, b)), Va.cls(t, a, b, False{}))

def Va.rls(xs: List<&2, Rl>, pa: U32, pb: U32, pc: U32, pd: U32, first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Rl{+a, +b, +c, +d}, t}:
      Bool.and(Bool.or(first, Cx.lt4(pa, pb, pc, pd, a, b, c, d)), Va.rls(t, a, b, c, d, False{}))

def ClassCtx.valid(+cf: CF) -> Bool:
  match cf:
    case CF{css, cls, rls}:
      Bool.and(Va.css(css, 0, True{}), Bool.and(Va.cls(cls, 0, 0, True{}), Va.rls(rls, 0, 0, 0, 0, True{})))

# ---- the entry point --------------------------------------------------------------------------
def ClassCtx.run2(ok: Bool, +cf: CF) -> Maybe<List<&2, Fd>>:
  match ok:
    case True{}:
      Some{ClassCtx.findings(cf)}
    case False{}:
      None{}

# None when the facts are not valid (ClassCtx.valid).
def ClassCtx.run(+cf: CF) -> Maybe<List<&2, Fd>>:
  ClassCtx.run2(ClassCtx.valid(cf), cf)

# ---- output -----------------------------------------------------------------------------------
def CRep.fd(fs: List<&2, Fd>) -> List<&2, String>:
  match fs:
    case Nil{}:
      Nil{}
    case Con{Fd{r, site, fn, callee}, t}:
      Con{"RCX " ++ U32.show(r) ++ " " ++ U32.show(site) ++ " " ++ U32.show(fn) ++ " " ++ U32.show(callee), CRep.fd(t)}

def CRep.summary(+fs: List<&2, Fd>) -> String:
  "RCXS " ++ U32.show(U32.from_nat(List.length(&2, Fd, fs)))

# Header, one RCX line per finding, then the count.
def ClassCtx.lines(+fs: List<&2, Fd>) -> List<&2, String>:
  Con{"pulsar-classctx 0", List.append(&2, String, CRep.fd(fs), Con{CRep.summary(fs), Nil{}})}

# ---- decoding rows (reader; unproven) ----------------------------------------------------------
# Tags: CS 17235, CL 17228, RL 21068. Other tags belong to other detectors and
# are skipped. A row of a known tag with the wrong field count makes the input bad.

def Cd.bad(d: CD) -> CD:
  match d:
    case CD{bad, f}:
      CD{1, f}

def Cd.cs(fs: List<&2, U32>, d: CD) -> CD:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Con{g, Nil{}}}}}} CD{bad, CF{css, cls, rls}}:
      CD{bad, CF{Con{Cs{a, b, c, e, g}, css}, cls, rls}}
    case _ d2:
      Cd.bad(d2)

def Cd.cl(fs: List<&2, U32>, d: CD) -> CD:
  match fs d:
    case Con{a, Con{b, Nil{}}} CD{bad, CF{css, cls, rls}}:
      CD{bad, CF{css, Con{Cl{a, b}, cls}, rls}}
    case _ d2:
      Cd.bad(d2)

def Cd.rl(fs: List<&2, U32>, d: CD) -> CD:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Nil{}}}}} CD{bad, CF{css, cls, rls}}:
      CD{bad, CF{css, cls, Con{Rl{a, b, c, e}, rls}}}
    case _ d2:
      Cd.bad(d2)

def Cd.add(tag: U32, fs: List<&2, U32>, d: CD) -> CD:
  match tag:
    case 17235:
      Cd.cs(fs, d)
    case 17228:
      Cd.cl(fs, d)
    case 21068:
      Cd.rl(fs, d)
    case _:
      d

def Cd.go(rows: List<&2, W.Row>, d: CD) -> CD:
  match rows:
    case Nil{}:
      d
    case Con{W.Row{tag, fs}, t}:
      Cd.go(t, Cd.add(tag, fs, d))

def Cd.fin2(ok: Bool, f: CF) -> Maybe<CF>:
  match ok:
    case True{}:
      Some{f}
    case False{}:
      None{}

def Cd.fin(d: CD) -> Maybe<CF>:
  match d:
    case CD{bad, CF{css, cls, rls}}:
      Cd.fin2(U32.is_eq(bad, 0), CF{List.reverse(&2, Cs, css), List.reverse(&2, Cl, cls), List.reverse(&2, Rl, rls)})

def ClassCtx.decode(rows: List<&2, W.Row>) -> Maybe<CF>:
  Cd.fin(Cd.go(rows, CD{0, CF{Nil{}, Nil{}, Nil{}}}))
