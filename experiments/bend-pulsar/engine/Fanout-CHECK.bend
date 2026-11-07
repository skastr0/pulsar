# bend Fanout-CHECK.bend - the fan-out rule on hand-written facts.
#   symbols: 10 a query, 11 a log call (not of the class), 12 a remote call (class 1001)
#   fn 1 handler: site 0 calls fn 2 in a loop (CE), site 1 calls 10 in a loop (CS),
#                 site 2 calls 11 in a loop, site 3 calls fn 4 in a loop, site 4 calls fn 5 in a loop
#   fn 2 calls fn 3 (site 5, not in a loop); fn 3 calls 10 (site 6, not in a loop)
#   fn 4 calls 10 inside a test (site 7); fn 5 calls 12 in a loop inside a test (site 8)
#   fn 6 test: calls 10 in a loop (site 9, ctx 4)
# Rule 1: query, 0 edges, not in tests   -> site 1 only
# Rule 2: query, 2 edges, not in tests   -> site 1; site 0 (fn 2 -> 3 -> query), site 3 (fn 4 holds a query)
# Rule 3: query, 1 edge                  -> sites 1, 9; site 3 (fn 4), not site 0 (needs 2 edges)
# Rule 4: remote, 1 edge, not in tests   -> site 4 (fn 5 calls the remote, in a test ctx of its own)
import Base
import ./ClassCtx.bend as X
import ./Fanout.bend as F

def T.f() -> F.FoF:
  F.FoF{[X.Cs{1, 1, 10, 1, 0}, X.Cs{2, 1, 11, 1, 0}, X.Cs{6, 3, 10, 0, 0}, X.Cs{7, 4, 10, 0, 4}, X.Cs{8, 5, 12, 1, 4}, X.Cs{9, 6, 10, 1, 4}], [X.Cl{10, 1}, X.Cl{11, 3}, X.Cl{12, 1001}], [F.Ce{0, 1, 2, 3, 1, 0}, F.Ce{3, 1, 4, 3, 1, 0}, F.Ce{4, 1, 5, 3, 1, 0}, F.Ce{5, 2, 3, 0, 0, 0}], [F.Rf{1, 1, 0, 4}, F.Rf{2, 1, 2, 4}, F.Rf{3, 1, 1, 0}, F.Rf{4, 1001, 1, 4}]}

def main() -> List<&2, String>:
  F.Fanout.lines(T.f())
