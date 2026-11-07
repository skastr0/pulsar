# Rows.bend - fact lines to tagged rows (a reader; unproven, like Parse.bend).
#
# Parse.bend reads FACTS v0 with one tag byte. The v1 relations have tags of up
# to three bytes (`SV`, `LY`, `CFN`), so the detectors that read them use this
# generic reader: every line becomes `Row{tag, fields}`, where `tag` packs the
# tag's bytes big-endian into a U32 (`LY` is 76*256+89) and `fields` are its
# decimal U32 fields, in order. Each detector decodes the rows it reads and
# checks their field counts itself.
#
#   `#` lines and blank lines   ignored
#   `pulsar-facts 0` or `1`     header (a tag of five or more bytes, one field 0 or 1)
#   any other line              a row
# With `Rows.start_keep`, a line whose tag is not kept is skipped unread.
# Otherwise stray bytes or a number over 2^32-1 mark the input bad; `Rows.finish` then
# answers None. Like Parse.bend, the state carries over chunk boundaries, so the
# file's bytes are never all in memory.

import Base
import ./Parse.bend as P

type Row is Data:
  Row{tag: U32, fs: List<&2, U32>}

type RMode is Data:
  RStart{}
  RTag{}
  RGap{}
  RNum{}
  RSkip{}

# `keep`: None keeps every row; Some{tags} keeps only rows with those tags, so a
# caller that reads a few relations never holds the others.
type RG is Data:
  RG{hdr: U32, bad: U32, keep: Maybe<&2, List<&2, U32>>, rows: List<&2, Row>}

type RS is Data:
  RS{mode: RMode, tag: U32, cur: U32, fs: List<&2, U32>, g: RG}

# Tags of up to four bytes pack exactly; a longer tag reads as 4294967295.
def Rows.tag_add2(short: Bool, +t: U32, b: U32) -> U32:
  match short:
    case True{}:
      U32.add(U32.mul(t, 256), b)
    case False{}:
      4294967295

def Rows.tag_add(+t: U32, b: U32) -> U32:
  Rows.tag_add2(U32.is_lt(t, 16777216), t, b)

def Rows.bad(g: RG) -> RG:
  match g:
    case RG{hdr, bad, keep, rows}:
      RG{hdr, 1, keep, rows}

def Rows.ovf2(o: Bool, g: RG) -> RG:
  match o:
    case True{}:
      Rows.bad(g)
    case False{}:
      g

def Rows.hdr2(ok: Bool, g: RG) -> RG:
  match ok g:
    case True{} RG{hdr, bad, keep, rows}:
      RG{1, bad, keep, rows}
    case False{} g2:
      Rows.bad(g2)

def Rows.hdr(fs: List<&2, U32>, g: RG) -> RG:
  match fs g:
    case Con{x, Nil{}} RG{hdr, bad, keep, rows}:
      Rows.hdr2(U32.is_le(x, 1), RG{hdr, bad, keep, rows})
    case _ g2:
      Rows.bad(g2)

def Rows.mem(xs: List<&2, U32>, +x: U32) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case Con{h, t}:
      Bool.or(U32.is_eq(h, x), Rows.mem(t, x))

def Rows.wants(+keep: Maybe<&2, List<&2, U32>>, +tag: U32) -> Bool:
  match keep:
    case None{}:
      True{}
    case Some{l}:
      Rows.mem(l, tag)

def Rows.push2(want: Bool, tag: U32, fs: List<&2, U32>, hdr: U32, bad: U32, keep: Maybe<&2, List<&2, U32>>, rows: List<&2, Row>) -> RG:
  match want:
    case True{}:
      RG{hdr, bad, keep, Con{Row{tag, List.reverse(&2, U32, fs)}, rows}}
    case False{}:
      RG{hdr, bad, keep, rows}

def Rows.push(+tag: U32, fs: List<&2, U32>, g: RG) -> RG:
  match g:
    case RG{hdr, bad, +keep, rows}:
      Rows.push2(Rows.wants(keep, tag), tag, fs, hdr, bad, keep, rows)

# A line ends: `fs` holds its fields, last first.
def Rows.end_line(tag: U32, fs: List<&2, U32>, g: RG) -> RG:
  match tag:
    case 0:
      g
    case 4294967295:
      Rows.hdr(fs, g)
    case _:
      Rows.push(tag, fs, g)

def Rows.g_wants(+g: RG, +tag: U32) -> Bool:
  match g:
    case RG{hdr, bad, +keep, rows}:
      Bool.or(U32.is_eq(tag, 4294967295), Rows.wants(keep, tag))

# After a tag: read the fields of a kept row; skip the rest of any other line
# unread, as Parse.bend does for tags the engine does not consume.
def Rows.after_tag(want: Bool) -> RMode:
  match want:
    case True{}:
      RGap{}
    case False{}:
      RSkip{}

