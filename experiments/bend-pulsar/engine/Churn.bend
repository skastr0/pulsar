# Churn.bend - per-function churn from the git-history rows (A, C, CFN), for Hotspot.bend.
#
#   Churn.of(rows)   one Ch{fn, n} per function with n > 0, in function-id order, where
#                    n = CFN rows for fn with touched > 0 whose commit's author is not
#                    a bot. Rows with a wrong field count are ignored.
#
# Unproven, like the decoders: three passes over the rows with binary tries (bot
# authors, bot commits, per-function counts); the walk gives keys in order.

import Base
import ./Rows.bend as R
import ./Hotspot.bend as H

# A binary trie over U32 keys, most significant bit first; leaves count insertions.
type Tr is Data:
  TE{}
  TL{n: Nat}
  TN{z: Tr, o: Tr}

def Tr.bits(+d: Nat, +key: U32) -> List<&2, Bool>:
  match d:
    case 0n:
      Nil{}
    case 1n+p:
      Con{U32.is_eq(U32.and(U32.shrn(key, p), 1), 1), Tr.bits(p, key)}

def Tr.key(+key: U32) -> List<&2, Bool>:
  Tr.bits(32n, key)

def Tr.ins(bs: List<&2, Bool>, t: Tr) -> Tr:
  match bs t:
    case Nil{} TL{n}:
      TL{1n+n}
    case Nil{} _:
      TL{1n}
    case Con{False{}, rest} TN{z, o}:
      TN{Tr.ins(rest, z), o}
    case Con{True{}, rest} TN{z, o}:
      TN{z, Tr.ins(rest, o)}
    case Con{False{}, rest} _:
      TN{Tr.ins(rest, TE{}), TE{}}
    case Con{True{}, rest} _:
      TN{TE{}, Tr.ins(rest, TE{})}

def Tr.has(bs: List<&2, Bool>, t: Tr) -> Bool:
  match bs t:
    case Nil{} TL{n}:
      True{}
    case Con{False{}, rest} TN{z, o}:
      Tr.has(rest, z)
    case Con{True{}, rest} TN{z, o}:
      Tr.has(rest, o)
    case _ _:
      False{}

# Leaves in key order, as (key, count).
def Tr.walk(t: Tr, +prefix: U32, rest: List<&2, H.Ch>) -> List<&2, H.Ch>:
  match t:
    case TE{}:
      rest
    case TL{n}:
      Con{H.Ch{prefix, n}, rest}
    case TN{z, o}:
      Tr.walk(z, U32.shl(prefix), Tr.walk(o, U32.or(U32.shl(prefix), 1), rest))

# Row tags, packed as Rows.bend does: "A" 65, "C" 67, "CFN" 67*65536+70*256+78.
def Churn.tag_a() -> U32:
  65

def Churn.tag_c() -> U32:
  67

def Churn.tag_cfn() -> U32:
  4408910

def Churn.ok2(fs: List<&2, U32>) -> Bool:
  match fs:
    case Con{a, Con{b, Nil{}}}:
      True{}
    case _:
      False{}

def Churn.ok3(fs: List<&2, U32>) -> Bool:
  match fs:
    case Con{a, Con{b, Con{c, Nil{}}}}:
      True{}
    case _:
      False{}

def Churn.f0(fs: List<&2, U32>) -> U32:
  match fs:
    case Con{a, t}:
      a
    case Nil{}:
      0

def Churn.f1(fs: List<&2, U32>) -> U32:
  match fs:
    case Con{a, Con{b, t}}:
      b
    case _:
      0

def Churn.f2(fs: List<&2, U32>) -> U32:
  match fs:
    case Con{a, Con{b, Con{c, t}}}:
      c
    case _:
      0

def Churn.add_if(hit: Bool, +key: U32, t: Tr) -> Tr:
  match hit:
    case True{}:
      Tr.ins(Tr.key(key), t)
    case False{}:
      t

# Pass 1: authors that are bots.
def Churn.bots(rows: List<&2, R.Row>, t: Tr) -> Tr:
  match rows:
    case Nil{}:
      t
    case Con{R.Row{tag, +fs}, rest}:
      Churn.bots(rest, Churn.add_if(Bool.and(U32.is_eq(tag, Churn.tag_a()), Bool.and(Churn.ok2(fs), U32.is_eq(Churn.f1(fs), 1))), Churn.f0(fs), t))

# Pass 2: commits whose author is a bot.
def Churn.bot_commits(rows: List<&2, R.Row>, +ba: Tr, t: Tr) -> Tr:
  match rows:
    case Nil{}:
      t
    case Con{R.Row{tag, +fs}, rest}:
      Churn.bot_commits(rest, ba, Churn.add_if(Bool.and(U32.is_eq(tag, Churn.tag_c()), Bool.and(Churn.ok3(fs), Tr.has(Tr.key(Churn.f1(fs)), ba))), Churn.f0(fs), t))

# Pass 3: one count per CFN row with touched > 0 from a non-bot commit.
def Churn.count(rows: List<&2, R.Row>, +bc: Tr, t: Tr) -> Tr:
  match rows:
    case Nil{}:
      t
    case Con{R.Row{tag, +fs}, rest}:
      Churn.count(rest, bc, Churn.add_if(Bool.and(U32.is_eq(tag, Churn.tag_cfn()), Bool.and(Churn.ok3(fs), Bool.and(U32.is_gt(Churn.f2(fs), 0), Bool.not(Tr.has(Tr.key(Churn.f0(fs)), bc))))), Churn.f1(fs), t))

# Every function with churn > 0, in id order.
def Churn.of(+rows: List<&2, R.Row>) -> List<&2, H.Ch>:
  Tr.walk(Churn.count(rows, Churn.bot_commits(rows, Churn.bots(rows, TE{}), TE{}), TE{}), 0, Nil{})

