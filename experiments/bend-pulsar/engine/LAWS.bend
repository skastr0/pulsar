# engine/LAWS.bend - laws about the functions pulsar-engine runs.
#
# These extend the top-level LAWS.bend (A-J, about Extract.value_kind,
# Resolve.add_edge2 and Graph.analyze). They are about the engine's own code:
#   Facts.add / Facts.apply   the fact-to-edge builder (Facts.bend)
#   Pipeline.run              facts to findings       (Pipeline.bend)
# and are filled in engine/PROOF.bend. Gate: `bend engine/PROOF.bend --verdict`,
# which also re-checks the top-level laws it imports.
#
# Not covered by any law, by design: Parse.bend (bytes to facts). The reader is
# shown against the fixtures in engine/fixtures and the synthetic input.
#
# Tested, not proven (fixtures, and gen-facts.py's independent rule table and
# Tarjan SCC at 20k files / 100k facts, which match byte for byte):
#   - row grouping: Scope.go / Facts.close_n put each accepted fact's edge in
#     the row of its src, and every row holds only such edges. K1-K13 and SC3-SC5
#     prove what a single fact adds to the open row, not that rows are opened
#     and closed at the right file. A proof would be an invariant over Scope.go:
#     after the prefix up to src, `all` holds the rows 0..src-1.
#   - Scope.count: the S line's file count (the number of production ids). It
#     changes no finding.
#   - the readers Parse.bend, Rows.bend and the decoders (MetricsIn, Layers.decode,
#     ClassCtx.decode).

import Base
import ../Extract.bend as E
import ../Resolve.bend as R
import ../Graph.bend as G
import ./Facts.bend as F
import ./Scope.bend as S
import ./Pipeline.bend as L
import ./Rows.bend as W
import ./Layers.bend as Y
import ./ClassCtx.bend as X
import ./Metrics.bend as M
import ./History.bend as Hs
import ./SqlIn.bend as Sq

# ---- K. the fact-to-edge rule -----------------------------------------------------------------
# `Facts.kind` asks the proven rule (Extract.value_kind) what a fact is. These
# laws say Facts.add then does exactly what Resolve.add_edge2 (laws D, E) does
# for that verdict, and they cover every verdict the rule can give.

