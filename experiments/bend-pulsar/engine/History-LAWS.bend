# engine/History-LAWS.bend - laws for History.bend: file churn, churn concentration
# and co-change. Filled in History-PROOF.bend; gate: `bend engine/PROOF.bend --verdict`.
#
# Every finding comes from an untrusted search and is kept only when its checker
# accepts it; these laws say what a kept finding means, in terms of the facts.
# The sets they name are History.bend's (Scope.set tries, exact by Scope-LAWS
# SC1-SC2):
#   Ch.hset(ch)      human commits: C rows whose author has no `A a 1` row
#   Ch.nbset(ch, r)  non-bulk commits: at most Rules.bulk(r) CF rows
#   Ch.fl(...)       the file of every CF row with a human commit and a production file
#   Ch.cl(...)       the same, also requiring a non-bulk commit (co-change mining)
#
# Not covered by any law: Hist.decode (rows to facts; shown against
# engine/fixtures/history*), and the formatting of numbers in Hist.lines.

import Base
import ../LAWS.bend as TL
import ../Graph.bend as G
import ./Scope.bend as S
import ./History.bend as Y

# Some `CF c f _ _` fact.
def CfHas(cfs: List<&2, Y.Cf>, c: U32, f: U32) -> Data:
  match cfs:
    case Nil{}:
      Empty
    case Con{Y.Cf{c2, f2, ad, de}, t}:
      Either<&2, &2, TL.And({c2 == c : U32}, {f2 == f : U32}), CfHas(t, c, f)>

# x is an element of the list (findings are lists of records).
def In(-A: Data, xs: List<&2, A>, x: A) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == x : A}, In(A, t, x)>

# ---- file churn -----------------------------------------------------------------------------------
# F1. a reported `CHF x k`: k is the number of counted CF rows for x, and not 0.
law file_churn:
  for +ch: Y.CH
  for +n: U32
  for +pt: G.Tr
  for +x: U32
  for +k: U32
  for h: In(Y.Ck, Y.Hist.files(n, Y.Hist.flt(ch, pt)), Y.Ck{x, k})
  TL.And({k == U32.from_nat(TL.Count(Y.Ch.fl(Y.CH.cfs(ch), Y.Ch.hset(ch), pt), x)) : U32}, {U32.is_eq(k, 0) == False{} : Bool})

# ---- churn concentration (history.churn-concentration) ----------------------------------------------
# X1. a reported `CHX k nf top total ws`: ws is k distinct files, k is at most
# Rules.top % of the nf churned files (rounded up: 100k < nf * top + 100), the
# files hold `top` of the `total` counted rows, and top is at least Rules.share %
# of total, which is not 0.
law concentration:
  for +ch: Y.CH
  for +r: Y.Rules
  for +n: U32
  for +pt: G.Tr
  for +k: U32
  for +nf: U32
  for +top: U32
  for +total: U32
  for +ws: List<&2, U32>
  for h: In(Y.Cx, Y.Hist.conc(ch, r, n, pt), Y.Cx{k, nf, top, total, ws})
  TL.And(TL.And({nf == U32.from_nat(List.length(&2, Y.Ck, Y.Hist.files(n, Y.Hist.flt(ch, pt)))) : U32}, {total == Y.Hist.total(ch, pt) : U32}), TL.And(TL.And({k == Y.Hist.len(ws) : U32}, {Y.Hist.asc(ws, 0, True{}) == True{} : Bool}), TL.And(TL.And({U32.is_lt(U32.mul(k, 100), U32.add(U32.mul(nf, Y.Rules.top(r)), 100)) == True{} : Bool}, {top == Y.Hist.sumc(ws, Y.Hist.flt(ch, pt)) : U32}), TL.And({U32.is_ge(total, 1) == True{} : Bool}, {U32.is_ge(U32.mul(100, top), U32.mul(Y.Rules.share(r), total)) == True{} : Bool}))))

# ---- co-change (history.co-change) --------------------------------------------------------------------
# C1. a reported pair `CHP a b sup na nb ws`: a < b are production files, and
# ws is sup distinct commits, sup at least Rules.sup.
law cochange_support:
  for +ch: Y.CH
  for +r: Y.Rules
  for +pt: G.Tr
  for +adj: List<&2, List<&2, U32>>
  for +a: U32
  for +b: U32
  for +sup: U32
  for +na: U32
  for +nb: U32
  for +ws: List<&2, U32>
  for h: In(Y.Cp, Y.Hist.pairs(ch, r, pt, adj), Y.Cp{a, b, sup, na, nb, ws})
  TL.And(TL.And({U32.is_lt(a, b) == True{} : Bool}, TL.And({S.Scope.has(pt, a) == True{} : Bool}, {S.Scope.has(pt, b) == True{} : Bool})), TL.And(TL.And({sup == Y.Hist.len(ws) : U32}, {U32.is_ge(sup, Y.Rules.sup(r)) == True{} : Bool}), {Y.Hist.asc(ws, 0, True{}) == True{} : Bool}))

