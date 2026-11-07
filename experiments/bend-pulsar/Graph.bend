# Graph.bend - strongly connected components (pure core).
#
# Iterative Tarjan over a graph whose nodes are 0..n-1 and whose adjacency is
# a list of successor lists. Bend requires every recursion to be structural,
# so the algorithm is a single transition function `step` driven by a fuel
# counter that is a safe upper bound on the number of transitions (every
# transition consumes a start node, an edge, a call frame or a stack entry).
#
# State layout (chosen to need one array and few array accesses):
#   ns   : Array<Node>   Node{ix, nbrs}. ix = 0 unvisited; 1..n discovery
#                        index; BIG once the node belongs to a finished
#                        component. BIG exceeds every lowlink, so
#                        `low = min(low, ix(w))` is a no-op for finished w,
#                        which is Tarjan's "w is not on the stack" case.
#                        nbrs is only read at first visit.
#   cstk : List<Fr>      the DFS call stack; a frame keeps its own lowlink.
#   tstk : List<&2, U32>     Tarjan's component stack.

import Base

type Node is Data:
  Node{ix: U32, nbrs: List<&2, U32>}

type Fr is Data:
  Fr{v: U32, rest: List<&2, U32>, low: U32, ix: U32}

type RS is Type:
  RS{tstk: List<&2, U32>, cstk: List<&2, Fr>, starts: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>}

type TS is Type:
  TS{ns: Array<Node>, rs: RS}

# ---- (A) pop one node of the finished component -------------------------------------

def Graph.pop_fin(same: Bool, w: U32, comps: List<&2, List<&2, U32>>, cur: List<&2, U32>) -> List<&2, List<&2, U32>> & List<&2, U32>:
  match same:
    case True{}:
      (Con{Con{w, cur}, comps}, Nil{})
    case False{}:
      (comps, Con{w, cur})

def Graph.pop_popv(same: Bool, popv: U32) -> U32:
  match same:
    case True{}:
      4294967295
    case False{}:
      popv

def Graph.pop_k(cc: List<&2, List<&2, U32>> & List<&2, U32>, same: Bool, popv: U32, ns: Array<Node>, rest: List<&2, U32>, cstk: List<&2, Fr>, starts: List<&2, U32>, cnt: U32) -> TS:
  (comps2, cur2) = cc
  TS{ns, RS{rest, cstk, starts, cnt, comps2, Graph.pop_popv(same, popv), cur2}}

def Graph.pop_one(tstk: List<&2, U32>, ns: Array<Node>, cstk: List<&2, Fr>, starts: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, +popv: U32, cur: List<&2, U32>) -> TS:
  match tstk:
    case Nil{}:
      TS{ns, RS{Nil{}, cstk, starts, cnt, comps, 4294967295, cur}}
    case Con{+w, rest}:
      Graph.pop_k(Graph.pop_fin(U32.is_eq(w, popv), w, comps, cur), U32.is_eq(w, popv), popv, Array.set(Node, ns, w, Node{4294967294, Nil{}}), rest, cstk, starts, cnt)

# ---- (C) top frame has no successors left: return from it ---------------------------
def Graph.ret_popv(is_root: Bool, v: U32) -> U32:
  match is_root:
    case True{}:
      v
    case False{}:
      4294967295

# Propagate the finished child's lowlink into the parent frame.
def Graph.ret_parent(cs: List<&2, Fr>, low: U32) -> List<&2, Fr>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{Fr{pv, prest, plow, pix}, cs2}:
      Con{Fr{pv, prest, U32.min(plow, low), pix}, cs2}

def Graph.ret_frame(v: U32, +low: U32, +ix: U32, cs: List<&2, Fr>, ns: Array<Node>, tstk: List<&2, U32>, starts: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, cur: List<&2, U32>) -> TS:
  TS{ns, RS{tstk, Graph.ret_parent(cs, low), starts, cnt, comps, Graph.ret_popv(U32.is_eq(low, ix), v), cur}}