# K1. the rule says import: the edge is added, even when it is a self edge.
law verdict_import_adds_edge:
  for src: U32
  for dst: U32
  for form: U32
  for hv: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for h: {F.Facts.kind(hv, ht, form) == E.KImport{} : E.RefKind}
  {F.Facts.add(F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}

# K2. the rule says export, and the file is not its own target: the edge is added.
law verdict_export_adds_edge:
  for src: U32
  for dst: U32
  for form: U32
  for hv: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for h: {F.Facts.kind(hv, ht, form) == E.KExport{} : E.RefKind}
  for hn: {U32.is_eq(src, dst) == False{} : Bool}
  {F.Facts.add(F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}

# K3. the rule says export, and the file is its own target: nothing is added.
law verdict_export_self_dropped:
  for src: U32
  for dst: U32
  for form: U32
  for hv: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for h: {F.Facts.kind(hv, ht, form) == E.KExport{} : E.RefKind}
  for hs: {U32.is_eq(src, dst) == True{} : Bool}
  {F.Facts.add(F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}

# K4. the rule says type-only: no edge, the statement is only counted.
law verdict_type_only_no_edge:
  for src: U32
  for dst: U32
  for form: U32
  for hv: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for h: {F.Facts.kind(hv, ht, form) == E.KTypeOnly{} : E.RefKind}
  {F.Facts.add(F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, U32.add(tonly, 1)} : R.Acc}

# K5. the rule has no other verdict for a fact, so K1-K4 cover every fact.
law verdict_exhaustive:
  for hv: U32
  for ht: U32
  for form: U32
  Either<&2, &2, {F.Facts.kind(hv, ht, form) == E.KImport{} : E.RefKind}, Either<&2, &2, {F.Facts.kind(hv, ht, form) == E.KExport{} : E.RefKind}, {F.Facts.kind(hv, ht, form) == E.KTypeOnly{} : E.RefKind}>>

# K6. the verdict is the proven rule's: Facts.kind is Extract.value_kind (laws A-C)
# on the fact's flags, an import for forms 0 and 1, an export for form 2.
law kind_is_value_kind:
  for hv: U32
  for ht: U32
  for form: U32
  {F.Facts.kind(hv, ht, form) == E.Extract.value_kind(F.Facts.flag(hv), F.Facts.flag(ht), F.Facts.edge_kind(form)) : E.RefKind}

# Concrete forms of the same facts, as the adapter emits them (FACTS.md).

# K7. a statement of only type bindings (hv 0, ht 1) is never an edge, whatever its form.
law fact_type_only_not_edge:
  for src: U32
  for dst: U32
  for form: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  {F.Facts.add(F.Fact{src, dst, form, 0, 1}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, U32.add(tonly, 1)} : R.Acc}

# K8. one value binding (hv 1) makes an `import ... from` an edge, whatever else it has.
law fact_value_import_is_edge:
  for src: U32
  for dst: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  {F.Facts.add(F.Fact{src, dst, 0, 1, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}

# K9. an empty clause (hv 0, ht 0) stays an edge, as in Pulsar.
law fact_empty_clause_is_edge:
  for src: U32
  for dst: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  {F.Facts.add(F.Fact{src, dst, 0, 0, 0}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}

# K10. a side-effect import (form 1) is an edge.
law fact_side_effect_import_is_edge:
  for src: U32
  for dst: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  {F.Facts.add(F.Fact{src, dst, 1, 1, 0}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}

# K11. an `export ... from` of another file with a value binding is an edge.
law fact_export_from_is_edge:
  for src: U32
  for dst: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for hn: {U32.is_eq(src, dst) == False{} : Bool}
  {F.Facts.add(F.Fact{src, dst, 2, 1, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}

# K12. an `export ... from` naming its own file adds no edge (law D, on facts).
law fact_export_self_dropped:
  for src: U32
  for dst: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for hs: {U32.is_eq(src, dst) == True{} : Bool}
  {F.Facts.add(F.Fact{src, dst, 2, 1, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}

# K13. an import naming its own file adds the self edge (law E, on facts).
law fact_import_self_kept:
  for src: U32
  for dst: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for hs: {U32.is_eq(src, dst) == True{} : Bool}
  {F.Facts.add(F.Fact{src, dst, 0, 1, 0}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{Con{dst, cur}, all, bare, miss, dyn, req, tonly} : R.Acc}

# ---- P. the shipped pipeline --------------------------------------------------------------------
# main.bend reads the facts, calls Pipeline.run and prints Report.lines. These
# tie `run` to the proven functions: the findings are Graph.analyze of the
# production graph Scope.graph builds, so laws G (sound), H (complete) and I
# (partition) of the top-level LAWS.bend are about what the binary prints.
# `files` is the number of production files (Scope.count). The production-scope
# rule itself is in Scope-LAWS.bend.

# P1. valid facts: the result is Graph.analyze over the built graph.
law pipeline_is_analyze:
  for +n: U32
  for +prods: List<&2, U32>
  for +fs: List<&2, F.Fact>
  for ok: {F.Facts.valid(fs, n, 0, True{}) == True{} : Bool}
  {L.Pipeline.run(n, prods, fs) == Some{L.Out{S.Scope.count(U32.to_nat(n), 0, S.Scope.set(prods), 0), G.Graph.edges(S.Scope.graph(S.Scope.set(prods), n, fs), 0), G.Graph.analyze(S.Scope.graph(S.Scope.set(prods), n, fs))}} : Maybe<L.Out>}

# P2. invalid facts are refused, never analysed.
law pipeline_refuses_invalid:
  for +n: U32
  for +prods: List<&2, U32>
  for +fs: List<&2, F.Fact>
  for bad: {F.Facts.valid(fs, n, 0, True{}) == False{} : Bool}
  {L.Pipeline.run(n, prods, fs) == None{} : Maybe<L.Out>}

# P3. the printed cycles are exactly Graph.cycles of the built graph, and the
# printed certificate is exactly the conjunction of the two runtime checks that
# laws H and I assume (this is law J, carried through the pipeline).
law pipeline_cycles_are_graph_cycles:
  for +n: U32
  for +prods: List<&2, U32>
  for +fs: List<&2, F.Fact>
  for ok: {F.Facts.valid(fs, n, 0, True{}) == True{} : Bool}
  {L.Pipeline.run(n, prods, fs) == Some{L.Out{S.Scope.count(U32.to_nat(n), 0, S.Scope.set(prods), 0), G.Graph.edges(S.Scope.graph(S.Scope.set(prods), n, fs), 0), G.Res{G.Graph.cycles(S.Scope.graph(S.Scope.set(prods), n, fs)), Bool.and(G.Graph.verified(S.Scope.graph(S.Scope.set(prods), n, fs)), G.Graph.part_ok(S.Scope.graph(S.Scope.set(prods), n, fs)))}}} : Maybe<L.Out>}

# P4. the output lines are the header, one CYC line per cycle, the certificate
# and the summary, built from the Res and the counts and from nothing else.
law report_shape:
  for files: U32
  for edges: U32
  for cs: List<&2, List<&2, U32>>
  for ok: Bool
  {L.Report.lines(L.Out{files, edges, G.Res{cs, ok}}) == Con{"pulsar-findings 0", List.append(&2, String, L.Report.cyc_lines(cs), [L.Report.cert_line(ok), L.Report.summary(files, edges, U32.from_nat(List.length(&2, List<&2, U32>, cs)))])} : List<&2, String>}

# P5. the binary prints the import-graph lines, then exactly the Metrics lines
# (FM, FX: Metrics-LAWS, from Metrics.run), when both detectors accept their facts.
law engine_is_both:
  for o: L.Out
  for ms: List<&2, String>
  {L.Engine.lines(Some{o}, Some{ms}) == Some{List.append(&2, String, L.Report.lines(o), ms)} : Maybe<List<&2, String>>}

# P6. if either detector refuses its facts, nothing is printed (the binary exits 2).
law engine_refuses_graph:
  for m: Maybe<&2, List<&2, String>>
  {L.Engine.lines(None{}, m) == None{} : Maybe<List<&2, String>>}

law engine_refuses_metrics:
  for o: L.Out
  {L.Engine.lines(Some{o}, None{}) == None{} : Maybe<List<&2, String>>}

# P7-P9. joining two detectors' lines: both accepted, their lines in order;
# either refused, nothing.
law engine_more_both:
  for a: List<&2, String>
  for b: List<&2, String>
  {L.Engine.more(Some{a}, Some{b}) == Some{List.append(&2, String, a, b)} : Maybe<List<&2, String>>}

law engine_more_refuses_left:
  for b: Maybe<List<&2, String>>
  {L.Engine.more(None{}, b) == None{} : Maybe<List<&2, String>>}

law engine_more_refuses_right:
  for a: List<&2, String>
  {L.Engine.more(Some{a}, None{}) == None{} : Maybe<List<&2, String>>}

# P10. with an `E` row, the layer lines are exactly Layers.lines of Layers.run
# (Layers-LAWS E1-E3), and a refusal by decode or run refuses the run.
law engine_layers_on:
  for +rows: List<&2, W.Row>
  for on: {L.Engine.has_tag(rows, L.Engine.tag_e()) == True{} : Bool}
  {L.Engine.layers(rows) == L.Engine.ly2(Y.Layers.decode(rows)) : Maybe<List<&2, String>>}

law engine_layers_run:
  for lf: Y.LF
  {L.Engine.ly2(Some{lf}) == L.Engine.ly3(Y.Layers.run(lf)) : Maybe<List<&2, String>>}

law engine_layers_lines:
  for o: Y.LOut
  {L.Engine.ly3(Some{o}) == Some{Y.Layers.lines(o)} : Maybe<List<&2, String>>}

# P11. with no `E` row the Effect pack is off: no layer lines.
law engine_layers_off:
  for +rows: List<&2, W.Row>
  for off: {L.Engine.has_tag(rows, L.Engine.tag_e()) == False{} : Bool}
  {L.Engine.layers(rows) == Some{Nil{}} : Maybe<List<&2, String>>}

# P12. with an `RL` row, the class-in-context lines are ClassCtx.lines of
# ClassCtx.run (ClassCtx-LAWS E1-E3).
law engine_classctx_on:
  for +rows: List<&2, W.Row>
  for on: {L.Engine.has_tag(rows, L.Engine.tag_rl()) == True{} : Bool}
  {L.Engine.classctx(rows) == L.Engine.cx2(X.ClassCtx.decode(rows)) : Maybe<List<&2, String>>}

law engine_classctx_run:
  for +cf: X.CF
  {L.Engine.cx2(Some{cf}) == L.Engine.cx3(X.ClassCtx.run(cf)) : Maybe<List<&2, String>>}

law engine_classctx_lines:
  for +fs: List<&2, X.Fd>
  {L.Engine.cx3(Some{fs}) == Some{X.ClassCtx.lines(fs)} : Maybe<List<&2, String>>}

# P13. with no `RL` row no rule is on: no class-in-context lines.
law engine_classctx_off:
  for +rows: List<&2, W.Row>
  for off: {L.Engine.has_tag(rows, L.Engine.tag_rl()) == False{} : Bool}
  {L.Engine.classctx(rows) == Some{Nil{}} : Maybe<List<&2, String>>}

# P14. what main.bend prints is the import graph and Metrics, then the layer
# lines, then the class-in-context lines, the SQL, fan-out, constant-argument and hot-path sections (SqlIn.bend),
# then the history lines h (main.bend passes Engine.history, P17-P18).
law engine_all:
  for o: Maybe<L.Out>
  for m: Maybe<&2, List<&2, String>>
  for h: Maybe<List<&2, String>>
  for +rows: List<&2, W.Row>
  {L.Engine.all(o, m, h, rows) == L.Engine.more(L.Engine.more(L.Engine.more(L.Engine.more(L.Engine.more(L.Engine.more(L.Engine.more(L.Engine.lines(o, m), L.Engine.layers(rows)), L.Engine.classctx(rows)), Sq.SqlIn.lines(rows)), Sq.FanoutIn.lines(rows)), Sq.KonstIn.lines(rows)), Sq.HotIn.lines(rows)), h) : Maybe<List<&2, String>>}

# P15. the rows the engine keeps (Rows.start_keep) are exactly the tags FACTS.md
# lists under "Rows the engine reads", each packed as Rows.bend packs it (the
# ASCII letters, big-endian): FN CT TF (MetricsIn); E SV LY LQ LP LR LC LO US
# (Layers); CS CL RL (ClassCtx); CV (Crap); A C CFN (Churn); CO (Cognitive);
# H CF HR (History); DS DT DC DI DX DF DG QS QT QU QD SR (SqlIn); CE RF (FanoutIn); AL RK (KonstIn); EP RH (HotIn).
law engine_row_tags:
  {L.Engine.row_tags() == [17998, 17236, 21574, 69, 21334, 19545, 19537, 19536, 19538, 19523, 19535, 21843, 17235, 17228, 21068, 17238, 65, 67, 4408910, 17231, 72, 17222, 18514, 17491, 17492, 17475, 17481, 17496, 17478, 17479, 20819, 20820, 20821, 20804, 21330, 17221, 21062, 16716, 21067, 17744, 21064] : List<&2, U32>}

# P16. the shipped Metrics thresholds are FACTS.md's: core.cyclomatic 10,
# core.nesting 3, core.npath 200, core.length 60. (The fifth field, the cap
# 2^24 - 1, is not a finding threshold, and stating it would expand a 2^24
# unary literal.)
def Thr(r: M.Rules) -> Nat & Nat & Nat & Nat:
  match r:
    case M.Rules{cc, nest, np, loc, cap}:
      (cc, nest, np, loc)

law metrics_defaults:
  {Thr(M.Metrics.defaults()) == (10n, 3n, 200n, 60n) : Nat & Nat & Nat & Nat}

# P17. with an `HR` row the history rules are on: the history lines are
# History.lines of History.run (History-LAWS E1-E3) on the decoded facts, the
# production set of the `F` facts, and the import graph the proven scope rule
# builds (K and SC laws), so "explained by an import" is that graph's edge.
law engine_history_on:
  for +n: U32
  for +prods: List<&2, U32>
  for +fs: List<&2, F.Fact>
  for +rows: List<&2, W.Row>
  for on: {L.Engine.has_tag(rows, L.Engine.tag_hr()) == True{} : Bool}
  {L.Engine.history(n, prods, fs, rows) == L.Engine.hs2(Hs.Hist.decode(rows), n, S.Scope.set(prods), S.Scope.graph(S.Scope.set(prods), n, fs)) : Maybe<List<&2, String>>}

law engine_history_run:
  for +ch: Hs.CH
  for +r: Hs.Rules
  for +n: U32
  for +pt: G.Tr
  for +adj: List<&2, List<&2, U32>>
  {L.Engine.hs2(Some{Hs.HIn{ch, r}}, n, pt, adj) == L.Engine.hs3(r, Hs.Hist.run(ch, r, n, pt, adj)) : Maybe<List<&2, String>>}

law engine_history_lines:
  for +r: Hs.Rules
  for o: Hs.COut
  {L.Engine.hs3(r, Some{o}) == Some{Hs.Hist.lines(r, o)} : Maybe<List<&2, String>>}

# P18. with no `HR` row the history rules are off: no history lines.
law engine_history_off:
  for +n: U32
  for +prods: List<&2, U32>
  for +fs: List<&2, F.Fact>
  for +rows: List<&2, W.Row>
  for off: {L.Engine.has_tag(rows, L.Engine.tag_hr()) == False{} : Bool}
  {L.Engine.history(n, prods, fs, rows) == Some{Nil{}} : Maybe<List<&2, String>>}
