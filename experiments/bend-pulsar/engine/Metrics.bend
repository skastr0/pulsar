# Metrics.bend - per-function complexity from control trees (FACTS.md v1: FN, CT).
#
#   Metrics.run(rules, fns, cts)   validate, build each function's control tree,
#                                  measure it; None when the facts are invalid
#   Metrics.findings(rules, ms)    the measures over their rule's threshold
#   Metrics.lines(rules, ms)       FM and FX output lines
#
# The four measures, all language-neutral (CT kinds in FACTS.md):
#   cyclomatic  1 + the decisions: a branch, a loop or a short-circuit is one;
#               a multi-branch is one per arm, less one when it has a default
#               (9); a try is one per catch arm. That is McCabe's count of
#               out-edges minus one, per decision node.
#   nesting     the deepest chain of branches, multi-branches, loops and tries.
#               A branch's else arm holding only a branch (`else if`) adds no level.
#   npath       Nejmeh (CACM 1988): a sequence multiplies; a branch sums its arms
#               plus an implicit empty one when it has a single arm; a
#               multi-branch sums its arms plus one when it has no default (or
#               no arm at all); a
#               loop is its body + 1; a try is (body + catches) x finally; each
#               short-circuit that is a child of a guard adds one. Computed in
#               Nat and capped at Metrics.cap() = 2^24 - 1: Bend's runtime holds
#               a Nat up to 2^48 - 1, and two capped values multiply below that.
#               A printed value equal to the cap means "at least the cap".
#               Metrics-LAWS.bend states the uncapped recurrence and proves this
#               one is it, capped.
#   length      FN `loc`: non-blank lines of the function's span (nested
#               functions included, as the adapter reports it).
# A kind-8 node is a nested function: it and anything under it count for
# nothing here; the nested function has its own FN and tree.
#
# Rule ids and default thresholds (research/thresholds.md; a finding when the
# measure is strictly greater): core.cyclomatic 10, core.nesting 3,
# core.npath 200, core.length 60.

import Base

# ---- input rows ------------------------------------------------------------------------------
type Fn is Data:
  Fn{fn: U32, file: U32, parent: U32, loc: U32, test: Bool}

type CtRow is Data:
  CtRow{fn: U32, node: U32, parent: U32, kind: U32}

# The CT kinds (FACTS.md), as the engine reads them.
type K is Data:
  KBranch{}
  KArm{}
  KMulti{}
  KLoop{}
  KTry{}
  KSc{}
  KExit{}
  KFn{}
  KFlag{}
  KFin{}

# A control tree as first-child / next-sibling: `kids` is the node's children
# in source order, `next` the node's later siblings.
type Ct is Data:
  Leaf{}
  Node{kind: K, kids: Ct, next: Ct}

# Thresholds per rule, and the NPath cap (see the header).
type Rules is Data:
  Rules{cc: Nat, nest: Nat, npath: Nat, loc: Nat, cap: Nat}

# One function's measures.
type FnM is Data:
  FnM{fn: U32, cc: Nat, nest: Nat, npath: Nat, loc: Nat, test: Bool}

# rule: 1 cyclomatic, 2 nesting, 3 npath, 4 length.
type Finding is Data:
  Finding{rule: U32, fn: U32, value: Nat, thr: Nat}

def Metrics.defaults() -> Rules:
  Rules{10n, 3n, 200n, 60n, U32.to_nat(16777215)}

def Rules.cap(r: Rules) -> Nat:
  match r:
    case Rules{cc, nest, np, loc, cap}:
      cap

# CT kind numbers; Build.kind_ok refuses any other, so the last case is unused.
def K.of(+k: U32) -> K:
  match k:
    case 1:
      KBranch{}
    case 2:
      KArm{}
    case 3:
      KMulti{}
    case 4:
      KLoop{}
    case 5:
      KTry{}
    case 6:
      KSc{}
    case 8:
      KFn{}
    case 9:
      KFlag{}
    case 10:
      KFin{}
    case _:
      KExit{}

def K.arm(k: K) -> Nat:
  match k:
    case KArm{}:
      1n
    case _:
      0n

def K.sc(k: K) -> Nat:
  match k:
    case KSc{}:
      1n
    case _:
      0n

def K.flag(k: K) -> Nat:
  match k:
    case KFlag{}:
      1n
    case _:
      0n

