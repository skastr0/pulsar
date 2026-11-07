# Sql.bend - SQL detectors over the schema and query facts (FACTS.md "SQL").
#
# Every detector is a filter: a finding for each fact the rule's predicate accepts.
# The predicates are plain Bool functions of the facts, and Sql-LAWS.bend proves each
# filter keeps exactly the facts its predicate accepts, and what each predicate means.
#
#   sql.dynamic-text      a query site whose text is not a literal or template (QS flag 64)
#   sql.offset-param      a query site with OFFSET from a parameter or expression (QS flag 8)
#   sql.index-defeat      a QD predicate on a column that some index of its table has as a
#                         term: the predicate keeps that index from being used
#   sql.unindexed-filter  an equality, range, IN or join use (QU role 1, 2, 3, 7) of a
#                         known column of a known base table, where no index of the table
#                         has the column as its leading term and the column is not the
#                         rowid alias
#   sql.fk-unindexed      a foreign key whose first column is no index's leading term on
#                         the child table (a single-column test: a multi-column key whose
#                         first column leads some index is not reported)
#   sql.schema-drift      a QT table with no DT row, or a resolved QU column with no DC row;
#                         only when the schema is complete (DS skipped = 0). Otherwise no
#                         drift finding is made, and the SQD line says the schema is incomplete
#
# Platform names (SQLite, D1, Durable Objects) never appear: the lane and the catalogs
# decide which text is SQL. Every rule is off unless policy enables it: the CLI writes an
# `SR rule` row for each rule that is on, and only those rules are reported.
#
#   pulsar-sql 0
#   SQD <ddl_ok> <ddl_skipped> <complete 0|1>
#   SQX <rule-id> site <site> <table> <col> <detail>   (table/col 4294967295 when none)
#   SQX sql.fk-unindexed fk <fk> <table> <col> <ref_table>
#   SQS <n>

import Base

type Qs is Data:
  Qs{site: U32, file: U32, fn: U32, node: U32, kind: U32, flags: U32}

type Qu is Data:
  Qu{site: U32, table: U32, col: U32, role: U32}

type Qd is Data:
  Qd{site: U32, table: U32, col: U32, kind: U32}

type Qt is Data:
  Qt{site: U32, table: U32, mode: U32}

type Dt is Data:
  Dt{table: U32, file: U32, flags: U32}

type Dc is Data:
  Dc{table: U32, col: U32, pos: U32, flags: U32}

type Di is Data:
  Di{index: U32, table: U32, flags: U32}

type Dx is Data:
  Dx{index: U32, pos: U32, col: U32}

type Dg is Data:
  Dg{fk: U32, pos: U32, col: U32, ref_col: U32}

type Df is Data:
  Df{fk: U32, table: U32, ref_table: U32}

type Schema is Data:
  Schema{ok: U32, skipped: U32, dts: List<&2, Dt>, dcs: List<&2, Dc>, dis: List<&2, Di>, dxs: List<&2, Dx>, dfs: List<&2, Df>, dgs: List<&2, Dg>}

type Qy is Data:
  Qy{qs: List<&2, Qs>, qts: List<&2, Qt>, qus: List<&2, Qu>, qds: List<&2, Qd>}

# A finding: rule (1..6 in the header's order), subject id (site or fk), table, col, detail.
type Sx is Data:
  Sx{rule: U32, id: U32, table: U32, col: U32, detail: U32}

def Sq.none() -> U32:
  4294967295

# The row id: the SQL lane writes it as a QU column for an implicit row key (a dialect
# table names it; SQLite: rowid, oid, _rowid_ of a table that is not WITHOUT ROWID).
def Sq.rowid() -> U32:
  4294967294

# ---- the generic filter -----------------------------------------------------------------------
def Sq.keep(hit: Bool, x: Sx, rest: List<&2, Sx>) -> List<&2, Sx>:
  match hit:
    case True{}:
      Con{x, rest}
    case False{}:
      rest

def Sq.bit(+flags: U32, +b: U32) -> Bool:
  U32.is_eq(U32.and(flags, b), b)

# ---- schema lookups ---------------------------------------------------------------------------
# Some index of `table` has `col` at term position `pos` (pos 0: the leading term), or at
# any position when `any` is True.
def Sq.term(+i: U32, +col: U32, +any: Bool, dxs: List<&2, Dx>) -> Bool:
  match dxs:
    case Nil{}:
      False{}
    case Con{Dx{x, p, c}, t}:
      Bool.or(Bool.and(U32.is_eq(x, i), Bool.and(U32.is_eq(c, col), Bool.or(any, U32.is_eq(p, 0)))), Sq.term(i, col, any, t))

def Sq.indexed(+table: U32, +col: U32, +any: Bool, dis: List<&2, Di>, +dxs: List<&2, Dx>) -> Bool:
  match dis:
    case Nil{}:
      False{}
    case Con{Di{i, t, f}, rest}:
      Bool.or(Bool.and(U32.is_eq(t, table), Sq.term(i, col, any, dxs)), Sq.indexed(table, col, any, rest, dxs))

