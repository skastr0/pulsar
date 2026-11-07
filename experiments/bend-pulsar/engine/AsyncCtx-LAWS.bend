# engine/AsyncCtx-LAWS.bend - laws about AsyncCtx.bend. Proofs: AsyncCtx-PROOF.bend.
# Gate: `bend engine/AsyncCtx-PROOF.bend --verdict`.
#
# Every law is about the functions pulsar-engine runs: the per-row findings (Ac.xrule,
# Ac.drule), every row's (AsyncCtx.excl, AsyncCtx.dropped) and the output (AsyncIn.lines).
# Soundness and completeness are stated in fact membership, never in terms of the sets
# (Scope.set) the detector builds.
#
#   - exclusive row RX r inner outer: a finding Ad{r, site, fn} is exactly a CS fact at site,
#     fn whose callee has a CL fact of class inner, an AW fact for site, and an XN fact
#     (site, x) where x is a CS site whose callee has a CL fact of class outer.
#   - dropped row RD r c a: a finding Ad{r, site, fn} is exactly a DV fact for site and an EP
#     fact for fn, with either a CS fact at site, fn whose callee has class c, or (a = 1) a CE
#     fact at site, fn to a target whose FC fact has bit 1 (async).
#   - order: the section runs only when CS and CE sites strictly ascend (Ac.cs_sorted,
#     Nc.ce_sorted); otherwise it refuses (E4, E5), so what is printed is a function of the facts.
#
# Not covered, by design: decoding the rows (AsyncCtx.decode, shown by fixtures) and the
# decimal formatting inside the lines.

import Base
import ../LAWS.bend as TL
import ./ClassCtx.bend as X
import ./ClassCtx-LAWS.bend as XL
import ./Fanout.bend as F
import ./Fanout-LAWS.bend as FL
import ./FnCtx.bend as N
import ./FnCtx-LAWS.bend as NL
import ./AsyncCtx.bend as A
import ./Rows.bend as W

def MemAd(xs: List<&2, A.Ad>, m: A.Ad) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : A.Ad}, MemAd(t, m)>

def MemCs(xs: List<&2, X.Cs>, m: X.Cs) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : X.Cs}, MemCs(t, m)>

def MemXn(xs: List<&2, A.Xn>, m: A.Xn) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : A.Xn}, MemXn(t, m)>

def MemRx(xs: List<&2, A.Rx>, m: A.Rx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : A.Rx}, MemRx(t, m)>

def MemRd(xs: List<&2, A.Rd>, m: A.Rd) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : A.Rd}, MemRd(t, m)>

# The CS fact c is at site x and its callee has class outer.
def OAt(c: X.Cs, +cls: List<&2, X.Cl>, +x: U32, +outer: U32) -> Data:
  match c:
    case X.Cs{site, fn, callee, ld, ctx}:
      TL.And({site == x : U32}, XL.ClHas(cls, callee, outer))

# Site s lies inside the arguments of a CS site whose callee has class outer.
def XOut(css: List<&2, X.Cs>, cls: List<&2, X.Cl>, xns: List<&2, A.Xn>, s: U32, outer: U32) -> Data:
  TL.Ex(U32, x => TL.And(MemXn(xns, A.Xn{s, x}), TL.Ex(X.Cs, c2 => TL.And(MemCs(css, c2), OAt(c2, cls, x, outer)))))

# Finding y of exclusive rule r from the CS fact c.
def XAt(c: X.Cs, +css: List<&2, X.Cs>, +cls: List<&2, X.Cl>, +aws: List<&2, U32>, +xns: List<&2, A.Xn>, +r: U32, +inner: U32, +outer: U32, +y: A.Ad) -> Data:
  match c:
    case X.Cs{site, fn, callee, ld, ctx}:
      TL.And({A.Ad{r, site, fn} == y : A.Ad}, TL.And(XL.ClHas(cls, callee, inner), TL.And(TL.Mem(aws, site), XOut(css, cls, xns, site, outer))))

