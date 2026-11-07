# Lex.bend - TypeScript token scanner (pure core).
#
# Turns source text into a token stream that is just rich enough to recognise
# module specifiers. It is NOT a TypeScript lexer: it only has to be right
# about where comments, string literals, template literals, regex literals and
# identifiers begin and end, so that specifier-like text inside them is never
# reported.
#
# Shape: one token per iteration of `loop`. Runs of characters that cannot
# matter (whitespace, comments, string bodies, regex bodies, identifiers) are
# consumed by small tail-recursive skippers instead of a per-character state
# machine. `loop` is fuel-driven (fuel = length of the text; every iteration
# consumes at least one character), which is what lets it call skippers whose
# result is a computed remainder while still passing Bend's termination check.
#
# Deliberate approximations (see README.md):
#  - regex-vs-division is decided from the previous token (heuristic)
#  - JSX text is not modelled; an apostrophe in JSX text opens a string that is
#    force-closed at the end of the line
#  - string escapes are kept raw (module specifiers never need them)
#  - string/template text is only kept when the previous token is `from`,
#    `import` or `(`; every other string becomes an empty TStr
#  - non-ASCII identifier characters split identifiers (they never matter)

import Base

type Tok is Data:
  TImport{}
  TExport{}
  TFrom{}
  TType{}
  TAs{}
  TRequire{}
  TWord{}
  TStr{text: String}
  TOpaque{}
  TP{c: Char}


# Result of scanning one identifier: reversed text and the remainder.
type Wr is Data:
  Wr{acc: String, rest: String}

# Result of scanning a string or template body: reversed text, remainder, and
# whether the closing delimiter was found (for templates: no `${` was met).
type Sr is Data:
  Sr{rest: String, text: String, closed: Bool}

# Scanner state: remaining text, template brace counters, whether a `/` here
# would start a regex, and the reversed token output.
type FS is Type:
  FS{s: String, stk: List<&2, U32>, rx: Bool, out: List<&2, Tok>}

def Lex.classify(w: String) -> Tok:
  match w:
    case SCon{'i', SCon{'m', SCon{'p', SCon{'o', SCon{'r', SCon{'t', SNil{}}}}}}}:
      TImport{}
    case SCon{'e', SCon{'x', SCon{'p', SCon{'o', SCon{'r', SCon{'t', SNil{}}}}}}}:
      TExport{}
    case SCon{'f', SCon{'r', SCon{'o', SCon{'m', SNil{}}}}}:
      TFrom{}
    case SCon{'t', SCon{'y', SCon{'p', SCon{'e', SNil{}}}}}:
      TType{}
    case SCon{'a', SCon{'s', SNil{}}}:
      TAs{}
    case SCon{'r', SCon{'e', SCon{'q', SCon{'u', SCon{'i', SCon{'r', SCon{'e', SNil{}}}}}}}}:
      TRequire{}
    case _:
      TWord{}

# After these words a `/` starts a regex rather than a division.
def Lex.rx_word(w: String) -> Bool:
  match w:
    case SCon{'r', SCon{'e', SCon{'t', SCon{'u', SCon{'r', SCon{'n', SNil{}}}}}}}:
      True{}
    case SCon{'t', SCon{'y', SCon{'p', SCon{'e', SCon{'o', SCon{'f', SNil{}}}}}}}:
      True{}
    case SCon{'c', SCon{'a', SCon{'s', SCon{'e', SNil{}}}}}:
      True{}
    case SCon{'i', SCon{'n', SNil{}}}:
      True{}
    case SCon{'o', SCon{'f', SNil{}}}:
      True{}
    case SCon{'d', SCon{'e', SCon{'l', SCon{'e', SCon{'t', SCon{'e', SNil{}}}}}}}:
      True{}
    case SCon{'v', SCon{'o', SCon{'i', SCon{'d', SNil{}}}}}:
      True{}
    case SCon{'t', SCon{'h', SCon{'r', SCon{'o', SCon{'w', SNil{}}}}}}:
      True{}
    case SCon{'n', SCon{'e', SCon{'w', SNil{}}}}:
      True{}
    case SCon{'a', SCon{'w', SCon{'a', SCon{'i', SCon{'t', SNil{}}}}}}:
      True{}
    case SCon{'y', SCon{'i', SCon{'e', SCon{'l', SCon{'d', SNil{}}}}}}:
      True{}
    case SCon{'e', SCon{'l', SCon{'s', SCon{'e', SNil{}}}}}:
      True{}
    case SCon{'d', SCon{'o', SNil{}}}:
      True{}
    case SCon{'i', SCon{'n', SCon{'s', SCon{'t', SCon{'a', SCon{'n', SCon{'c', SCon{'e', SCon{'o', SCon{'f', SNil{}}}}}}}}}}}:
      True{}
    case _:
      False{}

