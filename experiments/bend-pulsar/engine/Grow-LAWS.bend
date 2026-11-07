# engine/Grow-LAWS.bend - laws about Grow.bend. Proofs: Grow-PROOF.bend.
# Gate: `bend engine/Grow-PROOF.bend --verdict`.
#
# The findings are exactly the (RG row, QT read, QT insert) triples whose checks hold
# (gr_findings_sound / _complete). What the checks mean, in the facts:
#   - unbounded: a complete schema, a known base table, a SELECT with no LIMIT at the read
#     site, and not keyed, both ways (gr_unb_means / gr_unb_complete);
#   - keyed: some key of the table has every column bound at the read site by an equality
#     or an IN list (KeyW), both ways (gr_keyed_sound / _complete), so a finding's read has
#     no such key (gr_no_key);
#   - the SELECT with no LIMIT (gr_sel_*), and the hot insert: a QS at the insert site whose
#     function an entry point reaches within `depth` CE edges (Hot-LAWS HR, gr_hot_*).
# Not covered, by design: decoding the rows.

import Base
import ../LAWS.bend as TL
import ./Sql.bend as Q
import ./Sql-LAWS.bend as QL
import ./Fanout.bend as F
import ./Hot.bend as H
import ./Hot-LAWS.bend as HL
import ./Grow.bend as R

def MemGx(xs: List<&2, R.Gx>, m: R.Gx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : R.Gx}, MemGx(t, m)>

def MemRg(xs: List<&2, R.Rg>, m: R.Rg) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : R.Rg}, MemRg(t, m)>

def MemDi(xs: List<&2, Q.Di>, m: Q.Di) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : Q.Di}, MemDi(t, m)>

def MemDc(xs: List<&2, Q.Dc>, m: Q.Dc) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : Q.Dc}, MemDc(t, m)>

def GxRs(y: R.Gx) -> U32:
  match y:
    case R.Gx{r, rs, t, ws}:
      rs

def GxT(y: R.Gx) -> U32:
  match y:
    case R.Gx{r, rs, t, ws}:
      t

def Top() -> Data:
  {True{} == True{} : Bool}

# ---- keys -------------------------------------------------------------------------------------
def BindR(+role: U32) -> Data:
  Either<&2, &2, {role == 1 : U32}, {role == 3 : U32}>

def EqAt(u: Q.Qu, +site: U32, +table: U32, +col: U32) -> Data:
  match u:
    case Q.Qu{s, t, c, role}:
      TL.And({s == site : U32}, TL.And({t == table : U32}, TL.And({c == col : U32}, BindR(role))))

# A QU row binds `col` of `table` at `site` by an equality or an IN list.
def EqW(+site: U32, +table: U32, +col: U32, +qus: List<&2, Q.Qu>) -> Data:
  TL.Ex(Q.Qu, u => TL.And(QL.MemQu(qus, u), EqAt(u, site, table, col)))

# Every term of index `i` is a named column bound at `site`.
def AllCov(+site: U32, +table: U32, +i: U32, dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>) -> Data:
  match dxs:
    case Nil{}:
      Top()
    case Con{Q.Dx{x, p, c}, rest}:
      TL.And(Either<&2, &2, {U32.is_eq(x, i) == False{} : Bool}, TL.And({U32.is_eq(c, Q.Sq.none()) == False{} : Bool}, EqW(site, table, c, qus))>, AllCov(site, table, i, rest, qus))

def UKeyAt(d: Q.Di, +site: U32, +table: U32, +dxs: List<&2, Q.Dx>, +qus: List<&2, Q.Qu>) -> Data:
  match d:
    case Q.Di{i, t, f}:
      TL.And({t == table : U32}, TL.And({Q.Sq.bit(f, 1) == True{} : Bool}, TL.And({Q.Sq.bit(f, 2) == False{} : Bool}, AllCov(site, table, i, dxs, qus))))

def PkAt(d: Q.Dc, +table: U32) -> Data:
  match d:
    case Q.Dc{t, c, p, f}:
      TL.And({t == table : U32}, {Q.Sq.bit(f, 1) == True{} : Bool})

# Every primary-key column of `table` is bound at `site`.
def PkAll(+site: U32, +table: U32, dcs: List<&2, Q.Dc>, +qus: List<&2, Q.Qu>) -> Data:
  match dcs:
    case Nil{}:
      Top()
    case Con{Q.Dc{t, c, p, f}, rest}:
      TL.And(Either<&2, &2, {Bool.and(U32.is_eq(t, table), Q.Sq.bit(f, 1)) == False{} : Bool}, EqW(site, table, c, qus)>, PkAll(site, table, rest, qus))

