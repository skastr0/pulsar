# bend Rules-CHECK.bend - the join on a hand-built relation. Each def is an equality the checker
# proves by computing both sides, so `bend Rules-CHECK.bend` passes only if the join answers
# exactly these environments, in this order.
#   rel 0 (edge): 1->2, 2->3, 3->1, 2->2, and one malformed 1-field tuple
#   C1  edge(X, Y), edge(Y, Z)   paths of two edges, in tuple order of the first atom
#   C2  edge(X, 3)               a constant field
#   C3  edge(X, X)               a repeated variable
#   C4  edge(_, X), edge(X, _)   wildcards; every head of an edge that also leaves
#   C5  edge(X, Y) from X = 3    a bound start environment
import Base
import ./Rules.bend as R

def T.edge() -> List<&2, List<&2, U32>>:
  [[1, 2], [2, 3], [3, 1], [2, 2], [1]]

def T.rels() -> List<&2, List<&2, List<&2, U32>>>:
  [T.edge()]

def T.v(n: Nat) -> R.Tm:
  R.TV{n}

def C1() -> {R.Join.atoms([R.At{0n, [T.v(0n), T.v(1n)]}, R.At{0n, [T.v(1n), T.v(2n)]}], T.rels(), [Nil{}]) == [[Some{1}, Some{2}, Some{3}], [Some{1}, Some{2}, Some{2}], [Some{2}, Some{3}, Some{1}], [Some{3}, Some{1}, Some{2}], [Some{2}, Some{2}, Some{3}], [Some{2}, Some{2}, Some{2}]] : List<&2, List<&2, Maybe<&2, U32>>>}:
  {==}

def C2() -> {R.Join.atoms([R.At{0n, [T.v(0n), R.TC{3}]}], T.rels(), [Nil{}]) == [[Some{2}]] : List<&2, List<&2, Maybe<&2, U32>>>}:
  {==}

def C3() -> {R.Join.atoms([R.At{0n, [T.v(0n), T.v(0n)]}], T.rels(), [Nil{}]) == [[Some{2}]] : List<&2, List<&2, Maybe<&2, U32>>>}:
  {==}

def C4() -> {R.Join.atoms([R.At{0n, [R.TW{}, T.v(0n)]}, R.At{0n, [T.v(0n), R.TW{}]}], T.rels(), [Nil{}]) == [[Some{2}], [Some{2}], [Some{3}], [Some{1}], [Some{2}], [Some{2}]] : List<&2, List<&2, Maybe<&2, U32>>>}:
  {==}

def C5() -> {R.Join.atoms([R.At{0n, [T.v(0n), T.v(1n)]}], T.rels(), [[Some{3}]]) == [[Some{3}, Some{1}]] : List<&2, List<&2, Maybe<&2, U32>>>}:
  {==}

def main() -> List<&2, List<&2, Maybe<&2, U32>>>:
  R.Join.atoms([R.At{0n, [T.v(0n), T.v(1n)]}, R.At{0n, [T.v(1n), T.v(2n)]}], T.rels(), [Nil{}])
