# engine/Binding-LAWS.bend - laws about Binding.bend. Proofs: Binding-PROOF.bend.
# Gate: `bend engine/Binding-PROOF.bend --verdict`.
#
# BR(k, ixs, starts, x) is what "file x is reachable from the entry files `starts` within
# k value import edges" means in the facts: k = 0, x is a start; k + 1, that, or an edge
# from a file reachable within k. Reading rows is not covered, by design (AGENTS.md
# scope): fixtures cover decoding.
#
# The laws tie the shipped functions to them: Bd.reach is exactly BR (sound and
# complete); Bd.files and Bd.decl list exactly the deployable's IE and IB facts; Bd.read
# is true exactly when some IU fact for the binding names a file in the closure;
# Bd.unread lists exactly the declared bindings Bd.read is false for; a finding is a
# declared binding of a deployable with an entry, unread, when the rule is on and the
# unread count is over its threshold (sound), and every such binding is a finding
# (complete). A deployable with no IE fact gets no finding, and with no BR fact the rule
# is off and the section is empty.

import Base
import ../LAWS.bend as TL
import ../Graph.bend as G
import ./Scope.bend as S
import ./Scope-LAWS.bend as SL
import ./Binding.bend as B

def MemIx(xs: List<&2, B.Ix>, m: B.Ix) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : B.Ix}, MemIx(t, m)>

def MemIe(xs: List<&2, B.Ie>, m: B.Ie) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : B.Ie}, MemIe(t, m)>

def MemIb(xs: List<&2, B.Ib>, m: B.Ib) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : B.Ib}, MemIb(t, m)>

def MemIu(xs: List<&2, B.Iu>, m: B.Iu) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : B.Iu}, MemIu(t, m)>

def MemBr(xs: List<&2, B.Br>, m: B.Br) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : B.Br}, MemBr(t, m)>

def MemBx(xs: List<&2, B.Bx>, m: B.Bx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : B.Bx}, MemBx(t, m)>

# Field readers for the statements below.
def IxSrc(e: B.Ix) -> U32:
  match e:
    case B.Ix{src, dst}:
      src

def IxDst(e: B.Ix) -> U32:
  match e:
    case B.Ix{src, dst}:
      dst

def IeDep(e: B.Ie) -> U32:
  match e:
    case B.Ie{dep, file}:
      dep

def IeFile(e: B.Ie) -> U32:
  match e:
    case B.Ie{dep, file}:
      file

def IbDep(e: B.Ib) -> U32:
  match e:
    case B.Ib{dep, bind}:
      dep

def IbBind(e: B.Ib) -> U32:
  match e:
    case B.Ib{dep, bind}:
      bind

def IuFile(e: B.Iu) -> U32:
  match e:
    case B.Iu{file, bind}:
      file

def IuBind(e: B.Iu) -> U32:
  match e:
    case B.Iu{file, bind}:
      bind

def BxDep(e: B.Bx) -> U32:
  match e:
    case B.Bx{dep, bnd, value, thr, declared}:
      dep

def BxBind(e: B.Bx) -> U32:
  match e:
    case B.Bx{dep, bnd, value, thr, declared}:
      bnd

def BxValue(e: B.Bx) -> U32:
  match e:
    case B.Bx{dep, bnd, value, thr, declared}:
      value

def BxThr(e: B.Bx) -> U32:
  match e:
    case B.Bx{dep, bnd, value, thr, declared}:
      thr

def BxDeclared(e: B.Bx) -> U32:
  match e:
    case B.Bx{dep, bnd, value, thr, declared}:
      declared

# ---- reach ------------------------------------------------------------------------------------
# File x is reachable from the start files within k import edges.
def BR(k: Nat, +ixs: List<&2, B.Ix>, +starts: List<&2, U32>, +x: U32) -> Data:
  match k:
    case 0n:
      TL.Mem(starts, x)
    case 1n+p:
      Either<&2, &2, BR(p, ixs, starts, x), TL.Ex(B.Ix, e => TL.And(MemIx(ixs, e), TL.And({IxDst(e) == x : U32}, BR(p, ixs, starts, IxSrc(e)))))>

law bd_reach_sound:
  for +k: Nat
  for +ixs: List<&2, B.Ix>
  for +starts: List<&2, U32>
  for +x: U32
  for hm: TL.Mem(B.Bd.reach(k, ixs, starts), x)
  BR(k, ixs, starts, x)

law bd_reach_complete:
  for +k: Nat
  for +ixs: List<&2, B.Ix>
  for +starts: List<&2, U32>
  for +x: U32
  for w: BR(k, ixs, starts, x)
  TL.Mem(B.Bd.reach(k, ixs, starts), x)

# ---- the deployable's facts -------------------------------------------------------------------
law bd_files_sound:
  for +ies: List<&2, B.Ie>
  for +dep: U32
  for +f: U32
  for hm: TL.Mem(B.Bd.files(ies, dep), f)
  TL.Ex(B.Ie, e => TL.And(MemIe(ies, e), TL.And({IeDep(e) == dep : U32}, {IeFile(e) == f : U32})))

law bd_files_complete:
  for +ies: List<&2, B.Ie>
  for +dep: U32
  for +f: U32
  for he: MemIe(ies, B.Ie{dep, f})
  TL.Mem(B.Bd.files(ies, dep), f)

law bd_decl_sound:
  for +ibs: List<&2, B.Ib>
  for +dep: U32
  for +b: U32
  for hm: TL.Mem(B.Bd.decl(ibs, dep), b)
  TL.Ex(B.Ib, e => TL.And(MemIb(ibs, e), TL.And({IbDep(e) == dep : U32}, {IbBind(e) == b : U32})))

