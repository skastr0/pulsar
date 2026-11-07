# main.bend - bend-cycles: import-cycle detector (TS-AD-02 equivalent), the
# thin effectful shell. All decisions live in the pure core modules:
#   Lex.bend      source text -> tokens
#   Extract.bend  tokens -> module-specifier references
#   Resolve.bend  references -> adjacency lists
#   Graph.bend    adjacency lists -> cycles
# This file only talks to the world: argv, `git ls-files`, file reads, stdout.
#
#   usage: bend-cycles <repo>

import Base
import ./Extract.bend as E
import ./Resolve.bend as R
import ./Graph.bend as G
import ./Select.bend as S

type Src is Data:
  Src{path: String, text: String}

# ---- file listing (pure) -------------------------------------------------------------

def Main.keep(a: Bool, b: Bool, c: Bool, d: Bool, dts: Bool) -> Bool:
  Bool.and(Bool.or(Bool.or(a, b), Bool.or(c, d)), Bool.not(dts))

# .ts .tsx .mts .cts, but not .d.ts
def Main.is_ts(+p: String) -> Bool:
  Main.keep(String.ends_with(p, ".ts"), String.ends_with(p, ".tsx"), String.ends_with(p, ".mts"), String.ends_with(p, ".cts"), String.ends_with(p, ".d.ts"))

def Main.apply_prod(prod: Bool, xs: List<&2, String>) -> List<&2, String>:
  match prod:
    case True{}:
      List.filter(~String, ~(+p => S.Select.production(p)), xs)
    case False{}:
      xs

def Main.ts_files(prod: Bool, out: String) -> List<&2, String>:
  List.sort(~String, ~String.is_le, Main.apply_prod(prod, List.filter(~String, ~(+p => Main.is_ts(p)), String.lines(out))))

# ---- batching (pure) -------------------------------------------------------------------------
def Main.batch_cur(last: Bool, +h: String, cur: List<&2, String>) -> List<&2, String>:
  match last:
    case True{}:
      Nil{}
    case False{}:
      Con{h, cur}

def Main.batch_out(last: Bool, +h: String, +cur: List<&2, String>, out: List<&2, List<&2, String>>) -> List<&2, List<&2, String>>:
  match last:
    case True{}:
      Con{List.reverse(&2, String, Con{h, cur}), out}
    case False{}:
      out

def Main.batch_tail(cur: List<&2, String>, out: List<&2, List<&2, String>>) -> List<&2, List<&2, String>>:
  match cur:
    case Nil{}:
      out
    case _:
      Con{List.reverse(&2, String, cur), out}

# Split into runs of 1024 paths (batches come out last-first; callers reverse).
# Bigger runs are faster (about 50 ms of fixed cost per run, measured) but hold
# more text at once (16 bytes per character): 1024 files is ~240 MB on junto.
def Main.batches(xs: List<&2, String>, +ctr: U32, +cur: List<&2, String>, out: List<&2, List<&2, String>>) -> List<&2, List<&2, String>>:
  match xs:
    case Nil{}:
      Main.batch_tail(cur, out)
    case Con{+h, t}:
      Main.batches(t, U32.and(U32.add(ctr, 1), 1023), Main.batch_cur(U32.is_eq(ctr, 1023), h, cur), Main.batch_out(U32.is_eq(ctr, 1023), h, cur, out))

# ---- scanning (pure, parallel) ---------------------------------------------------------------------
# Force the whole scan (lex + extract) here, inside the parallel task, by
# demanding the number of references before the item is built.
def Main.force(c: U32, it: R.Item) -> R.Item:
  match c:
    case U32{w}:
      it

def Main.scan_one2(path: String, +refs: List<&2, E.Ref>) -> R.Item:
  Main.force(U32.from_nat(List.length(&2, E.Ref, refs)), R.Item{path, refs})

def Main.scan_one(p: Src) -> R.Item:
  match p:
    case Src{path, text}:
      Main.scan_one2(path, E.Extract.scan(text))

def Main.scan_seq(xs: List<&2, Src>) -> List<&2, R.Item>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Main.scan_one(h), Main.scan_seq(t)}

def Main.append_items(a: List<&2, R.Item>, b: List<&2, R.Item>) -> List<&2, R.Item>:
  match a:
    case Nil{}:
      b
    case Con{h, t}:
      Con{h, Main.append_items(t, b)}

# Fork-join over halves of a batch, unrolled to a fixed depth. Each level
# splits the list once (a single pass that moves, never duplicates, the
# elements: sharing a text between two tasks makes every later traversal of it
# copy-on-match) and scans both halves with a parallel call. lvlK handles 2^K
# leaves; `n` is the number of elements.
def Main.split_cons(h: Src, r: List<&2, Src> & List<&2, Src>) -> List<&2, Src> & List<&2, Src>:
  (a, b) = r
  (Con{h, a}, b)