# ---- cyclomatic -------------------------------------------------------------------------------
# Arms and default flags in one sibling chain.
def Cc.arms(t: Ct) -> Nat:
  match t:
    case Leaf{}:
      0n
    case Node{k, kids, next}:
      Nat.add(K.arm(k), Cc.arms(next))

def Cc.dflt(t: Ct) -> Nat:
  match t:
    case Leaf{}:
      0n
    case Node{k, kids, next}:
      Nat.add(K.flag(k), Cc.dflt(next))

# The decisions one node adds, given its children: McCabe's out-edges minus one.
def Cc.weight(k: K, +kids: Ct) -> Nat:
  match k:
    case KBranch{}:
      1n
    case KLoop{}:
      1n
    case KSc{}:
      1n
    case KMulti{}:
      Nat.sub(Cc.arms(kids), Cc.dflt(kids))
    case KTry{}:
      Nat.sub(Cc.arms(kids), 1n)
    case _:
      0n

# One node in front of the rest `r` of its chain; `d` is the decisions under it.
# A nested function (KFn) adds nothing, and nothing under it counts.
def Cc.node(k: K, +kids: Ct, d: Nat, r: Nat) -> Nat:
  match k:
    case KFn{}:
      r
    case KBranch{}:
      Nat.add(Nat.add(Cc.weight(KBranch{}, kids), d), r)
    case KArm{}:
      Nat.add(Nat.add(Cc.weight(KArm{}, kids), d), r)
    case KMulti{}:
      Nat.add(Nat.add(Cc.weight(KMulti{}, kids), d), r)
    case KLoop{}:
      Nat.add(Nat.add(Cc.weight(KLoop{}, kids), d), r)
    case KTry{}:
      Nat.add(Nat.add(Cc.weight(KTry{}, kids), d), r)
    case KSc{}:
      Nat.add(Nat.add(Cc.weight(KSc{}, kids), d), r)
    case KExit{}:
      Nat.add(Nat.add(Cc.weight(KExit{}, kids), d), r)
    case KFlag{}:
      Nat.add(Nat.add(Cc.weight(KFlag{}, kids), d), r)
    case KFin{}:
      Nat.add(Nat.add(Cc.weight(KFin{}, kids), d), r)

# Decisions in a sibling chain and everything under it.
def Cc.seq(t: Ct) -> Nat:
  match t:
    case Leaf{}:
      0n
    case Node{k, +kids, next}:
      Cc.node(k, kids, Cc.seq(kids), Cc.seq(next))

def Cc.of(t: Ct) -> Nat:
  1n+Cc.seq(t)

# ---- nesting ----------------------------------------------------------------------------------
# Where a chain sits: any chain; a branch's children before its first arm; a
# branch's children after its first arm (so the next arm is the else arm).
type Md is Data:
  MAny{}
  MPre{}
  MPost{}

# A chain that is exactly one branch: the body of an `else if`.
def Nest.lone(t: Ct) -> Bool:
  match t:
    case Leaf{}:
      False{}
    case Node{k, kids, next}:
      match k next:
        case KBranch{} Leaf{}:
          True{}
        case _ _:
          False{}

def Nest.after(k: K, +m: Md) -> Md:
  match k m:
    case KArm{} MAny{}:
      MAny{}
    case KArm{} _:
      MPost{}
    case _ _:
      m

def Nest.kid_mode(k: K) -> Md:
  match k:
    case KBranch{}:
      MPre{}
    case _:
      MAny{}

# The depth of an arm: its children's depth `d`, less the level an `else if`
# would add.
def Nest.arm(m: Md, lone: Bool, +d: Nat) -> Nat:
  match m lone:
    case MPost{} True{}:
      Nat.sub(d, 1n)
    case _ _:
      d

# One node in front of the rest `r` of its chain; `d` is the depth under it.
def Nest.node(k: K, m: Md, +kids: Ct, +d: Nat, r: Nat) -> Nat:
  match k:
    case KFn{}:
      r
    case KBranch{}:
      Nat.max(1n+d, r)
    case KMulti{}:
      Nat.max(1n+d, r)
    case KLoop{}:
      Nat.max(1n+d, r)
    case KTry{}:
      Nat.max(1n+d, r)
    case KArm{}:
      Nat.max(Nest.arm(m, Nest.lone(kids), d), r)
    case KSc{}:
      Nat.max(d, r)
    case KExit{}:
      Nat.max(d, r)
    case KFlag{}:
      Nat.max(d, r)
    case KFin{}:
      Nat.max(d, r)

