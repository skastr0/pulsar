# engine/Konst-LAWS.bend - laws about Konst.bend. Proofs: Konst-PROOF.bend.
# Gate: `bend engine/Konst-PROOF.bend --verdict`.
#
# Each finding of a rule row is a CS fact calling a symbol with a CL fact for the
# row's class, and an AL fact says that site's argument at the row's position is a
# constant (sound). Every such site is a finding (complete). Not covered, by design:
# decoding the rows.

import Base
import ../LAWS.bend as TL
import ./ClassCtx.bend as X
import ./ClassCtx-LAWS.bend as CL
import ./Fanout-LAWS.bend as FL
import ./Konst.bend as K

def MemKx(xs: List<&2, K.Kx>, m: K.Kx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : K.Kx}, MemKx(t, m)>

def MemAl(xs: List<&2, K.Al>, m: K.Al) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : K.Al}, MemAl(t, m)>

def MemRk(xs: List<&2, K.Rk>, m: K.Rk) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : K.Rk}, MemRk(t, m)>

# The AL fact a is about argument pos of site.
def AlAt(a: K.Al, +site: U32, +pos: U32) -> Data:
  match a:
    case K.Al{s2, p2, kind}:
      TL.And({s2 == site : U32}, {p2 == pos : U32})

# Finding y of rule r from the CS fact s.
def KAt(s: X.Cs, +cls: List<&2, X.Cl>, +c: U32, +als: List<&2, K.Al>, +r: U32, +pos: U32, +y: K.Kx) -> Data:
  match s:
    case X.Cs{site, fn, callee, ld, ctx}:
      TL.And(CL.ClHas(cls, callee, c), TL.And(TL.Ex(K.Al, a => TL.And(MemAl(als, a), AlAt(a, site, pos))), {K.Kx{r, site, fn, callee, pos} == y : K.Kx}))

law ko_rule_sound:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +als: List<&2, K.Al>
  for +r: U32
  for +c: U32
  for +pos: U32
  for +y: K.Kx
  for hm: MemKx(K.Ko.rule(css, cls, als, K.Rk{r, c, pos}), y)
  TL.Ex(X.Cs, s => TL.And(FL.MemCs(css, s), KAt(s, cls, c, als, r, pos, y)))

law ko_rule_complete:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +als: List<&2, K.Al>
  for +r: U32
  for +c: U32
  for +pos: U32
  for +site: U32
  for +fn: U32
  for +callee: U32
  for +ld: U32
  for +ctx: U32
  for +kind: U32
  for hm: FL.MemCs(css, X.Cs{site, fn, callee, ld, ctx})
  for hc: CL.ClHas(cls, callee, c)
  for ha: MemAl(als, K.Al{site, pos, kind})
  MemKx(K.Ko.rule(css, cls, als, K.Rk{r, c, pos}), K.Kx{r, site, fn, callee, pos})

law ko_findings_sound:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +als: List<&2, K.Al>
  for +rks: List<&2, K.Rk>
  for +y: K.Kx
  for hm: MemKx(K.Konst.findings(K.KF{css, cls, als, rks}), y)
  TL.Ex(K.Rk, k => TL.And(MemRk(rks, k), MemKx(K.Ko.rule(css, cls, als, k), y)))

law ko_findings_complete:
  for +css: List<&2, X.Cs>
  for +cls: List<&2, X.Cl>
  for +als: List<&2, K.Al>
  for +rks: List<&2, K.Rk>
  for +k: K.Rk
  for +y: K.Kx
  for hk: MemRk(rks, k)
  for hm: MemKx(K.Ko.rule(css, cls, als, k), y)
  MemKx(K.Konst.findings(K.KF{css, cls, als, rks}), y)

law ko_lines_shape:
  for +f: K.KF
  {K.Konst.lines(f) == Con{"pulsar-konst 0", List.append(&2, String, K.Ko.lines(K.Konst.findings(f)), ["KXS " ++ Nat.show(List.length(&2, K.Kx, K.Konst.findings(f)))])} : List<&2, String>}
