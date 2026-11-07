# AsyncCtx.bend - awaited work inside an exclusive section, and async work dropped in an entry
# point (core, generic; pure core).
#
# Two rule kinds, both filters over call sites. Classes are numbers from the catalogs, so the
# mechanism names no technology: what is `exclusive` (a Durable Object's blockConcurrencyWhile,
# a semaphore's withPermits, a mutex) or `remote` (fetch, a stub call, RPC) is pack data. The CLI
# writes the rule rows only for active rules, so the facts alone never make a finding.
#
# Input (FACTS.md):
#   CS site fn callee loop_depth ctx    a call site of a catalog symbol
#   CL sym class                        sym belongs to class
#   AW site                             the call's value is awaited (await, yield*)
#   XN site outer                       site lies lexically inside an argument of call site outer
#   DV site                             the call's value is dropped (an expression statement)
#   EP fn kind                          fn is an entry point
#   CE site fn target node ld ctx       a call to repo function target
#   FC fn file ctx                      the ctx bits in force in fn (bit 1: async)
#   RX rule inner outer                 exclusive rule: an awaited call of class inner inside
#                                       the arguments of a call of class outer
#   RD rule class async                 dropped rule: a dropped call of class, or (async = 1) a
#                                       dropped call of an async repo function, directly in an
#                                       entry point's body
#
# Output (AsyncCtx.lines): `pulsar-async 0`, then per RX row in row order one `AXX rule site fn`
# per matching CS site, then per RD row in row order one `ADX rule site fn` per matching CS site
# and then per matching CE site, then `ASYN n`, the count. CS and CE must be in strict site
# order, or the section refuses (None, exit 2), so the lines are a function of the facts.
# The CLI groups the lines by (rule, site).
#
# Generalisation: both are joins of numbers (sites, classes, function ids). The exclusive rule
# is "held a lock across remote I/O"; the dropped rule is "started work the platform may cancel
# when the entry point returns". Neither names a runtime. Laws: AsyncCtx-LAWS.bend.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./ClassCtx.bend as X
import ./Fanout.bend as F
import ./FnCtx.bend as N
import ./Rows.bend as W

type Xn is Data:
  Xn{site: U32, outer: U32}

type Rx is Data:
  Rx{r: U32, inner: U32, outer: U32}

type Rd is Data:
  Rd{r: U32, c: U32, a: U32}

type Ad is Data:
  Ad{r: U32, site: U32, fn: U32}

type AF is Data:
  AF{css: List<&2, X.Cs>, cls: List<&2, X.Cl>, aws: List<&2, U32>, xns: List<&2, Xn>, dvs: List<&2, U32>, eps: List<&2, U32>, ces: List<&2, F.Ce>, fcs: List<&2, N.Fc>, rxs: List<&2, Rx>, rds: List<&2, Rd>}

def Ac.keep(b: Bool, x: Ad, acc: List<&2, Ad>) -> List<&2, Ad>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# ---- the sets ---------------------------------------------------------------------------------
# The CS sites whose callee is in the set oc.
def Ac.osites(css: List<&2, X.Cs>, +oc: G.Tr) -> List<&2, U32>:
  match css:
    case Nil{}:
      Nil{}
    case Con{X.Cs{+site, fn, +callee, ld, ctx}, t}:
      X.Cx.push_u(S.Scope.has(oc, callee), site, Ac.osites(t, oc))

# The XN sites whose outer site is in the set os.
def Ac.xin(xns: List<&2, Xn>, +os: G.Tr) -> List<&2, U32>:
  match xns:
    case Nil{}:
      Nil{}
    case Con{Xn{+site, +outer}, t}:
      X.Cx.push_u(S.Scope.has(os, outer), site, Ac.xin(t, os))

# The AW sites that are also in the set xs.
def Ac.both(aws: List<&2, U32>, +xs: G.Tr) -> List<&2, U32>:
  match aws:
    case Nil{}:
      Nil{}
    case Con{+s, t}:
      X.Cx.push_u(S.Scope.has(xs, s), s, Ac.both(t, xs))

