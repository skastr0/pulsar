# bend Grow-CHECK.bend - unbounded growth on hand-written facts.
#   Tables 1 (events: pk col 10, unique index 0 on col 11) and 2 (a view).
#   EP fn 0; CE 0 -> 1. Fn 2 is not reached.
#   Reads of table 1: site 20 no LIMIT, no filter (unbounded); 21 with LIMIT; 22 pk bound;
#   23 index 0 bound by IN; 24 filters col 12 only (unbounded). Read of view 2 at 25.
#   Inserts into table 1: 30 in fn 1 (hot), 31 in fn 2 (not hot).
# Rule 7, depth 1 -> GX 7 20 1 30, GX 7 24 1 30.
import Base
import ./Sql.bend as Q
import ./Fanout.bend as F
import ./Hot.bend as H
import ./Grow.bend as R

def T.s() -> Q.Schema:
  Q.Schema{5, 0, [Q.Dt{1, 0, 0}, Q.Dt{2, 0, 8}], [Q.Dc{1, 10, 0, 1}, Q.Dc{1, 11, 1, 0}, Q.Dc{1, 12, 2, 0}], [Q.Di{0, 1, 1}], [Q.Dx{0, 0, 11}], [], []}

def T.qs() -> List<&2, Q.Qs>:
  [Q.Qs{20, 0, 1, 0, 1, 0}, Q.Qs{21, 0, 1, 0, 1, 1}, Q.Qs{22, 0, 1, 0, 1, 0}, Q.Qs{23, 0, 1, 0, 1, 0}, Q.Qs{24, 0, 1, 0, 1, 0}, Q.Qs{25, 0, 1, 0, 1, 0}, Q.Qs{30, 0, 1, 0, 2, 0}, Q.Qs{31, 0, 2, 0, 2, 0}]

def T.qts() -> List<&2, Q.Qt>:
  [Q.Qt{20, 1, 1}, Q.Qt{21, 1, 1}, Q.Qt{22, 1, 1}, Q.Qt{23, 1, 1}, Q.Qt{24, 1, 1}, Q.Qt{25, 2, 1}, Q.Qt{30, 1, 2}, Q.Qt{31, 1, 2}]

def T.qus() -> List<&2, Q.Qu>:
  [Q.Qu{22, 1, 10, 1}, Q.Qu{23, 1, 11, 3}, Q.Qu{24, 1, 12, 1}]

def main() -> List<&2, String>:
  R.Grow.lines(R.GF{T.s(), T.qs(), T.qts(), T.qus(), [H.Ep{0, 0}], [F.Ce{40, 0, 1, 0, 0, 0}], [R.Rg{7, 1}]})
