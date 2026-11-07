# Metrics-CHECK.bend - hand-written FN/CT rows through Metrics.run, normalised
# by `bend engine/Metrics-CHECK.bend`. Expected output is in the comments.
import Base
import ./Metrics.bend as M

def T.rows() -> List<&2, M.CtRow>:
  [M.CtRow{0, 1, 0, 1}, M.CtRow{0, 2, 1, 6}, M.CtRow{0, 3, 1, 2}, M.CtRow{0, 4, 1, 2}, M.CtRow{0, 5, 4, 1}, M.CtRow{0, 6, 5, 2}, M.CtRow{0, 7, 0, 4}, M.CtRow{0, 8, 7, 1}, M.CtRow{0, 9, 8, 2}, M.CtRow{1, 1, 0, 8}]

def T.fns() -> List<&2, M.Fn>:
  [M.Fn{0, 0, 4294967295, 12}, M.Fn{1, 0, 0, 3}]

def main() -> Maybe<&2, List<&2, String>>:
  do Maybe<&2, List<&2, String>>:
    ms : List<&2, M.FnM> <- M.Metrics.run(M.Rules{5n, 1n, 10n, 60n, 1000n}, T.fns(), T.rows())
    return M.Metrics.lines(M.Rules{5n, 1n, 10n, 60n, 1000n}, ms)