# ---- exclusive rules --------------------------------------------------------------------------
# The CS sites whose callee is in ta and whose site is in tb.
def Ac.xs(css: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr) -> List<&2, Ad>:
  match css:
    case Nil{}:
      Nil{}
    case Con{X.Cs{+site, +fn, +callee, ld, ctx}, t}:
      Ac.keep(Bool.and(S.Scope.has(ta, callee), S.Scope.has(tb, site)), Ad{r, site, fn}, Ac.xs(t, r, ta, tb))

# The sites an RX row reports: callee of class inner, awaited, inside the arguments of a call
# of class outer.
def Ac.xset(+f: AF, +outer: U32) -> G.Tr:
  match f:
    case AF{+css, +cls, +aws, +xns, dvs, eps, ces, fcs, rxs, rds}:
      S.Scope.set(Ac.both(aws, S.Scope.set(Ac.xin(xns, S.Scope.set(Ac.osites(css, S.Scope.set(X.Cx.ids(cls, outer))))))))

def Ac.xrule(+f: AF, +k: Rx) -> List<&2, Ad>:
  match f k:
    case AF{+css, +cls, aws, xns, dvs, eps, ces, fcs, rxs, rds} Rx{+r, +inner, +outer}:
      Ac.xs(css, r, S.Scope.set(X.Cx.ids(cls, inner)), Ac.xset(f, outer))

def Ac.xrules(+f: AF, ks: List<&2, Rx>) -> List<&2, Ad>:
  match ks:
    case Nil{}:
      Nil{}
    case Con{+k, t}:
      List.append(&2, Ad, Ac.xrule(f, k), Ac.xrules(f, t))

# ---- dropped rules ----------------------------------------------------------------------------
# The CS sites whose callee is in ta, whose site is in tb and whose function is in tc.
def Ac.ds(css: List<&2, X.Cs>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr) -> List<&2, Ad>:
  match css:
    case Nil{}:
      Nil{}
    case Con{X.Cs{+site, +fn, +callee, ld, ctx}, t}:
      Ac.keep(Bool.and(S.Scope.has(ta, callee), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))), Ad{r, site, fn}, Ac.ds(t, r, ta, tb, tc))

# The CE sites whose target is in ta, whose site is in tb and whose function is in tc.
def Ac.de(ces: List<&2, F.Ce>, +r: U32, +ta: G.Tr, +tb: G.Tr, +tc: G.Tr) -> List<&2, Ad>:
  match ces:
    case Nil{}:
      Nil{}
    case Con{F.Ce{+site, +fn, +target, node, ld, ctx}, t}:
      Ac.keep(Bool.and(S.Scope.has(ta, target), Bool.and(S.Scope.has(tb, site), S.Scope.has(tc, fn))), Ad{r, site, fn}, Ac.de(t, r, ta, tb, tc))

# The async branch of an RD row: on only when its `async` field is 1.
def Ac.dasync(on: Bool, +ces: List<&2, F.Ce>, +fcs: List<&2, N.Fc>, +r: U32, +tb: G.Tr, +tc: G.Tr) -> List<&2, Ad>:
  match on:
    case True{}:
      Ac.de(ces, r, S.Scope.set(N.Nc.fns(fcs, 1, 0)), tb, tc)
    case False{}:
      Nil{}

def Ac.drule(+f: AF, +k: Rd) -> List<&2, Ad>:
  match f k:
    case AF{+css, +cls, aws, xns, +dvs, +eps, +ces, +fcs, rxs, rds} Rd{+r, +c, +a}:
      List.append(&2, Ad, Ac.ds(css, r, S.Scope.set(X.Cx.ids(cls, c)), S.Scope.set(dvs), S.Scope.set(eps)), Ac.dasync(U32.is_eq(a, 1), ces, fcs, r, S.Scope.set(dvs), S.Scope.set(eps)))