# `table` is a known base table: a DT row that is neither a view (8) nor virtual (4).
def Sq.base(+table: U32, dts: List<&2, Dt>) -> Bool:
  match dts:
    case Nil{}:
      False{}
    case Con{Dt{t, file, +f}, rest}:
      Bool.or(Bool.and(U32.is_eq(t, table), Bool.and(Bool.not(Sq.bit(f, 8)), Bool.not(Sq.bit(f, 4)))), Sq.base(table, rest))

def Sq.table(+table: U32, dts: List<&2, Dt>) -> Bool:
  match dts:
    case Nil{}:
      False{}
    case Con{Dt{t, file, f}, rest}:
      Bool.or(U32.is_eq(t, table), Sq.table(table, rest))

# `col` is a column of `table`; with `rowid`, only when it is the rowid alias (DC flag 32).
def Sq.col(+table: U32, +col: U32, +rowid: Bool, dcs: List<&2, Dc>) -> Bool:
  match dcs:
    case Nil{}:
      False{}
    case Con{Dc{t, c, p, f}, rest}:
      Bool.or(Bool.and(U32.is_eq(t, table), Bool.and(U32.is_eq(c, col), Bool.or(Bool.not(rowid), Sq.bit(f, 32)))), Sq.col(table, col, rowid, rest))

# The first column of foreign key `fk`.
def Sq.fk_first(+fk: U32, dgs: List<&2, Dg>) -> U32:
  match dgs:
    case Nil{}:
      Sq.none()
    case Con{Dg{k, p, c, r}, rest}:
      Bool.pick(U32, Bool.and(U32.is_eq(k, fk), U32.is_eq(p, 0)), c, Sq.fk_first(fk, rest))

# ---- the predicates ---------------------------------------------------------------------------
def Sq.filter_role(+role: U32) -> Bool:
  Bool.or(U32.is_eq(role, 1), Bool.or(U32.is_eq(role, 2), Bool.or(U32.is_eq(role, 3), U32.is_eq(role, 7))))

def Sq.unindexed(+s: Schema, +table: U32, +col: U32, +role: U32) -> Bool:
  match s:
    case Schema{ok, sk, +dts, +dcs, +dis, +dxs, dfs, dgs}:
      Bool.and(Sq.filter_role(role), Bool.and(Sq.base(table, dts), Bool.and(Sq.col(table, col, False{}, dcs), Bool.and(Bool.not(Sq.indexed(table, col, False{}, dis, dxs)), Bool.not(Sq.col(table, col, True{}, dcs))))))

def Sq.defeats(+s: Schema, +table: U32, +col: U32) -> Bool:
  match s:
    case Schema{ok, sk, dts, dcs, +dis, +dxs, dfs, dgs}:
      Sq.indexed(table, col, True{}, dis, dxs)

def Sq.complete(+s: Schema) -> Bool:
  match s:
    case Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}:
      U32.is_eq(sk, 0)

def Sq.fk_bad(+s: Schema, +table: U32, +col: U32) -> Bool:
  match s:
    case Schema{ok, sk, dts, dcs, +dis, +dxs, dfs, dgs}:
      Bool.and(Bool.not(U32.is_eq(col, Sq.none())), Bool.not(Sq.indexed(table, col, False{}, dis, dxs)))

def Sq.drift_t(+s: Schema, +table: U32) -> Bool:
  match s:
    case Schema{ok, sk, +dts, dcs, dis, dxs, dfs, dgs}:
      Bool.and(U32.is_eq(sk, 0), Bool.not(Sq.table(table, dts)))

def Sq.drift_c(+s: Schema, +table: U32, +col: U32) -> Bool:
  match s:
    case Schema{ok, sk, +dts, +dcs, dis, dxs, dfs, dgs}:
      Bool.and(U32.is_eq(sk, 0), Bool.and(Bool.not(U32.is_eq(table, Sq.none())), Bool.and(Sq.table(table, dts), Bool.and(Bool.not(Sq.col(table, col, False{}, dcs)), Bool.not(U32.is_eq(col, Sq.rowid()))))))

# ---- the detectors ----------------------------------------------------------------------------
def Sq.sites(qs: List<&2, Qs>) -> List<&2, Sx>:
  match qs:
    case Nil{}:
      Nil{}
    case Con{Qs{+site, file, fn, node, kind, +flags}, t}:
      Sq.keep(Sq.bit(flags, 64), Sx{1, site, Sq.none(), Sq.none(), 64}, Sq.keep(Sq.bit(flags, 8), Sx{2, site, Sq.none(), Sq.none(), 8}, Sq.sites(t)))

def Sq.defeat_all(+s: Schema, qds: List<&2, Qd>) -> List<&2, Sx>:
  match qds:
    case Nil{}:
      Nil{}
    case Con{Qd{+site, +table, +col, +kind}, t}:
      Sq.keep(Sq.defeats(s, table, col), Sx{3, site, table, col, kind}, Sq.defeat_all(s, t))

