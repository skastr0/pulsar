# bend Crap-CHECK.bend - CRAP on hand-made measures and CV rows.
#   fn 0  c=6, 0 of 10 covered     6^2 x 10^3/10^3 + 6 = 42
#   fn 1  c=6, 5 of 10 covered     36 x 125/1000 = 4.5 -> 4, + 6 = 10
#   fn 2  c=6, 10 of 10 covered    6
#   fn 3  c=9, no CV row           no data: no CR line
#   fn 4  c=9, 1 of 3, a test      36 x... = 81 x 8/27 = 24, + 9 = 33, no finding (TF)
#   fn 5  c=27, 2 of 3 covered     729 x 1/27 = 27, + 27 = 54; c u^3 = 27 = n^3: complexity-only
#   fn 6  c=28, 2 of 3 covered     784 x 1/27 = 29, + 28 = 57; c u^3 = 28 > 27: coverage
#   fn 0 (42) is coverage: c u^3 = 6000 > 1000
# then a CV row with covered > coverable is refused.
import Base
import ./Metrics.bend as M
import ./Crap.bend as C

def T.m(+fn: U32, +c: Nat, +test: Bool) -> M.FnM:
  M.FnM{fn, c, 0n, 1n, 1n, test}

def T.ms() -> List<&2, M.FnM>:
  [T.m(0, 6n, False{}), T.m(1, 6n, False{}), T.m(2, 6n, False{}), T.m(3, 9n, False{}), T.m(4, 9n, True{}), T.m(5, 27n, False{}), T.m(6, 28n, False{})]

def main() -> List<&2, Maybe<&2, List<&2, String>>>:
  [C.Crap.run(30n, T.ms(), [C.Cv{0, 0, 10}, C.Cv{1, 5, 10}, C.Cv{2, 10, 10}, C.Cv{4, 1, 3}, C.Cv{5, 2, 3}, C.Cv{6, 2, 3}]), C.Crap.run(30n, T.ms(), [C.Cv{1, 11, 10}])]
