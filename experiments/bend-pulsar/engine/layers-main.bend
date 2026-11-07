# layers-main.bend - pulsar-layers: the Effect layer-graph detectors on a facts
# file, until main.bend reads the v1 relations. Effects only.
#
#   usage: pulsar-layers <facts-file>
#
# Rows.bend reads the bytes (4 KiB chunks), Layers.decode picks the Effect
# relations, Layers.run decides, Layers.lines formats. Exit 2 on malformed or
# invalid facts.

import Base
import ./Rows.bend as W
import ./Layers.bend as Y

def LM.chunk() -> U32:
  4096

def LM.feed(r: Result<&1, &1, U32 & String, List<&2, U32>>, s: W.RS) -> W.RS:
  match r:
    case Fail{e}:
      W.Rows.fail(s)
    case Done{bytes}:
      W.Rows.feed(bytes, s)

def LM.step(r: File & Result<&1, &1, U32 & String, List<&2, U32>>, s: W.RS) -> File & W.RS:
  (f, res) = r
  (f, LM.feed(res, s))

def LM.read_one(fp: File & W.RS, off: U32) -> IO(File & W.RS):
  (f, s) = fp
  do IO<File & W.RS>:
    r : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_at(f, off, LM.chunk())
    IO.pure(File & W.RS, LM.step(r, s))

def LM.chunks(fuel: Nat, fp: File & W.RS, +off: U32) -> IO(File & W.RS):
  match fuel:
    case 0n:
      IO.pure(File & W.RS, fp)
    case 1n+p:
      do IO<File & W.RS>:
        nx : File & W.RS <- LM.read_one(fp, off)
        LM.chunks(p, nx, U32.add(off, LM.chunk()))

def LM.close(out: File & W.RS) -> IO(Maybe<List<&2, W.Row>>):
  (f, s) = out
  do IO<Maybe<List<&2, W.Row>>>:
    Unit <- File.close(f)
    IO.pure(Maybe<List<&2, W.Row>>, W.Rows.finish(s))

def LM.sized(r: File & Result<&1, &1, U32 & String, U32>) -> IO(Maybe<List<&2, W.Row>>):
  (f, res) = r
  match res:
    case Fail{(code, msg)}:
      do IO<Maybe<List<&2, W.Row>>>:
        Unit <- File.close(f)
        IO.die(Maybe<List<&2, W.Row>>, 2, "pulsar-layers: cannot size facts file: " ++ msg)
    case Done{+size}:
      do IO<Maybe<List<&2, W.Row>>>:
        out : File & W.RS <- LM.chunks(U32.to_nat(U32.add(U32.div(size, LM.chunk()), 1)), (f, W.Rows.start()), 0)
        LM.close(out)

def LM.opened(r: Result<&1, &1, U32 & String, File>, path: String) -> IO(Maybe<List<&2, W.Row>>):
  match r:
    case Fail{(code, msg)}:
      IO.die(Maybe<List<&2, W.Row>>, 2, "pulsar-layers: cannot open " ++ path ++ ": " ++ msg)
    case Done{f}:
      do IO<Maybe<List<&2, W.Row>>>:
        sz : File & Result<&1, &1, U32 & String, U32> <- File.size(f)
        LM.sized(sz)

def LM.read(+path: String) -> IO(Maybe<List<&2, W.Row>>):
  do IO<Maybe<List<&2, W.Row>>>:
    r : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    LM.opened(r, path)

def LM.print(xs: List<&2, String>) -> IO(Unit):
  match xs:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case Con{h, t}:
      do IO<Unit>:
        IO.print(h)
        LM.print(t)

def LM.report(m: Maybe<Y.LOut>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-layers: invalid facts (id out of range, or a relation not strictly ascending)")
    case Some{o}:
      LM.print(Y.Layers.lines(o))

def LM.decoded(m: Maybe<Y.LF>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-layers: malformed Effect facts (field count, or a second E header)")
    case Some{lf}:
      LM.report(Y.Layers.run(lf))

def LM.rows(m: Maybe<List<&2, W.Row>>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-layers: malformed facts file (header or number)")
    case Some{rows}:
      LM.decoded(Y.Layers.decode(rows))

def LM.go(path: String) -> IO(Unit):
  do IO<Unit>:
    m : Maybe<List<&2, W.Row>> <- LM.read(path)
    LM.rows(m)

def LM.run(args: List<String>) -> IO(Unit):
  match args:
    case Con{prog, Con{path, Nil{}}}:
      LM.go(path)
    case _:
      IO.die(Unit, 2, "usage: pulsar-layers <facts-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    LM.run(args)
