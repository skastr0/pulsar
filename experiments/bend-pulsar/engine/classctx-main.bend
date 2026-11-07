# classctx-main.bend - pulsar-classctx: the class-in-context detector on a facts
# file, until main.bend runs it from the pipeline. Effects only.
#
#   usage: pulsar-classctx <facts-file>
#
# Rows.bend reads the bytes (64 KiB chunks), ClassCtx.decode picks CS, CL and RL,
# ClassCtx.run decides (laws E1, E2), ClassCtx.lines formats (E3). Exit 2 on
# malformed or invalid facts.

import Base
import ./Rows.bend as W
import ./ClassCtx.bend as X

def CM.chunk() -> U32:
  65536

def CM.feed(r: Result<&1, &1, U32 & String, List<&2, U32>>, s: W.RS) -> W.RS:
  match r:
    case Fail{e}:
      W.Rows.fail(s)
    case Done{bytes}:
      W.Rows.feed(bytes, s)

def CM.step(r: File & Result<&1, &1, U32 & String, List<&2, U32>>, s: W.RS) -> File & W.RS:
  (f, res) = r
  (f, CM.feed(res, s))

def CM.read_one(fp: File & W.RS, off: U32) -> IO(File & W.RS):
  (f, s) = fp
  do IO<File & W.RS>:
    r : File & Result<&1, &1, U32 & String, List<&2, U32>> <- File.read_at(f, off, CM.chunk())
    IO.pure(File & W.RS, CM.step(r, s))

def CM.chunks(fuel: Nat, fp: File & W.RS, +off: U32) -> IO(File & W.RS):
  match fuel:
    case 0n:
      IO.pure(File & W.RS, fp)
    case 1n+p:
      do IO<File & W.RS>:
        nx : File & W.RS <- CM.read_one(fp, off)
        CM.chunks(p, nx, U32.add(off, CM.chunk()))

def CM.close(out: File & W.RS) -> IO(Maybe<List<&2, W.Row>>):
  (f, s) = out
  do IO<Maybe<List<&2, W.Row>>>:
    Unit <- File.close(f)
    IO.pure(Maybe<List<&2, W.Row>>, W.Rows.finish(s))

def CM.sized(r: File & Result<&1, &1, U32 & String, U32>) -> IO(Maybe<List<&2, W.Row>>):
  (f, res) = r
  match res:
    case Fail{(code, msg)}:
      do IO<Maybe<List<&2, W.Row>>>:
        Unit <- File.close(f)
        IO.die(Maybe<List<&2, W.Row>>, 2, "pulsar-classctx: cannot size facts file: " ++ msg)
    case Done{+size}:
      do IO<Maybe<List<&2, W.Row>>>:
        out : File & W.RS <- CM.chunks(U32.to_nat(U32.add(U32.div(size, CM.chunk()), 1)), (f, W.Rows.start()), 0)
        CM.close(out)

def CM.opened(r: Result<&1, &1, U32 & String, File>, path: String) -> IO(Maybe<List<&2, W.Row>>):
  match r:
    case Fail{(code, msg)}:
      IO.die(Maybe<List<&2, W.Row>>, 2, "pulsar-classctx: cannot open " ++ path ++ ": " ++ msg)
    case Done{f}:
      do IO<Maybe<List<&2, W.Row>>>:
        sz : File & Result<&1, &1, U32 & String, U32> <- File.size(f)
        CM.sized(sz)

def CM.read(+path: String) -> IO(Maybe<List<&2, W.Row>>):
  do IO<Maybe<List<&2, W.Row>>>:
    r : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    CM.opened(r, path)

def CM.print(xs: List<&2, String>) -> IO(Unit):
  match xs:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case Con{h, t}:
      do IO<Unit>:
        IO.print(h)
        CM.print(t)

def CM.report(m: Maybe<List<&2, X.Fd>>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-classctx: invalid facts (CS, CL or RL not strictly ascending)")
    case Some{o}:
      CM.print(X.ClassCtx.lines(o))

def CM.decoded(m: Maybe<X.CF>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-classctx: malformed facts (CS, CL or RL field count)")
    case Some{cf}:
      CM.report(X.ClassCtx.run(cf))

def CM.rows(m: Maybe<List<&2, W.Row>>) -> IO(Unit):
  match m:
    case None{}:
      IO.die(Unit, 2, "pulsar-classctx: malformed facts file (header or number)")
    case Some{rows}:
      CM.decoded(X.ClassCtx.decode(rows))

def CM.go(path: String) -> IO(Unit):
  do IO<Unit>:
    m : Maybe<List<&2, W.Row>> <- CM.read(path)
    CM.rows(m)

def CM.run(args: List<String>) -> IO(Unit):
  match args:
    case Con{prog, Con{path, Nil{}}}:
      CM.go(path)
    case _:
      IO.die(Unit, 2, "usage: pulsar-classctx <facts-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    CM.run(args)
