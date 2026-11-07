# SqlIn.bend - read the SQL and fan-out rows (FACTS.md "SQL", "Symbols, calls and
# catalogs") into the detectors' inputs, and print their sections.
#
# Reading is not proven (AGENTS.md, verification scope): fixtures cover it. A row of one
# of these tags with the wrong field count refuses the section (None), as the other
# decoders do. Rows keep their file order, which the CLI sorts.
#
#   SQL section     runs when there is an `SR rule` row (a SQL rule policy turned on)
#   fan-out section runs when there is an `RF rule class edges none` row
#   constant-argument section runs when there is an `RK rule class pos` row
#   hot-path section runs when there is an `RH rule lane base depth` row; its base
#                   findings are the shown SQL, fan-out and constant-argument findings

import Base
import ./Rows.bend as W
import ./ClassCtx.bend as X
import ./Sql.bend as Q
import ./Fanout.bend as F
import ./Konst.bend as K
import ./Hot.bend as H

def Si.f(fs: List<&2, U32>, k: Nat) -> U32:
  match fs k:
    case Nil{} _:
      0
    case Con{h, t} 0n:
      h
    case Con{h, t} 1n+p:
      Si.f(t, p)

type Ar is Data:
  Ar{tag: U32, n: Nat}

# The field count a tag's rows must have, or 0 for a tag this file does not read: a table.
def Si.arities() -> List<&2, Ar>:
  [Ar{17491, 2n}, Ar{17492, 3n}, Ar{17475, 4n}, Ar{17481, 3n}, Ar{17496, 3n}, Ar{17478, 3n}, Ar{17479, 4n}, Ar{20819, 6n}, Ar{20820, 3n}, Ar{20821, 4n}, Ar{20804, 4n}, Ar{21330, 1n}, Ar{17235, 5n}, Ar{17228, 2n}, Ar{17221, 6n}, Ar{21062, 4n}, Ar{16716, 3n}, Ar{21067, 3n}, Ar{17744, 2n}, Ar{21064, 4n}]

def Si.pick(hit: Bool, n: Nat, m: Nat) -> Nat:
  match hit:
    case True{}:
      n
    case False{}:
      m

def Si.look(+tag: U32, xs: List<&2, Ar>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case Con{Ar{t, n}, rest}:
      Si.pick(U32.is_eq(t, tag), n, Si.look(tag, rest))

def Si.arity(+tag: U32) -> Nat:
  Si.look(tag, Si.arities())

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

def Si.als(xs: List<&2, List<&2, U32>>) -> List<&2, K.Al>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{K.Al{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n)}, Si.als(t)}

def Si.rks(xs: List<&2, List<&2, U32>>) -> List<&2, K.Rk>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{K.Rk{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n)}, Si.rks(t)}

def Si.eps(xs: List<&2, List<&2, U32>>) -> List<&2, H.Ep>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{H.Ep{Si.f(f, 0n), Si.f(f, 1n)}, Si.eps(t)}

def Si.rhs(xs: List<&2, List<&2, U32>>) -> List<&2, H.Rh>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Con{H.Rh{Si.f(f, 0n), Si.f(f, 1n), Si.f(f, 2n), Si.f(f, 3n)}, Si.rhs(t)}

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

def Si.ko2(ok: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match ok:
    case True{}:
      Some{K.Konst.lines(K.KF{Si.css(Si.of(rows, 17235)), Si.cls(Si.of(rows, 17228)), Si.als(Si.of(rows, 16716)), Si.rks(Si.of(rows, 21067))})}
    case False{}:
      None{}

def Si.ko1(on: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      Si.ko2(Bool.not(Si.bad(rows)), rows)
    case False{}:
      Some{Nil{}}

# The constant-argument section: nothing without an RK row, None when a row has the wrong arity.
def KonstIn.lines(+rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  Si.ko1(Si.has(rows, 21067), rows)

# The hot-path inputs: EP and CE rows, the QS sites, and the findings the SQL, fan-out and
# constant-argument sections show (each empty without its rule rows).
def Si.hf(+rows: List<&2, W.Row>) -> H.HF:
  +css = Si.css(Si.of(rows, 17235))
  +cls = Si.cls(Si.of(rows, 17228))
  +ces = Si.ces(Si.of(rows, 17221))
  H.HF{Si.eps(Si.of(rows, 17744)), ces, Si.qss(Si.of(rows, 20819)), Q.Sq.only(Si.ons(Si.of(rows, 21330)), Q.Sq.findings(Si.schema(rows), Si.query(rows))), F.Fanout.findings(F.FoF{css, cls, ces, Si.rfs(Si.of(rows, 21062))}), K.Konst.findings(K.KF{css, cls, Si.als(Si.of(rows, 16716)), Si.rks(Si.of(rows, 21067))}), Si.rhs(Si.of(rows, 21064))}

def Si.ho2(ok: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match ok:
    case True{}:
      Some{H.Hot.lines(Si.hf(rows))}
    case False{}:
      None{}

def Si.ho1(on: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      Si.ho2(Bool.not(Si.bad(rows)), rows)
    case False{}:
      Some{Nil{}}

# The hot-path section: nothing without an RH row, None when a row has the wrong arity.
def HotIn.lines(+rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  Si.ho1(Si.has(rows, 21064), rows)