def UColAt(d: Q.Dc, +site: U32, +table: U32, +qus: List<&2, Q.Qu>) -> Data:
  match d:
    case Q.Dc{t, c, p, f}:
      TL.And({t == table : U32}, TL.And(Either<&2, &2, {Q.Sq.bit(f, 4) == True{} : Bool}, {Q.Sq.bit(f, 32) == True{} : Bool}>, EqW(site, table, c, qus)))

# Some key of `table` is bound at `site`: a unique, not partial index with every term bound;
# or a primary key (some DC flag-1 column) with every column bound; or a column alone
# UNIQUE or the rowid alias, bound; or the row id (QU col Sq.rowid()), bound.
def KeyW(+site: U32, +table: U32, s: Q.Schema, +qus: List<&2, Q.Qu>) -> Data:
  match s:
    case Q.Schema{ok, sk, dts, +dcs, dis, dxs, dfs, dgs}:
      Either<&2, &2, TL.Ex(Q.Di, d => TL.And(MemDi(dis, d), UKeyAt(d, site, table, dxs, qus))), Either<&2, &2, TL.And(TL.Ex(Q.Dc, d => TL.And(MemDc(dcs, d), PkAt(d, table))), PkAll(site, table, dcs, qus)), Either<&2, &2, TL.Ex(Q.Dc, d => TL.And(MemDc(dcs, d), UColAt(d, site, table, qus))), EqW(site, table, Q.Sq.rowid(), qus)>>>

law gr_keyed_sound:
  for +site: U32
  for +table: U32
  for +s: Q.Schema
  for +qus: List<&2, Q.Qu>
  for e: {R.Gr.keyed(site, table, s, qus) == True{} : Bool}
  KeyW(site, table, s, qus)

law gr_keyed_complete:
  for +site: U32
  for +table: U32
  for +s: Q.Schema
  for +qus: List<&2, Q.Qu>
  for w: KeyW(site, table, s, qus)
  {R.Gr.keyed(site, table, s, qus) == True{} : Bool}

# ---- the read and the insert ------------------------------------------------------------------
def SelAt(x: Q.Qs, +site: U32) -> Data:
  match x:
    case Q.Qs{s, file, fn, node, kind, flags}:
      TL.And({s == site : U32}, TL.And({kind == 1 : U32}, {Q.Sq.bit(flags, 1) == False{} : Bool}))

law gr_sel_sound:
  for +site: U32
  for +qs: List<&2, Q.Qs>
  for e: {R.Gr.sel(site, qs) == True{} : Bool}
  TL.Ex(Q.Qs, x => TL.And(QL.MemQs(qs, x), SelAt(x, site)))

law gr_sel_complete:
  for +site: U32
  for +qs: List<&2, Q.Qs>
  for w: TL.Ex(Q.Qs, x => TL.And(QL.MemQs(qs, x), SelAt(x, site)))
  {R.Gr.sel(site, qs) == True{} : Bool}

def QsSite(x: Q.Qs) -> U32:
  match x:
    case Q.Qs{s, file, fn, node, kind, flags}:
      s

def QsFn(x: Q.Qs) -> U32:
  match x:
    case Q.Qs{s, file, fn, node, kind, flags}:
      fn

# The QS at `site` is in a function an entry point reaches within `depth` CE edges.
def HotAt(x: Q.Qs, +site: U32, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +depth: U32) -> Data:
  TL.And({QsSite(x) == site : U32}, HL.HR(U32.to_nat(depth), eps, ces, QsFn(x)))

law gr_hot_sound:
  for +site: U32
  for +qs: List<&2, Q.Qs>
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +depth: U32
  for e: {R.Gr.hotw(site, qs, R.Gr.hset(eps, ces, depth)) == True{} : Bool}
  TL.Ex(Q.Qs, x => TL.And(QL.MemQs(qs, x), HotAt(x, site, eps, ces, depth)))

law gr_hot_complete:
  for +site: U32
  for +qs: List<&2, Q.Qs>
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +depth: U32
  for w: TL.Ex(Q.Qs, x => TL.And(QL.MemQs(qs, x), HotAt(x, site, eps, ces, depth)))
  {R.Gr.hotw(site, qs, R.Gr.hset(eps, ces, depth)) == True{} : Bool}

law gr_unb_means:
  for +s: Q.Schema
  for +qs: List<&2, Q.Qs>
  for +qus: List<&2, Q.Qu>
  for +rs: U32
  for +table: U32
  for e: {R.Gr.unb(s, qs, qus, rs, table) == True{} : Bool}
  TL.And({Q.Sq.complete(s) == True{} : Bool}, TL.And({R.Gr.base(table, s) == True{} : Bool}, TL.And({R.Gr.sel(rs, qs) == True{} : Bool}, {R.Gr.keyed(rs, table, s, qus) == False{} : Bool})))

