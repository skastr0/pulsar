# bend MetricsIn-CHECK.bend - the decoder on hand-made rows. Prints the Metrics
# lines for two functions (one with a nested arrow), the same with fn 0 marked as
# a test (TF: FM lines, no FX), then None for a short CT row and for a TF id that
# is not a function. Then the full chain with coverage and history: fn 0 at 0% coverage
# (CRAP 4^2+4 = 20, no core.crap at 30) touched by 3 human commits (hotspot over
# its cyclomatic finding), a bot commit that does not count, and None for a CV row
# with covered > coverable and for a CV id that is not a function.
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

def T.tf(+a: U32) -> R.Row:
  R.Row{21574, [a]}

def T.low() -> M.Rules:
  M.Rules{3n, 1n, 3n, 60n, 1000n}

def T.hist() -> List<&2, R.Row>:
  [R.Row{65, [0, 0]}, R.Row{65, [1, 1]}, R.Row{67, [0, 0, 20000]}, R.Row{67, [1, 0, 20001]}, R.Row{67, [2, 1, 20002]}, R.Row{67, [3, 0, 20003]}, R.Row{4408910, [0, 0, 2]}, R.Row{4408910, [1, 0, 1]}, R.Row{4408910, [2, 0, 5]}, R.Row{4408910, [3, 0, 1]}, R.Row{4408910, [3, 1, 1]}]

def T.cv(+a: U32, +b: U32, +c: U32) -> R.Row:
  R.Row{17238, [a, b, c]}

def main() -> List<&2, Maybe<&2, List<&2, String>>>:
  [I.MetricsIn.lines(T.low(), T.rows()), I.MetricsIn.lines(T.low(), List.append(&2, R.Row, T.rows(), [T.tf(0)])), I.MetricsIn.lines(M.Metrics.defaults(), [T.fn(0, 0, 4294967295, 1), R.Row{17236, [0, 1, 0]}]), I.MetricsIn.lines(M.Metrics.defaults(), [T.fn(0, 0, 4294967295, 1), T.tf(5)]), I.MetricsIn.lines(T.low(), List.append(&2, R.Row, T.rows(), Con{T.cv(0, 0, 10), T.hist()})), I.MetricsIn.lines(T.low(), List.append(&2, R.Row, T.rows(), [T.cv(0, 11, 10)])), I.MetricsIn.lines(T.low(), List.append(&2, R.Row, T.rows(), [T.cv(2, 1, 10)]))]