# ---- character classes -------------------------------------------------------------
def Lex.in_range(+x: U32, lo: U32, hi: U32) -> Bool:
  Bool.and(U32.is_ge(x, lo), U32.is_le(x, hi))

# Non-ASCII characters only: ASCII is handled by literal patterns.
def Lex.is_high(c: Char) -> Bool:
  match c:
    case Chr{x}:
      U32.is_ge(x, 128)

# Punctuation after which a `/` is a division (and after `<`, for JSX `</`).
def Lex.ends_expr(c: Char) -> Bool:
  match c:
    case ')':
      True{}
    case ']':
      True{}
    case '}':
      True{}
    case '<':
      True{}
    case _:
      False{}

# ---- skippers (tail-recursive, no per-character state) ---------------------------------
def Lex.skip_ws(s: String) -> String:
  match s:
    case SCon{' ', t}:
      Lex.skip_ws(t)
    case SCon{'\n', t}:
      Lex.skip_ws(t)
    case SCon{'\t', t}:
      Lex.skip_ws(t)
    case SCon{'\r', t}:
      Lex.skip_ws(t)
    case other:
      other

# Up to and including the end of the line.
def Lex.skip_line(s: String) -> String:
  match s:
    case SCon{'\n', t}:
      t
    case SCon{_, t}:
      Lex.skip_line(t)
    case SNil{}:
      SNil{}

# Up to and including the closing `*/`.
def Lex.skip_block(s: String) -> String:
  match s:
    case SCon{'*', SCon{'/', t}}:
      t
    case SCon{_, t}:
      Lex.skip_block(t)
    case SNil{}:
      SNil{}

# Regex body, after the opening `/`. `cls` is true inside `[...]`.
def Lex.skip_regex(s: String, cls: Bool) -> String:
  match s cls:
    case SCon{'\\', SCon{_, t}} _:
      Lex.skip_regex(t, cls)
    case SCon{'[', t} _:
      Lex.skip_regex(t, True{})
    case SCon{']', t} _:
      Lex.skip_regex(t, False{})
    case SCon{'/', t} False{}:
      t
    case SCon{'\n', t} _:
      t
    case SCon{_, t} _:
      Lex.skip_regex(t, cls)
    case SNil{} _:
      SNil{}

