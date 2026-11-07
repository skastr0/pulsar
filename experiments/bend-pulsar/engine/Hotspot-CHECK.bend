# bend Hotspot-CHECK.bend - churn and composites on hand-made rows.
#   authors: 0 human, 1 bot. commits 0..4, commit 2 by the bot.
#   fn 5   touched by commits 0, 1, 2 (bot), 3          churn 3
#   fn 7   touched by 0, 1 (0 lines), 2 (bot), 4        churn 2
#   fn 300 touched by 3                                 churn 1
#   base: cyclomatic on 5, length on 7, nesting on 300; CRAP on 5 and 7.
# threshold 2: hotspot 5 (via cyclomatic), risky 5. threshold 1: also risky 7;
# 7 is no hotspot because length is not a complexity finding.
import Base
import ./Rows.bend as R
import ./Metrics.bend as M
import ./Hotspot.bend as H
import ./Churn.bend as Ch

def T.a(+x: U32, +b: U32) -> R.Row:
  R.Row{65, [x, b]}

def T.c(+x: U32, +a: U32) -> R.Row:
  R.Row{67, [x, a, 100]}

def T.f(+c: U32, +fn: U32, +t: U32) -> R.Row:
  R.Row{4408910, [c, fn, t]}

def T.rows() -> List<&2, R.Row>:
  [T.a(0, 0), T.a(1, 1), T.c(0, 0), T.c(1, 0), T.c(2, 1), T.c(3, 0), T.c(4, 0), T.f(0, 5, 3), T.f(0, 7, 1), T.f(1, 5, 2), T.f(1, 7, 0), T.f(2, 5, 9), T.f(2, 7, 4), T.f(3, 5, 1), T.f(3, 300, 1), T.f(4, 7, 2)]

def T.metrics() -> List<&2, M.Finding>:
  [M.Finding{1, 5, 12n, 10n}, M.Finding{4, 7, 80n, 60n}, M.Finding{2, 300, 4n, 3n}]

def T.crap() -> List<&2, M.Finding>:
  [M.Finding{5, 5, 42n, 30n}, M.Finding{5, 7, 50n, 30n}]

def T.show(xs: List<&2, H.Ch>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{H.Ch{fn, n}, t}:
      Con{U32.show(fn) ++ ":" ++ Nat.show(n), T.show(t)}

def main() -> List<&2, List<&2, String>>:
  [T.show(Ch.Churn.of(T.rows())), H.Hotspot.lines(2n, Ch.Churn.of(T.rows()), T.metrics(), T.crap()), H.Hotspot.lines(1n, Ch.Churn.of(T.rows()), T.metrics(), T.crap())]