law gr_unb_complete:
  for +s: Q.Schema
  for +qs: List<&2, Q.Qs>
  for +qus: List<&2, Q.Qu>
  for +rs: U32
  for +table: U32
  for ec: {Q.Sq.complete(s) == True{} : Bool}
  for eb: {R.Gr.base(table, s) == True{} : Bool}
  for es: {R.Gr.sel(rs, qs) == True{} : Bool}
  for ek: {R.Gr.keyed(rs, table, s, qus) == False{} : Bool}
  {R.Gr.unb(s, qs, qus, rs, table) == True{} : Bool}

# ---- the findings -----------------------------------------------------------------------------
def GPair(g: R.Rg, a: Q.Qt, b: Q.Qt, +s: Q.Schema, +qs: List<&2, Q.Qs>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +y: R.Gx) -> Data:
  match g:
    case R.Rg{r, depth}:
      match a:
        case Q.Qt{rs, t, ma}:
          match b:
            case Q.Qt{ws, tb, mb}:
              TL.And({ma == 1 : U32}, TL.And({R.Gr.unb(s, qs, qus, rs, t) == True{} : Bool}, TL.And({tb == t : U32}, TL.And({mb == 2 : U32}, TL.And({R.Gr.hotw(ws, qs, R.Gr.hset(eps, ces, depth)) == True{} : Bool}, {R.Gx{r, rs, t, ws} == y : R.Gx})))))

def GAt(+s: Q.Schema, +qs: List<&2, Q.Qs>, +qts: List<&2, Q.Qt>, +qus: List<&2, Q.Qu>, +eps: List<&2, H.Ep>, +ces: List<&2, F.Ce>, +rgs: List<&2, R.Rg>, +y: R.Gx) -> Data:
  TL.Ex(R.Rg, g => TL.And(MemRg(rgs, g), TL.Ex(Q.Qt, a => TL.And(QL.MemQt(qts, a), TL.Ex(Q.Qt, b => TL.And(QL.MemQt(qts, b), GPair(g, a, b, s, qs, qus, eps, ces, y)))))))

law gr_findings_sound:
  for +s: Q.Schema
  for +qs: List<&2, Q.Qs>
  for +qts: List<&2, Q.Qt>
  for +qus: List<&2, Q.Qu>
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +rgs: List<&2, R.Rg>
  for +y: R.Gx
  for hm: MemGx(R.Grow.findings(R.GF{s, qs, qts, qus, eps, ces, rgs}), y)
  GAt(s, qs, qts, qus, eps, ces, rgs, y)

law gr_findings_complete:
  for +s: Q.Schema
  for +qs: List<&2, Q.Qs>
  for +qts: List<&2, Q.Qt>
  for +qus: List<&2, Q.Qu>
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +rgs: List<&2, R.Rg>
  for +y: R.Gx
  for w: GAt(s, qs, qts, qus, eps, ces, rgs, y)
  MemGx(R.Grow.findings(R.GF{s, qs, qts, qus, eps, ces, rgs}), y)

# A finding's read has no key bound at its site.
law gr_no_key:
  for +s: Q.Schema
  for +qs: List<&2, Q.Qs>
  for +qts: List<&2, Q.Qt>
  for +qus: List<&2, Q.Qu>
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +rgs: List<&2, R.Rg>
  for +y: R.Gx
  for hm: MemGx(R.Grow.findings(R.GF{s, qs, qts, qus, eps, ces, rgs}), y)
  for k: KeyW(GxRs(y), GxT(y), s, qus)
  Empty

# ---- output -----------------------------------------------------------------------------------
law gr_lines_shape:
  for +s: Q.Schema
  for +qs: List<&2, Q.Qs>
  for +qts: List<&2, Q.Qt>
  for +qus: List<&2, Q.Qu>
  for +eps: List<&2, H.Ep>
  for +ces: List<&2, F.Ce>
  for +rgs: List<&2, R.Rg>
  {R.Grow.lines(R.GF{s, qs, qts, qus, eps, ces, rgs}) == Con{"pulsar-grow 0", Con{Q.Sq.header(s), List.append(&2, String, R.Gr.lines(R.Grow.findings(R.GF{s, qs, qts, qus, eps, ces, rgs})), ["GXS " ++ Nat.show(List.length(&2, R.Gx, R.Grow.findings(R.GF{s, qs, qts, qus, eps, ces, rgs})))])}} : List<&2, String>}
