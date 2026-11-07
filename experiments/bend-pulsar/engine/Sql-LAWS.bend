# engine/Sql-LAWS.bend - laws about Sql.bend. Proofs: Sql-PROOF.bend.
# Gate: `bend engine/Sql-PROOF.bend --verdict`.
#
# The laws are about the shipped detectors (Sq.sites, Sq.defeat_all, Sq.unindexed_all,
# Sq.fk_all, Sq.drift_ts, Sq.drift_cs), their predicates and Sql.lines. For each
# detector: every finding comes from a fact its predicate accepts (sound), and every
# such fact gives its finding (complete). Then what the index lookup means, what an
# unindexed filter requires, and that drift needs a complete schema. Not covered, by
# design: decoding the rows to these lists, like the other decoders.

import Base
import ./Sql.bend as S
import ./Metrics-LAWS.bend as ML

def MemS(xs: List<&2, S.Sx>, m: S.Sx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : S.Sx}, MemS(t, m)>

def MemQs(xs: List<&2, S.Qs>, m: S.Qs) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : S.Qs}, MemQs(t, m)>

def MemQd(xs: List<&2, S.Qd>, m: S.Qd) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : S.Qd}, MemQd(t, m)>

def MemQu(xs: List<&2, S.Qu>, m: S.Qu) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : S.Qu}, MemQu(t, m)>

def MemQt(xs: List<&2, S.Qt>, m: S.Qt) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : S.Qt}, MemQt(t, m)>

def MemDf(xs: List<&2, S.Df>, m: S.Df) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : S.Df}, MemDf(t, m)>

# ---- dynamic text and OFFSET from a parameter, per site ---------------------------------------
def WitSites(qs: List<&2, S.Qs>, y: S.Sx) -> Data:
  match qs:
    case Nil{}:
      Empty
    case Con{S.Qs{site, file, fn, node, kind, +flags}, t}:
      Either<&2, &2, ML.And({S.Sq.bit(flags, 64) == True{} : Bool}, {S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64} == y : S.Sx}), Either<&2, &2, ML.And({S.Sq.bit(flags, 8) == True{} : Bool}, {S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8} == y : S.Sx}), WitSites(t, y)>>

law sql_sites_sound:
  for +qs: List<&2, S.Qs>
  for +y: S.Sx
  for hm: MemS(S.Sq.sites(qs), y)
  WitSites(qs, y)

law sql_dynamic_complete:
  for +qs: List<&2, S.Qs>
  for +site: U32
  for +file: U32
  for +fn: U32
  for +node: U32
  for +kind: U32
  for +flags: U32
  for hm: MemQs(qs, S.Qs{site, file, fn, node, kind, flags})
  for h: {S.Sq.bit(flags, 64) == True{} : Bool}
  MemS(S.Sq.sites(qs), S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64})

law sql_offset_complete:
  for +qs: List<&2, S.Qs>
  for +site: U32
  for +file: U32
  for +fn: U32
  for +node: U32
  for +kind: U32
  for +flags: U32
  for hm: MemQs(qs, S.Qs{site, file, fn, node, kind, flags})
  for h: {S.Sq.bit(flags, 8) == True{} : Bool}
  MemS(S.Sq.sites(qs), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8})

