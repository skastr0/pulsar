# Scope.bend - the production-scope rule, and the graph builder that uses it.
#
# TS-AD-02 builds the import graph over production files only. `F file prod`
# facts say which files those are. A fact becomes an edge only if
#   1. the proven rule says it is one (Facts.add: Extract.value_kind and
#      Resolve.add_edge2, LAWS.bend A-E and engine/LAWS.bend K), and
#   2. both its endpoints are production files (this module).
# Files that are not production keep their id and stay in the graph with no
# edges, so they are in no cycle. `Scope.count` is the number of production
# files, which is what the output reports as `files`.

import Base
import ../Graph.bend as G
import ../Resolve.bend as R
import ./Facts.bend as F

# The set of production files: the ids listed by `F file 1` facts. This is the
# same fold as Graph.ins_comp (every id stored under key 0), so the proven
# trie lemmas apply.
def Scope.set(ids: List<&2, U32>) -> G.Tr:
  G.Graph.ins_comp(ids, 0n, G.TE{})

def Scope.has2(m: Maybe<&2, Nat>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{x}:
      True{}

def Scope.has(t: G.Tr, x: U32) -> Bool:
  Scope.has2(G.Tr.getu(t, x))

def Scope.in_scope(+t: G.Tr, src: U32, dst: U32) -> Bool:
  Bool.and(Scope.has(t, src), Scope.has(t, dst))

def Scope.add2(ok: Bool, f: F.Fact, acc: R.Acc) -> R.Acc:
  match ok:
    case True{}:
      F.Facts.add(f, acc)
    case False{}:
      acc

# One fact into the accumulator: out of scope contributes nothing; in scope it
# is whatever the proven rule says.
def Scope.add(+t: G.Tr, f: F.Fact, acc: R.Acc) -> R.Acc:
  match f:
    case F.Fact{+src, +dst, form, hv, ht}:
      Scope.add2(Scope.in_scope(t, src, dst), F.Fact{src, dst, form, hv, ht}, acc)

# Walk the facts in order (as Facts.go did): `cur` is the file whose row is
# open; a fact for a later file first closes the files in between.
def Scope.go(fs: List<&2, F.Fact>, +cur: U32, +t: G.Tr, acc: R.Acc) -> R.Acc & U32:
  match fs:
    case Nil{}:
      (acc, cur)
    case Con{+h, tl}:
      Scope.go(tl, F.Facts.src_of(h), t, Scope.add(t, h, F.Facts.close_n(U32.to_nat(F.Facts.gap(F.Facts.src_of(h), cur)), acc)))

# The import graph of n files over the production files in `t`.
def Scope.graph(+t: G.Tr, +n: U32, fs: List<&2, F.Fact>) -> List<&2, List<&2, U32>>:
  F.Facts.finish(n, Scope.go(fs, 0, t, R.Resolve.empty_acc()))

# Number of production files among ids i .. i+k-1.
def Scope.count(k: Nat, +i: U32, +t: G.Tr, acc: U32) -> U32:
  match k:
    case 0n:
      acc
    case 1n+p:
      Scope.count(p, U32.add(i, 1), t, U32.add(acc, Bool.to_u32(Scope.has(t, i))))
