# Parse.bend - FACTS v0 bytes to facts (the reader; unproven, see LAWS.bend).
#
# A byte-level state machine that keeps no text: lines hold only a tag byte
# and up to five decimal U32 fields, which are shifted through five registers
# (a b c d e), so a complete `I` line is a..e with no indexing. Chunks of the
# file are fed one after another; the state carries over a chunk boundary, so
# memory is proportional to the facts, not to the file.
#
#   `#` lines and blank lines   ignored
#   `pulsar-facts v`            header: the tag `pulsar-facts` and one field, 0 or 1
#                               (v1 only adds relations the engine skips)
#   `N k`                       file count
#   `I a b c d e`               an import-like fact (exactly five fields)
#   `F file prod`               a file; the production ones (prod 1) are kept
#   any other tag               ignored, whatever the line holds (K, U, and every v1 relation:
#                               M, FN, FK, CT, H, C, CF, ...)
# Anything malformed (stray bytes, a number over 2^32-1, wrong field count on
# a line the engine reads) sets `bad`, and `Parse.finish` then answers None.

import Base
import ./Facts.bend as F

type Mode is Data:
  MStart{}
  MTag{}
  MGap{}
  MNum{}
  MSkip{}

# Whole-file state, touched only at line ends.
type G is Data:
  G{n: U32, hdr: U32, bad: U32, prods: List<&2, U32>, facts: List<&2, F.Fact>}

type PS is Data:
  PS{mode: Mode, kind: U32, cur: U32, nf: U32, a: U32, b: U32, c: U32, d: U32, e: U32, g: G}

type Parsed is Data:
  Parsed{n: U32, prods: List<&2, U32>, facts: List<&2, F.Fact>}

type Cls is Data:
  CNl{}
  CWs{}
  CHash{}
  CDig{d: U32}
  COth{b: U32}

def Parse.cls2(isdig: Bool, c: U32) -> Cls:
  match isdig:
    case True{}:
      CDig{U32.sub(c, 48)}
    case False{}:
      COth{c}

def Parse.cls(+c: U32) -> Cls:
  match c:
    case 10:
      CNl{}
    case 13:
      CWs{}
    case 9:
      CWs{}
    case 32:
      CWs{}
    case 35:
      CHash{}
    case _:
      Parse.cls2(Bool.and(U32.is_ge(c, 48), U32.is_le(c, 57)), c)

# ---- numbers -------------------------------------------------------------------------------
def Parse.ovf(+cur: U32, +d: U32) -> Bool:
  Bool.or(U32.is_gt(cur, 429496729), Bool.and(U32.is_eq(cur, 429496729), U32.is_gt(d, 5)))

def Parse.mad2(ovf: Bool, +cur: U32, d: U32) -> U32:
  match ovf:
    case True{}:
      4294967295
    case False{}:
      U32.add(U32.mul(cur, 10), d)

def Parse.mad(+cur: U32, +d: U32) -> U32:
  Parse.mad2(Parse.ovf(cur, d), cur, d)

# Tags the engine consumes get a tag id (their byte for the one-letter tags I, N,
# F; 112 for the `pulsar-facts` header); every other tag has id 0 and its lines
# are skipped whatever they contain.
def Parse.consumed(+tag: U32) -> Bool:
  Bool.or(Bool.or(U32.is_eq(tag, 73), U32.is_eq(tag, 78)), Bool.or(U32.is_eq(tag, 70), U32.is_eq(tag, 112)))

# Tag of a line from its first byte, the number of bytes after the first, and
# the last four bytes (base 256). Only the one-letter tags and the header count.
def Parse.tag_id2(longhdr: Bool) -> U32:
  match longhdr:
    case True{}:
      112
    case False{}:
      0

def Parse.tag_one(kind: U32) -> U32:
  match kind:
    case 112:
      0
    case _:
      kind

def Parse.tag_id3(+kind: U32, tl: U32, code: U32) -> U32:
  match tl:
    case 0:
      Parse.tag_one(kind)
    case _:
      Parse.tag_id2(Bool.and(Bool.and(U32.is_eq(kind, 112), U32.is_eq(tl, 11)), U32.is_eq(code, 1633907827)))

def Parse.tag_id(kind: U32, tl: U32, code: U32) -> U32:
  Parse.tag_id3(kind, tl, code)

def Parse.inc3(full: Bool, n: U32) -> U32:
  match full:
    case True{}:
      n
    case False{}:
      U32.add(n, 1)