def Graph.edge_seen(f2: Fr, iw: U32, ns: Array<Node>, cs: List<&2, Fr>, tstk: List<&2, U32>, starts: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  match f2:
    case Fr{v, rest, low, ix}:
      TS{ns, RS{tstk, Con{Fr{v, rest, U32.min(low, iw), ix}, cs}, starts, cnt, comps, popv, cur}}

# ---- (B) top frame has a successor w -------------------------------------------------
def Graph.edge_k2(unvisited: Bool, ns: Array<Node>, iw: U32, nbrs: List<&2, U32>, +w: U32, f2: Fr, cs: List<&2, Fr>, tstk: List<&2, U32>, starts: List<&2, U32>, +cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  match unvisited:
    case True{}:
      TS{Array.set(Node, ns, w, Node{U32.add(cnt, 1), Nil{}}), RS{Con{w, tstk}, Con{Fr{w, nbrs, U32.add(cnt, 1), U32.add(cnt, 1)}, Con{f2, cs}}, starts, U32.add(cnt, 1), comps, popv, cur}}
    case False{}:
      Graph.edge_seen(f2, iw, ns, cs, tstk, starts, cnt, comps, popv, cur)

def Graph.edge_k(r: Array<Node> & Node, w: U32, f2: Fr, cs: List<&2, Fr>, tstk: List<&2, U32>, starts: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  (ns2, nd) = r
  match nd:
    case Node{+iw, nbrs}:
      Graph.edge_k2(U32.is_eq(iw, 0), ns2, iw, nbrs, w, f2, cs, tstk, starts, cnt, comps, popv, cur)

def Graph.edge_step(f: Fr, cs: List<&2, Fr>, ns: Array<Node>, tstk: List<&2, U32>, starts: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  match f:
    case Fr{v, Con{+w, nxt}, low, ix}:
      Graph.edge_k(Array.get(Node, ns, w), w, Fr{v, nxt, low, ix}, cs, tstk, starts, cnt, comps, popv, cur)
    case Fr{v, Nil{}, low, ix}:
      Graph.ret_frame(v, low, ix, cs, ns, tstk, starts, cnt, comps, cur)

# ---- (D) no frames: start the next unvisited root -----------------------------------------
def Graph.start_k2(unvisited: Bool, ns: Array<Node>, nbrs: List<&2, U32>, +s: U32, tstk: List<&2, U32>, rest: List<&2, U32>, +cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  match unvisited:
    case True{}:
      TS{Array.set(Node, ns, s, Node{U32.add(cnt, 1), Nil{}}), RS{Con{s, tstk}, Con{Fr{s, nbrs, U32.add(cnt, 1), U32.add(cnt, 1)}, Nil{}}, rest, U32.add(cnt, 1), comps, popv, cur}}
    case False{}:
      TS{ns, RS{tstk, Nil{}, rest, cnt, comps, popv, cur}}

def Graph.start_k(r: Array<Node> & Node, s: U32, tstk: List<&2, U32>, rest: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  (ns2, nd) = r
  match nd:
    case Node{+iw, nbrs}:
      Graph.start_k2(U32.is_eq(iw, 0), ns2, nbrs, s, tstk, rest, cnt, comps, popv, cur)

def Graph.start_step(starts: List<&2, U32>, ns: Array<Node>, tstk: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  match starts:
    case Nil{}:
      TS{ns, RS{tstk, Nil{}, Nil{}, cnt, comps, popv, cur}}
    case Con{+s, rest}:
      Graph.start_k(Array.get(Node, ns, s), s, tstk, rest, cnt, comps, popv, cur)

# ---- dispatch ---------------------------------------------------------------------------------
def Graph.walk(cstk: List<&2, Fr>, ns: Array<Node>, tstk: List<&2, U32>, starts: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  match cstk:
    case Nil{}:
      Graph.start_step(starts, ns, tstk, cnt, comps, popv, cur)
    case Con{f, cs}:
      Graph.edge_step(f, cs, ns, tstk, starts, cnt, comps, popv, cur)

def Graph.step_d(popping: Bool, ns: Array<Node>, tstk: List<&2, U32>, cstk: List<&2, Fr>, starts: List<&2, U32>, cnt: U32, comps: List<&2, List<&2, U32>>, popv: U32, cur: List<&2, U32>) -> TS:
  match popping:
    case True{}:
      Graph.pop_one(tstk, ns, cstk, starts, cnt, comps, popv, cur)
    case False{}:
      Graph.walk(cstk, ns, tstk, starts, cnt, comps, popv, cur)

def Graph.step_rs(ns: Array<Node>, rs: RS) -> TS:
  match rs:
    case RS{tstk, cstk, starts, cnt, comps, +popv, cur}:
      Graph.step_d(Bool.not(U32.is_eq(popv, 4294967295)), ns, tstk, cstk, starts, cnt, comps, popv, cur)

def Graph.step(ts: TS) -> TS:
  match ts:
    case TS{ns, rs}:
      Graph.step_rs(ns, rs)

# Drive `step` for at most `fuel` transitions. Idle transitions (all stacks
# empty) are no-ops, so any fuel at or above the bound is equivalent.
def Graph.run(fuel: Nat, ts: TS) -> TS:
  match fuel:
    case 0n:
      ts
    case 1n+p:
      Graph.run(p, Graph.step(ts))

# ---- set-up -----------------------------------------------------------------------------------------
def Graph.ceil_half(+n: U32) -> U32:
  U32.shr(U32.add(n, 1))

def Graph.depth_go(fuel: Nat, +n: U32, d: U32) -> U32:
  match fuel:
    case 0n:
      d
    case 1n+p:
      Graph.depth_go(p, Graph.ceil_half(n), U32.add(d, Bool.to_u32(U32.is_gt(n, 1))))

# Smallest d with 2^d >= n.
def Graph.depth(n: U32) -> Nat:
  U32.to_nat(Graph.depth_go(32n, n, 0))

def Graph.fill(adj: List<&2, List<&2, U32>>, +i: U32, ns: Array<Node>) -> Array<Node>:
  match adj:
    case Nil{}:
      ns
    case Con{nb, t}:
      Graph.fill(t, U32.add(i, 1), Array.set(Node, ns, i, Node{0, nb}))

def Graph.len(xs: List<&2, List<&2, U32>>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case Con{_, t}:
      Graph.len(t, U32.add(acc, 1))

def Graph.edges(xs: List<&2, List<&2, U32>>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case Con{h, t}:
      Graph.edges(t, U32.add(acc, U32.from_nat(List.length(&2, U32, h))))

def Graph.iota(fuel: Nat, +i: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match fuel:
    case 0n:
      acc
    case 1n+p:
      Graph.iota(p, U32.sub(i, 1), Con{i, acc})

# Start nodes 0..n-1 in order.
def Graph.starts(+n: U32) -> List<&2, U32>:
  Graph.iota(U32.to_nat(n), U32.sub(n, 1), Nil{})

def Graph.final(ts: TS) -> List<&2, List<&2, U32>>:
  match ts:
    case TS{ns, RS{tstk, cstk, starts, cnt, comps, popv, cur}}:
      comps

def Graph.sccs_n(adj: List<&2, List<&2, U32>>, +n: U32, m: U32) -> List<&2, List<&2, U32>>:
  Graph.final(Graph.run(U32.to_nat(U32.add(U32.add(U32.mul(n, 3), m), 8)), TS{Graph.fill(adj, 0, Array.new(Node, Graph.depth(n), Node{0, Nil{}})), RS{Nil{}, Nil{}, Graph.starts(n), 0, Nil{}, 4294967295, Nil{}}}))

# All strongly connected components (singletons included), each in an
# unspecified order, as lists of node indices.
def Graph.sccs(+adj: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  Graph.sccs_n(adj, Graph.len(adj, 0), Graph.edges(adj, 0))

# ---- reporting: components that are cycles -----------------------------------------
def Graph.has_go(xs: List<&2, U32>, +v: U32, found: Bool) -> Bool:
  match xs:
    case Nil{}:
      found
    case Con{h, t}:
      Graph.has_go(t, v, Bool.or(found, U32.is_eq(h, v)))

def Graph.push_if(c: Bool, x: List<&2, U32>, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# Members of one-node components.
def Graph.singles(cs: List<&2, List<&2, U32>>, acc: List<&2, U32>) -> List<&2, U32>:
  match cs:
    case Nil{}:
      acc
    case Con{Con{v, Nil{}}, t}:
      Graph.singles(t, Con{v, acc})
    case Con{_, t}:
      Graph.singles(t, acc)

def Graph.loop_if(selfedge: Bool, sg: List<&2, U32>, +i: U32, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match selfedge:
    case True{}:
      Graph.push_if(Graph.has_go(sg, i, False{}), [i], acc)
    case False{}:
      acc

def Graph.self_loops(adj: List<&2, List<&2, U32>>, +sg: List<&2, U32>, +i: U32, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match adj:
    case Nil{}:
      acc
    case Con{nb, t}:
      Graph.self_loops(t, sg, U32.add(i, 1), Graph.loop_if(Graph.has_go(nb, i, False{}), sg, i, acc))

# Components with at least two nodes.
def Graph.multi(cs: List<&2, List<&2, U32>>, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match cs:
    case Nil{}:
      acc
    case Con{Con{a, Con{b, r}}, t}:
      Graph.multi(t, Con{Con{a, Con{b, r}}, acc})
    case Con{_, t}:
      Graph.multi(t, acc)

def Graph.u32_le(a: U32, b: U32) -> Bool:
  U32.is_le(a, b)

def Graph.sort_members(cs: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{List.sort(~U32, ~Graph.u32_le, h), Graph.sort_members(t)}

def Graph.merge_cmp(c: Cmp, d: Cmp) -> Cmp:
  match c:
    case EQ{}:
      d
    case other:
      other

# Lexicographic comparison of index lists (shorter prefix first).
def Graph.list_cmp(a: List<&2, U32>, b: List<&2, U32>, c: Cmp) -> Cmp:
  match a b:
    case Nil{} Nil{}:
      c
    case Nil{} Con{_, _}:
      Graph.merge_cmp(c, LT{})
    case Con{_, _} Nil{}:
      Graph.merge_cmp(c, GT{})
    case Con{x, xt} Con{y, yt}:
      Graph.list_cmp(xt, yt, Graph.merge_cmp(c, U32.cmp(x, y)))

def Graph.list_le(a: List<&2, U32>, b: List<&2, U32>) -> Bool:
  Cmp.is_le(Graph.list_cmp(a, b, EQ{}))

def Graph.cycles2(adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  List.sort(~List<&2, U32>, ~Graph.list_le, Graph.sort_members(Graph.multi(cs, Graph.self_loops(adj, Graph.singles(cs, Nil{}), 0, Nil{}))))

# Every cycle of the graph: each component with two or more nodes, plus each
# self-looping node alone. Members ascending, cycles in lexicographic order
# of their member lists. Because file indices follow sorted path order, this
# is the order of the printed lines.
def Graph.cycles(+adj: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  Graph.cycles2(adj, Graph.sccs(adj))
