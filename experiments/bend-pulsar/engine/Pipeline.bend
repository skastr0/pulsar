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
import ./Rows.bend as W
import ./Layers.bend as Y
import ./ClassCtx.bend as X
import ./History.bend as Hs
import ./SqlIn.bend as Sq

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

# Join two detectors' lines; None when either refused its facts. LAWS.bend P7-P9.
def Engine.more(a: Maybe<List<&2, String>>, b: Maybe<List<&2, String>>) -> Maybe<List<&2, String>>:
  match a b:
    case Some{x} Some{y}:
      Some{List.append(&2, String, x, y)}
    case _ _:
      None{}

def Engine.has_tag(rows: List<&2, W.Row>, +t: U32) -> Bool:
  match rows:
    case Nil{}:
      False{}
    case Con{W.Row{tag, fs}, rest}:
      Bool.or(U32.is_eq(tag, t), Engine.has_tag(rest, t))

# ---- framework packs: on only when their facts are present ----------------------------------------
# The Effect layer graph (Layers.bend) runs when the facts have an `E` header row,
# which the CLI writes only when the Effect pack is active. LAWS.bend P10-P11.
def Engine.tag_e() -> U32:
  69

def Engine.ly3(m: Maybe<Y.LOut>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{o}:
      Some{Y.Layers.lines(o)}

def Engine.ly2(m: Maybe<Y.LF>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{lf}:
      Engine.ly3(Y.Layers.run(lf))

def Engine.ly1(on: Bool, rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      Engine.ly2(Y.Layers.decode(rows))
    case False{}:
      Some{Nil{}}

def Engine.layers(+rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  Engine.ly1(Engine.has_tag(rows, Engine.tag_e()), rows)

# Class-in-context rules (ClassCtx.bend) run when there is an `RL` row: the CLI
# writes RL only for rules that are on. LAWS.bend P12-P13.
def Engine.tag_rl() -> U32:
  21068

def Engine.cx3(m: Maybe<List<&2, X.Fd>>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{fs}:
      Some{X.ClassCtx.lines(fs)}

def Engine.cx2(m: Maybe<X.CF>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{cf}:
      Engine.cx3(X.ClassCtx.run(cf))

def Engine.cx1(on: Bool, rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      Engine.cx2(X.ClassCtx.decode(rows))
    case False{}:
      Some{Nil{}}

def Engine.classctx(+rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  Engine.cx1(Engine.has_tag(rows, Engine.tag_rl()), rows)

# What pulsar-engine prints: the import graph and Metrics (P5-P6), then the
# Effect layer lines, then the class-in-context lines. LAWS.bend P14.
# History rules (History.bend) run when there is an `HR` row: the CLI writes it,
# with the rule numbers from policy, only when a history rule is on.
def Engine.tag_hr() -> U32:
  18514

def Engine.hs3(+r: Hs.Rules, m: Maybe<Hs.COut>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{o}:
      Some{Hs.Hist.lines(r, o)}

def Engine.hs2(m: Maybe<Hs.HIn>, +n: U32, +pt: G.Tr, +adj: List<&2, List<&2, U32>>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{Hs.HIn{+ch, +r}}:
      Engine.hs3(r, Hs.Hist.run(ch, r, n, pt, adj))

def Engine.hs1(on: Bool, +n: U32, +pt: G.Tr, fs: List<&2, F.Fact>, rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      Engine.hs2(Hs.Hist.decode(rows), n, pt, S.Scope.graph(pt, n, fs))
    case False{}:
      Some{Nil{}}

# n, prods and fs as Pipeline.run takes them; the import graph is the one the
# proven production-scope rule builds.
def Engine.history(+n: U32, prods: List<&2, U32>, fs: List<&2, F.Fact>, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  Engine.hs1(Engine.has_tag(rows, Engine.tag_hr()), n, S.Scope.set(prods), fs, rows)

def Engine.all(o: Maybe<Out>, m: Maybe<&2, List<&2, String>>, h: Maybe<List<&2, String>>, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  Engine.more(Engine.more(Engine.more(Engine.more(Engine.more(Engine.lines(o, m), Engine.layers(rows)), Engine.classctx(rows)), Sq.SqlIn.lines(rows)), Sq.FanoutIn.lines(rows)), h)

# The row tags the detectors read from Rows.bend: FN, CT, TF (MetricsIn.bend); E, SV,
# LY, LQ, LP, LR, LC, LO, US (Layers.bend); CS, CL, RL (ClassCtx.bend); CV (Crap.bend);
# A, C, CFN (Churn.bend); CO (Cognitive, via MetricsIn); H, CF, HR (History.bend);
# DS, DT, DC, DI, DX, DF, DG, QS, QT, QU, QD, SR (SqlIn.bend); CE, RF (FanoutIn).
def Engine.row_tags() -> List<&2, U32>:
  [17998, 17236, 21574, 69, 21334, 19545, 19537, 19536, 19538, 19523, 19535, 21843, 17235, 17228, 21068, 17238, 65, 67, 4408910, 17231, 72, 17222, 18514, 17491, 17492, 17475, 17481, 17496, 17478, 17479, 20819, 20820, 20821, 20804, 21330, 17221, 21062]
