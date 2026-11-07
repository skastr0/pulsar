# LAWS.bend - properties a TS-AD-02 style detector must satisfy.
# Convention: laws are open claims here; PROOF.bend fills them.

import Base
import ./Extract.bend as E
import ./Resolve.bend as R
import ./Graph.bend as G

# ---- A. type-elision rule (Extract.value_kind) -------------------------------------
# The rule that decides whether an import/export statement is a graph edge.

# A. clause with only type bindings is never an edge.
law only_type_bindings_elided:
  for edge: E.RefKind
  {E.Extract.value_kind(False{}, True{}, edge) == E.KTypeOnly{} : E.RefKind}

# B. one value binding makes the statement an edge, whatever else is in it.
law value_binding_keeps_edge:
  for ht: Bool
  for edge: E.RefKind
  {E.Extract.value_kind(True{}, ht, edge) == edge : E.RefKind}

# C. an empty clause (`import {} from "x"`) stays an edge, like Pulsar.
law empty_clause_keeps_edge:
  for edge: E.RefKind
  {E.Extract.value_kind(False{}, False{}, edge) == edge : E.RefKind}

# ---- B. edge bookkeeping (Resolve.add_edge2) ----------------------------------------
# `drop_self` is true for export-from statements (TS-AD-02 never adds an
# export edge from a file to itself, but does for imports).

# D. an export-from naming its own file adds no edge.
law export_self_edge_dropped:
  for v: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  {R.Resolve.add_edge2(True{}, True{}, v, cur, all, bare, miss, dyn, req, tonly) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}

# E. an import naming its own file adds the self edge (reported as a 1-cycle).
law import_self_edge_kept:
  for v: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  {R.Resolve.add_edge2(False{}, True{}, v, cur, all, bare, miss, dyn, req, tonly) == R.Acc{Con{v, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}

# ---- C. SCC machine (Graph.step / Graph.run) -----------------------------------------

# F. once every stack is empty and no component is being popped, a transition
# changes nothing. This is what makes "fuel above the bound" harmless.
law idle_is_fixed_point:
  for ns: Array<G.Node>
  for cnt: U32
  for comps: List<&2, List<&2, U32>>
  for cur: List<&2, U32>
  {G.Graph.step(G.TS{ns, G.RS{Nil{}, Nil{}, Nil{}, cnt, comps, 4294967295, cur}}) == G.TS{ns, G.RS{Nil{}, Nil{}, Nil{}, cnt, comps, 4294967295, cur}} : G.TS}

# ---- D. the claims that matter most (OPEN) ----------------------------------------------
# Edges and reachability, as types.

# w is one of the listed successors.
def Mem(xs: List<&2, U32>, w: U32) -> Type:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&1, &1, {h == w : U32}, Mem(t, w)>

def MemL(xs: List<&2, List<&2, U32>>, c: List<&2, U32>) -> Type:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&1, &1, {h == c : List<&2, U32>}, MemL(t, c)>

# The successor list of node n.
def Nth(adj: List<&2, List<&2, U32>>, n: Nat) -> List<&2, U32>:
  match adj n:
    case Nil{} _:
      Nil{}
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      Nth(t, p)

def Succ(adj: List<&2, List<&2, U32>>, u: U32, w: U32) -> Type:
  Mem(Nth(adj, U32.to_nat(u)), w)

# A walk of at most k edges from u to v.
def Walk(adj: List<&2, List<&2, U32>>, k: Nat, u: U32, v: U32) -> Type:
  match k:
    case 0n:
      {u == v : U32}
    case 1n+p:
      Either<&1, &1, {u == v : U32}, &w: U32 -> (Succ(adj, u, w) & Walk(adj, p, w, v))>

# A walk with at least one edge: u -> w, then any walk w ~> v.
def Reach1(adj: List<&2, List<&2, U32>>, u: U32, v: U32) -> Type:
  &w: U32 -> (Succ(adj, u, w) & &k: Nat -> Walk(adj, k, w, v))

def Count.step(hit: Bool, rest: Nat) -> Nat:
  match hit:
    case True{}:
      1n+rest
    case False{}:
      rest

# Count occurrences of v in a list.
def Count(xs: List<&2, U32>, +v: U32) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{h, t}:
      Count.step(U32.is_eq(h, v), Count(t, v))

# Every successor index is a node of the graph. Resolve.graph builds only such
# graphs (indices come from the file map), but nothing proves it; Bend arrays
# wrap out-of-range indices around, so this precondition is load-bearing.
def WF(adj: List<&2, List<&2, U32>>) -> Type:
  &u: U32 -> &w: U32 -> Succ(adj, u, w) -> {U32.is_lt(w, U32.from_nat(List.length(&2, List<&2, U32>, adj))) == True{} : Bool}

# G. SOUND: every reported cycle is a real cycle of the extracted graph.
#    Any two members u, v of a reported component are joined by a walk with
#    at least one edge (for a self-loop, the loop itself).
law cycles_sound:
  for adj: List<&2, List<&2, U32>>
  for wf: WF(adj)
  for c: List<&2, U32>
  for hc: MemL(G.Graph.cycles(adj), c)
  for u: U32
  for hu: Mem(c, u)
  for v: U32
  for hv: Mem(c, v)
  Reach1(adj, u, v)

# H. COMPLETE: every node on a cycle is reported. u and v on a common closed
#    walk lie in one reported component.
law cycles_complete:
  for adj: List<&2, List<&2, U32>>
  for wf: WF(adj)
  for u: U32
  for v: U32
  for r1: Reach1(adj, u, v)
  for r2: Reach1(adj, v, u)
  exs c: List<&2, U32>
  MemL(G.Graph.cycles(adj), c) & Mem(c, u) & Mem(c, v)

# I. PARTITION: the components of Graph.sccs split the nodes: each node of the
#    graph occurs in exactly one component, exactly once.
law sccs_partition:
  for adj: List<&2, List<&2, U32>>
  for wf: WF(adj)
  for i: U32
  for hi: {U32.is_lt(i, U32.from_nat(List.length(&2, List<&2, U32>, adj))) == True{} : Bool}
  {Count(List.concat(&2, U32, G.Graph.sccs(adj)), i) == 1n : Nat}
