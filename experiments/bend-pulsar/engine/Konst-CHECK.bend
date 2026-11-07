# bend Konst-CHECK.bend - constant-argument rule on hand-written facts.
#   20 is a partition lookup (class 1002), 21 is not. Sites: 0 calls 20 with a literal
#   at pos 0; 1 calls 20 with a variable; 2 calls 21 with a literal; 3 calls 20 with a
#   literal at pos 1 only. Rule 7 (class 1002, pos 0) -> site 0 only.
import Base
import ./ClassCtx.bend as X
import ./Konst.bend as K

def main() -> List<&2, String>:
  K.Konst.lines(K.KF{[X.Cs{0, 5, 20, 0, 0}, X.Cs{1, 5, 20, 0, 0}, X.Cs{2, 6, 21, 0, 0}, X.Cs{3, 6, 20, 1, 0}], [X.Cl{20, 1002}, X.Cl{21, 3}], [K.Al{0, 0, 1}, K.Al{2, 0, 1}, K.Al{3, 1, 2}], [K.Rk{7, 1002, 0}]})
