# bend MetricsIn-CHECK.bend - the decoder on hand-made rows. Prints the Metrics
# lines for two functions (one with a nested arrow), then None for a short CT row.
import Base
import ./Rows.bend as R
import ./Metrics.bend as M
import ./MetricsIn.bend as I

def T.fn(+a: U32, +b: U32, +c: U32, +d: U32) -> R.Row:
  R.Row{17998, [a, b, c, d]}

def T.ct(+a: U32, +b: U32, +c: U32, +d: U32) -> R.Row:
  R.Row{17236, [a, b, c, d]}

# fn 0: if (a && b) { for (...) { inner = () => {} } } else { return }
# fn 1: the arrow, parent 0
def T.rows() -> List<&2, R.Row>:
  [R.Row{77, [2]}, T.fn(0, 0, 4294967295, 9), T.fn(1, 0, 0, 1), R.Row{17995, [0, 1, 2]}, T.ct(0, 1, 0, 1), T.ct(0, 2, 1, 6), T.ct(0, 3, 1, 2), T.ct(0, 4, 3, 4), T.ct(0, 5, 4, 8), T.ct(0, 6, 1, 2), T.ct(0, 7, 6, 7)]

def main() -> List<&2, Maybe<&2, List<&2, String>>>:
  [I.MetricsIn.lines(M.Metrics.defaults(), T.rows()), I.MetricsIn.lines(M.Metrics.defaults(), [T.fn(0, 0, 4294967295, 1), R.Row{17236, [0, 1, 0]}])]
