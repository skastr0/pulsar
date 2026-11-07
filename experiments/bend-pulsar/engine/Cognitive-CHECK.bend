# bend Cognitive-CHECK.bend - cognitive complexity on hand-built trees.
#   fn 0  if (a && b && c) { for (..) { if (x) {} } } else if (d || e) {} else {}
#         if 1, && run 1, for 2 (level 1), inner if 3 (level 2), else if 1, || 1  = 9
#         (the paper also charges the final else: 10; CT cannot tell it from a ternary)
#   fn 1  for (..) { switch (v) { 5 cases, default } }    for 1, switch 2 (level 1)   = 3
#   fn 2  try { if (x) {} } catch {} catch {} finally {}  if 1 (a try body keeps the
#         level), each catch 1                                                       = 3
#   fn 3  return a && b || c && d ?? e                     runs &&, ||, && = 3; ?? 0  = 3
#   fn 4  a test function with fn 0's tree: measured 9, no finding
#   fn 5  x => { if (y) {} } inside fn 5's tree is a kind-8 leaf                    = 0
# At threshold 2: findings for fns 0, 1, 2 and 3; none for 4 (test) or 5.
import Base
import ./Metrics.bend as M
import ./Cognitive.bend as C

def T.n(k: M.K, kids: M.Ct, next: M.Ct) -> M.Ct:
  M.Node{k, kids, next}

def T.arm(kids: M.Ct, next: M.Ct) -> M.Ct:
  M.Node{M.KArm{}, kids, next}

def T.sc(next: M.Ct) -> M.Ct:
  M.Node{M.KSc{}, M.Leaf{}, next}

def T.if0(next: M.Ct) -> M.Ct:
  T.n(M.KBranch{}, T.arm(M.Leaf{}, M.Leaf{}), next)

def T.f0() -> M.Ct:
  T.n(M.KBranch{}, T.sc(T.sc(T.arm(T.n(M.KLoop{}, T.if0(M.Leaf{}), M.Leaf{}), T.arm(T.n(M.KBranch{}, T.sc(T.arm(M.Leaf{}, T.arm(M.Leaf{}, M.Leaf{}))), M.Leaf{}), M.Leaf{})))), M.Leaf{})

def T.cases(k: Nat, tail: M.Ct) -> M.Ct:
  match k:
    case 0n:
      tail
    case 1n+p:
      T.arm(M.Leaf{}, T.cases(p, tail))

def T.f1() -> M.Ct:
  T.n(M.KLoop{}, T.n(M.KMulti{}, T.cases(6n, M.Node{M.KFlag{}, M.Leaf{}, M.Leaf{}}), M.Leaf{}), M.Leaf{})

def T.f2() -> M.Ct:
  T.n(M.KTry{}, T.arm(T.if0(M.Leaf{}), T.arm(M.Leaf{}, T.arm(M.Leaf{}, M.Node{M.KFin{}, M.Leaf{}, M.Leaf{}}))), M.Leaf{})

def T.f3() -> M.Ct:
  T.sc(T.sc(T.sc(T.sc(M.Leaf{}))))

def T.f5() -> M.Ct:
  M.Node{M.KFn{}, M.Leaf{}, M.Leaf{}}

def T.fs() -> List<&2, M.FnT>:
  [M.FnT{0, T.f0(), 9, False{}}, M.FnT{1, T.f1(), 9, False{}}, M.FnT{2, T.f2(), 9, False{}}, M.FnT{3, T.f3(), 1, False{}}, M.FnT{4, T.f0(), 9, True{}}, M.FnT{5, T.f5(), 1, False{}}]

# fn 0: && && ||; fn 3: && || && ??; fn 4: && && ||.
def T.ops() -> List<&2, C.Op>:
  [C.OAnd{}, C.OAnd{}, C.OOr{}, C.OAnd{}, C.OOr{}, C.OAnd{}, C.ONone{}, C.OAnd{}, C.OAnd{}, C.OOr{}]

def T.show(ms: List<&2, C.CgM>) -> List<&2, String>:
  match ms:
    case Nil{}:
      Nil{}
    case Con{C.CgM{fn, v, test}, t}:
      Con{U32.show(fn) ++ ":" ++ Nat.show(v), T.show(t)}

def main() -> List<&2, List<&2, String>>:
  [T.show(C.Cog.measure_all(T.fs(), T.ops())), C.Cognitive.lines(2n, T.fs(), T.ops())]