# ---- defeat ----
def Wit_defeat(+s: S.Schema, xs: List<&2, S.Qd>, y: S.Sx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{S.Qd{+site, +table, +col, +kind}, t}:
      Either<&2, &2, ML.And({S.Sq.defeats(s, table, col) == True{} : Bool}, {S.Sx{3, site, table, col, kind} == y : S.Sx}), Wit_defeat(s, t, y)>

law sql_defeat_sound:
  for +s: S.Schema
  for +xs: List<&2, S.Qd>
  for +y: S.Sx
  for hm: MemS(S.Sq.defeat_all(s, xs), y)
  Wit_defeat(s, xs, y)

law sql_defeat_complete:
  for +s: S.Schema
  for +xs: List<&2, S.Qd>
  for +site: U32
  for +table: U32
  for +col: U32
  for +kind: U32
  for hm: MemQd(xs, S.Qd{site, table, col, kind})
  for h: {S.Sq.defeats(s, table, col) == True{} : Bool}
  MemS(S.Sq.defeat_all(s, xs), S.Sx{3, site, table, col, kind})

# ---- unindexed ----
def Wit_unindexed(+s: S.Schema, xs: List<&2, S.Qu>, y: S.Sx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{S.Qu{+site, +table, +col, +role}, t}:
      Either<&2, &2, ML.And({S.Sq.unindexed(s, table, col, role) == True{} : Bool}, {S.Sx{4, site, table, col, role} == y : S.Sx}), Wit_unindexed(s, t, y)>

law sql_unindexed_sound:
  for +s: S.Schema
  for +xs: List<&2, S.Qu>
  for +y: S.Sx
  for hm: MemS(S.Sq.unindexed_all(s, xs), y)
  Wit_unindexed(s, xs, y)

law sql_unindexed_complete:
  for +s: S.Schema
  for +xs: List<&2, S.Qu>
  for +site: U32
  for +table: U32
  for +col: U32
  for +role: U32
  for hm: MemQu(xs, S.Qu{site, table, col, role})
  for h: {S.Sq.unindexed(s, table, col, role) == True{} : Bool}
  MemS(S.Sq.unindexed_all(s, xs), S.Sx{4, site, table, col, role})

# ---- fk ----
def Wit_fk(+s: S.Schema, +dgs: List<&2, S.Dg>, xs: List<&2, S.Df>, y: S.Sx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{S.Df{+fk, +table, +ref}, t}:
      Either<&2, &2, ML.And({S.Sq.fk_bad(s, table, S.Sq.fk_first(fk, dgs)) == True{} : Bool}, {S.Sx{5, fk, table, S.Sq.fk_first(fk, dgs), ref} == y : S.Sx}), Wit_fk(s, dgs, t, y)>

law sql_fk_sound:
  for +s: S.Schema
  for +dgs: List<&2, S.Dg>
  for +xs: List<&2, S.Df>
  for +y: S.Sx
  for hm: MemS(S.Sq.fk_all(s, xs, dgs), y)
  Wit_fk(s, dgs, xs, y)

law sql_fk_complete:
  for +s: S.Schema
  for +dgs: List<&2, S.Dg>
  for +xs: List<&2, S.Df>
  for +fk: U32
  for +table: U32
  for +ref: U32
  for hm: MemDf(xs, S.Df{fk, table, ref})
  for h: {S.Sq.fk_bad(s, table, S.Sq.fk_first(fk, dgs)) == True{} : Bool}
  MemS(S.Sq.fk_all(s, xs, dgs), S.Sx{5, fk, table, S.Sq.fk_first(fk, dgs), ref})

# ---- drift_t ----
def Wit_drift_t(+s: S.Schema, xs: List<&2, S.Qt>, y: S.Sx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{S.Qt{+site, +table, +mode}, t}:
      Either<&2, &2, ML.And({S.Sq.drift_t(s, table) == True{} : Bool}, {S.Sx{6, site, table, S.Sq.none(), mode} == y : S.Sx}), Wit_drift_t(s, t, y)>

law sql_drift_t_sound:
  for +s: S.Schema
  for +xs: List<&2, S.Qt>
  for +y: S.Sx
  for hm: MemS(S.Sq.drift_ts(s, xs), y)
  Wit_drift_t(s, xs, y)

law sql_drift_t_complete:
  for +s: S.Schema
  for +xs: List<&2, S.Qt>
  for +site: U32
  for +table: U32
  for +mode: U32
  for hm: MemQt(xs, S.Qt{site, table, mode})
  for h: {S.Sq.drift_t(s, table) == True{} : Bool}
  MemS(S.Sq.drift_ts(s, xs), S.Sx{6, site, table, S.Sq.none(), mode})

# ---- drift_c ----
def Wit_drift_c(+s: S.Schema, xs: List<&2, S.Qu>, y: S.Sx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{S.Qu{+site, +table, +col, +role}, t}:
      Either<&2, &2, ML.And({S.Sq.drift_c(s, table, col) == True{} : Bool}, {S.Sx{6, site, table, col, role} == y : S.Sx}), Wit_drift_c(s, t, y)>

law sql_drift_c_sound:
  for +s: S.Schema
  for +xs: List<&2, S.Qu>
  for +y: S.Sx
  for hm: MemS(S.Sq.drift_cs(s, xs), y)
  Wit_drift_c(s, xs, y)

law sql_drift_c_complete:
  for +s: S.Schema
  for +xs: List<&2, S.Qu>
  for +site: U32
  for +table: U32
  for +col: U32
  for +role: U32
  for hm: MemQu(xs, S.Qu{site, table, col, role})
  for h: {S.Sq.drift_c(s, table, col) == True{} : Bool}
  MemS(S.Sq.drift_cs(s, xs), S.Sx{6, site, table, col, role})

# ---- what the index lookup means --------------------------------------------------------------
def TermW(+i: U32, +col: U32, +any: Bool, dxs: List<&2, S.Dx>) -> Data:
  match dxs:
    case Nil{}:
      Empty
    case Con{S.Dx{x, p, c}, rest}:
      Either<&2, &2, ML.And({U32.is_eq(x, i) == True{} : Bool}, ML.And({U32.is_eq(c, col) == True{} : Bool}, {Bool.or(any, U32.is_eq(p, 0)) == True{} : Bool})), TermW(i, col, any, rest)>

# Some index row on `table` with a term on `col` (at position 0 unless `any`).
def IdxW(+table: U32, +col: U32, +any: Bool, dis: List<&2, S.Di>, +dxs: List<&2, S.Dx>) -> Data:
  match dis:
    case Nil{}:
      Empty
    case Con{S.Di{i, t, f}, rest}:
      Either<&2, &2, ML.And({U32.is_eq(t, table) == True{} : Bool}, TermW(i, col, any, dxs)), IdxW(table, col, any, rest, dxs)>

law sql_indexed_sound:
  for +table: U32
  for +col: U32
  for +any: Bool
  for +dis: List<&2, S.Di>
  for +dxs: List<&2, S.Dx>
  for e: {S.Sq.indexed(table, col, any, dis, dxs) == True{} : Bool}
  IdxW(table, col, any, dis, dxs)

law sql_indexed_complete:
  for +table: U32
  for +col: U32
  for +any: Bool
  for +dis: List<&2, S.Di>
  for +dxs: List<&2, S.Dx>
  for w: IdxW(table, col, any, dis, dxs)
  {S.Sq.indexed(table, col, any, dis, dxs) == True{} : Bool}

# An unindexed filter is a filter role on a known base table's column, with no index
# leading on it, and the column is not the rowid alias.
law sql_unindexed_means:
  for +ok: U32
  for +sk: U32
  for +dts: List<&2, S.Dt>
  for +dcs: List<&2, S.Dc>
  for +dis: List<&2, S.Di>
  for +dxs: List<&2, S.Dx>
  for +dfs: List<&2, S.Df>
  for +dgs: List<&2, S.Dg>
  for +table: U32
  for +col: U32
  for +role: U32
  for e: {S.Sq.unindexed(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, table, col, role) == True{} : Bool}
  ML.And({S.Sq.filter_role(role) == True{} : Bool}, ML.And({S.Sq.base(table, dts) == True{} : Bool}, ML.And({S.Sq.col(table, col, False{}, dcs) == True{} : Bool}, ML.And({S.Sq.indexed(table, col, False{}, dis, dxs) == False{} : Bool}, {S.Sq.col(table, col, True{}, dcs) == False{} : Bool}))))

# ---- drift needs a complete schema ------------------------------------------------------------
law sql_drift_tables_need_complete:
  for +ok: U32
  for +sk: U32
  for +dts: List<&2, S.Dt>
  for +dcs: List<&2, S.Dc>
  for +dis: List<&2, S.Di>
  for +dxs: List<&2, S.Dx>
  for +dfs: List<&2, S.Df>
  for +dgs: List<&2, S.Dg>
  for +h: {U32.is_eq(sk, 0) == False{} : Bool}
  for +qts: List<&2, S.Qt>
  {S.Sq.drift_ts(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, qts) == Nil{} : List<&2, S.Sx>}

law sql_drift_cols_need_complete:
  for +ok: U32
  for +sk: U32
  for +dts: List<&2, S.Dt>
  for +dcs: List<&2, S.Dc>
  for +dis: List<&2, S.Di>
  for +dxs: List<&2, S.Dx>
  for +dfs: List<&2, S.Df>
  for +dgs: List<&2, S.Dg>
  for +h: {U32.is_eq(sk, 0) == False{} : Bool}
  for +qus: List<&2, S.Qu>
  {S.Sq.drift_cs(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, qus) == Nil{} : List<&2, S.Sx>}

# ---- the entry point --------------------------------------------------------------------------
law sql_findings_shape:
  for +s: S.Schema
  for +qs: List<&2, S.Qs>
  for +qts: List<&2, S.Qt>
  for +qus: List<&2, S.Qu>
  for +qds: List<&2, S.Qd>
  {S.Sq.findings(s, S.Qy{qs, qts, qus, qds}) == List.append(&2, S.Sx, S.Sq.sites(qs), List.append(&2, S.Sx, S.Sq.defeat_all(s, qds), List.append(&2, S.Sx, S.Sq.unindexed_all(s, qus), List.append(&2, S.Sx, S.Sq.fks(s), List.append(&2, S.Sx, S.Sq.drift_ts(s, qts), S.Sq.drift_cs(s, qus)))))) : List<&2, S.Sx>}

law sql_fks_shape:
  for +ok: U32
  for +sk: U32
  for +dts: List<&2, S.Dt>
  for +dcs: List<&2, S.Dc>
  for +dis: List<&2, S.Di>
  for +dxs: List<&2, S.Dx>
  for +dfs: List<&2, S.Df>
  for +dgs: List<&2, S.Dg>
  {S.Sq.fks(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}) == S.Sq.fk_all(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, dfs, dgs) : List<&2, S.Sx>}

# ---- only the rules that are on ---------------------------------------------------------------
def MemU(xs: List<&2, U32>, m: U32) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : U32}, MemU(t, m)>

def Rule(x: S.Sx) -> U32:
  match x:
    case S.Sx{rule, id, table, col, d}:
      rule

law sql_only_sound:
  for +on: List<&2, U32>
  for +xs: List<&2, S.Sx>
  for +y: S.Sx
  for hm: MemS(S.Sq.only(on, xs), y)
  ML.And(MemS(xs, y), MemU(on, Rule(y)))

law sql_only_complete:
  for +on: List<&2, U32>
  for +xs: List<&2, S.Sx>
  for +y: S.Sx
  for hm: MemS(xs, y)
  for ho: MemU(on, Rule(y))
  MemS(S.Sq.only(on, xs), y)

law sql_lines_shape:
  for +s: S.Schema
  for +q: S.Qy
  for +on: List<&2, U32>
  {S.Sql.lines(s, q, on) == List.append(&2, String, ["pulsar-sql 0", S.Sq.header(s)], List.append(&2, String, S.Sq.lines(S.Sq.only(on, S.Sq.findings(s, q))), ["SQS " ++ Nat.show(List.length(&2, S.Sx, S.Sq.only(on, S.Sq.findings(s, q))))])) : List<&2, String>}
