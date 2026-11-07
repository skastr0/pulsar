# Resolve.bend - relative-specifier resolution and edge building (pure core).
#
# Given the sorted list of repository files (as a path -> index Map) and the
# references extracted from each file, produce the import graph as one sorted,
# duplicate-free adjacency list per file.
#
# Resolution (mirrors Pulsar's path lookup, minus tsconfig paths and workspace
# packages): the specifier is joined to the importing file's directory and
# normalised; then, in order, the exact path, path/index.{tsx,ts,mts,cts} and
# path + .{tsx,ts,mts,cts} are tried; if the specifier ends in a JS runtime
# extension (.js .jsx .mjs .cjs) the same is tried again with it stripped.
#
# The candidate order is deliberately NOT TypeScript's (file before directory
# index). It reproduces Pulsar's path table, where several files can claim the
# same key and the last one in sorted order wins: `x/index.tsx` beats
# `x/index.ts` beats `x.tsx` beats `x.ts`, because "." sorts before "/".

import Base
import ./Extract.bend as E

type Res is Data:
  Hit{idx: U32}
  Miss{}
  Bare{}

# Running totals. `cur` holds the edges of the file being processed.
type Acc is Data:
  Acc{cur: List<&2, U32>, all: List<&2, List<&2, U32>>, bare: U32, miss: U32, dyn: U32, req: U32, tonly: U32}

type Item is Data:
  Item{path: String, refs: List<&2, E.Ref>}

# ---- path arithmetic -------------------------------------------------------------

def Resolve.is_dotdot(s: String) -> Bool:
  match s:
    case SCon{'.', SCon{'.', SNil{}}}:
      True{}
    case _:
      False{}

def Resolve.pop_seg2(dd: Bool, h: String, t: List<&2, String>) -> List<&2, String>:
  match dd:
    case True{}:
      Con{"..", Con{h, t}}
    case False{}:
      t

# Drop the innermost directory; stepping above the root leaves a `..` segment
# behind, which no repository file can match.
def Resolve.pop_seg(stack: List<&2, String>) -> List<&2, String>:
  match stack:
    case Nil{}:
      Con{"..", Nil{}}
    case Con{+h, t}:
      Resolve.pop_seg2(Resolve.is_dotdot(h), h, t)

def Resolve.apply(segs: List<&2, String>, stack: List<&2, String>) -> List<&2, String>:
  match segs:
    case Nil{}:
      stack
    case Con{seg, t}:
      match seg:
        case SNil{}:
          Resolve.apply(t, stack)
        case SCon{'.', SNil{}}:
          Resolve.apply(t, stack)
        case SCon{'.', SCon{'.', SNil{}}}:
          Resolve.apply(t, Resolve.pop_seg(stack))
        case other:
          Resolve.apply(t, Con{other, stack})

# Reversed directory segments of a file path.
def Resolve.dir_stack(src: String) -> List<&2, String>:
  List.tail(&2, String, List.reverse(&2, String, String.split(src, '/')))

# The normalised path a specifier points at, relative to the repo root.
def Resolve.joined(src: String, spec: String) -> String:
  String.join(List.reverse(&2, String, Resolve.apply(String.split(spec, '/'), Resolve.dir_stack(src))), "/")

def Resolve.in_dir(+base: String, name: String) -> String:
  match base:
    case SNil{}:
      name
    case _:
      base ++ "/" ++ name

def Resolve.with_exts(+base: String) -> List<&2, String>:
  [base,
   Resolve.in_dir(base, "index.tsx"), Resolve.in_dir(base, "index.ts"),
   Resolve.in_dir(base, "index.mts"), Resolve.in_dir(base, "index.cts"),
   base ++ ".tsx", base ++ ".ts", base ++ ".mts", base ++ ".cts"]

def Resolve.ext_len2(mjs: Bool, cjs: Bool, jsx: Bool, js: Bool) -> Nat:
  match mjs cjs jsx js:
    case True{} _ _ _:
      4n
    case False{} True{} _ _:
      4n
    case False{} False{} True{} _:
      4n
    case False{} False{} False{} True{}:
      3n
    case _ _ _ _:
      0n

# `.js .jsx .mjs .cjs` -> length of that extension (TS ESM convention), else 0.
def Resolve.js_ext_len(+s: String) -> Nat:
  Resolve.ext_len2(String.ends_with(s, ".mjs"), String.ends_with(s, ".cjs"), String.ends_with(s, ".jsx"), String.ends_with(s, ".js"))

def Resolve.strip_group(len: Nat, +base: String) -> List<&2, String>:
  match len:
    case 0n:
      Nil{}
    case 1n+p:
      Resolve.with_exts(String.take(base, Nat.sub(String.length(base), len)))

# ---- lookup -----------------------------------------------------------------------------
def Resolve.pick2(unset: Bool, best: U32, v: U32) -> U32:
  match unset:
    case True{}:
      v
    case False{}:
      best

