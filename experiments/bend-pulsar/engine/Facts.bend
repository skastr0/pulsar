# Facts.bend - FACTS v0 `I` facts to the import graph (pure core).
#
# This is the engine's edge builder. It decides nothing itself: whether an
# `I src dst form hv ht` fact is an edge is answered by the proven rules,
#   Extract.value_kind   (LAWS.bend A-C: a clause of only type bindings is not
#                         an edge; one value binding, or an empty clause, is)
#   Resolve.add_edge2    (LAWS.bend D-E: an export-from naming its own file adds
#                         no edge; an import naming its own file does)
# reached through Resolve.count_res, the same bookkeeping bend-cycles ran.
# Rows are closed with Resolve.close_file, so every row is sorted ascending and
# duplicate free, exactly as Graph.analyze expects. Scope.bend walks the facts
# and adds the production-scope rule on top of this one.
#
# The builder needs the facts grouped by `src` (FACTS.md: every relation is
# emitted sorted). `Facts.valid` checks that, plus id and flag ranges, and the
# pipeline refuses input that fails it.

import Base
import ../Extract.bend as E
import ../Resolve.bend as R

type Fact is Data:
  Fact{src: U32, dst: U32, form: U32, hv: U32, ht: U32}

# ---- the fact-to-edge rule -------------------------------------------------------------
# Flags are 0/1 in a valid file; any non-zero value reads as true.
def Facts.flag(x: U32) -> Bool:
  Bool.not(U32.is_eq(x, 0))

def Facts.kind2(is_export: Bool) -> E.RefKind:
  match is_export:
    case True{}:
      E.KExport{}
    case False{}:
      E.KImport{}

# form 2 is `export ... from`; forms 0 and 1 are imports.
def Facts.edge_kind(form: U32) -> E.RefKind:
  Facts.kind2(U32.is_eq(form, 2))

# What the statement is, once the proven type-elision rule has looked at it.
def Facts.kind(hv: U32, ht: U32, form: U32) -> E.RefKind:
  E.Extract.value_kind(Facts.flag(hv), Facts.flag(ht), Facts.edge_kind(form))

# Apply the rule's verdict to the running accumulator.
def Facts.apply(k: E.RefKind, src: U32, dst: U32, acc: R.Acc) -> R.Acc:
  match k:
    case E.KImport{}:
      R.Resolve.count_res(R.Hit{dst}, src, False{}, acc)
    case E.KExport{}:
      R.Resolve.count_res(R.Hit{dst}, src, True{}, acc)
    case E.KTypeOnly{}:
      R.Acc{cur, all, bare, miss, dyn, req, tonly} = acc
      R.Acc{cur, all, bare, miss, dyn, req, U32.add(tonly, 1)}
    case E.KDynamic{}:
      acc
    case E.KRequire{}:
      acc

# One fact into the accumulator: an edge, a skipped type-only statement, or
# nothing (a dropped export self edge).
def Facts.add(f: Fact, acc: R.Acc) -> R.Acc:
  match f:
    case Fact{src, dst, form, hv, ht}:
      Facts.apply(Facts.kind(hv, ht, form), src, dst, acc)

# ---- rows ------------------------------------------------------------------------------------
# Close k files: each pushes its (sorted, de-duplicated) edge row onto `all`.
def Facts.close_n(k: Nat, acc: R.Acc) -> R.Acc:
  match k:
    case 0n:
      acc
    case 1n+p:
      Facts.close_n(p, R.Resolve.close_file(acc))

# src - cur when src >= cur, else 0 (a valid file never has src < cur).
def Facts.gap2(ge: Bool, src: U32, cur: U32) -> U32:
  match ge:
    case True{}:
      U32.sub(src, cur)
    case False{}:
      0

def Facts.gap(+src: U32, +cur: U32) -> U32:
  Facts.gap2(U32.is_ge(src, cur), src, cur)

def Facts.src_of(f: Fact) -> U32:
  match f:
    case Fact{src, dst, form, hv, ht}:
      src

def Facts.rows(acc: R.Acc) -> List<&2, List<&2, U32>>:
  match acc:
    case R.Acc{cur, all, bare, miss, dyn, req, tonly}:
      List.reverse(&2, List<&2, U32>, all)

def Facts.finish(+n: U32, r: R.Acc & U32) -> List<&2, List<&2, U32>>:
  (acc, cur) = r
  Facts.rows(Facts.close_n(U32.to_nat(Facts.gap(n, cur)), acc))

# ---- validity --------------------------------------------------------------------------------
# Every id is below n, form is 0..2, flags are 0 or 1, and src never decreases.
def Facts.ok1(+src: U32, +dst: U32, +form: U32, hv: U32, ht: U32, +n: U32, prev: U32) -> Bool:
  Bool.and(Bool.and(Bool.and(U32.is_lt(src, n), U32.is_lt(dst, n)), Bool.and(U32.is_le(form, 2), U32.is_ge(src, prev))), Bool.and(U32.is_le(hv, 1), U32.is_le(ht, 1)))

def Facts.valid(fs: List<&2, Fact>, +n: U32, prev: U32, ok: Bool) -> Bool:
  match fs:
    case Nil{}:
      ok
    case Con{Fact{+src, dst, form, hv, ht}, t}:
      Facts.valid(t, n, src, Bool.and(ok, Facts.ok1(src, dst, form, hv, ht, n, prev)))