def Rows.go(bs: List<&2, P.Cls>, mode: RMode, +tag: U32, +cur: U32, fs: List<&2, U32>, +g: RG) -> RS:
  match bs:
    case Nil{}:
      RS{mode, tag, cur, fs, g}
    case Con{h, t}:
      match h mode:
        case P.CNl{} RSkip{}:
          Rows.go(t, RStart{}, 0, 0, Nil{}, g)
        case _ RSkip{}:
          Rows.go(t, RSkip{}, tag, cur, fs, g)
        case P.CNl{} RStart{}:
          Rows.go(t, RStart{}, 0, 0, Nil{}, g)
        case P.CWs{} RStart{}:
          Rows.go(t, RStart{}, 0, 0, Nil{}, g)
        case P.CHash{} RStart{}:
          Rows.go(t, RSkip{}, 0, 0, Nil{}, g)
        case P.CDig{x} RStart{}:
          Rows.go(t, RTag{}, U32.add(x, 48), 0, Nil{}, g)
        case P.COth{x} RStart{}:
          Rows.go(t, RTag{}, x, 0, Nil{}, g)
        case P.CNl{} RTag{}:
          Rows.go(t, RStart{}, 0, 0, Nil{}, Rows.end_line(tag, fs, g))
        case P.CWs{} RTag{}:
          Rows.go(t, Rows.after_tag(Rows.g_wants(g, tag)), tag, 0, fs, g)
        case P.CDig{x} RTag{}:
          Rows.go(t, RTag{}, Rows.tag_add(tag, U32.add(x, 48)), cur, fs, g)
        case P.COth{x} RTag{}:
          Rows.go(t, RTag{}, Rows.tag_add(tag, x), cur, fs, g)
        case P.CHash{} RTag{}:
          Rows.go(t, RTag{}, Rows.tag_add(tag, 35), cur, fs, g)
        case P.CNl{} RGap{}:
          Rows.go(t, RStart{}, 0, 0, Nil{}, Rows.end_line(tag, fs, g))
        case P.CWs{} RGap{}:
          Rows.go(t, RGap{}, tag, cur, fs, g)
        case P.CDig{x} RGap{}:
          Rows.go(t, RNum{}, tag, x, fs, g)
        case _ RGap{}:
          Rows.go(t, RSkip{}, tag, cur, fs, Rows.bad(g))
        case P.CNl{} RNum{}:
          Rows.go(t, RStart{}, 0, 0, Nil{}, Rows.end_line(tag, Con{cur, fs}, g))
        case P.CWs{} RNum{}:
          Rows.go(t, RGap{}, tag, 0, Con{cur, fs}, g)
        case P.CDig{+x} RNum{}:
          Rows.go(t, RNum{}, tag, P.Parse.mad(cur, x), fs, Rows.ovf2(P.Parse.ovf(cur, x), g))
        case _ RNum{}:
          Rows.go(t, RSkip{}, tag, cur, fs, Rows.bad(g))

def Rows.start() -> RS:
  RS{RStart{}, 0, 0, Nil{}, RG{0, 0, None{}, Nil{}}}

# Keep only the rows whose tag is listed; every line is still read and checked.
def Rows.start_keep(tags: List<&2, U32>) -> RS:
  RS{RStart{}, 0, 0, Nil{}, RG{0, 0, Some{tags}, Nil{}}}

def Rows.feed(bs: List<&2, U32>, s: RS) -> RS:
  match s:
    case RS{mode, tag, cur, fs, g}:
      Rows.go(P.Parse.classify(bs), mode, tag, cur, fs, g)

def Rows.fail(s: RS) -> RS:
  match s:
    case RS{mode, tag, cur, fs, g}:
      RS{mode, tag, cur, fs, Rows.bad(g)}

def Rows.done3(ok: Bool, rows: List<&2, Row>) -> Maybe<List<&2, Row>>:
  match ok:
    case True{}:
      Some{List.reverse(&2, Row, rows)}
    case False{}:
      None{}

def Rows.done2(g: RG) -> Maybe<List<&2, Row>>:
  match g:
    case RG{hdr, bad, keep, rows}:
      Rows.done3(Bool.and(U32.is_eq(bad, 0), U32.is_eq(hdr, 1)), rows)

def Rows.done1(s: RS) -> Maybe<List<&2, Row>>:
  match s:
    case RS{mode, tag, cur, fs, g}:
      Rows.done2(g)

# End of input: close a last line with no newline, then check header and bad flag.
def Rows.finish(s: RS) -> Maybe<List<&2, Row>>:
  Rows.done1(Rows.feed(Con{10, Nil{}}, s))
