import Base
import ./LAWS.bend as Laws
import ./Lemmas.bend as L
import ./Lemmas2.bend as L2
import ./Lemmas3.bend as L3
import ./Graph.bend as G

def Laws.cycles_sound(adj, c, hc, u, hu, v, hv):
  L.Cert.sound(c, G.Graph.find(c, adj), adj, u, v, L.Keep.sound(G.Graph.candidates(adj, G.Graph.sccs(adj)), adj, c, hc), hu, hv)

def Laws.only_type_bindings_elided(edge):
  {==}

def Laws.value_binding_keeps_edge(ht, edge):
  match ht:
    case False{}:
      {==}
    case True{}:
      {==}

def Laws.empty_clause_keeps_edge(edge):
  {==}

def Laws.export_self_edge_dropped(v, cur, all, bare, miss, dyn, req, tonly):
  {==}

def Laws.import_self_edge_kept(v, cur, all, bare, miss, dyn, req, tonly):
  {==}

def Laws.idle_is_fixed_point(ns, cnt, comps, cur):
  {==}

def Laws.cycles_complete(adj, ok, u, v, r1, r2):
  +ok2 = L.Bool.and_true(Bool.and(G.Graph.mono_ok(adj, 0, G.Graph.ids(G.Graph.sccs(adj), 0n, G.TE{})), G.Graph.all_cert(G.Graph.candidates(adj, G.Graph.sccs(adj)), adj)), G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)), ok)
  L2.Complete.fin(adj, u, v, L2.SO.snd(Bool.and(G.Graph.mono_ok(adj, 0, G.Graph.ids(G.Graph.sccs(adj), 0n, G.TE{})), G.Graph.all_cert(G.Graph.candidates(adj, G.Graph.sccs(adj)), adj)), G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)), ok2), L.Bool.and_true(G.Graph.mono_ok(adj, 0, G.Graph.ids(G.Graph.sccs(adj), 0n, G.TE{})), G.Graph.all_cert(G.Graph.candidates(adj, G.Graph.sccs(adj)), adj), L2.SO.fst(Bool.and(G.Graph.mono_ok(adj, 0, G.Graph.ids(G.Graph.sccs(adj), 0n, G.TE{})), G.Graph.all_cert(G.Graph.candidates(adj, G.Graph.sccs(adj)), adj)), G.Graph.selfs_ok(adj, 0, G.Graph.selfs(adj)), ok2)), r1, r2)

def Laws.sccs_partition(adj, ok, p, hp):
  L3.Part.at(adj, G.Graph.sccs(adj), p, ok, hp)

def Laws.analyze_is_cycles(adj):
  {==}
