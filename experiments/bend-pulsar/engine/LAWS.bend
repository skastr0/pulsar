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

import Base
import ../Extract.bend as E
import ../Resolve.bend as R
import ../Graph.bend as G
import ./Facts.bend as F
import ./Scope.bend as S
import ./Pipeline.bend as L

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