def Parse.tinc(+n: U32) -> U32:
  Parse.inc3(U32.is_ge(n, 200), n)

def Parse.tagacc(cur: U32, b: U32) -> U32:
  U32.add(U32.mul(cur, 256), b)

def Parse.set_bad(isbad: Bool, g: G) -> G:
  match isbad g:
    case True{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, 1, prods, facts}
    case False{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, bad, prods, facts}

def Parse.flag_ovf(+cur: U32, +d: U32, +kind: U32, g: G) -> G:
  Parse.set_bad(Bool.and(Parse.ovf(cur, d), Parse.consumed(kind)), g)

# A stray byte is an error only on a line the engine reads.
def Parse.stray(+kind: U32, g: G) -> G:
  Parse.set_bad(Parse.consumed(kind), g)

def Parse.inc2(full: Bool, nf: U32) -> U32:
  match full:
    case True{}:
      nf
    case False{}:
      U32.add(nf, 1)

# Field count, saturating at 6 (more than any relation has).
def Parse.inc(+nf: U32) -> U32:
  Parse.inc2(U32.is_ge(nf, 6), nf)

# ---- line ends -------------------------------------------------------------------------------
def Parse.add_fact(ok: Bool, a: U32, b: U32, c: U32, d: U32, e: U32, g: G) -> G:
  match ok g:
    case True{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, bad, prods, Con{F.Fact{a, b, c, d, e}, facts}}
    case False{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, 1, prods, facts}

def Parse.add_prod2(p: Bool, file: U32, g: G) -> G:
  match p g:
    case True{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, bad, Con{file, prods}, facts}
    case False{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, bad, prods, facts}

# `F file prod`: exactly two fields, prod 0 or 1. Production files are kept.
def Parse.add_prod(ok: Bool, file: U32, prod: U32, g: G) -> G:
  match ok g:
    case True{} G{n, hdr, bad, prods, facts}:
      Parse.add_prod2(U32.is_eq(prod, 1), file, G{n, hdr, bad, prods, facts})
    case False{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, 1, prods, facts}

def Parse.set_n(ok: Bool, v: U32, g: G) -> G:
  match ok g:
    case True{} G{n, hdr, bad, prods, facts}:
      G{v, hdr, bad, prods, facts}
    case False{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, 1, prods, facts}

def Parse.set_hdr(ok: Bool, g: G) -> G:
  match ok g:
    case True{} G{n, hdr, bad, prods, facts}:
      G{n, 1, bad, prods, facts}
    case False{} G{n, hdr, bad, prods, facts}:
      G{n, hdr, 1, prods, facts}

def Parse.line_end(kind: U32, +nf: U32, a: U32, b: U32, c: U32, d: U32, +e: U32, g: G) -> G:
  match kind:
    case 73:
      Parse.add_fact(U32.is_eq(nf, 5), a, b, c, d, e, g)
    case 70:
      Parse.add_prod(Bool.and(U32.is_eq(nf, 2), U32.is_le(e, 1)), d, e, g)
    case 78:
      Parse.set_n(U32.is_eq(nf, 1), e, g)
    case 112:
      Parse.set_hdr(Bool.and(U32.is_eq(nf, 1), U32.is_le(e, 1)), g)
    case _:
      g