# The deepest nesting in a chain and everything under it.
def Nest.seq(t: Ct, +m: Md) -> Nat:
  match t:
    case Leaf{}:
      0n
    case Node{+k, +kids, next}:
      Nest.node(k, m, kids, Nest.seq(kids, Nest.kid_mode(k)), Nest.seq(next, Nest.after(k, m)))

def Nest.of(t: Ct) -> Nat:
  Nest.seq(t, MAny{})

# ---- npath ------------------------------------------------------------------------------------
def Sat.add(a: Nat, b: Nat, +cap: Nat) -> Nat:
  Nat.min(Nat.add(a, b), cap)

def Sat.mul(a: Nat, +b: Nat, +cap: Nat) -> Nat:
  Nat.min(Nat.mul(a, b), cap)

# What a sibling chain tells its parent:
#   prod  the chain as a sequence: the product of its nodes' NPaths
#   sum   the sum of its arms' NPaths
#   arms  how many arms        sc  how many short-circuits
#   dflt  how many default flags
#   fin   the finally arm's NPath; 1 when there is none
type Agg is Data:
  Agg{prod: Nat, sum: Nat, arms: Nat, sc: Nat, dflt: Nat, fin: Nat}

def Np.prod(a: Agg) -> Nat:
  match a:
    case Agg{prod, sum, arms, sc, dflt, fin}:
      prod

# One node's NPath as a statement, given what its children's chain tells it.
def Np.val(k: K, prod: Nat, sum: Nat, arms: Nat, sc: Nat, dflt: Nat, +fin: Nat, +cap: Nat) -> Nat:
  match k:
    case KBranch{}:
      Sat.add(Sat.add(sum, Nat.sub(2n, arms), cap), sc, cap)
    case KMulti{}:
      Sat.add(Sat.add(sum, Nat.sub(1n, Nat.min(dflt, arms)), cap), sc, cap)
    case KLoop{}:
      Sat.add(Sat.add(prod, 1n, cap), sc, cap)
    case KTry{}:
      Sat.mul(Sat.add(sum, Nat.sub(1n, arms), cap), fin, cap)
    case KArm{}:
      prod
    case _:
      Nat.min(1n, cap)

def Np.value(k: K, a: Agg, +cap: Nat) -> Nat:
  match a:
    case Agg{prod, sum, arms, sc, dflt, fin}:
      Np.val(k, prod, sum, arms, sc, dflt, fin, cap)

def Np.fin_of(k: K, ap: Nat, +cap: Nat) -> Nat:
  match k:
    case KFin{}:
      ap
    case _:
      Nat.min(1n, cap)

# A node, as one element of its parent's chain, in front of the rest `r`.
def Np.cons(+k: K, +a: Agg, r: Agg, +cap: Nat) -> Agg:
  match r:
    case Agg{prod, sum, arms, sc, dflt, fin}:
      +ap = Np.prod(a)
      Agg{Sat.mul(Np.value(k, a, cap), prod, cap), Sat.add(Nat.mul(K.arm(k), ap), sum, cap), Nat.add(K.arm(k), arms), Nat.add(K.sc(k), sc), Nat.add(K.flag(k), dflt), Sat.mul(Np.fin_of(k, ap, cap), fin, cap)}

def Np.empty(+cap: Nat) -> Agg:
  Agg{Nat.min(1n, cap), 0n, 0n, 0n, 0n, Nat.min(1n, cap)}

# A nested function is a statement with one path; its subtree is not looked at.
def Np.kids(k: K, a: Agg, +cap: Nat) -> Agg:
  match k:
    case KFn{}:
      Np.empty(cap)
    case _:
      a

def Np.agg(t: Ct, +cap: Nat) -> Agg:
  match t:
    case Leaf{}:
      Np.empty(cap)
    case Node{+k, kids, next}:
      Np.cons(k, Np.kids(k, Np.agg(kids, cap), cap), Np.agg(next, cap), cap)

def Np.of(t: Ct, +cap: Nat) -> Nat:
  Np.prod(Np.agg(t, cap))

# ---- building the trees -------------------------------------------------------------------
# CT rows for one function come in preorder (ids 1..k) with parent pointers. A
# fold over the rows keeps the open ancestors on a stack (the body, id 0, at the
# bottom): a row first closes every open node that is not its parent, then opens
# itself. A row whose parent is not open is out of preorder and makes the tree
# invalid.
type Kid is Data:
  Kid{kind: K, kids: Ct}

