# bend Untested-CHECK.bend - untested data access on hand-written facts.
#   FnM: fn 1, 2, 3, 4, 5; fn 5 is a test function. QS sites in fn 1, 2, 3, 5 (fn 1 twice).
#   Coverage data (CrM) for fn 1, 2, 4. CRAP finding for fn 1 only.
# Rule 60 -> UX 60 1 1 (CRAP), UX 60 3 2 (no data); not fn 2 (data, no finding), not fn 4
#   (no query site), not fn 5 (test). Rule 61 repeats the same lines.
import Base
import ./Metrics.bend as M
import ./Crap.bend as C
import ./Untested.bend as U

def T.ms() -> List<&2, M.FnM>:
  [M.FnM{1, 9n, 1n, 1n, 10n, False{}}, M.FnM{2, 1n, 0n, 1n, 3n, False{}}, M.FnM{3, 1n, 0n, 1n, 3n, False{}}, M.FnM{4, 1n, 0n, 1n, 3n, False{}}, M.FnM{5, 1n, 0n, 1n, 3n, True{}}]

def main() -> List<&2, String>:
  U.Untested.lines(T.ms(), [M.Finding{5, 1, 90n, 30n}], [C.CrM{1, 9n, 0n, 10n, 90n, False{}}, C.CrM{2, 1n, 3n, 3n, 1n, False{}}, C.CrM{4, 1n, 0n, 3n, 2n, False{}}], U.UF{[1, 1, 2, 3, 5], [60, 61]})
