# Pipeline.bend - the engine's pure entry point: facts in, findings out.
#
#   Pipeline.run(n, prods, facts)  validate, build the production import graph
#                                  (Scope.graph), run the proven SCC analysis
#                                  (Graph.analyze)
#   Report.lines(out)              the FACTS.md output, one string per line
#
# main.bend only reads bytes into facts and prints these lines. LAWS.bend ties
# `run` to `Graph.analyze` over `Scope.graph`, so the proofs about
# Graph.analyze are about what the binary prints.

import Base
import ../Graph.bend as G
import ./Facts.bend as F
import ./Scope.bend as S

type Out is Data:
  Out{files: U32, edges: U32, res: G.Res}

# `files` counts production files; edges and cycles are over the production graph.
def Pipeline.out(+n: U32, +t: G.Tr, +adj: List<&2, List<&2, U32>>) -> Out:
  Out{S.Scope.count(U32.to_nat(n), 0, t, 0), G.Graph.edges(adj, 0), G.Graph.analyze(adj)}

def Pipeline.run3(+n: U32, +t: G.Tr, fs: List<&2, F.Fact>) -> Out:
  Pipeline.out(n, t, S.Scope.graph(t, n, fs))

def Pipeline.run2(ok: Bool, +n: U32, prods: List<&2, U32>, fs: List<&2, F.Fact>) -> Maybe<Out>:
  match ok:
    case True{}:
      Some{Pipeline.run3(n, S.Scope.set(prods), fs)}
    case False{}:
      None{}

# None when the facts are not valid (see Facts.valid). `prods` lists the files
# with `F file 1`.
def Pipeline.run(+n: U32, prods: List<&2, U32>, +fs: List<&2, F.Fact>) -> Maybe<Out>:
  Pipeline.run2(F.Facts.valid(fs, n, 0, True{}), n, prods, fs)

# ---- output -----------------------------------------------------------------------------------
def Report.ids(c: List<&2, U32>) -> List<&2, String>:
  match c:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{U32.show(h), Report.ids(t)}

def Report.cyc_line(+c: List<&2, U32>) -> String:
  "CYC " ++ U32.show(U32.from_nat(List.length(&2, U32, c))) ++ " " ++ String.join(Report.ids(c), " ")

def Report.cyc_lines(cs: List<&2, List<&2, U32>>) -> List<&2, String>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Report.cyc_line(h), Report.cyc_lines(t)}

def Report.cert_line(ok: Bool) -> String:
  match ok:
    case True{}:
      "CERT 1"
    case False{}:
      "CERT 0"

def Report.summary(files: U32, edges: U32, cycles: U32) -> String:
  "S " ++ U32.show(files) ++ " " ++ U32.show(edges) ++ " " ++ U32.show(cycles)

def Report.tail(+cs: List<&2, List<&2, U32>>, ok: Bool, files: U32, edges: U32) -> List<&2, String>:
  List.append(&2, String, Report.cyc_lines(cs), [Report.cert_line(ok), Report.summary(files, edges, U32.from_nat(List.length(&2, List<&2, U32>, cs)))])

def Report.res_lines(files: U32, edges: U32, r: G.Res) -> List<&2, String>:
  match r:
    case G.Res{cs, ok}:
      Con{"pulsar-findings 0", Report.tail(cs, ok, files, edges)}

def Report.lines(o: Out) -> List<&2, String>:
  match o:
    case Out{files, edges, res}:
      Report.res_lines(files, edges, res)

# ---- the engine: every detector's lines ------------------------------------------------------
# The import-graph lines, then the Metrics lines (FM, FX). None when either
# refuses its facts: the binary then exits 2 and prints nothing. LAWS.bend P5-P6.
def Engine.join(ls: List<&2, String>, m: Maybe<&2, List<&2, String>>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{ms}:
      Some{List.append(&2, String, ls, ms)}

def Engine.lines(o: Maybe<Out>, m: Maybe<&2, List<&2, String>>) -> Maybe<List<&2, String>>:
  match o:
    case None{}:
      None{}
    case Some{x}:
      Engine.join(Report.lines(x), m)

# The row tags the detectors read from Rows.bend: FN, CT (MetricsIn.bend).
def Engine.row_tags() -> List<&2, U32>:
  [17998, 17236]