type Frame is Data:
  Frame{id: U32, kind: U32, kids: List<&2, Kid>}

# Kids are kept newest first; this turns them into a sibling chain in source order.
def Build.chain(ks: List<&2, Kid>, acc: Ct) -> Ct:
  match ks:
    case Nil{}:
      acc
    case Con{Kid{k, kc}, t}:
      Build.chain(t, Node{k, kc, acc})

def Build.top_is(st: List<&2, Frame>, +p: U32) -> Bool:
  match st:
    case Nil{}:
      False{}
    case Con{Frame{id, kind, kids}, t}:
      U32.is_eq(id, p)

def Build.top_kind(st: List<&2, Frame>) -> U32:
  match st:
    case Nil{}:
      0
    case Con{Frame{id, kind, kids}, t}:
      kind

# Close the top frame into the one below it.
def Build.fold1(st: List<&2, Frame>) -> List<&2, Frame>:
  match st:
    case Nil{}:
      Nil{}
    case Con{Frame{id, kind, kids}, rest}:
      match rest:
        case Nil{}:
          Nil{}
        case Con{Frame{id2, kind2, kids2}, rest2}:
          Con{Frame{id2, kind2, Con{Kid{K.of(kind), Build.chain(kids, Leaf{})}, kids2}}, rest2}

# Close frames until the top is `p`; an empty stack when `p` is not open.
def Build.pop(fuel: Nat, hit: Bool, st: List<&2, Frame>, +p: U32) -> List<&2, Frame>:
  match fuel:
    case 0n:
      Nil{}
    case 1n+f:
      match hit:
        case True{}:
          st
        case False{}:
          +ns = Build.fold1(st)
          Build.pop(f, Build.top_is(ns, p), ns, p)

# A node's kind is 1..10, and its parent is the body (0) or a node that can have
# children: not a short-circuit (6), an early exit (7), a nested-function leaf
# (8) or a flag (9). The leaf's own tree is under its own FN.
def Build.kind_ok(+kind: U32, +pk: U32) -> Bool:
  Bool.and(Bool.and(U32.is_ge(kind, 1), U32.is_le(kind, 10)), Bool.not(Bool.and(U32.is_ge(pk, 6), U32.is_le(pk, 9))))

def Build.push(st: List<&2, Frame>, node: U32, kind: U32) -> List<&2, Frame>:
  Con{Frame{node, kind, Nil{}}, st}

def Build.depth(st: List<&2, Frame>) -> Nat:
  List.length(&2, Frame, st)

# One row: close down to its parent, check it, open it. `want` is the id it must have.
def Build.go(rows: List<&2, CtRow>, +st: List<&2, Frame>, ok: Bool, +want: U32) -> List<&2, Frame> & Bool:
  match rows:
    case Nil{}:
      (st, ok)
    case Con{CtRow{fn, +node, +parent, +kind}, t}:
      +st2 = Build.pop(Build.depth(st), Build.top_is(st, parent), st, parent)
      +ok2 = Bool.and(Bool.and(Build.top_is(st2, parent), U32.is_eq(node, want)), Build.kind_ok(kind, Build.top_kind(st2)))
      Build.go(t, Build.push(st2, node, kind), Bool.and(ok, ok2), U32.add(want, 1))

# Close everything; the body's kids are the function's chain.
def Build.body(st: List<&2, Frame>) -> Ct:
  match st:
    case Nil{}:
      Leaf{}
    case Con{Frame{id, kind, kids}, t}:
      Build.chain(kids, Leaf{})

def Build.finish(r: List<&2, Frame> & Bool) -> Maybe<&2, Ct>:
  (+st, ok) = r
  Bool.pick(Maybe<&2, Ct>, ok, Some{Build.body(Build.pop(Build.depth(st), Build.top_is(st, 0), st, 0))}, None{})

# One function's rows to its tree; None when they are not a valid preorder tree.
def Build.tree(rows: List<&2, CtRow>) -> Maybe<&2, Ct>:
  Build.finish(Build.go(rows, [Frame{0, 0, Nil{}}], True{}, 1))

def Build.empty(rows: List<&2, CtRow>) -> Bool:
  match rows:
    case Nil{}:
      True{}
    case Con{h, t}:
      False{}