# Finding y of dropped rule r from the CS fact c (class branch).
def DAt(c: X.Cs, +cls: List<&2, X.Cl>, +dvs: List<&2, U32>, +eps: List<&2, U32>, +r: U32, +k: U32, +y: A.Ad) -> Data:
  match c:
    case X.Cs{site, fn, callee, ld, ctx}:
      TL.And({A.Ad{r, site, fn} == y : A.Ad}, TL.And(XL.ClHas(cls, callee, k), TL.And(TL.Mem(dvs, site), TL.Mem(eps, fn))))

# Finding y of dropped rule r from the CE fact e (async branch).
def DEAt(e: F.Ce, +fcs: List<&2, N.Fc>, +dvs: List<&2, U32>, +eps: List<&2, U32>, +r: U32, +y: A.Ad) -> Data:
  match e:
    case F.Ce{site, fn, target, node, ld, ctx}:
      TL.And({A.Ad{r, site, fn} == y : A.Ad}, TL.And(NL.FnHas(fcs, target, 1, 0), TL.And(TL.Mem(dvs, site), TL.Mem(eps, fn))))

# ---- exclusive rules ---------------------------------------------------------------------------
# A1. soundness: each finding of an RX row is justified by CS, CL, AW and XN facts.
law ac_xrule_sound:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +r: U32
  for +inner: U32
  for +outer: U32
  for +y: A.Ad
  for hm: MemAd(A.Ac.xrule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, A.Rx{r, inner, outer}), y)
  TL.Ex(X.Cs, c => TL.And(MemCs(css, c), XAt(c, css, cls, aws, xns, r, inner, outer, y)))

# A2. completeness: every such combination of facts is a finding.
law ac_xrule_complete:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +r: U32
  for +inner: U32
  for +outer: U32
  for +site: U32
  for +fn: U32
  for +callee: U32
  for +ld: U32
  for +ctx: U32
  for +x: U32
  for +f2: U32
  for +c2: U32
  for +ld2: U32
  for +ctx2: U32
  for hc: MemCs(css, X.Cs{site, fn, callee, ld, ctx})
  for hi: XL.ClHas(cls, callee, inner)
  for ha: TL.Mem(aws, site)
  for hx: MemXn(xns, A.Xn{site, x})
  for ho: MemCs(css, X.Cs{x, f2, c2, ld2, ctx2})
  for hoc: XL.ClHas(cls, c2, outer)
  MemAd(A.Ac.xrule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, A.Rx{r, inner, outer}), A.Ad{r, site, fn})

# ---- dropped rules -----------------------------------------------------------------------------
# A3. soundness: each finding of an RD row is a DV and an EP fact with a CS fact of the class, or
# (a = 1) a CE fact to an async function.
law ac_drule_sound:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +r: U32
  for +k: U32
  for +a: U32
  for +y: A.Ad
  for hm: MemAd(A.Ac.drule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, A.Rd{r, k, a}), y)
  Either<&2, &2, TL.Ex(X.Cs, c => TL.And(MemCs(css, c), DAt(c, cls, dvs, eps, r, k, y))), TL.And({U32.is_eq(a, 1) == True{} : Bool}, TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), DEAt(e, fcs, dvs, eps, r, y))))>

# A4. completeness, class branch.
law ac_drule_complete_class:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +r: U32
  for +k: U32
  for +a: U32
  for +site: U32
  for +fn: U32
  for +callee: U32
  for +ld: U32
  for +ctx: U32
  for hc: MemCs(css, X.Cs{site, fn, callee, ld, ctx})
  for hk: XL.ClHas(cls, callee, k)
  for hd: TL.Mem(dvs, site)
  for he: TL.Mem(eps, fn)
  MemAd(A.Ac.drule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, A.Rd{r, k, a}), A.Ad{r, site, fn})

# A5. completeness, async branch.
law ac_drule_complete_async:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +r: U32
  for +k: U32
  for +a: U32
  for +site: U32
  for +fn: U32
  for +target: U32
  for +node: U32
  for +ld: U32
  for +ctx: U32
  for +file: U32
  for +tctx: U32
  for ha: {U32.is_eq(a, 1) == True{} : Bool}
  for hc: FL.MemCe(ces, F.Ce{site, fn, target, node, ld, ctx})
  for hf: NL.MemFc(fcs, N.Fc{target, file, tctx})
  for ht: {N.Nc.ok(1, 0, tctx) == True{} : Bool}
  for hd: TL.Mem(dvs, site)
  for he: TL.Mem(eps, fn)
  MemAd(A.Ac.drule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, A.Rd{r, k, a}), A.Ad{r, site, fn})

