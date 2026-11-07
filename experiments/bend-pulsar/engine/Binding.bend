# Binding.bend - infra binding drift (#694 facts, #725): a binding a deployable declares
# that no code it reaches reads.
#
# Facts (FACTS.md "Infra"): `ID dep`, `IE dep file`, `IB dep binding`, `IU file binding`,
# the import rows `I src dst form hv ht`, and `BF rule thr`, the CLI's row that a binding
# rule is on, with its threshold.
#
#   entry closure  the files a deployable's entry files reach over value import edges
#   read binding   a binding b with an `IU f b` row for some f in that closure
#   drift          a declared binding `IB dep b` that no reachable file reads
#
# A deployable with no `IE` row is skipped: its code is unknown, and the CLI reports that
# as degraded input, never as drift. A declared binding whose entry closure has no `IU`
# row for it is drift only when the rule is on and the deployable's unread count is over
# the rule's threshold.
#
# Output (FACTS.md "Binding rules"), only when a `BF` row names the rule:
#   pulsar-binding 0
#   BFX cloudflare.binding-drift <dep> <bind> <value> <thr> declared=<d>
#   BFS <n>
# One line per unread binding, in deployable then binding order; `value` is the
# deployable's unread count and `declared` its declared bindings. Laws:
# Binding-LAWS.bend.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./Rows.bend as W
import ./Facts.bend as F
import ../Extract.bend as E

type Ie is Data:
  Ie{dep: U32, file: U32}

type Ib is Data:
  Ib{dep: U32, bind: U32}

type Iu is Data:
  Iu{file: U32, bind: U32}

type Ix is Data:
  Ix{src: U32, dst: U32}

type Br is Data:
  Br{rule: U32, thr: U32}

# A drift finding: binding `bnd` of deployable `dep` is unread; the deployable has
# `value` unread bindings of `declared`, and the rule's threshold is `thr`.
type Bx is Data:
  Bx{dep: U32, bnd: U32, value: U32, thr: U32, declared: U32}

# What the engine runs on: the facts of a tree and the size of its file set.
type BIn is Data:
  BIn{ids: List<&2, U32>, ies: List<&2, Ie>, ibs: List<&2, Ib>, ius: List<&2, Iu>, ixs: List<&2, Ix>, brs: List<&2, Br>, n: U32}

type Ar is Data:
  Ar{tag: U32, n: Nat}

# ---- row tags and decoding --------------------------------------------------------------------
def Bd.tag_id() -> U32:
  18756

def Bd.tag_ie() -> U32:
  18757

def Bd.tag_ib() -> U32:
  18754

def Bd.tag_iu() -> U32:
  18773

def Bd.tag_i() -> U32:
  73

def Bd.tag_br() -> U32:
  16966

def Bd.f(fs: List<&2, U32>, k: Nat) -> U32:
  match fs k:
    case Nil{} _:
      0
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      Bd.f(t, p)

# The field count each tag read here must have; a tag not read here gets 0.
def Bd.arities() -> List<&2, Ar>:
  [Ar{18756, 1n}, Ar{18757, 2n}, Ar{18754, 2n}, Ar{18773, 2n}, Ar{73, 5n}, Ar{16966, 2n}]

def Bd.pick(hit: Bool, n: Nat, m: Nat) -> Nat:
  match hit:
    case True{}:
      n
    case False{}:
      m