type Span is Data:
  Span{mine: List<&2, CtRow>, rest: List<&2, CtRow>}

def Span.push(r: CtRow, s: Span) -> Span:
  match s:
    case Span{mine, rest}:
      Span{Con{r, mine}, rest}

def Span.hit(rows: List<&2, CtRow>, +f: U32) -> Bool:
  match rows:
    case Nil{}:
      False{}
    case Con{CtRow{fn, node, parent, kind}, t}:
      U32.is_eq(fn, f)

# The leading rows of function `f`, and the rows after them. `hit` says whether
# the first row is one of f's.
def Span.of(rows: List<&2, CtRow>, hit: Bool, +f: U32) -> Span:
  match rows hit:
    case Nil{} _:
      Span{Nil{}, Nil{}}
    case Con{r, +t} True{}:
      Span.push(r, Span.of(t, Span.hit(t, f), f))
    case Con{r, t} False{}:
      Span{Nil{}, Con{r, t}}

def Span.for(+rows: List<&2, CtRow>, +f: U32) -> Span:
  Span.of(rows, Span.hit(rows, f), f)

# ---- the measures and the rules --------------------------------------------------------------
type FnT is Data:
  FnT{fn: U32, t: Ct, loc: U32, test: Bool}

def Metrics.measure(f: FnT, +cap: Nat) -> FnM:
  match f:
    case FnT{fn, +t, loc, test}:
      FnM{fn, Cc.of(t), Nest.of(t), Np.of(t, cap), U32.to_nat(loc), test}

def Metrics.measure_all(fs: List<&2, FnT>, +cap: Nat) -> List<&2, FnM>:
  match fs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Metrics.measure(h, cap), Metrics.measure_all(t, cap)}

def Trees.cons(+fn: U32, +loc: U32, test: Bool, mt: Maybe<&2, Ct>, rest: Maybe<&2, List<&2, FnT>>) -> Maybe<&2, List<&2, FnT>>:
  match mt rest:
    case Some{t} Some{xs}:
      Some{Con{FnT{fn, t, loc, test}, xs}}
    case _ _:
      None{}

def Trees.ok(+fn: U32, +want: U32, m: Maybe<&2, List<&2, FnT>>) -> Maybe<&2, List<&2, FnT>>:
  Bool.pick(Maybe<&2, List<&2, FnT>>, U32.is_eq(fn, want), m, None{})

# Every function, in id order 0..m-1, with its tree; every CT row belongs to a
# listed function. `s` is the span of rows for function `want`. None when any of
# that fails.
def Trees.go(fns: List<&2, Fn>, s: Span, +want: U32) -> Maybe<&2, List<&2, FnT>>:
  match fns s:
    case Nil{} Span{mine, rest}:
      Bool.pick(Maybe<&2, List<&2, FnT>>, Bool.and(Build.empty(mine), Build.empty(rest)), Some{Nil{}}, None{})
    case Con{Fn{+fn, file, parent, +loc, test}, t} Span{mine, +rest}:
      +nx = U32.add(want, 1)
      Trees.ok(fn, want, Trees.cons(fn, loc, test, Build.tree(mine), Trees.go(t, Span.for(rest, nx), nx)))

def Trees.of(fns: List<&2, Fn>, +cts: List<&2, CtRow>) -> Maybe<&2, List<&2, FnT>>:
  Trees.go(fns, Span.for(cts, 0), 0)

def Metrics.run2(+cap: Nat, m: Maybe<&2, List<&2, FnT>>) -> Maybe<&2, List<&2, FnM>>:
  match m:
    case None{}:
      None{}
    case Some{fs}:
      Some{Metrics.measure_all(fs, cap)}

# The entry point: the facts to every function's measures.
def Metrics.run(r: Rules, fns: List<&2, Fn>, cts: List<&2, CtRow>) -> Maybe<&2, List<&2, FnM>>:
  Metrics.run2(Rules.cap(r), Trees.of(fns, cts))

# A finding for rule `rule` when the value is strictly over the threshold.
def Rule.keep(over: Bool, x: Finding, rest: List<&2, Finding>) -> List<&2, Finding>:
  match over:
    case True{}:
      Con{x, rest}
    case False{}:
      rest

