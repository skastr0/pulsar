# engine/Grow.bend - unbounded growth (PLAN group I composite): a read with no row bound on
# a table that an entry point inserts into, so the read's cost grows with traffic.
# Laws: Grow-LAWS.bend.
#
#   RG rule depth   the rule is on; inserts count when an entry point reaches their function
#                   within `depth` CE edges (Hot.bend's hot set)
#
# Per RG row, per QT read (mode 1) of `table` at site `rs`, then per QT insert (mode 2) of the
# same table at site `ws`, in QT order, `GX rule rs table ws` when:
#   - the schema is complete (DS ddl_skipped 0) and `table` is a known base table;
#   - the QS at `rs` is a SELECT (kind 1) with no LIMIT (flag 1 clear);
#   - the read is not keyed: no key of `table` has every column bound at `rs` by equality
#     or an IN list (QU role 1 or 3). The keys: a unique index that is not partial, with
#     every term a named column; the primary key (all DC flag-1 columns, when there are
#     any); a column alone UNIQUE (DC flag 4) or the rowid alias (DC flag 32); the row id
#     (QU col Sq.rowid(), which the SQL lane writes for a dialect's implicit row key).
#   - the QS at `ws` is in a function the hot set holds.
# An aggregate with no bound key (`COUNT(*)`) counts, on purpose: its cost grows with the table.
#
# Output, only with an RG row: `pulsar-grow 0`, the SQL schema line (SQD), the GX lines,
# then `GXS n`.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./Sql.bend as Q
import ./Fanout.bend as F
import ./Hot.bend as H

type Rg is Data:
  Rg{r: U32, depth: U32}

type Gx is Data:
  Gx{r: U32, rsite: U32, table: U32, wsite: U32}

type GF is Data:
  GF{s: Q.Schema, qs: List<&2, Q.Qs>, qts: List<&2, Q.Qt>, qus: List<&2, Q.Qu>, eps: List<&2, H.Ep>, ces: List<&2, F.Ce>, rgs: List<&2, Rg>}

# ---- is the read keyed? -----------------------------------------------------------------------
def Gr.bind(+role: U32) -> Bool:
  Bool.or(U32.is_eq(role, 1), U32.is_eq(role, 3))

# `col` of `table` is bound at `site` (equality or IN list).
def Gr.eq(+site: U32, +table: U32, +col: U32, qus: List<&2, Q.Qu>) -> Bool:
  match qus:
    case Nil{}:
      False{}
    case Con{Q.Qu{s, t, c, +role}, rest}:
      Bool.or(Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), Gr.bind(role)))), Gr.eq(site, table, col, rest))

# Every term of index `i` is a named column bound at `site`.
def Gr.covers(+site: U32, +table: U32, +i: U32, dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>) -> Bool:
  match dxs:
    case Nil{}:
      True{}
    case Con{Q.Dx{x, p, +c}, rest}:
      Bool.and(Bool.or(Bool.not(U32.is_eq(x, i)), Bool.and(Bool.not(U32.is_eq(c, Q.Sq.none())), Gr.eq(site, table, c, qus))), Gr.covers(site, table, i, rest, qus))

# A unique, not partial, index of `table` with every term bound.
def Gr.uidx(+site: U32, +table: U32, dis: List<&2, Q.Di>, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>) -> Bool:
  match dis:
    case Nil{}:
      False{}
    case Con{Q.Di{+i, t, +f}, rest}:
      Bool.or(Bool.and(U32.is_eq(t, table), Bool.and(Q.Sq.bit(f, 1), Bool.and(Bool.not(Q.Sq.bit(f, 2)), Gr.covers(site, table, i, dxs, qus)))), Gr.uidx(site, table, rest, dxs, qus))

# `table` has a primary-key column.
def Gr.haspk(+table: U32, dcs: List<&2, Q.Dc>) -> Bool:
  match dcs:
    case Nil{}:
      False{}
    case Con{Q.Dc{t, c, p, +f}, rest}:
      Bool.or(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)), Gr.haspk(table, rest))

# Every primary-key column of `table` is bound at `site`.
def Gr.pkcov(+site: U32, +table: U32, dcs: List<&2, Q.Dc>, +qus: List<&2, Q.Qu>) -> Bool:
  match dcs:
    case Nil{}:
      True{}
    case Con{Q.Dc{t, +c, p, +f}, rest}:
      Bool.and(Bool.or(Bool.not(Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1))), Gr.eq(site, table, c, qus)), Gr.pkcov(site, table, rest, qus))

# A column of `table` alone UNIQUE, or the rowid alias, is bound at `site`.
def Gr.ucol(+site: U32, +table: U32, dcs: List<&2, Q.Dc>, +qus: List<&2, Q.Qu>) -> Bool:
  match dcs:
    case Nil{}:
      False{}
    case Con{Q.Dc{t, +c, p, +f}, rest}:
      Bool.or(Bool.and(U32.is_eq(t, table), Bool.and(Bool.or(Q.Sq.bit(f, 4), Q.Sq.bit(f, 32)), Gr.eq(site, table, c, qus))), Gr.ucol(site, table, rest, qus))

