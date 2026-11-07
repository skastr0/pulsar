# SqlIn.bend - read the SQL and fan-out rows (FACTS.md "SQL", "Symbols, calls and
# catalogs") into the detectors' inputs, and print their sections.
#
# Reading is not proven (AGENTS.md, verification scope): fixtures cover it. A row of one
# of these tags with the wrong field count refuses the section (None), as the other
# decoders do. Rows keep their file order, which the CLI sorts.
#
#   SQL section     runs when there is an `SR rule` row (a SQL rule policy turned on)
#   fan-out section runs when there is an `RF rule class edges none` row

import Base
import ./Rows.bend as W
import ./ClassCtx.bend as X
import ./Sql.bend as Q
import ./Fanout.bend as F

def Si.f(fs: List<&2, U32>, k: Nat) -> U32:
  match fs k:
    case Nil{} _:
      0
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      Si.f(t, p)

# The field count a tag's rows must have, or 0 for a tag this file does not read.
def Si.arity(tag: U32) -> Nat:
  match tag:
    case 17491:
      2n
    case 17492:
      3n
    case 17475:
      4n
    case 17481:
      3n
    case 17496:
      3n
    case 17478:
      3n
    case 17479:
      4n
    case 20819:
      6n
    case 20820:
      3n
    case 20821:
      4n
    case 20804:
      4n
    case 21330:
      1n
    case 17235:
      5n
    case 17228:
      2n
    case 17221:
      6n
    case 21062:
      4n
    case _:
      0n

def Si.bad1(+n: Nat, fs: List<&2, U32>) -> Bool:
  Bool.and(Bool.not(Nat.is_eq(n, 0n)), Bool.not(Nat.is_eq(n, List.length(&2, U32, fs))))

# Some row of a tag read here has the wrong field count.
def Si.bad(rows: List<&2, W.Row>) -> Bool:
  match rows:
    case Nil{}:
      False{}
    case Con{W.Row{tag, fs}, t}:
      Bool.or(Si.bad1(Si.arity(tag), fs), Si.bad(t))

def Si.has(rows: List<&2, W.Row>, +tag: U32) -> Bool:
  match rows:
    case Nil{}:
      False{}
    case Con{W.Row{t, fs}, rest}:
      Bool.or(U32.is_eq(t, tag), Si.has(rest, tag))

def Si.push(b: Bool, fs: List<&2, U32>, acc: List<&2, List<&2, U32>>) -> List<&2, List<&2, U32>>:
  match b:
    case True{}:
      Con{fs, acc}
    case False{}:
      acc

# The field lists of every row with tag `tag`, in order.
def Si.of(rows: List<&2, W.Row>, +tag: U32) -> List<&2, List<&2, U32>>:
  match rows:
    case Nil{}:
      Nil{}
    case Con{W.Row{+t, fs}, rest}:
      Si.push(U32.is_eq(t, tag), fs, Si.of(rest, tag))

# ---- one constructor per tag ------------------------------------------------------------------
def Si.dts(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Dt>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Dt{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n)}, Si.dts(t)}

def Si.dcs(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Dc>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Dc{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n)}, Si.dcs(t)}

def Si.dis(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Di>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Di{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n)}, Si.dis(t)}

def Si.dxs(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Dx>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Dx{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n)}, Si.dxs(t)}

def Si.dfs(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Df>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Df{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n)}, Si.dfs(t)}

def Si.dgs(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Dg>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Dg{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n)}, Si.dgs(t)}

def Si.qss(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Qs>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Qs{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n), Si.f(f, 4n), Si.f(f, 5n)}, Si.qss(t)}

def Si.qts(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Qt>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Qt{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n)}, Si.qts(t)}

def Si.qus(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Qu>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Qu{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n)}, Si.qus(t)}

def Si.qds(xs: List<&2, List<&2, U32>>) -> List<&2, Q.Qd>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Q.Qd{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n)}, Si.qds(t)}

def Si.css(xs: List<&2, List<&2, U32>>) -> List<&2, X.Cs>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{X.Cs{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n), Si.f(f, 4n)}, Si.css(t)}

def Si.cls(xs: List<&2, List<&2, U32>>) -> List<&2, X.Cl>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{X.Cl{Si.f(f, 0n), Si.f(f, 1n)}, Si.cls(t)}

def Si.ces(xs: List<&2, List<&2, U32>>) -> List<&2, F.Ce>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{F.Ce{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n), Si.f(f, 4n), Si.f(f, 5n)}, Si.ces(t)}

def Si.rfs(xs: List<&2, List<&2, U32>>) -> List<&2, F.Rf>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{F.Rf{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n)}, Si.rfs(t)}

def Si.ons(xs: List<&2, List<&2, U32>>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{Si.f(f, 0n), Si.ons(t)}

# The DS header, or 0 0 when there is none (no DDL seen: the schema is not complete).
def Si.ds(xs: List<&2, List<&2, U32>>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      [0, 1]
    case Con{f, t}:
      f

# ---- the sections -----------------------------------------------------------------------------
def Si.schema(+rows: List<&2, W.Row>) -> Q.Schema:
  +ds = Si.ds(Si.of(rows, 17491))
  Q.Schema{Si.f(ds, 0n), Si.f(ds, 1n), Si.dts(Si.of(rows, 17492)), Si.dcs(Si.of(rows, 17475)), Si.dis(Si.of(rows, 17481)), Si.dxs(Si.of(rows, 17496)), Si.dfs(Si.of(rows, 17478)), Si.dgs(Si.of(rows, 17479))}

def Si.query(+rows: List<&2, W.Row>) -> Q.Qy:
  Q.Qy{Si.qss(Si.of(rows, 20819)), Si.qts(Si.of(rows, 20820)), Si.qus(Si.of(rows, 20821)), Si.qds(Si.of(rows, 20804))}

def Si.sql2(ok: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match ok:
    case True{}:
      Some{Q.Sql.lines(Si.schema(rows), Si.query(rows), Si.ons(Si.of(rows, 21330)))}
    case False{}:
      None{}

def Si.sql1(on: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      Si.sql2(Bool.not(Si.bad(rows)), rows)
    case False{}:
      Some{Nil{}}

# The SQL section: nothing without an SR row, None when a row has the wrong arity.
def SqlIn.lines(+rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  Si.sql1(Si.has(rows, 21330), rows)

def Si.fo2(ok: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match ok:
    case True{}:
      Some{F.Fanout.lines(F.FoF{Si.css(Si.of(rows, 17235)), Si.cls(Si.of(rows, 17228)), Si.ces(Si.of(rows, 17221)), Si.rfs(Si.of(rows, 21062))})}
    case False{}:
      None{}

def Si.fo1(on: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      Si.fo2(Bool.not(Si.bad(rows)), rows)
    case False{}:
      Some{Nil{}}

# The fan-out section: nothing without an RF row, None when a row has the wrong arity.
def FanoutIn.lines(+rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  Si.fo1(Si.has(rows, 21062), rows)