# ---- every row -----------------------------------------------------------------------------------
# A6. the exclusive findings are the union of the RX rows' findings.
law ac_excl_sound:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +y: A.Ad
  for hm: MemAd(A.AsyncCtx.excl(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}), y)
  TL.Ex(A.Rx, k => TL.And(MemRx(rxs, k), MemAd(A.Ac.xrule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, k), y)))

law ac_excl_complete:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +k: A.Rx
  for +y: A.Ad
  for hk: MemRx(rxs, k)
  for hm: MemAd(A.Ac.xrule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, k), y)
  MemAd(A.AsyncCtx.excl(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}), y)

# A7. the dropped findings are the union of the RD rows' findings.
law ac_dropped_sound:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +y: A.Ad
  for hm: MemAd(A.AsyncCtx.dropped(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}), y)
  TL.Ex(A.Rd, k => TL.And(MemRd(rds, k), MemAd(A.Ac.drule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, k), y)))

law ac_dropped_complete:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for +k: A.Rd
  for +y: A.Ad
  for hk: MemRd(rds, k)
  for hm: MemAd(A.Ac.drule(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}, k), y)
  MemAd(A.AsyncCtx.dropped(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}), y)

# ---- output --------------------------------------------------------------------------------------
# A8. the printed lines are built from the findings and nothing else: the header, one AXX line
# per exclusive finding in order, one ADX line per dropped finding in order, the count.
law ac_lines_shape:
  for +f: A.AF
  {A.AsyncCtx.lines(f) == Con{"pulsar-async 0", List.append(&2, String, A.Ac.lines("AXX", A.AsyncCtx.excl(f)), List.append(&2, String, A.Ac.lines("ADX", A.AsyncCtx.dropped(f)), [A.Ac.count(A.AsyncCtx.excl(f), A.AsyncCtx.dropped(f))]))} : List<&2, String>}

# ---- the section ---------------------------------------------------------------------------------
# E1. with an RX or RD row, the section is AsyncIn.go of the decoded facts.
law async_on:
  for +rows: List<&2, W.Row>
  for on: {A.AsyncIn.on(rows) == True{} : Bool}
  {A.AsyncIn.lines(rows) == A.AsyncIn.go(A.AsyncCtx.decode(rows)) : Maybe<List<&2, String>>}

# E2. decoded facts with CS and CE in strict site order print AsyncCtx.lines.
law async_go_lines:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for hs: {A.Ac.cs_sorted(css) == True{} : Bool}
  for hc: {N.Nc.ce_sorted(ces) == True{} : Bool}
  {A.AsyncIn.go(Some{A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}) == Some{A.AsyncCtx.lines(A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds})} : Maybe<List<&2, String>>}

# E3. facts that do not decode refuse the section.
law async_go_refuses:
  {A.AsyncIn.go(None{}) == None{} : Maybe<List<&2, String>>}

# E4. CS out of strict site order refuses the section (exit 2).
law async_cs_unsorted_refuses:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for h: {A.Ac.cs_sorted(css) == False{} : Bool}
  {A.AsyncIn.go(Some{A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}) == None{} : Maybe<List<&2, String>>}

# E5. CE out of strict site order refuses the section (exit 2).
law async_ce_unsorted_refuses:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +aws: List<&2, U32>
  for +xns: List<&2, A.Xn>
  for +dvs: List<&2, U32>
  for +eps: List<&2, U32>
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +rxs: List<&2, A.Rx>
  for +rds: List<&2, A.Rd>
  for h: {N.Nc.ce_sorted(ces) == False{} : Bool}
  {A.AsyncIn.go(Some{A.AF{css, cls, aws, xns, dvs, eps, ces, fcs, rxs, rds}}) == None{} : Maybe<List<&2, String>>}

# E6. with no RX or RD row no rule of this kind is on: no lines.
law async_off:
  for +rows: List<&2, W.Row>
  for off: {A.AsyncIn.on(rows) == False{} : Bool}
  {A.AsyncIn.lines(rows) == Some{Nil{}} : Maybe<List<&2, String>>}