# Identifier characters: [A-Za-z0-9_$].
def Lex.span_ident(s: String, acc: String) -> Wr:
  match s:
    case SCon{'a', t}:
      Lex.span_ident(t, SCon{'a', acc})
    case SCon{'b', t}:
      Lex.span_ident(t, SCon{'b', acc})
    case SCon{'c', t}:
      Lex.span_ident(t, SCon{'c', acc})
    case SCon{'d', t}:
      Lex.span_ident(t, SCon{'d', acc})
    case SCon{'e', t}:
      Lex.span_ident(t, SCon{'e', acc})
    case SCon{'f', t}:
      Lex.span_ident(t, SCon{'f', acc})
    case SCon{'g', t}:
      Lex.span_ident(t, SCon{'g', acc})
    case SCon{'h', t}:
      Lex.span_ident(t, SCon{'h', acc})
    case SCon{'i', t}:
      Lex.span_ident(t, SCon{'i', acc})
    case SCon{'j', t}:
      Lex.span_ident(t, SCon{'j', acc})
    case SCon{'k', t}:
      Lex.span_ident(t, SCon{'k', acc})
    case SCon{'l', t}:
      Lex.span_ident(t, SCon{'l', acc})
    case SCon{'m', t}:
      Lex.span_ident(t, SCon{'m', acc})
    case SCon{'n', t}:
      Lex.span_ident(t, SCon{'n', acc})
    case SCon{'o', t}:
      Lex.span_ident(t, SCon{'o', acc})
    case SCon{'p', t}:
      Lex.span_ident(t, SCon{'p', acc})
    case SCon{'q', t}:
      Lex.span_ident(t, SCon{'q', acc})
    case SCon{'r', t}:
      Lex.span_ident(t, SCon{'r', acc})
    case SCon{'s', t}:
      Lex.span_ident(t, SCon{'s', acc})
    case SCon{'t', t}:
      Lex.span_ident(t, SCon{'t', acc})
    case SCon{'u', t}:
      Lex.span_ident(t, SCon{'u', acc})
    case SCon{'v', t}:
      Lex.span_ident(t, SCon{'v', acc})
    case SCon{'w', t}:
      Lex.span_ident(t, SCon{'w', acc})
    case SCon{'x', t}:
      Lex.span_ident(t, SCon{'x', acc})
    case SCon{'y', t}:
      Lex.span_ident(t, SCon{'y', acc})
    case SCon{'z', t}:
      Lex.span_ident(t, SCon{'z', acc})
    case SCon{'A', t}:
      Lex.span_ident(t, SCon{'A', acc})
    case SCon{'B', t}:
      Lex.span_ident(t, SCon{'B', acc})
    case SCon{'C', t}:
      Lex.span_ident(t, SCon{'C', acc})
    case SCon{'D', t}:
      Lex.span_ident(t, SCon{'D', acc})
    case SCon{'E', t}:
      Lex.span_ident(t, SCon{'E', acc})
    case SCon{'F', t}:
      Lex.span_ident(t, SCon{'F', acc})
    case SCon{'G', t}:
      Lex.span_ident(t, SCon{'G', acc})
    case SCon{'H', t}:
      Lex.span_ident(t, SCon{'H', acc})
    case SCon{'I', t}:
      Lex.span_ident(t, SCon{'I', acc})
    case SCon{'J', t}:
      Lex.span_ident(t, SCon{'J', acc})
    case SCon{'K', t}:
      Lex.span_ident(t, SCon{'K', acc})
    case SCon{'L', t}:
      Lex.span_ident(t, SCon{'L', acc})
    case SCon{'M', t}:
      Lex.span_ident(t, SCon{'M', acc})
    case SCon{'N', t}:
      Lex.span_ident(t, SCon{'N', acc})
    case SCon{'O', t}:
      Lex.span_ident(t, SCon{'O', acc})
    case SCon{'P', t}:
      Lex.span_ident(t, SCon{'P', acc})
    case SCon{'Q', t}:
      Lex.span_ident(t, SCon{'Q', acc})
    case SCon{'R', t}:
      Lex.span_ident(t, SCon{'R', acc})
    case SCon{'S', t}:
      Lex.span_ident(t, SCon{'S', acc})
    case SCon{'T', t}:
      Lex.span_ident(t, SCon{'T', acc})
    case SCon{'U', t}:
      Lex.span_ident(t, SCon{'U', acc})
    case SCon{'V', t}:
      Lex.span_ident(t, SCon{'V', acc})
    case SCon{'W', t}:
      Lex.span_ident(t, SCon{'W', acc})
    case SCon{'X', t}:
      Lex.span_ident(t, SCon{'X', acc})
    case SCon{'Y', t}:
      Lex.span_ident(t, SCon{'Y', acc})
    case SCon{'Z', t}:
      Lex.span_ident(t, SCon{'Z', acc})
    case SCon{'0', t}:
      Lex.span_ident(t, SCon{'0', acc})
    case SCon{'1', t}:
      Lex.span_ident(t, SCon{'1', acc})
    case SCon{'2', t}:
      Lex.span_ident(t, SCon{'2', acc})
    case SCon{'3', t}:
      Lex.span_ident(t, SCon{'3', acc})
    case SCon{'4', t}:
      Lex.span_ident(t, SCon{'4', acc})
    case SCon{'5', t}:
      Lex.span_ident(t, SCon{'5', acc})
    case SCon{'6', t}:
      Lex.span_ident(t, SCon{'6', acc})
    case SCon{'7', t}:
      Lex.span_ident(t, SCon{'7', acc})
    case SCon{'8', t}:
      Lex.span_ident(t, SCon{'8', acc})
    case SCon{'9', t}:
      Lex.span_ident(t, SCon{'9', acc})
    case SCon{'_', t}:
      Lex.span_ident(t, SCon{'_', acc})
    case SCon{'$', t}:
      Lex.span_ident(t, SCon{'$', acc})
    case other:
      Wr{acc, other}

def Lex.skip_dq(s: String, acc: String) -> Sr:
  match s:
    case SCon{'\\', SCon{c2, t}}:
      Lex.skip_dq(t, SCon{c2, SCon{'\\', acc}})
    case SCon{'"', t}:
      Sr{t, acc, True{}}
    case SCon{'\n', t}:
      Sr{t, acc, False{}}
    case SCon{c, t}:
      Lex.skip_dq(t, SCon{c, acc})
    case SNil{}:
      Sr{SNil{}, acc, False{}}

def Lex.skip_dq0(s: String) -> Sr:
  match s:
    case SCon{'\\', SCon{_, t}}:
      Lex.skip_dq0(t)
    case SCon{'"', t}:
      Sr{t, SNil{}, True{}}
    case SCon{'\n', t}:
      Sr{t, SNil{}, False{}}
    case SCon{_, t}:
      Lex.skip_dq0(t)
    case SNil{}:
      Sr{SNil{}, SNil{}, False{}}

def Lex.skip_sq(s: String, acc: String) -> Sr:
  match s:
    case SCon{'\\', SCon{c2, t}}:
      Lex.skip_sq(t, SCon{c2, SCon{'\\', acc}})
    case SCon{'\'', t}:
      Sr{t, acc, True{}}
    case SCon{'\n', t}:
      Sr{t, acc, False{}}
    case SCon{c, t}:
      Lex.skip_sq(t, SCon{c, acc})
    case SNil{}:
      Sr{SNil{}, acc, False{}}