# ---- the machine -------------------------------------------------------------------------------
def Parse.go(bs: List<&2, Cls>, mode: Mode, +kind: U32, +cur: U32, +nf: U32, a: U32, b: U32, c: U32, d: U32, e: U32, g: G) -> PS:
  match bs:
    case Nil{}:
      PS{mode, kind, cur, nf, a, b, c, d, e, g}
    case Con{h, t}:
      match h mode:
        case CNl{} MSkip{}:
          Parse.go(t, MStart{}, 0, 0, 0, 0, 0, 0, 0, 0, g)
        case _ MSkip{}:
          Parse.go(t, MSkip{}, kind, cur, nf, a, b, c, d, e, g)
        case CNl{} MStart{}:
          Parse.go(t, MStart{}, 0, 0, 0, 0, 0, 0, 0, 0, g)
        case CWs{} MStart{}:
          Parse.go(t, MStart{}, 0, 0, 0, 0, 0, 0, 0, 0, g)
        case CHash{} MStart{}:
          Parse.go(t, MSkip{}, 0, 0, 0, 0, 0, 0, 0, 0, g)
        case CDig{x} MStart{}:
          Parse.go(t, MTag{}, U32.add(x, 48), 0, 0, 0, 0, 0, 0, 0, g)
        case COth{x} MStart{}:
          Parse.go(t, MTag{}, x, 0, 0, 0, 0, 0, 0, 0, g)
        case CNl{} MTag{}:
          Parse.go(t, MStart{}, 0, 0, 0, 0, 0, 0, 0, 0, Parse.line_end(Parse.tag_id(kind, nf, cur), 0, a, b, c, d, e, g))
        case CWs{} MTag{}:
          Parse.go(t, MGap{}, Parse.tag_id(kind, nf, cur), 0, 0, a, b, c, d, e, g)
        case CDig{+x} MTag{}:
          Parse.go(t, MTag{}, kind, Parse.tagacc(cur, U32.add(x, 48)), Parse.tinc(nf), a, b, c, d, e, g)
        case CHash{} MTag{}:
          Parse.go(t, MTag{}, kind, Parse.tagacc(cur, 35), Parse.tinc(nf), a, b, c, d, e, g)
        case COth{x} MTag{}:
          Parse.go(t, MTag{}, kind, Parse.tagacc(cur, x), Parse.tinc(nf), a, b, c, d, e, g)
        case CNl{} MGap{}:
          Parse.go(t, MStart{}, 0, 0, 0, 0, 0, 0, 0, 0, Parse.line_end(kind, nf, a, b, c, d, e, g))
        case CWs{} MGap{}:
          Parse.go(t, MGap{}, kind, cur, nf, a, b, c, d, e, g)
        case CDig{x} MGap{}:
          Parse.go(t, MNum{}, kind, x, nf, a, b, c, d, e, g)
        case _ MGap{}:
          Parse.go(t, MSkip{}, kind, cur, nf, a, b, c, d, e, Parse.stray(kind, g))
        case CNl{} MNum{}:
          Parse.go(t, MStart{}, 0, 0, 0, 0, 0, 0, 0, 0, Parse.line_end(kind, Parse.inc(nf), b, c, d, e, cur, g))
        case CWs{} MNum{}:
          Parse.go(t, MGap{}, kind, 0, Parse.inc(nf), b, c, d, e, cur, g)
        case CDig{+x} MNum{}:
          Parse.go(t, MNum{}, kind, Parse.mad(cur, x), nf, a, b, c, d, e, Parse.flag_ovf(cur, x, kind, g))
        case _ MNum{}:
          Parse.go(t, MSkip{}, kind, cur, nf, a, b, c, d, e, Parse.stray(kind, g))

def Parse.classify(bs: List<&2, U32>) -> List<&2, Cls>:
  match bs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Parse.cls(h), Parse.classify(t)}

# Feed one chunk of bytes.
def Parse.feed(bs: List<&2, U32>, ps: PS) -> PS:
  match ps:
    case PS{mode, kind, cur, nf, a, b, c, d, e, g}:
      Parse.go(Parse.classify(bs), mode, kind, cur, nf, a, b, c, d, e, g)

def Parse.start() -> PS:
  PS{MStart{}, 0, 0, 0, 0, 0, 0, 0, 0, G{0, 0, 0, Nil{}, Nil{}}}

# A read that failed marks the input bad.
def Parse.fail(ps: PS) -> PS:
  match ps:
    case PS{mode, kind, cur, nf, a, b, c, d, e, g}:
      PS{mode, kind, cur, nf, a, b, c, d, e, Parse.set_bad(True{}, g)}

def Parse.done3(ok: Bool, n: U32, prods: List<&2, U32>, facts: List<&2, F.Fact>) -> Maybe<Parsed>:
  match ok:
    case True{}:
      Some{Parsed{n, prods, List.reverse(&2, F.Fact, facts)}}
    case False{}:
      None{}

def Parse.done2(g: G) -> Maybe<Parsed>:
  match g:
    case G{n, hdr, bad, prods, facts}:
      Parse.done3(Bool.and(U32.is_eq(bad, 0), U32.is_eq(hdr, 1)), n, prods, facts)

def Parse.done1(ps: PS) -> Maybe<Parsed>:
  match ps:
    case PS{mode, kind, cur, nf, a, b, c, d, e, g}:
      Parse.done2(g)

# End of input: a final line without a newline is closed, then the header and
# the bad flag are checked.
def Parse.finish(ps: PS) -> Maybe<Parsed>:
  Parse.done1(Parse.feed(Con{10, Nil{}}, ps))