def Ac.drules(+f: AF, ks: List<&2, Rd>) -> List<&2, Ad>:
  match ks:
    case Nil{}:
      Nil{}
    case Con{+k, t}:
      List.append(&2, Ad, Ac.drule(f, k), Ac.drules(f, t))

def AsyncCtx.excl(+f: AF) -> List<&2, Ad>:
  match f:
    case AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}:
      Ac.xrules(f, rxs)

def AsyncCtx.dropped(+f: AF) -> List<&2, Ad>:
  match f:
    case AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}:
      Ac.drules(f, rds)

# ---- output -----------------------------------------------------------------------------------
def Ac.line(+tag: String, x: Ad) -> String:
  match x:
    case Ad{r, site, fn}:
      tag ++ " " ++ U32.show(r) ++ " " ++ U32.show(site) ++ " " ++ U32.show(fn)

def Ac.lines(+tag: String, xs: List<&2, Ad>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Ac.line(tag, h), Ac.lines(tag, t)}

def Ac.count(+xs: List<&2, Ad>, +ds: List<&2, Ad>) -> String:
  "ASYN " ++ Nat.show(Nat.add(List.length(&2, Ad, xs), List.length(&2, Ad, ds)))

def AsyncCtx.lines(+f: AF) -> List<&2, String>:
  +xs = AsyncCtx.excl(f)
  +ds = AsyncCtx.dropped(f)
  Con{"pulsar-async 0", List.append(&2, String, Ac.lines("AXX", xs), List.append(&2, String, Ac.lines("ADX", ds), [Ac.count(xs, ds)]))}

# ---- order ------------------------------------------------------------------------------------
# CS's site column strictly ascends: one row per call site, in site order. The CLI numbers each
# site once and writes CS sorted, so a real run passes; a run that does not is refused.
def Ac.cs_go(css: List<&2, X.Cs>, +prev: U32) -> Bool:
  match css:
    case Nil{}:
      True{}
    case Con{X.Cs{+site, fn, callee, ld, ctx}, t}:
      Bool.and(Cmp.is_lt(U32.cmp(prev, site)), Ac.cs_go(t, site))

def Ac.cs_sorted(css: List<&2, X.Cs>) -> Bool:
  match css:
    case Nil{}:
      True{}
    case Con{X.Cs{+site, fn, callee, ld, ctx}, t}:
      Ac.cs_go(t, site)

# ---- decoding rows (reader; unproven) ---------------------------------------------------------
# Tags: CS 17235 (5 fields), CL 17228 (2), AW 16727 (1), XN 22606 (2), DV 17494 (1), EP 17744
# (2; the fn is kept), CE 17221 (6), FC 17987 (3), RX 21080 (3), RD 21060 (3). Other tags belong
# to other detectors and are skipped. Rows keep their file order, which the CLI sorts.
type AD is Data:
  AD{bad: U32, f: AF}

def Dc.has(rows: List<&2, W.Row>, +tag: U32) -> Bool:
  match rows:
    case Nil{}:
      False{}
    case Con{W.Row{t, fs}, rest}:
      Bool.or(U32.is_eq(t, tag), Dc.has(rest, tag))

def Dc.bad(d: AD) -> AD:
  match d:
    case AD{bad, f}:
      AD{1, f}