def Sq.unindexed_all(+s: Schema, qus: List<&2, Qu>) -> List<&2, Sx>:
  match qus:
    case Nil{}:
      Nil{}
    case Con{Qu{+site, +table, +col, +role}, t}:
      Sq.keep(Sq.unindexed(s, table, col, role), Sx{4, site, table, col, role}, Sq.unindexed_all(s, t))

def Sq.fk_all(+s: Schema, dfs: List<&2, Df>, +dgs: List<&2, Dg>) -> List<&2, Sx>:
  match dfs:
    case Nil{}:
      Nil{}
    case Con{Df{+fk, +table, +ref}, t}:
      +c = Sq.fk_first(fk, dgs)
      Sq.keep(Sq.fk_bad(s, table, c), Sx{5, fk, table, c, ref}, Sq.fk_all(s, t, dgs))

def Sq.drift_ts(+s: Schema, qts: List<&2, Qt>) -> List<&2, Sx>:
  match qts:
    case Nil{}:
      Nil{}
    case Con{Qt{+site, +table, +mode}, t}:
      Sq.keep(Sq.drift_t(s, table), Sx{6, site, table, Sq.none(), mode}, Sq.drift_ts(s, t))

def Sq.drift_cs(+s: Schema, qus: List<&2, Qu>) -> List<&2, Sx>:
  match qus:
    case Nil{}:
      Nil{}
    case Con{Qu{+site, +table, +col, +role}, t}:
      Sq.keep(Sq.drift_c(s, table, col), Sx{6, site, table, col, role}, Sq.drift_cs(s, t))

def Sq.fks(+s: Schema) -> List<&2, Sx>:
  match s:
    case Schema{ok, sk, dts, dcs, dis, dxs, dfs, +dgs}:
      Sq.fk_all(s, dfs, dgs)

# Every finding: dynamic text and offset per site, index-defeating predicates, unindexed
# filters, unindexed foreign keys, then schema drift (tables, then columns).
def Sq.findings(+s: Schema, q: Qy) -> List<&2, Sx>:
  match q:
    case Qy{qs, +qts, +qus, qds}:
      List.append(&2, Sx, Sq.sites(qs), List.append(&2, Sx, Sq.defeat_all(s, qds), List.append(&2, Sx, Sq.unindexed_all(s, qus), List.append(&2, Sx, Sq.fks(s), List.append(&2, Sx, Sq.drift_ts(s, qts), Sq.drift_cs(s, qus))))))

# ---- output -----------------------------------------------------------------------------------
def Sq.rid(+rule: U32) -> String:
  match rule:
    case 1:
      "sql.dynamic-text"
    case 2:
      "sql.offset-param"
    case 3:
      "sql.index-defeat"
    case 4:
      "sql.unindexed-filter"
    case 5:
      "sql.fk-unindexed"
    case _:
      "sql.schema-drift"

def Sq.line(x: Sx) -> String:
  match x:
    case Sx{+rule, id, table, col, d}:
      "SQX " ++ Sq.rid(rule) ++ Bool.pick(String, U32.is_eq(rule, 5), " fk ", " site ") ++ U32.show(id) ++ " " ++ U32.show(table) ++ " " ++ U32.show(col) ++ " " ++ U32.show(d)

def Sq.lines(xs: List<&2, Sx>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Sq.line(h), Sq.lines(t)}

def Sq.header(+s: Schema) -> String:
  match s:
    case Schema{+ok, +sk, dts, dcs, dis, dxs, dfs, dgs}:
      "SQD " ++ U32.show(ok) ++ " " ++ U32.show(sk) ++ " " ++ Bool.pick(String, U32.is_eq(sk, 0), "1", "0")

# Rule `rule` (1..6) is on: some `SR rule` row (the CLI writes one per rule policy turns on).
def Sq.on(+rule: U32, on: List<&2, U32>) -> Bool:
  match on:
    case Nil{}:
      False{}
    case Con{r, t}:
      Bool.or(U32.is_eq(r, rule), Sq.on(rule, t))

# The findings of the rules that are on, in order.
def Sq.only(+on: List<&2, U32>, xs: List<&2, Sx>) -> List<&2, Sx>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{Sx{+rule, +id, +table, +col, +d}, t}:
      Sq.keep(Sq.on(rule, on), Sx{rule, id, table, col, d}, Sq.only(on, t))

# The entry point: the schema, the query facts and the rules that are on, to the
# section's lines.
def Sql.lines(+s: Schema, q: Qy, +on: List<&2, U32>) -> List<&2, String>:
  +xs = Sq.only(on, Sq.findings(s, q))
  List.append(&2, String, ["pulsar-sql 0", Sq.header(s)], List.append(&2, String, Sq.lines(xs), ["SQS " ++ Nat.show(List.length(&2, Sx, xs))]))
