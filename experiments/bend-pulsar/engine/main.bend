# main.bend - pulsar-engine: FACTS in, findings out. Effects only.
#
#   usage: pulsar-engine <facts-file>
#
# All decisions live in the pure modules:
#   Parse.bend     bytes -> facts           (reader, unproven)
#   Facts.bend     facts -> import graph    (proven rules: Extract.value_kind, Resolve.add_edge2)
#   Rows.bend      bytes -> detector rows   (reader, unproven; Engine.row_tags are kept)
#   MetricsIn.bend rows -> Metrics          (decoder, unproven; Metrics-LAWS from Metrics.run)
#   Pipeline.bend  findings lines           (Graph.analyze, Metrics, Layers, ClassCtx; LAWS.bend P1-P14)
# This file reads the file in 4 KiB chunks, feeding each chunk to both readers,
# so the bytes of the file are never all in memory, and prints the lines.

import Base
import ./Facts.bend as F
import ./Parse.bend as P
import ./Pipeline.bend as L
import ./Rows.bend as W
import ./Metrics.bend as M
import ./MetricsIn.bend as MI


# The two readers, fed the same chunks.
type St is Data:
  St{ps: P.PS, rs: W.RS}

def Main.chunk_size() -> U32:
  4096

# Parse the result of one read; a failed read marks the input bad.
def Main.feed2(r: Result<&1, &1, U32 & String, List<&2, U32>>, ps: P.PS, rs: W.RS) -> St:
  match r:
    case Fail{e}:
      St{P.Parse.fail(ps), W.Rows.fail(rs)}
    case Done{+bytes}:
      St{P.Parse.feed(bytes, ps), W.Rows.feed(bytes, rs)}

def Main.feed(r: Result<&1, &1, U32 & String, List<&2, U32>>, st: St) -> St:
  match st:
    case St{ps, rs}:
      Main.feed2(r, ps, rs)

def Main.step(r: File & Result<&1, &1, U32 & String, List<&2, U32>>, st: St) -> File & St:
  (f, res) = r
  (f, Main.feed(res, st))

def Main.read_one(fp: File & St, off: U32) -> IO(File & St):
  (f, st) = fp
  do IO<File & St>:
    r : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_at(f, off, Main.chunk_size())
    IO.pure(File & St, Main.step(r, st))

# Read at most `fuel` chunks starting at `off`. Each chunk is parsed before
# the next is read.
def Main.chunks(fuel: Nat, fp: File & St, +off: U32) -> IO(File & St):
  match fuel:
    case 0n:
      IO.pure(File & St, fp)
    case 1n+p:
      do IO<File & St>:
        nx : File & St <- Main.read_one(fp, off)
        Main.chunks(p, nx, U32.add(off, Main.chunk_size()))

def Main.nchunks(+size: U32) -> Nat:
  U32.to_nat(U32.add(U32.div(size, Main.chunk_size()), 1))

# What both readers made of the file.
def Main.done(st: St) -> Maybe<P.Parsed> & Maybe<List<&2, W.Row>>:
  match st:
    case St{ps, rs}:
      (P.Parse.finish(ps), W.Rows.finish(rs))

def Main.close_parse(out: File & St) -> IO(Maybe<P.Parsed> & Maybe<List<&2, W.Row>>):
  (f, st) = out
  do IO<Maybe<P.Parsed> & Maybe<List<&2, W.Row>>>:
    Unit <- File.close(f)
    IO.pure(Maybe<P.Parsed> & Maybe<List<&2, W.Row>>, Main.done(st))

def Main.parse_sized(r: File & Result<&1, &1, U32 & String, U32>) -> IO(Maybe<P.Parsed> & Maybe<List<&2, W.Row>>):
  (f, res) = r
  match res:
    case Fail{(code, msg)}:
      do IO<Maybe<P.Parsed> & Maybe<List<&2, W.Row>>>:
        Unit <- File.close(f)
        IO.die(Maybe<P.Parsed> & Maybe<List<&2, W.Row>>, 2, "pulsar-engine: cannot size facts file: " ++ msg)
    case Done{size}:
      do IO<Maybe<P.Parsed> & Maybe<List<&2, W.Row>>>:
        out : File & St <- Main.chunks(Main.nchunks(size), (f, St{P.Parse.start(), W.Rows.start_keep(L.Engine.row_tags())}), 0)
        Main.close_parse(out)

def Main.opened(r: Result<&1, &1, U32 & String, File>, path: String) -> IO(Maybe<P.Parsed> & Maybe<List<&2, W.Row>>):
  match r:
    case Fail{(code, msg)}:
      IO.die(Maybe<P.Parsed> & Maybe<List<&2, W.Row>>, 2, "pulsar-engine: cannot open " ++ path ++ ": " ++ msg)
    case Done{f}:
      do IO<Maybe<P.Parsed> & Maybe<List<&2, W.Row>>>:
        sz : File & Result<&1, &1, U32 & String, U32> <- File.size(f)
        Main.parse_sized(sz)

def Main.read_facts(+path: String) -> IO(Maybe<P.Parsed> & Maybe<List<&2, W.Row>>):
  do IO<Maybe<P.Parsed> & Maybe<List<&2, W.Row>>>:
    r : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    Main.opened(r, path)

# ---- output --------------------------------------------------------------------------------------
def Main.print_lines(xs: List<&2, String>) -> IO(Unit):
  match xs:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case Con{h, t}:
      do IO<Unit>:
        IO.print(h)
        Main.print_lines(t)

def Main.report(m: Maybe<List<&2, String>>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-engine: invalid facts (id out of range, bad flag, I facts not grouped by src ascending, or FN/CT facts Metrics refuses)")
    case Some{ls}:
      Main.print_lines(ls)

def Main.run_both(p: P.Parsed, +rows: List<&2, W.Row>) -> IO(Unit):
  match p:
    case P.Parsed{+n, +prods, +fs}:
      Main.report(L.Engine.all(L.Pipeline.run(n, prods, fs), MI.MetricsIn.lines(M.Metrics.defaults(), rows), L.Engine.history(n, prods, fs, rows), rows))

def Main.run_rows(m: Maybe<List<&2, W.Row>>, p: P.Parsed) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-engine: malformed facts file (header, number or field count)")
    case Some{rows}:
      Main.run_both(p, rows)

def Main.run_parsed2(pm: Maybe<P.Parsed>, m: Maybe<List<&2, W.Row>>) -> IO(Unit):
  match pm:
    case None{}:
      IO.die(Unit, 2, "pulsar-engine: malformed facts file (header, number or field count)")
    case Some{p}:
      Main.run_rows(m, p)

def Main.run_parsed(i: Maybe<P.Parsed> & Maybe<List<&2, W.Row>>) -> IO(Unit):
  (pm, m) = i
  Main.run_parsed2(pm, m)

def Main.go(path: String) -> IO(Unit):
  do IO<Unit>:
    i : Maybe<P.Parsed> & Maybe<List<&2, W.Row>> <- Main.read_facts(path)
    Main.run_parsed(i)

def Main.run(args: List<String>) -> IO(Unit):
  match args:
    case Con{prog, Con{path, Nil{}}}:
      Main.go(path)
    case _:
      IO.die(Unit, 2, "usage: pulsar-engine <facts-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    Main.run(args)