def Lex.skip_sq0(s: String) -> Sr:
  match s:
    case SCon{'\\', SCon{_, t}}:
      Lex.skip_sq0(t)
    case SCon{'\'', t}:
      Sr{t, SNil{}, True{}}
    case SCon{'\n', t}:
      Sr{t, SNil{}, False{}}
    case SCon{_, t}:
      Lex.skip_sq0(t)
    case SNil{}:
      Sr{SNil{}, SNil{}, False{}}

# Template body: closed = true at the closing backtick, false at `${`.
def Lex.skip_tpl(s: String, acc: String) -> Sr:
  match s:
    case SCon{'\\', SCon{c2, t}}:
      Lex.skip_tpl(t, SCon{c2, SCon{'\\', acc}})
    case SCon{'`', t}:
      Sr{t, acc, True{}}
    case SCon{'$', SCon{'{', t}}:
      Sr{t, acc, False{}}
    case SCon{c, t}:
      Lex.skip_tpl(t, SCon{c, acc})
    case SNil{}:
      Sr{SNil{}, acc, True{}}

def Lex.skip_tpl0(s: String) -> Sr:
  match s:
    case SCon{'\\', SCon{_, t}}:
      Lex.skip_tpl0(t)
    case SCon{'`', t}:
      Sr{t, SNil{}, True{}}
    case SCon{'$', SCon{'{', t}}:
      Sr{t, SNil{}, False{}}
    case SCon{_, t}:
      Lex.skip_tpl0(t)
    case SNil{}:
      Sr{SNil{}, SNil{}, True{}}

# ---- token constructors -------------------------------------------------------------------
# Strings are only worth keeping right after `from`, `import` or `(`.
def Lex.need_text(out: List<&2, Tok>) -> Bool:
  match out:
    case Con{TFrom{}, _}:
      True{}
    case Con{TImport{}, _}:
      True{}
    case Con{TP{'('}, _}:
      True{}
    case _:
      False{}

