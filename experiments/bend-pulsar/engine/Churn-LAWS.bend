# engine/Churn-LAWS.bend - laws for Churn.bend, per-function churn (read by Hotspot
# through MetricsIn). Filled in Churn-PROOF.bend; gate: `bend engine/PROOF.bend --verdict`.
#
# The counted rows are Churn.list(rows): the fn of every `CFN c fn t` row with
# t > 0, fn < 2^24 and c not a bot commit, a bot commit being one with a
# `C c a d` row whose author has an `A a 1` row (Churn.bend's header; the two
# sets are Scope.set tries, exact by Scope-LAWS SC1-SC2). The laws say the
# reported list is exactly the tally of those rows.
#
# Not covered by any law: the order of the list (id order when the untrusted
# sort is right, which fixtures check) and that each function appears once.

import Base
import ../LAWS.bend as TL
import ./Hotspot.bend as H
import ./Rows.bend as R
import ./Churn.bend as C

# x is an element of the list.
def In(xs: List<&2, H.Ch>, x: H.Ch) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == x : H.Ch}, In(t, x)>

# CH1. a reported Ch{fn, n}: n is the number of counted rows for fn, and not 0.
law churn_sound:
  for +rows: List<&2, R.Row>
  for +fn: U32
  for +n: Nat
  for h: In(C.Churn.of(rows), H.Ch{fn, n})
  TL.And({n == TL.Count(C.Churn.list(rows), fn) : Nat}, {Nat.is_eq(n, 0n) == False{} : Bool})

# CH2. every function with a counted row is reported, with that count.
law churn_complete:
  for +rows: List<&2, R.Row>
  for +fn: U32
  for +hm: TL.Mem(C.Churn.list(rows), fn)
  In(C.Churn.of(rows), H.Ch{fn, TL.Count(C.Churn.list(rows), fn)})