def Bd.look(+tag: U32, xs: List<&2, Ar>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{Ar{t, n}, rest}:
      Bd.pick(U32.is_eq(t, tag), n, Bd.look(tag, rest))

def Bd.arity(+tag: U32) -> Nat:
  Bd.look(tag, Bd.arities())

def Bd.bad1(+tag: U32, +fs: List<&2, U32>) -> Bool:
  +n = Bd.arity(tag)
  Bool.and(Bool.not(Nat.is_eq(n, 0n)), Bool.not(Nat.is_eq(n, List.length(&2, U32, fs))))

# Some row of a tag read here has the wrong field count.
def Bd.bad(rows: List<&2, W.Row>) -> Bool:
  match rows:
    case Nil{}:
      False{}
    case Con{W.Row{tag, fs}, t}:
      Bool.or(Bd.bad1(tag, fs), Bd.bad(t))

def Bd.push(b: Bool, fs: List<&2, U32>, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match b:
    case True{}:
      Con{fs, acc}
    case False{}:
      acc

# The field lists of every row with tag `tag` and exactly `n` fields, in row order.
def Bd.of(rows: List<&2, W.Row>, +tag: U32, +n: Nat) -> List<&2, List<&2, U32>>:
  match rows:
    case Nil{}:
      Nil{}
    case Con{W.Row{+t, +fs}, rest}:
      Bd.push(Bool.and(U32.is_eq(t, tag), Nat.is_eq(List.length(&2, U32, fs), n)), fs, Bd.of(rest, tag, n))

def Bd.ids(xs: List<&2, List<&2, U32>>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Bd.f(f, 0n), Bd.ids(t)}

def Bd.ies(xs: List<&2, List<&2, U32>>) -> List<&2, Ie>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Ie{Bd.f(f, 0n), Bd.f(f, 1n)}, Bd.ies(t)}

def Bd.ibs(xs: List<&2, List<&2, U32>>) -> List<&2, Ib>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Ib{Bd.f(f, 0n), Bd.f(f, 1n)}, Bd.ibs(t)}

def Bd.ius(xs: List<&2, List<&2, U32>>) -> List<&2, Iu>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Iu{Bd.f(f, 0n), Bd.f(f, 1n)}, Bd.ius(t)}

def Bd.brs(xs: List<&2, List<&2, U32>>) -> List<&2, Br>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Br{Bd.f(f, 0n), Bd.f(f, 1n)}, Bd.brs(t)}

# A value-carrying import: the proven kind rule (Facts.kind) says the statement is an
# import or an export, not type-only, dynamic or require.
def Bd.kind_is(k: E.RefKind) -> Bool:
  match k:
    case E.KImport{}:
      True{}
    case E.KExport{}:
      True{}
    case E.KTypeOnly{}:
      False{}
    case E.KDynamic{}:
      False{}
    case E.KRequire{}:
      False{}

def Bd.is_edge(+fs: List<&2, U32>) -> Bool:
  Bd.kind_is(F.Facts.kind(Bd.f(fs, 3n), Bd.f(fs, 4n), Bd.f(fs, 2n)))

type Iy is Data:
  Iy{src: U32, dst: U32, ok: Bool}

def Bd.iys(xs: List<&2, List<&2, U32>>) -> List<&2, Iy>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Iy{Bd.f(f, 0n), Bd.f(f, 1n), Bd.is_edge(f)}, Bd.iys(t)}

def Bd.iy_ok(y: Iy) -> Bool:
  match y:
    case Iy{src, dst, ok}:
      ok

def Bd.push_ix(y: Iy, acc: List<&2, Ix>) -> List<&2, Ix>:
  match y:
    case Iy{src, dst, ok}:
      Con{Ix{src, dst}, acc}

def Bd.push_i(ok: Bool, +y: Iy, acc: List<&2, Ix>) -> List<&2, Ix>:
  match ok:
    case True{}:
      Bd.push_ix(y, acc)
    case False{}:
      acc

def Bd.ixs(ys: List<&2, Iy>) -> List<&2, Ix>:
  match ys:
    case Nil{}:
      Nil{}
    case Con{+y, t}:
      Bd.push_i(Bd.iy_ok(y), y, Bd.ixs(t))

def Bd.dec(+rows: List<&2, W.Row>, +n: U32) -> BIn:
  BIn{Bd.ids(Bd.of(rows, Bd.tag_id(), 1n)), Bd.ies(Bd.of(rows, Bd.tag_ie(), 2n)), Bd.ibs(Bd.of(rows, Bd.tag_ib(), 2n)), Bd.ius(Bd.of(rows, Bd.tag_iu(), 2n)), Bd.ixs(Bd.iys(Bd.of(rows, Bd.tag_i(), 5n))), Bd.brs(Bd.of(rows, Bd.tag_br(), 2n)), n}