def Dc.cs(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Con{g, Nil{}}}}}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{Con{X.Cs{a, b, c, e, g}, css}, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.cl(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Con{b, Nil{}}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, Con{X.Cl{a, b}, cls}, aws, xns, dvs, eps, ces, fcs, rxs, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.aw(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Nil{}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, cls, Con{a, aws}, xns, dvs, eps, ces, fcs, rxs, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.xn(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Con{b, Nil{}}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, cls, aws, Con{Xn{a, b}, xns}, dvs, eps, ces, fcs, rxs, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.dv(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Nil{}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, cls, aws, xns, Con{a, dvs}, eps, ces, fcs, rxs, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.ep(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Con{b, Nil{}}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, cls, aws, xns, dvs, Con{a, eps}, ces, fcs, rxs, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.ce(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Con{g, Con{h, Nil{}}}}}}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, cls, aws, xns, dvs, eps, Con{F.Ce{a, b, c, e, g, h}, ces}, fcs, rxs, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.fc(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, Con{N.Fc{a, b, c}, fcs}, rxs, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.rx(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, Con{Rx{a, b, c}, rxs}, rds}}
    case _ d2:
      Dc.bad(d2)

def Dc.rd(fs: List<&2, U32>, d: AD) -> AD:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, Con{Rd{a, b, c}, rds}}}
    case _ d2:
      Dc.bad(d2)

def Dc.add(tag: U32, fs: List<&2, U32>, d: AD) -> AD:
  match tag:
    case 17235:
      Dc.cs(fs, d)
    case 17228:
      Dc.cl(fs, d)
    case 16727:
      Dc.aw(fs, d)
    case 22606:
      Dc.xn(fs, d)
    case 17494:
      Dc.dv(fs, d)
    case 17744:
      Dc.ep(fs, d)
    case 17221:
      Dc.ce(fs, d)
    case 17987:
      Dc.fc(fs, d)
    case 21080:
      Dc.rx(fs, d)
    case 21060:
      Dc.rd(fs, d)
    case _:
      d

def Dc.go(rows: List<&2, W.Row>, d: AD) -> AD:
  match rows:
    case Nil{}:
      d
    case Con{W.Row{tag, fs}, t}:
      Dc.go(t, Dc.add(tag, fs, d))

def Dc.fin2(ok: Bool, f: AF) -> Maybe<AF>:
  match ok:
    case True{}:
      Some{f}
    case False{}:
      None{}

def Dc.fin(d: AD) -> Maybe<AF>:
  match d:
    case AD{bad, AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}:
      Dc.fin2(U32.is_eq(bad, 0), AF{List.reverse(&2, X.Cs, css), List.reverse(&2, X.Cl, cls), List.reverse(&2, U32, aws), List.reverse(&2, Xn, xns), List.reverse(&2, U32, dvs), List.reverse(&2, U32, eps), List.reverse(&2, F.Ce, ces), List.reverse(&2, N.Fc, fcs), List.reverse(&2, Rx, rxs), List.reverse(&2, Rd, rds)})

def AsyncCtx.decode(rows: List<&2, W.Row>) -> Maybe<AF>:
  Dc.fin(Dc.go(rows, AD{0, AF{Nil{}, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}, Nil{}}}))

# ---- the section ------------------------------------------------------------------------------
# It runs when there is an RX or RD row (the CLI writes them only for active rules); a row of a
# tag read here with the wrong field count, or CS or CE out of strict site order, refuses it
# (None). AsyncCtx-LAWS E1-E4.
def AsyncIn.ok(ok: Bool, +f: AF) -> Maybe<List<&2, String>>:
  match ok:
    case True{}:
      Some{AsyncCtx.lines(f)}
    case False{}:
      None{}

def AsyncIn.go(m: Maybe<AF>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{AF{+css, cls, aws, xns, dvs, eps, +ces, fcs, rxs, rds}}:
      AsyncIn.ok(Bool.and(Ac.cs_sorted(css), N.Nc.ce_sorted(ces)), AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds})

def AsyncIn.go1(on: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      AsyncIn.go(AsyncCtx.decode(rows))
    case False{}:
      Some{Nil{}}

def AsyncIn.on(+rows: List<&2, W.Row>) -> Bool:
  Bool.or(Dc.has(rows, 21080), Dc.has(rows, 21060))

def AsyncIn.lines(+rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  AsyncIn.go1(AsyncIn.on(rows), rows)
