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

# ---- D. the claims that matter most ----------------------------------------------
# Edges and reachability, as types. All of them are Data, so a proof can use a
# fact more than once.

def And(-A: Data, -B: Data) -> Data:
  Sigma<&2, &2, A, _ => B>

def Ex(-A: Data, -B: @-x: A -> Data) -> Data:
  Sigma<&2, &2, A, B>

# w is one of the listed successors.
def Mem(xs: List<&2, U32>, w: U32) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == w : U32}, Mem(t, w)>

def MemL(xs: List<&2, List<&2, U32>>, c: List<&2, U32>) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == c : List<&2, U32>}, MemL(t, c)>

# The successor list of node n.
def Nth(adj: List<&2, List<&2, U32>>, n: Nat) -> List<&2, U32>:
  match adj n:
    case Nil{} _:
      Nil{}
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      Nth(t, p)

def Succ(adj: List<&2, List<&2, U32>>, u: U32, w: U32) -> Data:
  Mem(Nth(adj, U32.to_nat(u)), w)

# A walk of exactly k edges from u to v.
def Walk(adj: List<&2, List<&2, U32>>, k: Nat, u: U32, v: U32) -> Data:
  match k:
    case 0n:
      {u == v : U32}
    case 1n+p:
      Ex(U32, w => And(Succ(adj, u, w), Walk(adj, p, w, v)))

# A walk with at least one edge: u -> w, then any walk w ~> v.
def Reach1(adj: List<&2, List<&2, U32>>, u: U32, v: U32) -> Data:
  Ex(U32, w => And(Succ(adj, u, w), Ex(Nat, k => Walk(adj, k, w, v))))

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
  for +adj: List<&2, List<&2, U32>>
  for +c: List<&2, U32>
  for hc: MemL(G.Graph.cycles(adj), c)
  for +u: U32
  for hu: Mem(c, u)
  for +v: U32
  for hv: Mem(c, v)
  Reach1(adj, u, v)

# H. COMPLETE, relative to the run's certificates: whenever `Graph.verified`
#    accepts (it checks that component numbers never decrease along an edge
#    and that every candidate cycle certifies), any u and v on a common closed
#    walk lie in one reported component. `verified` is a runtime check on the
#    untrusted SCC search; this law does not say the search always passes it.
law cycles_complete:
  for +adj: List<&2, List<&2, U32>>
  for ok: {G.Graph.verified(adj) == True{} : Bool}
  for +u: U32
  for +v: U32
  for +r1: Reach1(adj, u, v)
  for r2: Reach1(adj, v, u)
  exs c: List<&2, U32>
  And(MemL(G.Graph.cycles(adj), c), And(Mem(c, u), Mem(c, v)))

# I. PARTITION, relative to the run's counting certificate: whenever
#    `Graph.part_ok` accepts (it tallies the concatenated components and checks
#    each node, position p being U32.from_nat(p), has tally exactly 1), the
#    node at every position p < length occurs exactly once in the components.
#    Stated per position (not per U32 below a bound), which avoids arithmetic
#    on U32 wrap-around; `part_ok` is again a runtime check on the SCC search.
law sccs_partition:
  for +adj: List<&2, List<&2, U32>>
  for ok: {G.Graph.part_ok(adj) == True{} : Bool}
  for +p: Nat
  for hp: {Nat.is_lt(p, List.length(&2, List<&2, U32>, adj)) == True{} : Bool}
  {Count(List.concat(&2, U32, G.Graph.sccs(adj)), U32.from_nat(p)) == 1n : Nat}

# J. SHIPPED OUTPUT: the binary calls Graph.analyze. Its cycles are exactly
#    Graph.cycles (so G, H and I apply to what is printed), and its ok flag is
#    exactly the conjunction of the two runtime certificates H and I assume.
law analyze_is_cycles:
  for +adj: List<&2, List<&2, U32>>
  {G.Graph.analyze(adj) == G.Res{G.Graph.cycles(adj), Bool.and(G.Graph.verified(adj), G.Graph.part_ok(adj))} : G.Res}