law bd_decl_complete:
  for +ibs: List<&2, B.Ib>
  for +dep: U32
  for +b: U32
  for he: MemIb(ibs, B.Ib{dep, b})
  TL.Mem(B.Bd.decl(ibs, dep), b)

# ---- reads ------------------------------------------------------------------------------------
law bd_read_sound:
  for +ius: List<&2, B.Iu>
  for +reach: G.Tr
  for +b: U32
  for hr: {B.Bd.read(ius, reach, b) == True{} : Bool}
  TL.Ex(B.Iu, e => TL.And(MemIu(ius, e), TL.And({IuBind(e) == b : U32}, {S.Scope.has(reach, IuFile(e)) == True{} : Bool})))

law bd_read_complete:
  for +ius: List<&2, B.Iu>
  for +reach: G.Tr
  for +file: U32
  for +b: U32
  for he: MemIu(ius, B.Iu{file, b})
  for hf: {S.Scope.has(reach, file) == True{} : Bool}
  {B.Bd.read(ius, reach, b) == True{} : Bool}

law bd_unread_sound:
  for +ibs: List<&2, B.Ib>
  for +ius: List<&2, B.Iu>
  for +reach: G.Tr
  for +dep: U32
  for +b: U32
  for hm: TL.Mem(B.Bd.unread(ibs, ius, reach, dep), b)
  TL.Ex(B.Ib, e => TL.And(MemIb(ibs, e), TL.And({IbDep(e) == dep : U32}, TL.And({IbBind(e) == b : U32}, {B.Bd.read(ius, reach, b) == False{} : Bool}))))

law bd_unread_complete:
  for +ibs: List<&2, B.Ib>
  for +ius: List<&2, B.Iu>
  for +reach: G.Tr
  for +dep: U32
  for +b: U32
  for he: MemIb(ibs, B.Ib{dep, b})
  for hn: {B.Bd.read(ius, reach, b) == False{} : Bool}
  TL.Mem(B.Bd.unread(ibs, ius, reach, dep), b)

# ---- findings ---------------------------------------------------------------------------------
# The closure of a set of entry files.
def Reach(es: List<&2, U32>, +ixs: List<&2, B.Ix>, +n: U32) -> G.Tr:
  S.Scope.set(B.Bd.reach(U32.to_nat(n), ixs, es))

# Every finding names a binding the deployable declares and no reachable code reads. The
# value and declared fields are Bd.dep's own two counts, so a reader of the line gets them
# from the shipped function; these laws are about which bindings are reported.
law bd_dep_sound:
  for +h: U32
  for +t: List<&2, U32>
  for +ibs: List<&2, B.Ib>
  for +ius: List<&2, B.Iu>
  for +ixs: List<&2, B.Ix>
  for +dep: U32
  for +thr: U32
  for +n: U32
  for +y: B.Bx
  for hm: MemBx(B.Bd.dep(Con{h, t}, ibs, ius, ixs, dep, thr, n), y)
  TL.Ex(U32, b => TL.And({BxBind(y) == b : U32}, TL.Mem(B.Bd.unread(ibs, ius, Reach(Con{h, t}, ixs, n), dep), b)))

# A deployable with an entry reports every unread binding when its unread count is over
# the threshold.
law bd_dep_complete:
  for +h: U32
  for +t: List<&2, U32>
  for +ibs: List<&2, B.Ib>
  for +ius: List<&2, B.Iu>
  for +ixs: List<&2, B.Ix>
  for +dep: U32
  for +thr: U32
  for +n: U32
  for +b: U32
  for mb: TL.Mem(B.Bd.unread(ibs, ius, Reach(Con{h, t}, ixs, n), dep), b)
  for hg: {Nat.is_gt(List.length(&2, U32, B.Bd.unread(ibs, ius, Reach(Con{h, t}, ixs, n), dep)), U32.to_nat(thr)) == True{} : Bool}
  MemBx(B.Bd.dep(Con{h, t}, ibs, ius, ixs, dep, thr, n), B.Bx{dep, b, U32.from_nat(List.length(&2, U32, B.Bd.unread(ibs, ius, Reach(Con{h, t}, ixs, n), dep))), thr, U32.from_nat(List.length(&2, U32, B.Bd.decl(ibs, dep)))})

# A deployable with no entry files gets no finding: degraded input is never drift.
law bd_no_entry:
  for +ibs: List<&2, B.Ib>
  for +ius: List<&2, B.Iu>
  for +ixs: List<&2, B.Ix>
  for +dep: U32
  for +thr: U32
  for +n: U32
  {B.Bd.dep(Nil{}, ibs, ius, ixs, dep, thr, n) == Nil{} : List<&2, B.Bx>}

# With no BR row the rule is off: no findings.
law bd_rule_off:
  for +ids: List<&2, U32>
  for +ies: List<&2, B.Ie>
  for +ibs: List<&2, B.Ib>
  for +ius: List<&2, B.Iu>
  for +ixs: List<&2, B.Ix>
  for +n: U32
  {B.Bd.run(B.BIn{ids, ies, ibs, ius, ixs, Nil{}, n}, 1) == Nil{} : List<&2, B.Bx>}

# The section is the header, the finding lines and the count of the findings.
law bd_lines_shape:
  for +f: B.BIn
  {B.Binding.lines(f) == Con{"pulsar-binding 0", List.append(&2, String, B.Bd.lines(B.Bd.run(f, 1)), ["BFS " ++ Nat.show(List.length(&2, B.Bx, B.Bd.run(f, 1)))])} : List<&2, String>}
