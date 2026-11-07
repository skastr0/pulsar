# engine/Delta-LAWS.bend - laws for Delta.bend, the per-sha delta. Filled in
# Delta-PROOF.bend; gate: `bend engine/PROOF.bend --verdict`.
#
# The laws are about Dl.run, the function the binary runs on the decoded rows. kb, kh, mb
# and mh are the KB, KH, MB and MH rows, in any order. Two rows have the same key when hi,
# lo and m agree (Same). Every law holds whenever the run printed a delta (run == Some):
# the run refuses when a sorted side is not strictly ascending or a walk runs out of fuel,
# so completeness is relative to that certificate, which the binary checks every run.
#
# Not covered by any law: Delta.decode (rows to kb/kh/mb/mh; fixtures/delta*), the
# number formatting in Dl.lines, and what the `unchanged` count means beyond its
# definition (matched head keys with cls != 1, Dr.same).

import Base
import ../LAWS.bend as TL
import ./Delta.bend as D

def In(-A: Data, xs: List<&2, A>, x: A) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == x : A}, In(A, t, x)>

def Same(a: D.Kr, b: D.Kr) -> Data:
  TL.And({D.Kr.hi(a) == D.Kr.hi(b) : U32}, TL.And({D.Kr.lo(a) == D.Kr.lo(b) : U32}, {D.Kr.m(a) == D.Kr.m(b) : U32}))

# Some row of xs has x's key.
def Has(xs: List<&2, D.Kr>, x: D.Kr) -> Data:
  TL.Ex(D.Kr, y => TL.And(In(D.Kr, xs, y), Same(y, x)))

def Run(kb: List<&2, D.Kr>, kh: List<&2, D.Kr>, mb: List<&2, D.Kr>, mh: List<&2, D.Kr>) -> Maybe<D.DOut>:
  D.Dl.run(D.DIn{kb, kh, mb, mh})

def Added(o: D.DOut) -> List<&2, D.Kr>:
  match o:
    case D.DOut{ad, al, cv, rm, sm, wo, be}:
      ad

def Allowed(o: D.DOut) -> List<&2, D.Kr>:
  match o:
    case D.DOut{ad, al, cv, rm, sm, wo, be}:
      al

def Cov(o: D.DOut) -> List<&2, D.Kr>:
  match o:
    case D.DOut{ad, al, cv, rm, sm, wo, be}:
      cv

def Removed(o: D.DOut) -> List<&2, D.Kr>:
  match o:
    case D.DOut{ad, al, cv, rm, sm, wo, be}:
      rm

def Worse(o: D.DOut) -> List<&2, D.Mv>:
  match o:
    case D.DOut{ad, al, cv, rm, sm, wo, be}:
      wo

def Better(o: D.DOut) -> List<&2, D.Mv>:
  match o:
    case D.DOut{ad, al, cv, rm, sm, wo, be}:
      be

# ---- soundness: every printed line is true of the rows ------------------------------------------
# D1. `KDA` (added): a plain head row.
law added_sound:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +h: In(D.Kr, Added(o), x)
  TL.And(In(D.Kr, kh, x), {D.Kr.v(x) == 0 : U32})

# D1b. and no base row has its key.
law added_fresh:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +h: In(D.Kr, Added(o), x)
  for +hk: Has(kb, x)
  Empty

# D2. `KDL` (allowed): a head row a decision allows (cls 2).
law allowed_sound:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +h: In(D.Kr, Allowed(o), x)
  TL.And(In(D.Kr, kh, x), {D.Kr.v(x) == 2 : U32})

# D2b. and no base row has its key.
law allowed_fresh:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +h: In(D.Kr, Allowed(o), x)
  for +hk: Has(kb, x)
  Empty

# D3. `KDC` (coverage): a head row that needs coverage (cls 1).
law coverage_sound:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +h: In(D.Kr, Cov(o), x)
  TL.And(In(D.Kr, kh, x), {D.Kr.v(x) == 1 : U32})

# D4. `KDR` (removed): a base row.
law removed_sound:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +h: In(D.Kr, Removed(o), x)
  In(D.Kr, kb, x)

# D4b. and no head row has its key.
law removed_fresh:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +h: In(D.Kr, Removed(o), x)
  for +hk: Has(kh, x)
  Empty

