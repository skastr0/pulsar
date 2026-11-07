# engine/Scope-LAWS.bend - laws for Scope.bend, the production-scope rule.
# (A module path is plain names, so `Scope.LAWS.bend` is not importable; this is
# the <Module>.LAWS.bend pair, spelled with a hyphen.) Filled in Scope-PROOF.bend.
#
# The rule (TS-AD-02: the graph is built over production files): a fact is an
# edge iff the proven rule says so (engine/LAWS.bend K1-K13) AND both endpoints
# are production files. SC3-SC5 split that "iff" into its cases, and SC1-SC2 say
# what "production file" means: exactly the ids listed by the `F file 1` facts.

import Base
import ../LAWS.bend as TL
import ../Resolve.bend as R
import ../Graph.bend as G
import ./Facts.bend as F
import ./Scope.bend as S

# SC1. a file the production set reports is one of the listed ids.
law scope_set_sound:
  for +ids: List<&2, U32>
  for +x: U32
  for h: {S.Scope.has(S.Scope.set(ids), x) == True{} : Bool}
  TL.Mem(ids, x)

# SC2. every listed id is in the production set.
law scope_set_complete:
  for +ids: List<&2, U32>
  for +x: U32
  for hm: TL.Mem(ids, x)
  {S.Scope.has(S.Scope.set(ids), x) == True{} : Bool}

# SC3. the importing file is not production: the fact adds nothing.
law scope_src_not_prod_no_edge:
  for t: G.Tr
  for src: U32
  for dst: U32
  for form: U32
  for hv: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for h: {S.Scope.has(t, src) == False{} : Bool}
  {S.Scope.add(t, F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}

# SC4. the target file is not production: the fact adds nothing.
law scope_dst_not_prod_no_edge:
  for t: G.Tr
  for src: U32
  for dst: U32
  for form: U32
  for hv: U32
  for ht: U32
  for cur: List<&2, U32>
  for all: List<&2, List<&2, U32>>
  for bare: U32
  for miss: U32
  for dyn: U32
  for req: U32
  for tonly: U32
  for h: {S.Scope.has(t, dst) == False{} : Bool}
  {S.Scope.add(t, F.Fact{src, dst, form, hv, ht}, R.Acc{cur, all, bare, miss, dyn, req, tonly}) == R.Acc{cur, all, bare, miss, dyn, req, tonly} : R.Acc}

# SC5. both files are production: the fact is exactly what the proven rule says
# (K1-K13 then give the edge, the dropped export self edge, or the type-only skip).
law scope_both_prod_is_rule:
  for t: G.Tr
  for src: U32
  for dst: U32
  for form: U32
  for hv: U32
  for ht: U32
  for acc: R.Acc
  for hs: {S.Scope.has(t, src) == True{} : Bool}
  for hd: {S.Scope.has(t, dst) == True{} : Bool}
  {S.Scope.add(t, F.Fact{src, dst, form, hv, ht}, acc) == F.Facts.add(F.Fact{src, dst, form, hv, ht}, acc) : R.Acc}
