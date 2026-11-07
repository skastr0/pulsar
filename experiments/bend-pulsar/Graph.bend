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

type Cert is Data:
  Cert{up: List<&2, U32>, down: List<&2, U32>}
type Ad is Data:
  Ad{v: U32, ns: List<&2, U32>}
type Ent is Data:
  Ent{v: U32, p: List<&2, U32>}
type Bs is Data:
  Bs{seen: List<&2, Ent>, front: List<&2, Ent>}
type Tr is Data:
  TE{}
  TV{x: Nat}
  TN{z: Tr, o: Tr}
type Res is Data:
  Res{cycles: List<&2, List<&2, U32>>, ok: Bool}
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
def Graph.push_if(c: Bool, x: List<&2, U32>, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Graph.u32_le(a: U32, b: U32) -> Bool:
  U32.is_le(a, b)

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

# ---- certificates -----------------------------------------------------------------------
# A component is reported only after a certificate for it has been checked
# against the adjacency lists. The search that produces certificates (BFS,
# below) is untrusted: `cert_ok` alone decides, and it is the only code the
# soundness proof reads. A certificate gives, for every member v of a
# component with root r (its first member), a walk r ->+ v and a walk v ->+ r,
# each as the list of nodes visited after the walk's start, at least one.


# Successor list of node n.
def Graph.nth(adj: List<&2, List<&2, U32>>, n: Nat) -> List<&2, U32>:
  match adj n:
    case Nil{} _:
      Nil{}
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      Graph.nth(t, p)

def Graph.mem(xs: List<&2, U32>, +w: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, t}:
      Bool.or(U32.is_eq(h, w), Graph.mem(t, w))

# u -> w is an edge.
def Graph.edge(adj: List<&2, List<&2, U32>>, u: U32, +w: U32) -> Bool:
  Graph.mem(Graph.nth(adj, U32.to_nat(u)), w)

# ws is a walk from u to v (possibly with no edge, when u is v).
def Graph.path0(ws: List<&2, U32>, +adj: List<&2, List<&2, U32>>, u: U32, +v: U32) -> Bool:
  match ws:
    case Nil{}:
      U32.is_eq(u, v)
    case Con{+w, t}:
      Bool.and(Graph.edge(adj, u, w), Graph.path0(t, adj, w, v))

# ws is a walk from u to v with at least one edge.
def Graph.path1(ws: List<&2, U32>, +adj: List<&2, List<&2, U32>>, u: U32, +v: U32) -> Bool:
  match ws:
    case Nil{}:
      False{}
    case Con{+w, t}:
      Bool.and(Graph.edge(adj, u, w), Graph.path0(t, adj, w, v))

def Graph.member_ok(+adj: List<&2, List<&2, U32>>, +r: U32, +v: U32, up: List<&2, U32>, down: List<&2, U32>) -> Bool:
  Bool.and(Graph.path1(up, adj, r, v), Graph.path1(down, adj, v, r))

def Graph.members_ok(c: List<&2, U32>, cs: List<&2, Cert>, +adj: List<&2, List<&2, U32>>, +r: U32) -> Bool:
  match c cs:
    case Nil{} Nil{}:
      True{}
    case Nil{} Con{_, _}:
      False{}
    case Con{_, _} Nil{}:
      False{}
    case Con{+v, vt} Con{Cert{up, down}, ct}:
      Bool.and(Graph.member_ok(adj, r, v, up, down), Graph.members_ok(vt, ct, adj, r))

# True only if every member of c is on a closed walk through c's first member.
def Graph.cert_ok(c: List<&2, U32>, cs: List<&2, Cert>, +adj: List<&2, List<&2, U32>>) -> Bool:
  match c:
    case Nil{}:
      True{}
    case Con{+r, +t}:
      Graph.members_ok(Con{r, t}, cs, adj, r)

# ---- certificate search (untrusted) ---------------------------------------------------------



def Graph.pick_l(hit: Bool, a: List<&2, U32>, b: List<&2, U32>) -> List<&2, U32>:
  match hit:
    case True{}:
      a
    case False{}:
      b

def Graph.ad_get(g: List<&2, Ad>, +v: U32) -> List<&2, U32>:
  match g:
    case Nil{}:
      Nil{}
    case Con{Ad{a, ns}, t}:
      Graph.pick_l(U32.is_eq(a, v), ns, Graph.ad_get(t, v))

def Graph.ent_get(g: List<&2, Ent>, +v: U32) -> List<&2, U32>:
  match g:
    case Nil{}:
      Nil{}
    case Con{Ent{a, p}, t}:
      Graph.pick_l(U32.is_eq(a, v), p, Graph.ent_get(t, v))

def Graph.seen_has(g: List<&2, Ent>, +v: U32) -> Bool:
  match g:
    case Nil{}:
      False{}
    case Con{Ent{a, _}, t}:
      Bool.or(U32.is_eq(a, v), Graph.seen_has(t, v))

def Graph.keep_in_k(hit: Bool, w: U32, rest: List<&2, U32>) -> List<&2, U32>:
  match hit:
    case True{}:
      Con{w, rest}
    case False{}:
      rest

# Restrict successor lists to members of c.
def Graph.keep_in(ns: List<&2, U32>, +c: List<&2, U32>) -> List<&2, U32>:
  match ns:
    case Nil{}:
      Nil{}
    case Con{+w, t}:
      Graph.keep_in_k(Graph.mem(c, w), w, Graph.keep_in(t, c))

# Forward graph restricted to members of c, one entry per member.
def Graph.fgraph(c: List<&2, U32>, +adj: List<&2, List<&2, U32>>, +all: List<&2, U32>) -> List<&2, Ad>:
  match c:
    case Nil{}:
      Nil{}
    case Con{+v, t}:
      Con{Ad{v, Graph.keep_in(Graph.nth(adj, U32.to_nat(v)), all)}, Graph.fgraph(t, adj, all)}

def Graph.radd1(hit: Bool, a: U32, ns: List<&2, U32>, u: U32) -> Ad:
  match hit:
    case True{}:
      Ad{a, Con{u, ns}}
    case False{}:
      Ad{a, ns}

def Graph.radd(g: List<&2, Ad>, +w: U32, +u: U32) -> List<&2, Ad>:
  match g:
    case Nil{}:
      Nil{}
    case Con{Ad{+a, ns}, t}:
      Con{Graph.radd1(U32.is_eq(a, w), a, ns, u), Graph.radd(t, w, u)}

def Graph.rev_edges(ns: List<&2, U32>, +u: U32, r: List<&2, Ad>) -> List<&2, Ad>:
  match ns:
    case Nil{}:
      r
    case Con{w, t}:
      Graph.rev_edges(t, u, Graph.radd(r, w, u))

def Graph.rev_go(g: List<&2, Ad>, r: List<&2, Ad>) -> List<&2, Ad>:
  match g:
    case Nil{}:
      r
    case Con{Ad{v, ns}, t}:
      Graph.rev_go(t, Graph.rev_edges(ns, v, r))

def Graph.rev_init(g: List<&2, Ad>) -> List<&2, Ad>:
  match g:
    case Nil{}:
      Nil{}
    case Con{Ad{v, _}, t}:
      Con{Ad{v, Nil{}}, Graph.rev_init(t)}

# Edges reversed (a member's list holds its predecessors).
def Graph.rgraph(+g: List<&2, Ad>) -> List<&2, Ad>:
  Graph.rev_go(g, Graph.rev_init(g))

# mode False: p is the reversed walk from the root (head = last node).
# mode True: p is the walk to the root (head = next node). `t` was reached from `v`.
def Graph.ext(mode: Bool, +v: U32, +t: U32, p: List<&2, U32>) -> List<&2, U32>:
  match mode:
    case True{}:
      Con{v, p}
    case False{}:
      Con{t, p}

def Graph.upd_k(hit: Bool, +e: Ent, seen: List<&2, Ent>, nf: List<&2, Ent>) -> Bs:
  match hit:
    case True{}:
      Bs{seen, nf}
    case False{}:
      Bs{Con{e, seen}, Con{e, nf}}

def Graph.upd(b: Bs, +v: U32, +p: List<&2, U32>, +mode: Bool, +t: U32) -> Bs:
  match b:
    case Bs{+seen, nf}:
      Graph.upd_k(Graph.seen_has(seen, t), Ent{t, Graph.ext(mode, v, t, p)}, seen, nf)

def Graph.expand(ns: List<&2, U32>, +v: U32, +p: List<&2, U32>, +mode: Bool, b: Bs) -> Bs:
  match ns:
    case Nil{}:
      b
    case Con{+t, ns2}:
      Graph.expand(ns2, v, p, mode, Graph.upd(b, v, p, mode, t))

def Graph.round(front: List<&2, Ent>, +g: List<&2, Ad>, +mode: Bool, b: Bs) -> Bs:
  match front:
    case Nil{}:
      b
    case Con{Ent{+v, p}, t}:
      Graph.round(t, g, mode, Graph.expand(Graph.ad_get(g, v), v, p, mode, b))

def Graph.newround(b: Bs, +g: List<&2, Ad>, +mode: Bool) -> Bs:
  match b:
    case Bs{seen, front}:
      Graph.round(front, g, mode, Bs{seen, Nil{}})

def Graph.bfs_seen(b: Bs) -> List<&2, Ent>:
  match b:
    case Bs{seen, front}:
      seen

def Graph.bfs(fuel: Nat, +g: List<&2, Ad>, +mode: Bool, b: Bs) -> List<&2, Ent>:
  match fuel:
    case 0n:
      Graph.bfs_seen(b)
    case 1n+f:
      Graph.bfs(f, g, mode, Graph.newround(b, g, mode))

# Every node of g reachable from r, each with its walk.
def Graph.search(+g: List<&2, Ad>, +mode: Bool, +r: U32, +fuel: Nat) -> List<&2, Ent>:
  Graph.bfs(fuel, g, mode, Bs{[Ent{r, Nil{}}], [Ent{r, Nil{}}]})

# The cycle through r: one step to a member s, then s's walk back.
def Graph.cyc(ns: List<&2, U32>, bseen: List<&2, Ent>) -> List<&2, U32>:
  match ns:
    case Nil{}:
      Nil{}
    case Con{+s, _}:
      Con{s, Graph.ent_get(bseen, s)}

def Graph.cert_for_k(is_root: Bool, +v: U32, fseen: List<&2, Ent>, bseen: List<&2, Ent>, +cyc: List<&2, U32>) -> Cert:
  match is_root:
    case True{}:
      Cert{cyc, cyc}
    case False{}:
      Cert{List.reverse(&2, U32, Graph.ent_get(fseen, v)), Graph.ent_get(bseen, v)}

def Graph.cert_for(+v: U32, +r: U32, +fseen: List<&2, Ent>, +bseen: List<&2, Ent>, +cyc: List<&2, U32>) -> Cert:
  Graph.cert_for_k(U32.is_eq(v, r), v, fseen, bseen, cyc)

def Graph.certs(c: List<&2, U32>, +r: U32, +fseen: List<&2, Ent>, +bseen: List<&2, Ent>, +cyc: List<&2, U32>) -> List<&2, Cert>:
  match c:
    case Nil{}:
      Nil{}
    case Con{v, t}:
      Con{Graph.cert_for(v, r, fseen, bseen, cyc), Graph.certs(t, r, fseen, bseen, cyc)}

def Graph.find_k4(+bseen: List<&2, Ent>, fseen: List<&2, Ent>, c: List<&2, U32>, +r: U32, rns: List<&2, U32>) -> List<&2, Cert>:
  Graph.certs(c, r, fseen, bseen, Graph.cyc(rns, bseen))

def Graph.find_k3(rg: List<&2, Ad>, fseen: List<&2, Ent>, c: List<&2, U32>, +r: U32, g: List<&2, Ad>, +fuel: Nat) -> List<&2, Cert>:
  Graph.find_k4(Graph.search(rg, True{}, r, fuel), fseen, c, r, Graph.ad_get(g, r))

def Graph.find_k2(fseen: List<&2, Ent>, c: List<&2, U32>, +r: U32, +g: List<&2, Ad>, +fuel: Nat) -> List<&2, Cert>:
  Graph.find_k3(Graph.rgraph(g), fseen, c, r, g, fuel)

def Graph.find_k(c: List<&2, U32>, +r: U32, +g: List<&2, Ad>, +fuel: Nat) -> List<&2, Cert>:
  Graph.find_k2(Graph.search(g, False{}, r, fuel), c, r, g, fuel)

# Certificates for component c, whose first member is the root.
def Graph.find(c: List<&2, U32>, +adj: List<&2, List<&2, U32>>) -> List<&2, Cert>:
  match c:
    case Nil{}:
      Nil{}
    case Con{+r, +t}:
      Graph.find_k(Con{r, t}, r, Graph.fgraph(Con{r, t}, adj, Con{r, t}), List.length(&2, U32, t))

def Graph.certified(+c: List<&2, U32>, +adj: List<&2, List<&2, U32>>) -> Bool:
  Graph.cert_ok(c, Graph.find(c, adj), adj)

# Keep the components that pass certification.
def Graph.keep_certified(cs: List<&2, List<&2, U32>>, +adj: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{+c, t}:
      Graph.push_if(Graph.certified(c, adj), c, Graph.keep_certified(t, adj))

# ---- sorting (insertion; the proofs only need that no member is lost) ---------------
def Graph.ins_u_k(b: Bool, x: U32, h: U32, t: List<&2, U32>, r: List<&2, U32>) -> List<&2, U32>:
  match b:
    case True{}:
      Con{x, Con{h, t}}
    case False{}:
      Con{h, r}

def Graph.ins_u(xs: List<&2, U32>, +x: U32) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Con{x, Nil{}}
    case Con{+h, +t}:
      Graph.ins_u_k(U32.is_le(x, h), x, h, t, Graph.ins_u(t, x))

def Graph.isort_u(xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Graph.ins_u(Graph.isort_u(t), h)

def Graph.ins_l_k(b: Bool, x: List<&2, U32>, h: List<&2, U32>, t: List<&2, List<&2, U32>>, r: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match b:
    case True{}:
      Con{x, Con{h, t}}
    case False{}:
      Con{h, r}

def Graph.ins_l(xs: List<&2, List<&2, U32>>, +x: List<&2, U32>) -> List<&2, List<&2, U32>>:
  match xs:
    case Nil{}:
      Con{x, Nil{}}
    case Con{+h, +t}:
      Graph.ins_l_k(Graph.list_le(x, h), x, h, t, Graph.ins_l(t, x))

def Graph.isort_l(xs: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Graph.ins_l(Graph.isort_l(t), h)

def Graph.sort_members(cs: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Graph.isort_u(h), Graph.sort_members(t)}

# ---- completeness certificate: component numbers never decrease along an edge ---------
# Tarjan emits components sinks first and Graph.sccs lists the latest first, so
# the position of a component in that list is a topological number.

# Map from U32 (read bit by bit, low bit first) to Nat.

def Tr.z(t: Tr) -> Tr:
  match t:
    case TE{}:
      TE{}
    case TV{_}:
      TE{}
    case TN{z, _}:
      z

def Tr.o(t: Tr) -> Tr:
  match t:
    case TE{}:
      TE{}
    case TV{_}:
      TE{}
    case TN{_, o}:
      o

def Tr.sel(b: Bool, t: Tr) -> Tr:
  match b:
    case False{}:
      Tr.z(t)
    case True{}:
      Tr.o(t)

def Tr.setk(b: Bool, t: Tr, nw: Tr) -> Tr:
  match b:
    case False{}:
      TN{nw, Tr.o(t)}
    case True{}:
      TN{Tr.z(t), nw}

def Tr.put(n: Nat, +t: Tr, w: Word(n), x: Nat) -> Tr:
  match n:
    case 0n:
      TV{x}
    case 1n+p:
      match w:
        case WCon{+b, wt}:
          Tr.setk(b, t, Tr.put(p, Tr.sel(b, t), wt, x))

def Tr.putu(t: Tr, x: U32, v: Nat) -> Tr:
  match x:
    case U32{w}:
      Tr.put(32n, t, w, v)

# ---- candidates --------------------------------------------------------------------------
# ---- self edges, read in one pass ---------------------------------------------------------
# The nodes whose own row lists them, positionally (the row at position p is
# node U32.from_nat(p)). Untrusted: only Graph.selfs_ok (in verified2) is
# relied on, and only for completeness; soundness never reads it, since every
# reported cycle passes cert_ok. One pass replaces an O(n) Graph.nth per
# singleton component, which was quadratic in the number of files.
def Graph.selfs_add(hit: Bool, +x: U32, s: Tr) -> Tr:
  match hit:
    case True{}:
      Tr.putu(s, x, 0n)
    case False{}:
      s

def Graph.selfs_go(adj: List<&2, List<&2, U32>>, +x: U32, s: Tr) -> Tr:
  match adj:
    case Nil{}:
      s
    case Con{ns, t}:
      Graph.selfs_go(t, U32.inc(x), Graph.selfs_add(Graph.mem(ns, x), x, s))

def Graph.selfs(adj: List<&2, List<&2, U32>>) -> Tr:
  Graph.selfs_go(adj, 0, TE{})

def Graph.in_tr2(m: Maybe<&2, Nat>) -> Bool:
  match m:
    case None{}:
      False{}
    case Some{v}:
      True{}

def Tr.leaf(t: Tr) -> Maybe<&2, Nat>:
  match t:
    case TE{}:
      None{}
    case TV{x}:
      Some{x}
    case TN{_, _}:
      None{}

def Tr.get(n: Nat, t: Tr, w: Word(n)) -> Maybe<&2, Nat>:
  match n:
    case 0n:
      Tr.leaf(t)
    case 1n+p:
      match w:
        case WCon{b, wt}:
          Tr.get(p, Tr.sel(b, t), wt)

def Tr.getu(t: Tr, x: U32) -> Maybe<&2, Nat>:
  match x:
    case U32{w}:
      Tr.get(32n, t, w)

def Graph.in_tr(+t: Tr, x: U32) -> Bool:
  Graph.in_tr2(Tr.getu(t, x))

# Certificate: every row that lists its own node is in s.
def Graph.selfs_ok(adj: List<&2, List<&2, U32>>, +x: U32, +s: Tr) -> Bool:
  match adj:
    case Nil{}:
      True{}
    case Con{ns, t}:
      Bool.and(Bool.or(Bool.not(Graph.mem(ns, x)), Graph.in_tr(s, x)), Graph.selfs_ok(t, U32.inc(x), s))

def Graph.cand_k(t: List<&2, U32>, +s: Tr, +x: U32) -> Bool:
  match t:
    case Nil{}:
      Graph.in_tr(s, x)
    case Con{_, _}:
      True{}

# A component is a cycle if it has two or more nodes, or one node with a self
# edge (s = Graph.selfs(adj)).
def Graph.is_cand(c: List<&2, U32>, +s: Tr) -> Bool:
  match c:
    case Nil{}:
      False{}
    case Con{+x, t}:
      Graph.cand_k(t, s, x)

def Graph.keep_cand(cs: List<&2, List<&2, U32>>, +s: Tr) -> List<&2, List<&2, U32>>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{+c, t}:
      Graph.push_if(Graph.is_cand(c, s), c, Graph.keep_cand(t, s))

# Every cycle of the graph (components' views): members ascending, cycles in
# lexicographic order of their member lists.
def Graph.candidates(adj: List<&2, List<&2, U32>>, cs: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  Graph.isort_l(Graph.sort_members(Graph.keep_cand(cs, Graph.selfs(adj))))

# Number every member of component c with k.
def Graph.ins_comp(c: List<&2, U32>, +k: Nat, tr: Tr) -> Tr:
  match c:
    case Nil{}:
      tr
    case Con{x, r}:
      Graph.ins_comp(r, k, Tr.putu(tr, x, k))

# Number the nodes of components cs, the first being k.
def Graph.ids(cs: List<&2, List<&2, U32>>, +k: Nat, tr: Tr) -> Tr:
  match cs:
    case Nil{}:
      tr
    case Con{c, t}:
      Graph.ids(t, 1n+k, Graph.ins_comp(c, k, tr))

def Graph.le_ok(mi: Maybe<&2, Nat>, mj: Maybe<&2, Nat>) -> Bool:
  match mi mj:
    case Some{i} Some{j}:
      Nat.is_le(i, j)
    case Some{_} None{}:
      False{}
    case None{} _:
      False{}

def Graph.row_ok(ns: List<&2, U32>, +mi: Maybe<&2, Nat>, +tr: Tr) -> Bool:
  match ns:
    case Nil{}:
      True{}
    case Con{w, t}:
      Bool.and(Graph.le_ok(mi, Tr.getu(tr, w)), Graph.row_ok(t, mi, tr))

# Every edge u -> w joins numbered nodes with number(u) <= number(w). The node
# at list position p is U32.from_nat(p); x walks along with it.
def Graph.mono_ok(adj: List<&2, List<&2, U32>>, +x: U32, +tr: Tr) -> Bool:
  match adj:
    case Nil{}:
      True{}
    case Con{ns, t}:
      Bool.and(Graph.row_ok(ns, Tr.getu(tr, x), tr), Graph.mono_ok(t, U32.inc(x), tr))

def Graph.all_cert(cs: List<&2, List<&2, U32>>, +adj: List<&2, List<&2, U32>>) -> Bool:
  match cs:
    case Nil{}:
      True{}
    case Con{+c, t}:
      Bool.and(Graph.certified(c, adj), Graph.all_cert(t, adj))

# ---- partition certificate: every node occurs once in the components -----------------------
def Graph.cnt_of(m: Maybe<&2, Nat>) -> Nat:
  match m:
    case None{}:
      0n
    case Some{x}:
      x

# Occurrence counts of every U32 in l, on top of tr.
def Graph.cnt_all(l: List<&2, U32>, +tr: Tr) -> Tr:
  match l:
    case Nil{}:
      tr
    case Con{+y, r}:
      Graph.cnt_all(r, Tr.putu(tr, y, 1n+Graph.cnt_of(Tr.getu(tr, y))))

def Graph.part_rows(adj: List<&2, List<&2, U32>>, +x: U32, +cnt: Tr) -> Bool:
  match adj:
    case Nil{}:
      True{}
    case Con{_, t}:
      Bool.and(Nat.is_eq(Graph.cnt_of(Tr.getu(cnt, x)), 1n), Graph.part_rows(t, U32.inc(x), cnt))

# Each node (position p of adj is U32.from_nat(p)) occurs exactly once in the
# concatenation of the components cs.
def Graph.part_ok2(adj: List<&2, List<&2, U32>>, cs: List<&2, List<&2, U32>>) -> Bool:
  Graph.part_rows(adj, 0, Graph.cnt_all(List.concat(&2, U32, cs), TE{}))

def Graph.part_ok(+adj: List<&2, List<&2, U32>>) -> Bool:
  Graph.part_ok2(adj, Graph.sccs(adj))

# ---- the pipeline ---------------------------------------------------------------------------
# cycles2: reported cycles; sound whatever sccs returned.
def Graph.cycles2(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  Graph.keep_certified(Graph.candidates(adj, cs), adj)

# verified2: the run's certificates all passed (see LAWS.bend: completeness and
# partition hold whenever this is True).
def Graph.verified2(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>) -> Bool:
  Bool.and(Bool.and(Graph.mono_ok(adj, 0, Graph.ids(cs, 0n, TE{})), Graph.all_cert(Graph.candidates(adj, cs), adj)), Graph.selfs_ok(adj, 0, Graph.selfs(adj)))

def Graph.cycles(+adj: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  Graph.cycles2(adj, Graph.sccs(adj))

def Graph.verified(+adj: List<&2, List<&2, U32>>) -> Bool:
  Graph.verified2(adj, Graph.sccs(adj))

# ---- shipped entry point --------------------------------------------------------------------
# One SCC search; the reported cycles (sound always), and whether every
# certificate passed (when True, LAWS.bend's cycles_complete and sccs_partition
# apply to this very run). A caller should treat `ok = False` as an internal
# error: the search disagreed with its own certificates.

def Graph.analyze2(+adj: List<&2, List<&2, U32>>, +cs: List<&2, List<&2, U32>>) -> Res:
  Res{Graph.cycles2(adj, cs), Bool.and(Graph.verified2(adj, cs), Graph.part_ok2(adj, cs))}

def Graph.analyze(+adj: List<&2, List<&2, U32>>) -> Res:
  Graph.analyze2(adj, Graph.sccs(adj))