# C2. every witness commit has a CF row for a and one for b, is human, and is
# not bulk: the pair really co-changed in each of the sup commits.
law cochange_witness:
  for +ch: Y.CH
  for +r: Y.Rules
  for +pt: G.Tr
  for +adj: List<&2, List<&2, U32>>
  for +a: U32
  for +b: U32
  for +sup: U32
  for +na: U32
  for +nb: U32
  for +ws: List<&2, U32>
  for h: In(Y.Cp, Y.Hist.pairs(ch, r, pt, adj), Y.Cp{a, b, sup, na, nb, ws})
  for +c: U32
  for hm: TL.Mem(ws, c)
  TL.And(TL.And(CfHas(Y.CH.cfs(ch), c, a), CfHas(Y.CH.cfs(ch), c, b)), TL.And({S.Scope.has(Y.Ch.hset(ch), c) == True{} : Bool}, {S.Scope.has(Y.Ch.nbset(ch, r), c) == True{} : Bool}))

# C3. no import edge joins a and b, in either direction.
law cochange_no_import:
  for +ch: Y.CH
  for +r: Y.Rules
  for +pt: G.Tr
  for +adj: List<&2, List<&2, U32>>
  for +a: U32
  for +b: U32
  for +sup: U32
  for +na: U32
  for +nb: U32
  for +ws: List<&2, U32>
  for h: In(Y.Cp, Y.Hist.pairs(ch, r, pt, adj), Y.Cp{a, b, sup, na, nb, ws})
  for hs: Either<&2, &2, TL.Succ(adj, a, b), TL.Succ(adj, b, a)>
  Empty

# C4. na and nb are the numbers of mined CF rows (human, non-bulk, production)
# for a and for b, and 100 * sup >= Rules.conf * min(na, nb).
law cochange_confidence:
  for +ch: Y.CH
  for +r: Y.Rules
  for +pt: G.Tr
  for +adj: List<&2, List<&2, U32>>
  for +a: U32
  for +b: U32
  for +sup: U32
  for +na: U32
  for +nb: U32
  for +ws: List<&2, U32>
  for h: In(Y.Cp, Y.Hist.pairs(ch, r, pt, adj), Y.Cp{a, b, sup, na, nb, ws})
  TL.And(TL.And({na == U32.from_nat(TL.Count(Y.Ch.cl(Y.CH.cfs(ch), Y.Ch.hset(ch), Y.Ch.nbset(ch, r), pt), a)) : U32}, {nb == U32.from_nat(TL.Count(Y.Ch.cl(Y.CH.cfs(ch), Y.Ch.hset(ch), Y.Ch.nbset(ch, r), pt), b)) : U32}), {U32.is_ge(U32.mul(100, sup), U32.mul(Y.Rules.conf(r), Y.Hist.min(na, nb))) == True{} : Bool})

# ---- the entry point ---------------------------------------------------------------------------------
# E1. valid facts: the result is exactly these detector functions.
law run_is_detectors:
  for +ch: Y.CH
  for +r: Y.Rules
  for +n: U32
  for +pt: G.Tr
  for +adj: List<&2, List<&2, U32>>
  for ok: {Y.Hist.valid(ch, r, n) == True{} : Bool}
  {Y.Hist.run(ch, r, n, pt, adj) == Some{Y.COut{Y.Hist.files(n, Y.Hist.flt(ch, pt)), Y.Hist.conc(ch, r, n, pt), Y.Hist.pairs(ch, r, pt, adj)}} : Maybe<Y.COut>}

# E2. invalid facts are refused, never analysed.
law run_refuses_invalid:
  for +ch: Y.CH
  for +r: Y.Rules
  for +n: U32
  for +pt: G.Tr
  for +adj: List<&2, List<&2, U32>>
  for bad: {Y.Hist.valid(ch, r, n) == False{} : Bool}
  {Y.Hist.run(ch, r, n, pt, adj) == None{} : Maybe<Y.COut>}

# E3. the printed lines: header, one CHF per file, CHX, CHP, then the summary.
law lines_shape:
  for +r: Y.Rules
  for +files: List<&2, Y.Ck>
  for +cxs: List<&2, Y.Cx>
  for +cps: List<&2, Y.Cp>
  {Y.Hist.lines(r, Y.COut{files, cxs, cps}) == Con{"pulsar-history 0", List.append(&2, String, Y.CRep.cks("CHF", files), List.append(&2, String, Y.CRep.cxs(cxs), List.append(&2, String, Y.CRep.cps(cps), Con{Y.CRep.summary(r, files, cxs, cps), Nil{}})))} : List<&2, String>}