def Main.split_at(n: Nat, xs: List<&2, Src>) -> List<&2, Src> & List<&2, Src>:
  match n xs:
    case 0n rest:
      (Nil{}, rest)
    case 1n+p Nil{}:
      (Nil{}, Nil{})
    case 1n+p Con{h, t}:
      Main.split_cons(h, Main.split_at(p, t))

def Main.lvl0(xs: List<&2, Src>, n: U32) -> List<&2, R.Item>:
  Main.scan_seq(xs)

def Main.lvl1c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl0(l, h) Main.lvl0(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl1(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl1c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl2c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl1(l, h) Main.lvl1(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl2(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl2c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl3c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl2(l, h) Main.lvl2(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl3(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl3c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl4c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl3(l, h) Main.lvl3(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl4(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl4c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl5c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl4(l, h) Main.lvl4(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl5(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl5c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl6c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl5(l, h) Main.lvl5(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl6(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl6c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl7c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl6(l, h) Main.lvl6(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl7(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl7c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl8c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl7(l, h) Main.lvl7(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl8(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl8c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl9c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl8(l, h) Main.lvl8(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl9(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl9c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl10c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl9(l, h) Main.lvl9(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl10(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl10c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl11c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl10(l, h) Main.lvl10(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl11(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl11c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

def Main.lvl12c(parts: List<&2, Src> & List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  (l, r) = parts
  +h = U32.shr(n)
  a b = Main.lvl11(l, h) Main.lvl11(r, U32.sub(n, h))
  Main.append_items(a, b)

def Main.lvl12(xs: List<&2, Src>, +n: U32) -> List<&2, R.Item>:
  Main.lvl12c(Main.split_at(U32.to_nat(U32.shr(n)), xs), n)

# ---- effects -------------------------------------------------------------------------------------------
# Read a whole file as text; unreadable files read as empty (they contribute
# no edges) so one bad path cannot abort a scan.
def Main.read_done(r: File & Result<&1, &1, U32 & String, String>) -> IO(String):
  (f, res) = r
  match res:
    case Fail{e}:
      do IO<String>:
        Unit <- File.close(f)
        return ""
    case Done{s}:
      do IO<String>:
        Unit <- File.close(f)
        return s

def Main.sized(r: File & Result<&1, &1, U32 & String, U32>) -> IO(String):
  (f, res) = r
  match res:
    case Fail{e}:
      do IO<String>:
        Unit <- File.close(f)
        return ""
    case Done{n}:
      do IO<String>:
        rd : File & Result<&1, &1, U32 & String, String> <- File.read(f, n)
        Main.read_done(rd)

def Main.opened(r: Result<&1, &1, U32 & String, File>) -> IO(String):
  match r:
    case Fail{e}:
      IO.pure(String, "")
    case Done{f}:
      do IO<String>:
        sz : File & Result<&1, &1, U32 & String, U32> <- File.size(f)
        Main.sized(sz)

def Main.read_file(path: String) -> IO(String):
  do IO<String>:
    r : Result<&1, &1, U32 & String, File> <- File.open(path, "r")
    Main.opened(r)

def Main.read_batch(+repo: String, paths: List<&2, String>) -> IO(List<&2, Src>):
  match paths:
    case Nil{}:
      IO.pure(List<&2, Src>, Nil{})
    case Con{+p, t}:
      do IO<List<&2, Src>>:
        txt : String <- Main.read_file(repo ++ "/" ++ p)
        rest : List<&2, Src> <- Main.read_batch(repo, t)
        return Con{Src{p, txt}, rest}

def Main.scan_all(+repo: String, bs: List<&2, List<&2, String>>, acc: List<&2, List<&2, R.Item>>) -> IO(List<&2, R.Item>):
  match bs:
    case Nil{}:
      IO.pure(List<&2, R.Item>, List.concat(&2, R.Item, List.reverse(&2, List<&2, R.Item>, acc)))
    case Con{b, t}:
      do IO<List<&2, R.Item>>:
        srcs : List<&2, Src> <- Main.read_batch(repo, b)
        Main.scan_all(repo, t, Con{Main.lvl10(srcs, 1024), acc})

def Main.git_ok(ok: Bool, out: String, err: String) -> IO(String):
  match ok:
    case True{}:
      IO.pure(String, out)
    case False{}:
      IO.die(String, 2, "git ls-files failed: " ++ err)

def Main.git_out(r: Result<&1, &1, U32 & String, U32 & (String & String)>) -> IO(String):
  match r:
    case Fail{(code, msg)}:
      IO.die(String, 2, "cannot run git: " ++ msg)
    case Done{(status, (out, err))}:
      Main.git_ok(U32.is_eq(status, 0), out, err)

def Main.git_files(repo: String) -> IO(String):
  do IO<String>:
    r : Result<&1, &1, U32 & String, U32 & (String & String)> <- Process.run("git", ["-c", "core.quotePath=false", "-C", repo, "ls-files"], "", 1073741824, 300000)
    Main.git_out(r)

# ---- report ------------------------------------------------------------------------------------------------
def Main.name_of(m: Maybe<&2, String>) -> String:
  match m:
    case None{}:
      "?"
    case Some{s}:
      s

def Main.names(idxs: List<&2, U32>, +paths: List<&2, String>) -> List<&2, String>:
  match idxs:
    case Nil{}:
      Nil{}
    case Con{i, t}:
      Con{Main.name_of(List.get(&2, String, paths, U32.to_nat(i))), Main.names(t, paths)}

def Main.print_cycles(cs: List<&2, List<&2, U32>>, +paths: List<&2, String>) -> IO(Unit):
  match cs:
    case Nil{}:
      IO.pure(Unit, Unit{})
    case Con{c, t}:
      do IO<Unit>:
        IO.print(String.join(Main.names(c, paths), " "))
        Main.print_cycles(t, paths)

def Main.summary(+n: U32, m: U32, c: U32, u: U32) -> String:
  "files=" ++ U32.show(n) ++ " edges=" ++ U32.show(m) ++ " cycles=" ++ U32.show(c) ++ " unresolved=" ++ U32.show(u)

def Main.detail(bare: U32, miss: U32, dyn: U32, req: U32, tonly: U32) -> String:
  "# unresolved_bare=" ++ U32.show(bare) ++ " unresolved_relative=" ++ U32.show(miss) ++ " type_only_skipped=" ++ U32.show(tonly) ++ " dynamic_import_literals=" ++ U32.show(dyn) ++ " require_literals=" ++ U32.show(req)

def Main.len_u32(xs: List<&2, List<&2, U32>>) -> U32:
  U32.from_nat(List.length(&2, List<&2, U32>, xs))

def Main.report2(+paths: List<&2, String>, +all: List<&2, List<&2, U32>>, +bare: U32, +miss: U32, +dyn: U32, +req: U32, +tonly: U32, +cyc: List<&2, List<&2, U32>>) -> IO(Unit):
  do IO<Unit>:
    Unit <- Main.print_cycles(cyc, paths)
    Unit <- IO.print(Main.summary(G.Graph.len(all, 0), G.Graph.edges(all, 0), Main.len_u32(cyc), U32.add(bare, miss)))
    IO.print_err(Main.detail(bare, miss, dyn, req, tonly))

def Main.report(paths: List<&2, String>, acc: R.Acc) -> IO(Unit):
  match acc:
    case R.Acc{cur, +all, bare, miss, dyn, req, tonly}:
      Main.report2(paths, all, bare, miss, dyn, req, tonly, G.Graph.cycles(all))

def Main.after_scan(+paths: List<&2, String>, items: List<&2, R.Item>) -> IO(Unit):
  Main.report(paths, R.Resolve.graph(items, R.Resolve.index(paths)))

def Main.after_list2(+repo: String, +paths: List<&2, String>) -> IO(Unit):
  do IO<Unit>:
    items : List<&2, R.Item> <- Main.scan_all(repo, List.reverse(&2, List<&2, String>, Main.batches(paths, 0, Nil{}, Nil{})), Nil{})
    Main.after_scan(paths, items)

def Main.after_list(prod: Bool, +repo: String, listing: String) -> IO(Unit):
  Main.after_list2(repo, Main.ts_files(prod, listing))

def Main.is_prod_flag(f: String) -> Bool:
  match f:
    case SCon{'-', SCon{'-', SCon{'p', SCon{'r', SCon{'o', SCon{'d', SCon{'u', SCon{'c', SCon{'t', SCon{'i', SCon{'o', SCon{'n', SNil{}}}}}}}}}}}}}:
      True{}
    case _:
      False{}

def Main.go(prod: Bool, +repo: String) -> IO(Unit):
  do IO<Unit>:
    listing : String <- Main.git_files(repo)
    Main.after_list(prod, repo, listing)

def Main.run(args: List<String>) -> IO(Unit):
  match args:
    case Con{prog, Con{+repo, Nil{}}}:
      Main.go(False{}, repo)
    case Con{prog, Con{+repo, Con{flag, Nil{}}}}:
      Main.go(Main.is_prod_flag(flag), repo)
    case _:
      IO.die(Unit, 2, "usage: bend-cycles <repo> [--production]")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    Main.run(args)
