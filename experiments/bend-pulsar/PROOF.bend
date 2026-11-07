# PROOF.bend - proofs for LAWS.bend. Laws without a def here are open claims.
#
# Proven: only_type_bindings_elided, value_binding_keeps_edge,
#         empty_clause_keeps_edge, export_self_edge_dropped,
#         import_self_edge_kept, idle_is_fixed_point.
# OPEN:   cycles_sound, cycles_complete, sccs_partition.

import Base
import ./LAWS.bend as Laws

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