def Resolve.pick(+best: U32, v: U32) -> U32:
  Resolve.pick2(U32.is_eq(best, 4294967295), best, v)

# Priority-ordered lookup: the first candidate present in the file map wins.
def Resolve.look_step2(r: Map<&2, U32> & U32, best: U32) -> Map<&2, U32> & U32:
  (m2, v) = r
  (m2, Resolve.pick(best, v))

def Resolve.look_step(mb: Map<&2, U32> & U32, k: String) -> Map<&2, U32> & U32:
  (m, best) = mb
  Resolve.look_step2(Map.get(U32, 4294967295, m, k), best)

def Resolve.look(cands: List<&2, String>, mb: Map<&2, U32> & U32) -> Map<&2, U32> & U32:
  match cands:
    case Nil{}:
      mb
    case Con{k, t}:
      Resolve.look(t, Resolve.look_step(mb, k))

def Resolve.is_rel(spec: String) -> Bool:
  match spec:
    case SCon{'.', _}:
      True{}
    case SCon{'/', _}:
      True{}
    case _:
      False{}

def Resolve.finish_hit2(unset: Bool, v: U32, m: Map<&2, U32>) -> Map<&2, U32> & Res:
  match unset:
    case True{}:
      (m, Miss{})
    case False{}:
      (m, Hit{v})

def Resolve.finish_hit(+v: U32, m: Map<&2, U32>) -> Map<&2, U32> & Res:
  Resolve.finish_hit2(U32.is_eq(v, 4294967295), v, m)

def Resolve.finish_look(r: Map<&2, U32> & U32) -> Map<&2, U32> & Res:
  (m, v) = r
  Resolve.finish_hit(v, m)

def Resolve.second2(unset: Bool, a: U32, +base: String, m: Map<&2, U32>) -> Map<&2, U32> & Res:
  match unset:
    case False{}:
      (m, Hit{a})
    case True{}:
      Resolve.finish_look(Resolve.look(Resolve.strip_group(Resolve.js_ext_len(base), base), (m, 4294967295)))

def Resolve.second(+a: U32, base: String, m: Map<&2, U32>) -> Map<&2, U32> & Res:
  Resolve.second2(U32.is_eq(a, 4294967295), a, base, m)

def Resolve.relative2(r: Map<&2, U32> & U32, base: String) -> Map<&2, U32> & Res:
  (m2, a) = r
  Resolve.second(a, base, m2)

def Resolve.relative(m: Map<&2, U32>, +src: String, +spec: String) -> Map<&2, U32> & Res:
  +base = Resolve.joined(src, spec)
  Resolve.relative2(Resolve.look(Resolve.with_exts(base), (m, 4294967295)), base)

def Resolve.dispatch(rel: Bool, m: Map<&2, U32>, src: String, spec: String) -> Map<&2, U32> & Res:
  match rel:
    case False{}:
      (m, Bare{})
    case True{}:
      Resolve.relative(m, src, spec)

# Resolve one specifier from file `src`.
def Resolve.resolve(m: Map<&2, U32>, src: String, +spec: String) -> Map<&2, U32> & Res:
  Resolve.dispatch(Resolve.is_rel(spec), m, src, spec)

# ---- edges -------------------------------------------------------------------------------------
def Resolve.add_edge2(drop_self: Bool, is_self: Bool, v: U32, cur: List<&2, U32>, all: List<&2, List<&2, U32>>, bare: U32, miss: U32, dyn: U32, req: U32, tonly: U32) -> Acc:
  match drop_self is_self:
    case True{} True{}:
      Acc{cur, all, bare, miss, dyn, req, tonly}
    case _ _:
      Acc{Con{v, cur}, all, bare, miss, dyn, req, tonly}

def Resolve.add_edge(self: U32, drop_self: Bool, +v: U32, acc: Acc) -> Acc:
  Acc{cur, all, bare, miss, dyn, req, tonly} = acc
  Resolve.add_edge2(drop_self, U32.is_eq(self, v), v, cur, all, bare, miss, dyn, req, tonly)

def Resolve.count_res(r: Res, self: U32, drop_self: Bool, acc: Acc) -> Acc:
  match r:
    case Hit{v}:
      Resolve.add_edge(self, drop_self, v, acc)
    case Miss{}:
      Acc{cur, all, bare, miss, dyn, req, tonly} = acc
      Acc{cur, all, bare, U32.add(miss, 1), dyn, req, tonly}
    case Bare{}:
      Acc{cur, all, bare, miss, dyn, req, tonly} = acc
      Acc{cur, all, U32.add(bare, 1), miss, dyn, req, tonly}

def Resolve.edge_ref2(res: Map<&2, U32> & Res, self: U32, drop_self: Bool, acc: Acc) -> Map<&2, U32> & Acc:
  (m2, r) = res
  (m2, Resolve.count_res(r, self, drop_self, acc))