def Gr.keyed(+site: U32, +table: U32, s: Q.Schema, +qus: List<&2, Q.Qu>) -> Bool:
  match s:
    case Q.Schema{ok, sk, dts, +dcs, dis, dxs, dfs, dgs}:
      Bool.or(Gr.uidx(site, table, dis, dxs, qus), Bool.or(Bool.and(Gr.haspk(table, dcs), Gr.pkcov(site, table, dcs, qus)), Bool.or(Gr.ucol(site, table, dcs, qus), Gr.eq(site, table, Q.Sq.rowid(), qus))))

# ---- the read and the write -------------------------------------------------------------------
# The QS at `site` is a SELECT with no LIMIT.
def Gr.sel(+site: U32, qs: List<&2, Q.Qs>) -> Bool:
  match qs:
    case Nil{}:
      False{}
    case Con{Q.Qs{s, file, fn, node, kind, +flags}, rest}:
      Bool.or(Bool.and(U32.is_eq(s, site), Bool.and(U32.is_eq(kind, 1), Bool.not(Q.Sq.bit(flags, 1)))), Gr.sel(site, rest))

# The QS at `site` is in a function of the hot set.
def Gr.hotw(+site: U32, qs: List<&2, Q.Qs>, +hset: G.Tr) -> Bool:
  match qs:
    case Nil{}:
      False{}
    case Con{Q.Qs{s, file, fn, node, kind, flags}, rest}:
      Bool.or(Bool.and(U32.is_eq(s, site), S.Scope.has(hset, fn)), Gr.hotw(site, rest, hset))

def Gr.base(+table: U32, s: Q.Schema) -> Bool:
  match s:
    case Q.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}:
      Q.Sq.base(table, dts)

# The read at `rs` of `table` is unbounded.
def Gr.unb(+s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +rs: U32, +table: U32) -> Bool:
  Bool.and(Q.Sq.complete(s), Bool.and(Gr.base(table, s), Bool.and(Gr.sel(rs, qs), Bool.not(Gr.keyed(rs, table, s, qus)))))

# ---- the composite ----------------------------------------------------------------------------
def Gr.push(b: Bool, x: Gx, acc: List<&2, Gx>) -> List<&2, Gx>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Gr.when(b: Bool, xs: List<&2, Gx>) -> List<&2, Gx>:
  match b:
    case True{}:
      xs
    case False{}:
      Nil{}

# The hot inserts into `table`, for the read at `rs`.
def Gr.ws(qts: List<&2, Q.Qt>, +qs: List<&2, Q.Qs>, +hset: G.Tr, +r: U32, +rs: U32, +table: U32) -> List<&2, Gx>:
  match qts:
    case Nil{}:
      Nil{}
    case Con{Q.Qt{+ws, t, mode}, rest}:
      Gr.push(Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(mode, 2), Gr.hotw(ws, qs, hset))), Gx{r, rs, table, ws}, Gr.ws(rest, qs, hset, r, rs, table))

# Per unbounded read in `rd`, the hot inserts among `all`.
def Gr.rd(rd: List<&2, Q.Qt>, +all: List<&2, Q.Qt>, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +hset: G.Tr, +r: U32) -> List<&2, Gx>:
  match rd:
    case Nil{}:
      Nil{}
    case Con{Q.Qt{+rs, +t, mode}, rest}:
      List.append(&2, Gx, Gr.when(Bool.and(U32.is_eq(mode, 1), Gr.unb(s, qs, qus, rs, t)), Gr.ws(all, qs, hset, r, rs, t)), Gr.rd(rest, all, s, qs, qus, hset, r))

def Gr.hset(+eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32) -> G.Tr:
  S.Scope.set(H.Ho.reach(U32.to_nat(depth), ces, H.Ho.seed(eps)))

def Gr.rules(+s: Q.Schema, +qs: List<&2, Q.Qs>, +qts: List<&2, Q.Qt>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, rgs: List<&2, Rg>) -> List<&2, Gx>:
  match rgs:
    case Nil{}:
      Nil{}
    case Con{Rg{+r, +depth}, rest}:
      List.append(&2, Gx, Gr.rd(qts, qts, s, qs, qus, Gr.hset(eps, ces, depth), r), Gr.rules(s, qs, qts, qus, eps, ces, rest))

def Grow.findings(f: GF) -> List<&2, Gx>:
  match f:
    case GF{+s, +qs, +qts, +qus, +eps, +ces, rgs}:
      Gr.rules(s, qs, qts, qus, eps, ces, rgs)

# ---- output -----------------------------------------------------------------------------------
def Gr.line(x: Gx) -> String:
  match x:
    case Gx{r, rs, t, ws}:
      "GX " ++ U32.show(r) ++ " " ++ U32.show(rs) ++ " " ++ U32.show(t) ++ " " ++ U32.show(ws)

def Gr.lines(xs: List<&2, Gx>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Gr.line(h), Gr.lines(t)}

def Grow.lines(f: GF) -> List<&2, String>:
  match f:
    case GF{+s, +qs, +qts, +qus, +eps, +ces, +rgs}:
      +xs = Grow.findings(GF{s, qs, qts, qus, eps, ces, rgs})
      Con{"pulsar-grow 0", Con{Q.Sq.header(s), List.append(&2, String, Gr.lines(xs), ["GXS " ++ Nat.show(List.length(&2, Gx, xs))])}}