# ---- the entry closure ------------------------------------------------------------------------
def Bd.push_u(c: Bool, x: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# The successors, over value import edges, of a set of files.
def Bd.step(ixs: List<&2, Ix>, +cur: G.Tr) -> List<&2, U32>:
  match ixs:
    case Nil{}:
      Nil{}
    case Con{Ix{src, +dst}, t}:
      Bd.push_u(S.Scope.has(cur, src), dst, Bd.step(t, cur))

# The files reachable from `cur` within k import edges: k + 1 adds the successors of the
# set k steps built.
def Bd.reach(k: Nat, +ixs: List<&2, Ix>, +cur: List<&2, U32>) -> List<&2, U32>:
  match k:
    case 0n:
      cur
    case 1n+p:
      Bd.reach(p, ixs, List.append(&2, U32, cur, Bd.step(ixs, S.Scope.set(cur))))

# The entry files of a deployable.
def Bd.files(ies: List<&2, Ie>, +dep: U32) -> List<&2, U32>:
  match ies:
    case Nil{}:
      Nil{}
    case Con{Ie{+d, +file}, t}:
      Bd.push_u(U32.is_eq(d, dep), file, Bd.files(t, dep))

# The bindings a deployable declares.
def Bd.decl(ibs: List<&2, Ib>, +dep: U32) -> List<&2, U32>:
  match ibs:
    case Nil{}:
      Nil{}
    case Con{Ib{+d, +b}, t}:
      Bd.push_u(U32.is_eq(d, dep), b, Bd.decl(t, dep))

# Some reachable file reads binding b.
def Bd.read(ius: List<&2, Iu>, +reach: G.Tr, +b: U32) -> Bool:
  match ius:
    case Nil{}:
      False{}
    case Con{Iu{+file, +bind}, t}:
      Bool.or(Bool.and(U32.is_eq(bind, b), S.Scope.has(reach, file)), Bd.read(t, reach, b))

# The declared bindings of a deployable that no reachable file reads.
def Bd.unread(ibs: List<&2, Ib>, +ius: List<&2, Iu>, +reach: G.Tr, +dep: U32) -> List<&2, U32>:
  match ibs:
    case Nil{}:
      Nil{}
    case Con{Ib{+d, +b}, t}:
      Bd.push_u(Bool.and(U32.is_eq(d, dep), Bool.not(Bd.read(ius, reach, b))), b, Bd.unread(t, ius, reach, dep))

def Bd.add_read(c: Bool, acc: Nat) -> Nat:
  match c:
    case True{}:
      1n+acc
    case False{}:
      acc

# How many of a deployable's declared bindings a reachable file reads.
def Bd.reads(ibs: List<&2, Ib>, +ius: List<&2, Iu>, +reach: G.Tr, +dep: U32) -> Nat:
  match ibs:
    case Nil{}:
      0n
    case Con{Ib{+d, +b}, t}:
      Bd.add_read(Bool.and(U32.is_eq(d, dep), Bd.read(ius, reach, b)), Bd.reads(t, ius, reach, dep))

# ---- findings ---------------------------------------------------------------------------------
# The threshold of the first BR row for `rule`, if any.
def Bd.thr_keep(acc: Maybe<U32>, t: U32) -> Maybe<U32>:
  match acc:
    case None{}:
      Some{t}
    case Some{old}:
      Some{old}

def Bd.thr_set(hit: Bool, t: U32, acc: Maybe<U32>) -> Maybe<U32>:
  match hit:
    case True{}:
      Bd.thr_keep(acc, t)
    case False{}:
      acc

def Bd.thr_go(brs: List<&2, Br>, +rule: U32, acc: Maybe<U32>) -> Maybe<U32>:
  match brs:
    case Nil{}:
      acc
    case Con{Br{+r, +t}, rest}:
      Bd.thr_go(rest, rule, Bd.thr_set(U32.is_eq(r, rule), t, acc))

def Bd.thr(brs: List<&2, Br>, +rule: U32) -> Maybe<U32>:
  Bd.thr_go(brs, rule, None{})

def Bd.fires(thr: U32, us: List<&2, U32>) -> Bool:
  Nat.is_gt(List.length(&2, U32, us), U32.to_nat(thr))

def Bd.mks(us: List<&2, U32>, +dep: U32, +value: U32, +thr: U32, +declared: U32) -> List<&2, Bx>:
  match us:
    case Nil{}:
      Nil{}
    case Con{+b, t}:
      Con{Bx{dep, b, value, thr, declared}, Bd.mks(t, dep, value, thr, declared)}

# A deployable with an entry, its unread bindings already computed: their findings when the
# unread count is over the threshold, none otherwise.
def Bd.dep2(on: Bool, +us: List<&2, U32>, +ibs: List<&2, Ib>, +ius: List<&2, Iu>, +reach: G.Tr, +dep: U32, +thr: U32) -> List<&2, Bx>:
  match on:
    case True{}:
      Bd.mks(us, dep, U32.from_nat(List.length(&2, U32, us)), thr, U32.from_nat(List.length(&2, U32, Bd.decl(ibs, dep))))
    case False{}:
      Nil{}

def Bd.dep1(es: List<&2, U32>, +ibs: List<&2, Ib>, +ius: List<&2, Iu>, +ixs: List<&2, Ix>, +dep: U32, +thr: U32, +n: U32) -> List<&2, Bx>:
  +reach = S.Scope.set(Bd.reach(U32.to_nat(n), ixs, es))
  +us = Bd.unread(ibs, ius, reach, dep)
  Bd.dep2(Bd.fires(thr, us), us, ibs, ius, reach, dep, thr)

# The findings of one deployable that has an entry: none when it has none.
def Bd.dep(es: List<&2, U32>, +ibs: List<&2, Ib>, +ius: List<&2, Iu>, +ixs: List<&2, Ix>, +dep: U32, +thr: U32, +n: U32) -> List<&2, Bx>:
  match es:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Bd.dep1(es, ibs, ius, ixs, dep, thr, n)

# Every deployable's findings, deployable by deployable in id order.
def Bd.alls(ids: List<&2, U32>, +ies: List<&2, Ie>, +ibs: List<&2, Ib>, +ius: List<&2, Iu>, +ixs: List<&2, Ix>, +thr: U32, +n: U32) -> List<&2, Bx>:
  match ids:
    case Nil{}:
      Nil{}
    case Con{+dep, t}:
      List.append(&2, Bx, Bd.dep(Bd.files(ies, dep), ibs, ius, ixs, dep, thr, n), Bd.alls(t, ies, ibs, ius, ixs, thr, n))

# ---- output -----------------------------------------------------------------------------------
# Rule code 1 is cloudflare.binding-drift.
def Bd.rid(rule: U32) -> String:
  Bool.pick(String, U32.is_eq(rule, 1), "cloudflare.binding-drift", "unknown-binding-rule")

def Bd.line(x: Bx) -> String:
  match x:
    case Bx{dep, bnd, value, thr, declared}:
      "BFX " ++ Bd.rid(1) ++ " " ++ U32.show(dep) ++ " " ++ U32.show(bnd) ++ " " ++ U32.show(value) ++ " " ++ U32.show(thr) ++ " declared=" ++ U32.show(declared)

def Bd.lines(xs: List<&2, Bx>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Bd.line(h), Bd.lines(t)}

# The findings of the rule `rule` when its BR row is present, with that row's threshold.
def Bd.run2(t: Maybe<U32>, +ids: List<&2, U32>, +ies: List<&2, Ie>, +ibs: List<&2, Ib>, +ius: List<&2, Iu>, +ixs: List<&2, Ix>, +n: U32) -> List<&2, Bx>:
  match t:
    case None{}:
      Nil{}
    case Some{thr}:
      Bd.alls(ids, ies, ibs, ius, ixs, thr, n)

def Bd.run(f: BIn, +rule: U32) -> List<&2, Bx>:
  match f:
    case BIn{ids, ies, ibs, ius, ixs, brs, n}:
      Bd.run2(Bd.thr(brs, rule), ids, ies, ibs, ius, ixs, n)

# The section: the header, one line per finding, then the count.
def Binding.lines(+f: BIn) -> List<&2, String>:
  +xs = Bd.run(f, 1)
  Con{"pulsar-binding 0", List.append(&2, String, Bd.lines(xs), ["BFS " ++ Nat.show(List.length(&2, Bx, xs))])}