def Lex.str_done(sr: Sr, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match sr:
    case Sr{rest, text, closed}:
      match closed:
        case True{}:
          FS{rest, stk, False{}, Con{TStr{String.reverse(text)}, out}}
        case False{}:
          FS{rest, stk, True{}, Con{TOpaque{}, out}}

def Lex.str_dq(need: Bool, t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match need:
    case True{}:
      Lex.str_done(Lex.skip_dq(t, SNil{}), stk, out)
    case False{}:
      Lex.str_done(Lex.skip_dq0(t), stk, out)

def Lex.str_sq(need: Bool, t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match need:
    case True{}:
      Lex.str_done(Lex.skip_sq(t, SNil{}), stk, out)
    case False{}:
      Lex.str_done(Lex.skip_sq0(t), stk, out)

# `first` = no `${` seen yet, so the body is a plain string.
def Lex.tpl_tok(first: Bool, rest: String, text: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match first:
    case True{}:
      FS{rest, stk, False{}, Con{TStr{String.reverse(text)}, out}}
    case False{}:
      FS{rest, stk, False{}, Con{TOpaque{}, out}}

# After a template body: closed -> a token, `${` -> enter code with brace depth 0.
def Lex.tpl_done(first: Bool, sr: Sr, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match sr:
    case Sr{rest, text, closed}:
      match closed:
        case True{}:
          Lex.tpl_tok(first, rest, text, stk, out)
        case False{}:
          FS{rest, Con{0, stk}, True{}, out}

def Lex.tpl_start(need: Bool, t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match need:
    case True{}:
      Lex.tpl_done(True{}, Lex.skip_tpl(t, SNil{}), stk, out)
    case False{}:
      Lex.tpl_done(True{}, Lex.skip_tpl0(t), stk, out)

def Lex.ident_tok(+w: String, rest: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  FS{rest, stk, Lex.rx_word(w), Con{Lex.classify(w), out}}

def Lex.ident_done(wr: Wr, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match wr:
    case Wr{acc, rest}:
      Lex.ident_tok(String.reverse(acc), rest, stk, out)

def Lex.punct(+c: Char, t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  FS{t, stk, Bool.not(Lex.ends_expr(c)), Con{TP{c}, out}}

def Lex.slash_other(rx: Bool, t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match rx:
    case True{}:
      FS{Lex.skip_regex(t, False{}), stk, False{}, Con{TOpaque{}, out}}
    case False{}:
      FS{t, stk, True{}, Con{TP{'/'}, out}}

def Lex.slash(t: String, stk: List<&2, U32>, rx: Bool, out: List<&2, Tok>) -> FS:
  match t:
    case SCon{'/', t2}:
      FS{Lex.skip_line(t2), stk, rx, out}
    case SCon{'*', t2}:
      FS{Lex.skip_block(t2), stk, rx, out}
    case _:
      Lex.slash_other(rx, t, stk, out)

def Lex.open_brace(t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match stk:
    case Nil{}:
      FS{t, Nil{}, True{}, Con{TP{'{'}, out}}
    case Con{d, rest}:
      FS{t, Con{U32.add(d, 1), rest}, True{}, Con{TP{'{'}, out}}

def Lex.close_depth(top: Bool, +d: U32, t: String, rest: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match top:
    case True{}:
      Lex.tpl_done(False{}, Lex.skip_tpl0(t), rest, out)
    case False{}:
      FS{t, Con{U32.sub(d, 1), rest}, False{}, Con{TP{'}'}, out}}

def Lex.close_brace(t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match stk:
    case Nil{}:
      FS{t, Nil{}, False{}, Con{TP{'}'}, out}}
    case Con{+d, rest}:
      Lex.close_depth(U32.is_eq(d, 0), d, t, rest, out)

# Anything not handled by a literal case: non-ASCII starts an identifier,
# everything else is punctuation.
def Lex.other2(high: Bool, +c: Char, t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match high:
    case True{}:
      Lex.ident_done(Lex.span_ident(t, SCon{c, SNil{}}), stk, out)
    case False{}:
      Lex.punct(c, t, stk, out)

def Lex.other(+c: Char, t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  Lex.other2(Lex.is_high(c), c, t, stk, out)

# Identifier characters [A-Za-z0-9_$]: skip the run without building it.
def Lex.skip_ident(s: String) -> String:
  match s:
    case SCon{'a', t}:
      Lex.skip_ident(t)
    case SCon{'b', t}:
      Lex.skip_ident(t)
    case SCon{'c', t}:
      Lex.skip_ident(t)
    case SCon{'d', t}:
      Lex.skip_ident(t)
    case SCon{'e', t}:
      Lex.skip_ident(t)
    case SCon{'f', t}:
      Lex.skip_ident(t)
    case SCon{'g', t}:
      Lex.skip_ident(t)
    case SCon{'h', t}:
      Lex.skip_ident(t)
    case SCon{'i', t}:
      Lex.skip_ident(t)
    case SCon{'j', t}:
      Lex.skip_ident(t)
    case SCon{'k', t}:
      Lex.skip_ident(t)
    case SCon{'l', t}:
      Lex.skip_ident(t)
    case SCon{'m', t}:
      Lex.skip_ident(t)
    case SCon{'n', t}:
      Lex.skip_ident(t)
    case SCon{'o', t}:
      Lex.skip_ident(t)
    case SCon{'p', t}:
      Lex.skip_ident(t)
    case SCon{'q', t}:
      Lex.skip_ident(t)
    case SCon{'r', t}:
      Lex.skip_ident(t)
    case SCon{'s', t}:
      Lex.skip_ident(t)
    case SCon{'t', t}:
      Lex.skip_ident(t)
    case SCon{'u', t}:
      Lex.skip_ident(t)
    case SCon{'v', t}:
      Lex.skip_ident(t)
    case SCon{'w', t}:
      Lex.skip_ident(t)
    case SCon{'x', t}:
      Lex.skip_ident(t)
    case SCon{'y', t}:
      Lex.skip_ident(t)
    case SCon{'z', t}:
      Lex.skip_ident(t)
    case SCon{'A', t}:
      Lex.skip_ident(t)
    case SCon{'B', t}:
      Lex.skip_ident(t)
    case SCon{'C', t}:
      Lex.skip_ident(t)
    case SCon{'D', t}:
      Lex.skip_ident(t)
    case SCon{'E', t}:
      Lex.skip_ident(t)
    case SCon{'F', t}:
      Lex.skip_ident(t)
    case SCon{'G', t}:
      Lex.skip_ident(t)
    case SCon{'H', t}:
      Lex.skip_ident(t)
    case SCon{'I', t}:
      Lex.skip_ident(t)
    case SCon{'J', t}:
      Lex.skip_ident(t)
    case SCon{'K', t}:
      Lex.skip_ident(t)
    case SCon{'L', t}:
      Lex.skip_ident(t)
    case SCon{'M', t}:
      Lex.skip_ident(t)
    case SCon{'N', t}:
      Lex.skip_ident(t)
    case SCon{'O', t}:
      Lex.skip_ident(t)
    case SCon{'P', t}:
      Lex.skip_ident(t)
    case SCon{'Q', t}:
      Lex.skip_ident(t)
    case SCon{'R', t}:
      Lex.skip_ident(t)
    case SCon{'S', t}:
      Lex.skip_ident(t)
    case SCon{'T', t}:
      Lex.skip_ident(t)
    case SCon{'U', t}:
      Lex.skip_ident(t)
    case SCon{'V', t}:
      Lex.skip_ident(t)
    case SCon{'W', t}:
      Lex.skip_ident(t)
    case SCon{'X', t}:
      Lex.skip_ident(t)
    case SCon{'Y', t}:
      Lex.skip_ident(t)
    case SCon{'Z', t}:
      Lex.skip_ident(t)
    case SCon{'0', t}:
      Lex.skip_ident(t)
    case SCon{'1', t}:
      Lex.skip_ident(t)
    case SCon{'2', t}:
      Lex.skip_ident(t)
    case SCon{'3', t}:
      Lex.skip_ident(t)
    case SCon{'4', t}:
      Lex.skip_ident(t)
    case SCon{'5', t}:
      Lex.skip_ident(t)
    case SCon{'6', t}:
      Lex.skip_ident(t)
    case SCon{'7', t}:
      Lex.skip_ident(t)
    case SCon{'8', t}:
      Lex.skip_ident(t)
    case SCon{'9', t}:
      Lex.skip_ident(t)
    case SCon{'_', t}:
      Lex.skip_ident(t)
    case SCon{'$', t}:
      Lex.skip_ident(t)
    case other:
      other

def Lex.id_head(s: String) -> Bool:
  match s:
    case SCon{'a', _}:
      True{}
    case SCon{'b', _}:
      True{}
    case SCon{'c', _}:
      True{}
    case SCon{'d', _}:
      True{}
    case SCon{'e', _}:
      True{}
    case SCon{'f', _}:
      True{}
    case SCon{'g', _}:
      True{}
    case SCon{'h', _}:
      True{}
    case SCon{'i', _}:
      True{}
    case SCon{'j', _}:
      True{}
    case SCon{'k', _}:
      True{}
    case SCon{'l', _}:
      True{}
    case SCon{'m', _}:
      True{}
    case SCon{'n', _}:
      True{}
    case SCon{'o', _}:
      True{}
    case SCon{'p', _}:
      True{}
    case SCon{'q', _}:
      True{}
    case SCon{'r', _}:
      True{}
    case SCon{'s', _}:
      True{}
    case SCon{'t', _}:
      True{}
    case SCon{'u', _}:
      True{}
    case SCon{'v', _}:
      True{}
    case SCon{'w', _}:
      True{}
    case SCon{'x', _}:
      True{}
    case SCon{'y', _}:
      True{}
    case SCon{'z', _}:
      True{}
    case SCon{'A', _}:
      True{}
    case SCon{'B', _}:
      True{}
    case SCon{'C', _}:
      True{}
    case SCon{'D', _}:
      True{}
    case SCon{'E', _}:
      True{}
    case SCon{'F', _}:
      True{}
    case SCon{'G', _}:
      True{}
    case SCon{'H', _}:
      True{}
    case SCon{'I', _}:
      True{}
    case SCon{'J', _}:
      True{}
    case SCon{'K', _}:
      True{}
    case SCon{'L', _}:
      True{}
    case SCon{'M', _}:
      True{}
    case SCon{'N', _}:
      True{}
    case SCon{'O', _}:
      True{}
    case SCon{'P', _}:
      True{}
    case SCon{'Q', _}:
      True{}
    case SCon{'R', _}:
      True{}
    case SCon{'S', _}:
      True{}
    case SCon{'T', _}:
      True{}
    case SCon{'U', _}:
      True{}
    case SCon{'V', _}:
      True{}
    case SCon{'W', _}:
      True{}
    case SCon{'X', _}:
      True{}
    case SCon{'Y', _}:
      True{}
    case SCon{'Z', _}:
      True{}
    case SCon{'0', _}:
      True{}
    case SCon{'1', _}:
      True{}
    case SCon{'2', _}:
      True{}
    case SCon{'3', _}:
      True{}
    case SCon{'4', _}:
      True{}
    case SCon{'5', _}:
      True{}
    case SCon{'6', _}:
      True{}
    case SCon{'7', _}:
      True{}
    case SCon{'8', _}:
      True{}
    case SCon{'9', _}:
      True{}
    case SCon{'_', _}:
      True{}
    case SCon{'$', _}:
      True{}
    case _:
      False{}

# A generic identifier or number: no token text is built.
def Lex.plain(t: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  FS{Lex.skip_ident(t), stk, False{}, Con{TWord{}, out}}

def Lex.kw_end2(isid: Bool, tok: Tok, rx: Bool, after: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match isid:
    case True{}:
      FS{Lex.skip_ident(after), stk, False{}, Con{TWord{}, out}}
    case False{}:
      FS{after, stk, rx, Con{tok, out}}

def Lex.kw_end(tok: Tok, rx: Bool, +after: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  Lex.kw_end2(Lex.id_head(after), tok, rx, after, stk, out)

def Lex.t_awai(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'t', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_awa(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'i', t}:
      Lex.t_awai(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_aw(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'a', t}:
      Lex.t_awa(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

# Keyword recognition as a trie: one small function per prefix (a single deeply
# nested match makes the Bend compiler overflow its stack). The function for
# prefix p receives the text after p.
def Lex.t_a(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'s', t}:
      Lex.kw_end(TAs{}, False{}, t, stk, out)
    case SCon{'w', t}:
      Lex.t_aw(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_cas(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_ca(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'s', t}:
      Lex.t_cas(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_c(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'a', t}:
      Lex.t_ca(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_delet(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_dele(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'t', t}:
      Lex.t_delet(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_del(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.t_dele(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_de(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'l', t}:
      Lex.t_del(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_d(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.t_de(t, stk, out)
    case SCon{'o', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_els(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_el(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'s', t}:
      Lex.t_els(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_expor(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'t', t}:
      Lex.kw_end(TExport{}, False{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_expo(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'r', t}:
      Lex.t_expor(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_exp(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'o', t}:
      Lex.t_expo(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_ex(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'p', t}:
      Lex.t_exp(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_e(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'l', t}:
      Lex.t_el(t, stk, out)
    case SCon{'x', t}:
      Lex.t_ex(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_fro(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'m', t}:
      Lex.kw_end(TFrom{}, False{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_fr(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'o', t}:
      Lex.t_fro(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_f(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'r', t}:
      Lex.t_fr(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_impor(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'t', t}:
      Lex.kw_end(TImport{}, False{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_impo(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'r', t}:
      Lex.t_impor(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_imp(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'o', t}:
      Lex.t_impo(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_im(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'p', t}:
      Lex.t_imp(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_instanceo(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'f', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_instance(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'o', t}:
      Lex.t_instanceo(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_instanc(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.t_instance(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_instan(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'c', t}:
      Lex.t_instanc(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_insta(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'n', t}:
      Lex.t_instan(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_inst(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'a', t}:
      Lex.t_insta(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_ins(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'t', t}:
      Lex.t_inst(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_in(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'s', t}:
      Lex.t_ins(t, stk, out)
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_i(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'m', t}:
      Lex.t_im(t, stk, out)
    case SCon{'n', t}:
      Lex.t_in(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_ne(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'w', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_n(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.t_ne(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_o(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'f', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_requir(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.kw_end(TRequire{}, False{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_requi(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'r', t}:
      Lex.t_requir(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_requ(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'i', t}:
      Lex.t_requi(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_req(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'u', t}:
      Lex.t_requ(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_retur(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'n', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_retu(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'r', t}:
      Lex.t_retur(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_ret(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'u', t}:
      Lex.t_retu(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_re(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'q', t}:
      Lex.t_req(t, stk, out)
    case SCon{'t', t}:
      Lex.t_ret(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_r(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.t_re(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_thro(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'w', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_thr(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'o', t}:
      Lex.t_thro(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_th(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'r', t}:
      Lex.t_thr(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_typeo(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'f', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_type(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'o', t}:
      Lex.t_typeo(t, stk, out)
    case other:
      Lex.kw_end(TType{}, False{}, other, stk, out)

def Lex.t_typ(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.t_type(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_ty(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'p', t}:
      Lex.t_typ(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_t(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'h', t}:
      Lex.t_th(t, stk, out)
    case SCon{'y', t}:
      Lex.t_ty(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_voi(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'d', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_vo(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'i', t}:
      Lex.t_voi(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_v(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'o', t}:
      Lex.t_vo(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_yiel(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'d', t}:
      Lex.kw_end(TWord{}, True{}, t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_yie(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'l', t}:
      Lex.t_yiel(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_yi(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'e', t}:
      Lex.t_yie(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_y(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case SCon{'i', t}:
      Lex.t_yi(t, stk, out)
    case other:
      FS{Lex.skip_ident(other), stk, False{}, Con{TWord{}, out}}

def Lex.t_as(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TAs{}, False{}, other, stk, out)

def Lex.t_do(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_of(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_new(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_case(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_else(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_from(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TFrom{}, False{}, other, stk, out)

def Lex.t_void(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_await(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_throw(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_yield(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_delete(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_export(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TExport{}, False{}, other, stk, out)

def Lex.t_import(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TImport{}, False{}, other, stk, out)

def Lex.t_return(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_typeof(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

def Lex.t_require(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TRequire{}, False{}, other, stk, out)

def Lex.t_instanceof(s: String, stk: List<&2, U32>, out: List<&2, Tok>) -> FS:
  match s:
    case other:
      Lex.kw_end(TWord{}, True{}, other, stk, out)

# ---- driver --------------------------------------------------------------------------------------
def Lex.disp(+c: Char, t: String, stk: List<&2, U32>, rx: Bool, +out: List<&2, Tok>) -> FS:
  match c:
    case ' ':
      FS{Lex.skip_ws(t), stk, rx, out}
    case '\n':
      FS{Lex.skip_ws(t), stk, rx, out}
    case '\t':
      FS{Lex.skip_ws(t), stk, rx, out}
    case '\r':
      FS{Lex.skip_ws(t), stk, rx, out}
    case '/':
      Lex.slash(t, stk, rx, out)
    case '"':
      Lex.str_dq(Lex.need_text(out), t, stk, out)
    case '\'':
      Lex.str_sq(Lex.need_text(out), t, stk, out)
    case '`':
      Lex.tpl_start(Lex.need_text(out), t, stk, out)
    case '{':
      Lex.open_brace(t, stk, out)
    case '}':
      Lex.close_brace(t, stk, out)
    case 'a':
      Lex.t_a(t, stk, out)
    case 'b':
      Lex.plain(t, stk, out)
    case 'c':
      Lex.t_c(t, stk, out)
    case 'd':
      Lex.t_d(t, stk, out)
    case 'e':
      Lex.t_e(t, stk, out)
    case 'f':
      Lex.t_f(t, stk, out)
    case 'g':
      Lex.plain(t, stk, out)
    case 'h':
      Lex.plain(t, stk, out)
    case 'i':
      Lex.t_i(t, stk, out)
    case 'j':
      Lex.plain(t, stk, out)
    case 'k':
      Lex.plain(t, stk, out)
    case 'l':
      Lex.plain(t, stk, out)
    case 'm':
      Lex.plain(t, stk, out)
    case 'n':
      Lex.t_n(t, stk, out)
    case 'o':
      Lex.t_o(t, stk, out)
    case 'p':
      Lex.plain(t, stk, out)
    case 'q':
      Lex.plain(t, stk, out)
    case 'r':
      Lex.t_r(t, stk, out)
    case 's':
      Lex.plain(t, stk, out)
    case 't':
      Lex.t_t(t, stk, out)
    case 'u':
      Lex.plain(t, stk, out)
    case 'v':
      Lex.t_v(t, stk, out)
    case 'w':
      Lex.plain(t, stk, out)
    case 'x':
      Lex.plain(t, stk, out)
    case 'y':
      Lex.t_y(t, stk, out)
    case 'z':
      Lex.plain(t, stk, out)
    case 'A':
      Lex.plain(t, stk, out)
    case 'B':
      Lex.plain(t, stk, out)
    case 'C':
      Lex.plain(t, stk, out)
    case 'D':
      Lex.plain(t, stk, out)
    case 'E':
      Lex.plain(t, stk, out)
    case 'F':
      Lex.plain(t, stk, out)
    case 'G':
      Lex.plain(t, stk, out)
    case 'H':
      Lex.plain(t, stk, out)
    case 'I':
      Lex.plain(t, stk, out)
    case 'J':
      Lex.plain(t, stk, out)
    case 'K':
      Lex.plain(t, stk, out)
    case 'L':
      Lex.plain(t, stk, out)
    case 'M':
      Lex.plain(t, stk, out)
    case 'N':
      Lex.plain(t, stk, out)
    case 'O':
      Lex.plain(t, stk, out)
    case 'P':
      Lex.plain(t, stk, out)
    case 'Q':
      Lex.plain(t, stk, out)
    case 'R':
      Lex.plain(t, stk, out)
    case 'S':
      Lex.plain(t, stk, out)
    case 'T':
      Lex.plain(t, stk, out)
    case 'U':
      Lex.plain(t, stk, out)
    case 'V':
      Lex.plain(t, stk, out)
    case 'W':
      Lex.plain(t, stk, out)
    case 'X':
      Lex.plain(t, stk, out)
    case 'Y':
      Lex.plain(t, stk, out)
    case 'Z':
      Lex.plain(t, stk, out)
    case '0':
      Lex.plain(t, stk, out)
    case '1':
      Lex.plain(t, stk, out)
    case '2':
      Lex.plain(t, stk, out)
    case '3':
      Lex.plain(t, stk, out)
    case '4':
      Lex.plain(t, stk, out)
    case '5':
      Lex.plain(t, stk, out)
    case '6':
      Lex.plain(t, stk, out)
    case '7':
      Lex.plain(t, stk, out)
    case '8':
      Lex.plain(t, stk, out)
    case '9':
      Lex.plain(t, stk, out)
    case '_':
      Lex.plain(t, stk, out)
    case '$':
      Lex.plain(t, stk, out)
    case _:
      Lex.other(c, t, stk, out)

def Lex.fin(fs: FS) -> List<&2, Tok>:
  match fs:
    case FS{s, stk, rx, out}:
      List.reverse(&2, Tok, out)

# One token (or skipped run) per iteration.
def Lex.loop(fuel: Nat, fs: FS) -> List<&2, Tok>:
  match fuel:
    case 0n:
      Lex.fin(fs)
    case 1n+p:
      match fs:
        case FS{s, stk, rx, out}:
          match s:
            case SNil{}:
              List.reverse(&2, Tok, out)
            case SCon{c, t}:
              Lex.loop(p, Lex.disp(c, t, stk, rx, out))

def Lex.tokens2(s: String) -> List<&2, Tok>:
  Lex.loop(4294967295n, FS{s, Nil{}, True{}, Nil{}})

# Total entry point: source text to token stream.
def Lex.tokens(s: String) -> List<&2, Tok>:
  Lex.tokens2(s)
