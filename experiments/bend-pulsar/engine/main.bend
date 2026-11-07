# main.bend - pulsar-engine: FACTS v0 in, findings out. Effects only.
#
#   usage: pulsar-engine <facts-file>
#
# All decisions live in the pure modules:
#   Parse.bend     bytes -> facts           (reader, unproven)
#   Facts.bend     facts -> import graph    (proven rules: Extract.value_kind, Resolve.add_edge2)
#   Pipeline.bend  facts -> findings lines  (Graph.analyze; see LAWS.bend)
# This file reads the file in 64 KiB chunks, so the bytes of the file are never
# all in memory, and prints the lines.

import Base
import ./Facts.bend as F
import ./Parse.bend as P
import ./Pipeline.bend as L

def Main.chunk_size() -> U32:
  65536

# Parse the result of one read; a failed read marks the input bad.
def Main.feed(r: Result<&1, &1, U32 & String, List<&2, U32>>, ps: P.PS) -> P.PS:
  match r:
    case Fail{e}:
      P.Parse.fail(ps)
    case Done{bytes}:
      P.Parse.feed(bytes, ps)

def Main.step(r: File & Result<&1, &1, U32 & String, List<&2, U32>>, ps: P.PS) -> File & P.PS:
  (f, res) = r
  (f, Main.feed(res, ps))

def Main.read_one(fp: File & P.PS, off: U32) -> IO(File & P.PS):
  (f, ps) = fp
  do IO<File & P.PS>:
    r : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_at(f, off, Main.chunk_size())
    IO.pure(File & P.PS, Main.step(r, ps))

# Read at most `fuel` chunks starting at `off`. Each chunk is parsed before
# the next is read.
def Main.chunks(fuel: Nat, fp: File & P.PS, +off: U32) -> IO(File & P.PS):
  match fuel:
    case 0n:
      IO.pure(File & P.PS, fp)
    case 1n+p:
      do IO<File & P.PS>:
        nx : File & P.PS <- Main.read_one(fp, off)
        Main.chunks(p, nx, U32.add(off, Main.chunk_size()))

def Main.nchunks(+size: U32) -> Nat:
  U32.to_nat(U32.add(U32.div(size, Main.chunk_size()), 1))

def Main.close_parse(out: File & P.PS) -> IO(Maybe<P.Parsed>):
  (f, ps) = out
  do IO<Maybe<P.Parsed>>:
    Unit <- File.close(f)
    IO.pure(Maybe<P.Parsed>, P.Parse.finish(ps))

def Main.parse_sized(r: File & Result<&1, &1, U32 & String, U32>) -> IO(Maybe<P.Parsed>):
  (f, res) = r
  match res:
    case Fail{(code, msg)}:
      do IO<Maybe<P.Parsed>>:
        Unit <- File.close(f)
        IO.die(Maybe<P.Parsed>, 2, "pulsar-engine: cannot size facts file: " ++ msg)
    case Done{size}:
      do IO<Maybe<P.Parsed>>:
        out : File & P.PS <- Main.chunks(Main.nchunks(size), (f, P.Parse.start()), 0)
        Main.close_parse(out)

def Main.opened(r: Result<&1, &1, U32 & String, File>, path: String) -> IO(Maybe<P.Parsed>):
  match r:
    case Fail{(code, msg)}:
      IO.die(Maybe<P.Parsed>, 2, "pulsar-engine: cannot open " ++ path ++ ": " ++ msg)
    case Done{f}:
      do IO<Maybe<P.Parsed>>:
        sz : File & Result<&1, &1, U32 & String, U32> <- File.size(f)
        Main.parse_sized(sz)

def Main.read_facts(+path: String) -> IO(Maybe<P.Parsed>):
  do IO<Maybe<P.Parsed>>:
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

def Main.report(m: Maybe<L.Out>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-engine: invalid facts (id out of range, bad flag, or I facts not grouped by src ascending)")
    case Some{o}:
      Main.print_lines(L.Report.lines(o))

def Main.run_parsed(m: Maybe<P.Parsed>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-engine: malformed facts file (header, number or field count)")
    case Some{P.Parsed{n, prods, fs}}:
      Main.report(L.Pipeline.run(n, prods, fs))

def Main.go(path: String) -> IO(Unit):
  do IO<Unit>:
    m : Maybe<P.Parsed> <- Main.read_facts(path)
    Main.run_parsed(m)

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