def Resolve.edge_ref(m: Map<&2, U32>, src: String, self: U32, drop_self: Bool, spec: String, acc: Acc) -> Map<&2, U32> & Acc:
  Resolve.edge_ref2(Resolve.resolve(m, src, spec), self, drop_self, acc)

def Resolve.ref_step2(k: E.RefKind, m: Map<&2, U32>, acc: Acc, +src: String, self: U32, spec: String) -> Map<&2, U32> & Acc:
  match k:
    case E.KImport{}:
      Resolve.edge_ref(m, src, self, False{}, spec, acc)
    case E.KExport{}:
      Resolve.edge_ref(m, src, self, True{}, spec, acc)
    case E.KTypeOnly{}:
      Acc{cur, all, bare, miss, dyn, req, tonly} = acc
      (m, Acc{cur, all, bare, miss, dyn, req, U32.add(tonly, 1)})
    case E.KDynamic{}:
      Acc{cur, all, bare, miss, dyn, req, tonly} = acc
      (m, Acc{cur, all, bare, miss, U32.add(dyn, 1), req, tonly})
    case E.KRequire{}:
      Acc{cur, all, bare, miss, dyn, req, tonly} = acc
      (m, Acc{cur, all, bare, miss, dyn, U32.add(req, 1), tonly})

def Resolve.ref_step(ma: Map<&2, U32> & Acc, src: String, self: U32, k: E.RefKind, spec: String) -> Map<&2, U32> & Acc:
  (m, acc) = ma
  Resolve.ref_step2(k, m, acc, src, self, spec)

def Resolve.file_refs(refs: List<&2, E.Ref>, ma: Map<&2, U32> & Acc, +src: String, +self: U32) -> Map<&2, U32> & Acc:
  match refs:
    case Nil{}:
      ma
    case Con{E.Ref{k, spec}, t}:
      Resolve.file_refs(t, Resolve.ref_step(ma, src, self, k, spec), src, self)

# ---- per-file finish --------------------------------------------------------------------------------
def Resolve.dedup_push(same: Bool, h: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match same:
    case True{}:
      acc
    case False{}:
      Con{h, acc}

def Resolve.dedup(xs: List<&2, U32>, last: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      acc
    case Con{+h, t}:
      Resolve.dedup(t, h, Resolve.dedup_push(U32.is_eq(h, last), h, acc))

def Resolve.u32_le(a: U32, b: U32) -> Bool:
  U32.is_le(a, b)

# Sorted ascending, duplicates removed.
def Resolve.sorted_unique(xs: List<&2, U32>) -> List<&2, U32>:
  List.reverse(&2, U32, Resolve.dedup(List.sort(~U32, ~Resolve.u32_le, xs), 4294967295, Nil{}))

def Resolve.close_file(acc: Acc) -> Acc:
  Acc{cur, all, bare, miss, dyn, req, tonly} = acc
  Acc{Nil{}, Con{Resolve.sorted_unique(cur), all}, bare, miss, dyn, req, tonly}

# ---- whole repo --------------------------------------------------------------------------------------------
def Resolve.item_step2(r: Map<&2, U32> & Acc) -> Map<&2, U32> & Acc:
  (m, acc) = r
  (m, Resolve.close_file(acc))

def Resolve.all_go(items: List<&2, Item>, ma: Map<&2, U32> & Acc, +i: U32) -> Map<&2, U32> & Acc:
  match items:
    case Nil{}:
      ma
    case Con{Item{path, refs}, t}:
      Resolve.all_go(t, Resolve.item_step2(Resolve.file_refs(refs, ma, path, i)), U32.add(i, 1))

def Resolve.empty_acc() -> Acc:
  Acc{Nil{}, Nil{}, 0, 0, 0, 0, 0}

def Resolve.index_go(paths: List<&2, String>, +i: U32, m: Map<&2, U32>) -> Map<&2, U32>:
  match paths:
    case Nil{}:
      m
    case Con{p, t}:
      Resolve.index_go(t, U32.add(i, 1), Map.set(&2, U32, m, p, i))

# path -> position in the (sorted) file list
def Resolve.index(paths: List<&2, String>) -> Map<&2, U32>:
  Resolve.index_go(paths, 0, Map.new(&2, U32))

# Resolved graph: adjacency lists in file order (reversed accumulation fixed
# here), plus the counters.
def Resolve.graph2(r: Map<&2, U32> & Acc) -> Acc:
  (m2, acc) = r
  Acc{cur, all, bare, miss, dyn, req, tonly} = acc
  Acc{cur, List.reverse(&2, List<&2, U32>, all), bare, miss, dyn, req, tonly}

def Resolve.graph(items: List<&2, Item>, m: Map<&2, U32>) -> Acc:
  Resolve.graph2(Resolve.all_go(items, (m, Resolve.empty_acc()), 0))