# D5. `KDW` (worsened): a base and a head measure row with the same key, head value above.
law worsened_sound:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +a: D.Kr
  for +b: D.Kr
  for +h: In(D.Mv, Worse(o), D.Mv{a, b})
  TL.And(TL.And(In(D.Kr, mb, a), In(D.Kr, mh, b)), TL.And(Same(a, b), {U32.is_gt(D.Kr.v(b), D.Kr.v(a)) == True{} : Bool}))

# D6. `KDI` (improved): the same, head value below.
law improved_sound:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +a: D.Kr
  for +b: D.Kr
  for +h: In(D.Mv, Better(o), D.Mv{a, b})
  TL.And(TL.And(In(D.Kr, mb, a), In(D.Kr, mh, b)), TL.And(Same(a, b), {U32.is_lt(D.Kr.v(b), D.Kr.v(a)) == True{} : Bool}))

# ---- completeness: every line that should be printed is ------------------------------------------
# C1. a plain head row is added, unless a base row has its key.
law added_complete:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +hx: In(D.Kr, kh, x)
  for +hv: {D.Kr.v(x) == 0 : U32}
  Either<&2, &2, In(D.Kr, Added(o), x), Has(kb, x)>

# C2. a head row of class 2 is allowed, unless a base row has its key.
law allowed_complete:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +hx: In(D.Kr, kh, x)
  for +hv: {D.Kr.v(x) == 2 : U32}
  Either<&2, &2, In(D.Kr, Allowed(o), x), Has(kb, x)>

# C3. every head row of class 1 is listed for coverage.
law coverage_complete:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +hx: In(D.Kr, kh, x)
  for +hv: {D.Kr.v(x) == 1 : U32}
  In(D.Kr, Cov(o), x)

# C4. a base row is removed, unless a head row has its key.
law removed_complete:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +x: D.Kr
  for +hx: In(D.Kr, kb, x)
  Either<&2, &2, In(D.Kr, Removed(o), x), Has(kh, x)>

# C5. a measure that went up between two rows with the same key is reported worsened.
law worsened_complete:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +a: D.Kr
  for +b: D.Kr
  for +ha: In(D.Kr, mb, a)
  for +hb: In(D.Kr, mh, b)
  for +hs: Same(a, b)
  for +hv: {U32.is_gt(D.Kr.v(b), D.Kr.v(a)) == True{} : Bool}
  In(D.Mv, Worse(o), D.Mv{a, b})

# C6. and one that went down is reported improved.
law improved_complete:
  for +kb: List<&2, D.Kr>
  for +kh: List<&2, D.Kr>
  for +mb: List<&2, D.Kr>
  for +mh: List<&2, D.Kr>
  for +o: D.DOut
  for +e: {Run(kb, kh, mb, mh) == Some{o} : Maybe<D.DOut>}
  for +a: D.Kr
  for +b: D.Kr
  for +ha: In(D.Kr, mb, a)
  for +hb: In(D.Kr, mh, b)
  for +hs: Same(a, b)
  for +hv: {U32.is_lt(D.Kr.v(b), D.Kr.v(a)) == True{} : Bool}
  In(D.Mv, Better(o), D.Mv{a, b})

# ---- the printed lines -------------------------------------------------------------------------------
# E1. header, KDA, KDL, KDC, KDR, KDW, KDI, then the KDS counts.
law lines_shape:
  for +ad: List<&2, D.Kr>
  for +al: List<&2, D.Kr>
  for +cv: List<&2, D.Kr>
  for +rm: List<&2, D.Kr>
  for +sm: U32
  for +wo: List<&2, D.Mv>
  for +be: List<&2, D.Mv>
  {D.Dl.lines(D.DOut{ad, al, cv, rm, sm, wo, be}) == Con{"pulsar-delta 0", List.append(&2, String, D.Dp.keys("KDA", ad), List.append(&2, String, D.Dp.keys("KDL", al), List.append(&2, String, D.Dp.keys("KDC", cv), List.append(&2, String, D.Dp.keys("KDR", rm), List.append(&2, String, D.Dp.moves("KDW", wo), List.append(&2, String, D.Dp.moves("KDI", be), Con{D.Dp.line("KDS", [D.Dp.len(ad), D.Dp.len(al), D.Dp.len(cv), D.Dp.len(rm), sm, D.Dp.plen(wo), D.Dp.plen(be)]), Nil{}}))))))} : List<&2, String>}
