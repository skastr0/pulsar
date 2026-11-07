import Base
import ../PROOF.bend as Top
import ../LAWS.bend as TopLaws
import ../Extract.bend as E
import ../Resolve.bend as R
import ../Graph.bend as G
import ./Facts.bend as F
import ./Scope.bend as S
import ./Pipeline.bend as L
import ./Scope-PROOF.bend as ScopeProof
import ./LAWS.bend as Laws
import ./Rows.bend as W
import ./Layers.bend as Y
import ./ClassCtx.bend as X
# One gate: importing every detector's proofs makes `bend engine/PROOF.bend --verdict`
# re-check them all.
import ./Layers-PROOF.bend as LayersProof
import ./Metrics-PROOF.bend as MetricsProof
import ./MetricsIn-PROOF.bend as MetricsInProof
import ./ClassCtx-PROOF.bend as ClassCtxProof
import ./Crap-PROOF.bend as CrapProof
import ./Hotspot-PROOF.bend as HotspotProof
import ./Churn-PROOF.bend as ChurnProof
import ./Cognitive-PROOF.bend as CognitiveProof
import ./Sql-PROOF.bend as SqlProof

def Laws.kind_is_value_kind(hv, ht, form):
  {==}

def Laws.verdict_import_adds_edge(src, dst, form, hv, ht, cur, all, bare, miss, dyn, req, tonly, h):
  %Equal.sym(E.RefKind, F.Facts.kind(hv, ht, form), E.KImport{}, h) : {F.Facts.apply(_, src, dst, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}
  {==}

def Laws.fact_type_only_not_edge(src, dst, form, cur, all, bare, miss, dyn, req, tonly):
  {==}

def Laws.fact_value_import_is_edge(src, dst, ht, cur, all, bare, miss, dyn, req, tonly):
  {==}

def Laws.fact_empty_clause_is_edge(src, dst, cur, all, bare, miss, dyn, req, tonly):
  {==}

def Laws.fact_side_effect_import_is_edge(src, dst, cur, all, bare, miss, dyn, req, tonly):
  {==}

def Laws.verdict_export_adds_edge(src, dst, form, hv, ht, cur, all, bare, miss, dyn, req, tonly, h, hn):
  %Equal.sym(E.RefKind, F.Facts.kind(hv, ht, form), E.KExport{}, h) : {F.Facts.apply(_, src, dst, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}
  %Equal.sym(Bool, U32.is_eq(src, dst), False{}, hn) : {R.Resolve.add_edge2(True{}, _, dst, cur, all, bare, miss, dyn, req, tonly) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}
  {==}

def Laws.verdict_export_self_dropped(src, dst, form, hv, ht, cur, all, bare, miss, dyn, req, tonly, h, hs):
  %Equal.sym(E.RefKind, F.Facts.kind(hv, ht, form), E.KExport{}, h) : {F.Facts.apply(_, src, dst, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}
  %Equal.sym(Bool, U32.is_eq(src, dst), True{}, hs) : {R.Resolve.add_edge2(True{}, _, dst, cur, all, bare, miss, dyn, req, tonly) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}
  {==}

def Laws.verdict_type_only_no_edge(src, dst, form, hv, ht, cur, all, bare, miss, dyn, req, tonly, h):
  %Equal.sym(E.RefKind, F.Facts.kind(hv, ht, form), E.KTypeOnly{}, h) : {F.Facts.apply(_, src, dst, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, U32.add(tonly, 1)} : R.Acc}
  {==}

def Laws.fact_export_from_is_edge(src, dst, ht, cur, all, bare, miss, dyn, req, tonly, hn):
  %Equal.sym(Bool, U32.is_eq(src, dst), False{}, hn) : {R.Resolve.add_edge2(True{}, _, dst, cur, all, bare, miss, dyn, req, tonly) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}
  {==}

def Laws.fact_export_self_dropped(src, dst, ht, cur, all, bare, miss, dyn, req, tonly, hs):
  %Equal.sym(Bool, U32.is_eq(src, dst), True{}, hs) : {R.Resolve.add_edge2(True{}, _, dst, cur, all, bare, miss, dyn, req, tonly) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}
  {==}

def Laws.fact_import_self_kept(src, dst, cur, all, bare, miss, dyn, req, tonly, hs):
  {==}

# The rule's verdict, by cases on the three Booleans it reads.
def Ex.cases(hv: Bool, ht: Bool, f: Bool) -> Either<&2, &2, {E.Extract.value_kind(hv, ht, F.Facts.kind2(f)) == E.KImport{} : E.RefKind}, Either<&2, &2, {E.Extract.value_kind(hv, ht, F.Facts.kind2(f)) == E.KExport{} : E.RefKind}, {E.Extract.value_kind(hv, ht, F.Facts.kind2(f)) == E.KTypeOnly{} : E.RefKind}>>:
  match hv ht f:
    case True{} _ False{}:
      Inl{{==}}
    case True{} _ True{}:
      Inr{Inl{{==}}}
    case False{} True{} _:
      Inr{Inr{{==}}}
    case False{} False{} False{}:
      Inl{{==}}
    case False{} False{} True{}:
      Inr{Inl{{==}}}

def Laws.verdict_exhaustive(hv, ht, form):
  Ex.cases(F.Facts.flag(hv), F.Facts.flag(ht), U32.is_eq(form, 2))

def Laws.pipeline_is_analyze(n, prods, fs, ok):
  %Equal.sym(Bool, F.Facts.valid(fs, n, 0, True{}), True{}, ok) : {L.Pipeline.run2(_, n, prods, fs) == Some{L.Out{S.Scope.count(U32.to_nat(n), 0, S.Scope.set(prods), 0), G.Graph.edges(S.Scope.graph(S.Scope.set(prods), n, fs), 0), G.Graph.analyze(S.Scope.graph(S.Scope.set(prods), n, fs))}} : Maybe<L.Out>}
  {==}

def Laws.pipeline_refuses_invalid(n, prods, fs, bad):
  %Equal.sym(Bool, F.Facts.valid(fs, n, 0, True{}), False{}, bad) : {L.Pipeline.run2(_, n, prods, fs) == None{} : Maybe<L.Out>}
  {==}

def Laws.pipeline_cycles_are_graph_cycles(n, prods, fs, ok):
  %Equal.sym(Bool, F.Facts.valid(fs, n, 0, True{}), True{}, ok) : {L.Pipeline.run2(_, n, prods, fs) == Some{L.Out{S.Scope.count(U32.to_nat(n), 0, S.Scope.set(prods), 0), G.Graph.edges(S.Scope.graph(S.Scope.set(prods), n, fs), 0), G.Res{G.Graph.cycles(S.Scope.graph(S.Scope.set(prods), n, fs)), Bool.and(G.Graph.verified(S.Scope.graph(S.Scope.set(prods), n, fs)), G.Graph.part_ok(S.Scope.graph(S.Scope.set(prods), n, fs)))}}} : Maybe<L.Out>}
  %TopLaws.analyze_is_cycles(S.Scope.graph(S.Scope.set(prods), n, fs)) : {Some{L.Out{S.Scope.count(U32.to_nat(n), 0, S.Scope.set(prods), 0), G.Graph.edges(S.Scope.graph(S.Scope.set(prods), n, fs), 0), G.Graph.analyze(S.Scope.graph(S.Scope.set(prods), n, fs))}} == Some{L.Out{S.Scope.count(U32.to_nat(n), 0, S.Scope.set(prods), 0), G.Graph.edges(S.Scope.graph(S.Scope.set(prods), n, fs), 0), _}} : Maybe<L.Out>}
  {==}

def Laws.report_shape(files, edges, cs, ok):
  {==}

def Laws.engine_is_both(o, ms):
  {==}

def Laws.engine_refuses_graph(m):
  {==}

def Laws.engine_refuses_metrics(o):
  {==}

def Laws.engine_more_both(a, b):
  {==}

def Laws.engine_more_refuses_left(b):
  {==}

def Laws.engine_more_refuses_right(a):
  {==}

def Laws.engine_layers_on(rows, on):
  %Equal.sym(Bool, L.Engine.has_tag(rows, L.Engine.tag_e()), True{}, on) : {L.Engine.ly1(_, rows) == L.Engine.ly2(Y.Layers.decode(rows)) : Maybe<List<&2, String>>}
  {==}

def Laws.engine_layers_run(lf):
  {==}

def Laws.engine_layers_lines(o):
  {==}

def Laws.engine_layers_off(rows, off):
  %Equal.sym(Bool, L.Engine.has_tag(rows, L.Engine.tag_e()), False{}, off) : {L.Engine.ly1(_, rows) == Some{Nil{}} : Maybe<List<&2, String>>}
  {==}

def Laws.engine_classctx_on(rows, on):
  %Equal.sym(Bool, L.Engine.has_tag(rows, L.Engine.tag_rl()), True{}, on) : {L.Engine.cx1(_, rows) == L.Engine.cx2(X.ClassCtx.decode(rows)) : Maybe<List<&2, String>>}
  {==}

def Laws.engine_classctx_run(cf):
  {==}

def Laws.engine_classctx_lines(fs):
  {==}

def Laws.engine_classctx_off(rows, off):
  %Equal.sym(Bool, L.Engine.has_tag(rows, L.Engine.tag_rl()), False{}, off) : {L.Engine.cx1(_, rows) == Some{Nil{}} : Maybe<List<&2, String>>}
  {==}

def Laws.engine_all(o, m, rows):
  {==}

def Laws.engine_row_tags():
  {==}

def Laws.metrics_defaults():
  {==}
