# bend Hot-CHECK.bend - hot-path composites on hand-written facts.
#   EP: fn 1 (request handler). CE: 1 -> 2 (site 50), 2 -> 3 (site 51), 7 -> 4 (site 52).
#   QS: site 10 in fn 3, site 11 in fn 4, site 12 in fn 2.
#   SQL findings: rule 4 on sites 10, 11 (twice: two columns), 12; rule 1 on site 12.
#   NX: rule 9 at site 20 in fn 2, at site 21 in fn 7.  KX: rule 7 at site 30 in fn 1.
# Rule 100: lane 1 base 4 depth 2 -> sites 10 (fn 3), 12 (fn 2); not 11 (fn 4, from fn 7 only)
# Rule 101: lane 1 base 4 depth 1 -> site 12 only (fn 3 needs 2 edges)
# Rule 102: lane 2 base 9 depth 3 -> site 20 (fn 2); not 21 (fn 7)
# Rule 103: lane 3 base 7 depth 0 -> site 30 (fn 1 is the entry itself)
# Rule 104: lane 5 base 4 depth 9 -> nothing (no such lane)
import Base
import ./Sql.bend as Q
import ./Fanout.bend as F
import ./Konst.bend as K
import ./Hot.bend as H

def T.f() -> H.HF:
  H.HF{[H.Ep{1, 1}], [F.Ce{50, 1, 2, 0, 0, 0}, F.Ce{51, 2, 3, 0, 0, 0}, F.Ce{52, 7, 4, 0, 0, 0}], [Q.Qs{10, 0, 3, 0, 1, 0}, Q.Qs{11, 0, 4, 0, 1, 0}, Q.Qs{12, 0, 2, 0, 1, 0}], [Q.Sx{4, 10, 1, 1, 0}, Q.Sx{4, 11, 1, 1, 0}, Q.Sx{4, 11, 1, 2, 0}, Q.Sx{4, 12, 1, 1, 0}, Q.Sx{1, 12, 0, 0, 0}], [F.Nx{9, 20, 2, 5, 0}, F.Nx{9, 21, 7, 5, 0}], [K.Kx{7, 30, 1, 5, 0}], [H.Rh{100, 1, 4, 2}, H.Rh{101, 1, 4, 1}, H.Rh{102, 2, 9, 3}, H.Rh{103, 3, 7, 0}, H.Rh{104, 5, 4, 9}]}

def main() -> List<&2, String>:
  H.Hot.lines(T.f())