def Rule.check(+rule: U32, +fn: U32, +v: Nat, +thr: Nat, rest: List<&2, Finding>) -> List<&2, Finding>:
  Rule.keep(Nat.is_gt(v, thr), Finding{rule, fn, v, thr}, rest)

# core.length has two tiers (rule version 2, lead ruling 2026-11-07). A body is linear when
# its cyclomatic is at most 2 and its nesting at most 1, and structured otherwise. A structured
# body is flagged above the Rules length threshold (default 60), a linear one above 300.
# Internally, rule 4 is structured length and rule 9 is linear length; both print as
# core.length, with shape=structured or shape=linear.
def Len.linear(+cc: Nat, +nest: Nat) -> Bool:
  Bool.and(Bool.not(Nat.is_gt(cc, 2n)), Bool.not(Nat.is_gt(nest, 1n)))

def Len.linear_thr() -> Nat:
  300n

def Len.pick(lin: Bool, +fn: U32, +loc: Nat, +tloc: Nat, rest: List<&2, Finding>) -> List<&2, Finding>:
  match lin:
    case True{}:
      Rule.check(9, fn, loc, Len.linear_thr(), rest)
    case False{}:
      Rule.check(4, fn, loc, tloc, rest)

def Len.check(+fn: U32, +cc: Nat, +nest: Nat, +loc: Nat, +tloc: Nat, rest: List<&2, Finding>) -> List<&2, Finding>:
  Len.pick(Len.linear(cc, nest), fn, loc, tloc, rest)

# A test function (a TF fact) gets no findings: FACTS.md has these detectors skip it.
def Rule.prod(test: Bool, +fn: U32, +cc: Nat, +nest: Nat, np: Nat, loc: Nat, tcc: Nat, tnest: Nat, tnp: Nat, tloc: Nat, rest: List<&2, Finding>) -> List<&2, Finding>:
  match test:
    case True{}:
      rest
    case False{}:
      Rule.check(1, fn, cc, tcc, Rule.check(2, fn, nest, tnest, Rule.check(3, fn, np, tnp, Len.check(fn, cc, nest, loc, tloc, rest))))

def Rule.one(r: Rules, m: FnM, rest: List<&2, Finding>) -> List<&2, Finding>:
  match r m:
    case Rules{tcc, tnest, tnp, tloc, cap} FnM{+fn, cc, nest, np, loc, test}:
      Rule.prod(test, fn, cc, nest, np, loc, tcc, tnest, tnp, tloc, rest)

def Metrics.findings(+r: Rules, ms: List<&2, FnM>) -> List<&2, Finding>:
  match ms:
    case Nil{}:
      Nil{}
    case Con{m, t}:
      Rule.one(r, m, Metrics.findings(r, t))

# ---- output -----------------------------------------------------------------------------------
#   FM <fn> <cyclomatic> <nesting> <npath> <length>     every function, id order
#   FX <rule-id> <fn> <value> <threshold> [shape=...]   every finding (shape: core.length)
def Rule.id(+rule: U32) -> String:
  match rule:
    case 1:
      "core.cyclomatic"
    case 2:
      "core.nesting"
    case 3:
      "core.npath"
    case _:
      "core.length"

def Report.fm(m: FnM) -> String:
  match m:
    case FnM{fn, cc, nest, np, loc, test}:
      "FM " ++ U32.show(fn) ++ " " ++ Nat.show(cc) ++ " " ++ Nat.show(nest) ++ " " ++ Nat.show(np) ++ " " ++ Nat.show(loc)

# The evidence tail: core.length's shape.
def Rule.ev(+rule: U32) -> String:
  match rule:
    case 4:
      " shape=structured"
    case 9:
      " shape=linear"
    case _:
      ""

def Report.fx(x: Finding) -> String:
  match x:
    case Finding{+rule, fn, v, thr}:
      "FX " ++ Rule.id(rule) ++ " " ++ U32.show(fn) ++ " " ++ Nat.show(v) ++ " " ++ Nat.show(thr) ++ Rule.ev(rule)

def Report.fms(ms: List<&2, FnM>) -> List<&2, String>:
  match ms:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Report.fm(h), Report.fms(t)}

def Report.fxs(xs: List<&2, Finding>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Report.fx(h), Report.fxs(t)}

def Metrics.lines(+r: Rules, +ms: List<&2, FnM>) -> List<&2, String>:
  List.append(&2, String, Report.fms(ms), Report.fxs(Metrics.findings(r, ms)))
