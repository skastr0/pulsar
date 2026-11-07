# engine/Hotspot-LAWS.bend - laws about Hotspot.bend. Filled in Hotspot-PROOF.bend.
# Gate: `bend engine/Hotspot-PROOF.bend --verdict`.
#
# The laws are about the shipped Hs.find, Hs.any, Hs.base_ok and Hotspot.lines.
# MemCh, Witness and Sound only describe inputs and outputs. Not covered, by design:
# Churn.bend (rows to the Ch list) and the EV formatting.

import Base
import ./Metrics.bend as M
import ./Hotspot.bend as H
import ./Metrics-LAWS.bend as ML

def MemCh(xs: List<&2, H.Ch>, m: H.Ch) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : H.Ch}, MemCh(t, m)>

# Some base finding is for `fn` and is one composite `k` accepts.
def Witness(+k: U32, +fn: U32, base: List<&2, M.Finding>) -> Data:
  match base:
    case Nil{}:
      Empty
    case Con{M.Finding{rule, f, v, t}, rest}:
      Either<&2, &2, ML.And({U32.is_eq(f, fn) == True{} : Bool}, {H.Hs.base_ok(k, rule) == True{} : Bool}), Witness(k, fn, rest)>

# A composite finding: kind k, churn over the threshold, the function's churn, and
# a base finding for the same function.
def Sound(+k: U32, +thr: Nat, chs: List<&2, H.Ch>, +base: List<&2, M.Finding>, x: M.Finding) -> Data:
  match x:
    case M.Finding{+rule, +fn, +v, +t}:
      ML.And({rule == k : U32}, ML.And({Nat.is_gt(v, t) == True{} : Bool}, ML.And({t == thr : Nat}, ML.And(MemCh(chs, H.Ch{fn, v}), Witness(k, fn, base)))))

# E1. the output is the hotspots over Metrics' findings, then the risky changes over CRAP's.
law hs_lines_shape:
  for +thr: Nat
  for +chs: List<&2, H.Ch>
  for +m: List<&2, M.Finding>
  for +c: List<&2, M.Finding>
  {H.Hotspot.lines(thr, chs, m, c) == List.append(&2, String, H.Hs.out(H.Hs.find(6, thr, chs, m), m), H.Hs.out(H.Hs.find(7, thr, chs, c), c)) : List<&2, String>}

# S1. sound: both inputs over threshold, and both named.
law hs_sound:
  for +k: U32
  for +thr: Nat
  for +chs: List<&2, H.Ch>
  for +base: List<&2, M.Finding>
  for +x: M.Finding
  for hm: ML.MemF(H.Hs.find(k, thr, chs, base), x)
  Sound(k, thr, chs, base, x)

# S2. complete: churn over the threshold and a base finding give the composite.
law hs_complete:
  for +k: U32
  for +thr: Nat
  for +chs: List<&2, H.Ch>
  for +base: List<&2, M.Finding>
  for +fn: U32
  for +n: Nat
  for hm: MemCh(chs, H.Ch{fn, n})
  for h: {Nat.is_gt(n, thr) == True{} : Bool}
  for +w: Witness(k, fn, base)
  ML.MemF(H.Hs.find(k, thr, chs, base), M.Finding{k, fn, n, thr})

# K1. a hotspot's base is a complexity finding: cyclomatic, nesting or NPath; not length or CRAP.
law hotspot_bases:
  ML.And({H.Hs.base_ok(6, 1) == True{} : Bool}, ML.And({H.Hs.base_ok(6, 2) == True{} : Bool}, ML.And({H.Hs.base_ok(6, 3) == True{} : Bool}, ML.And({H.Hs.base_ok(6, 4) == False{} : Bool}, {H.Hs.base_ok(6, 5) == False{} : Bool}))))

# K2. a risky change's base is a CRAP finding, and only that.
law risky_bases:
  ML.And({H.Hs.base_ok(7, 5) == True{} : Bool}, ML.And({H.Hs.base_ok(7, 1) == False{} : Bool}, ML.And({H.Hs.base_ok(7, 2) == False{} : Bool}, ML.And({H.Hs.base_ok(7, 3) == False{} : Bool}, {H.Hs.base_ok(7, 4) == False{} : Bool}))))
