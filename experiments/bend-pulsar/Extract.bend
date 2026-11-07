# Extract.bend - module-specifier extraction from a token stream (pure core).
#
# Recognises, over the output of Lex.tokens:
#   import "x"                         side-effect import  -> KImport
#   import a, { b, type c } from "x"   value import        -> KImport
#   import type ... from "x"           type-only           -> KTypeOnly
#   import { type a } from "x"         all-type bindings   -> KTypeOnly
#   export * [as n] from "x"           re-export           -> KExport
#   export { ... } from "x"            re-export           -> KExport
#   export type ... from "x"           type-only           -> KTypeOnly
#   import("x")                        dynamic literal     -> KDynamic
#   require("x")                       CommonJS literal    -> KRequire
# Everything else (`import x = require(...)` aside, which yields KRequire) is
# ignored. Dynamic and require refs are reported but never become graph edges,
# matching TS-AD-02, which only walks ImportDeclaration / ExportDeclaration.

import Base
import ./Lex.bend as L

type RefKind is Data:
  KImport{}
  KExport{}
  KTypeOnly{}
  KDynamic{}
  KRequire{}

type Ref is Data:
  Ref{kind: RefKind, spec: String}

# Clause-scanner state. CTop is outside braces; CIn is inside `{ ... }` with
# `start` true at the first token of an element. CDone carries the specifier.
type CS is Data:
  CTop{hv: Bool, ht: Bool}
  CIn{start: Bool, hv: Bool, ht: Bool}
  CDone{hv: Bool, ht: Bool, spec: String}
  CAbort{}

# ---- clause scanner ---------------------------------------------------------

# An element inside braces that begins with `type`: it is a type-only
# specifier unless `type` is itself the imported name (`type`, `type as x`).
def Extract.elem_type(+t: List<&2, L.Tok>) -> Bool:
  match t:
    case Con{L.TAs{}, _}:
      False{}
    case Con{L.TP{','}, _}:
      False{}
    case Con{L.TP{'}'}, _}:
      False{}
    case Con{_, _}:
      True{}
    case Nil{}:
      False{}

def Extract.in_name(start: Bool, hv: Bool, ht: Bool) -> CS:
  match start:
    case True{}:
      CIn{False{}, True{}, ht}
    case False{}:
      CIn{False{}, hv, ht}

def Extract.in_type_start(is_type: Bool, hv: Bool, ht: Bool) -> CS:
  match is_type:
    case True{}:
      CIn{False{}, hv, True{}}
    case False{}:
      CIn{False{}, True{}, ht}

def Extract.in_type(start: Bool, t: List<&2, L.Tok>, hv: Bool, ht: Bool) -> CS:
  match start:
    case False{}:
      CIn{False{}, hv, ht}
    case True{}:
      Extract.in_type_start(Extract.elem_type(t), hv, ht)

def Extract.in_tok(h: L.Tok, +t: List<&2, L.Tok>, start: Bool, +hv: Bool, +ht: Bool) -> CS:
  match h:
    case L.TP{c}:
      match c:
        case '}':
          CTop{hv, ht}
        case ',':
          CIn{True{}, hv, ht}
        case _:
          CAbort{}
    case L.TOpaque{}:
      CAbort{}
    case L.TType{}:
      Extract.in_type(start, t, hv, ht)
    case _:
      Extract.in_name(start, hv, ht)

def Extract.top_from(t: List<&2, L.Tok>, hv: Bool, ht: Bool) -> CS:
  match t:
    case Con{L.TStr{spec}, _}:
      CDone{hv, ht, spec}
    case _:
      CTop{True{}, ht}

def Extract.top_tok(h: L.Tok, t: List<&2, L.Tok>, hv: Bool, ht: Bool) -> CS:
  match h:
    case L.TFrom{}:
      Extract.top_from(t, hv, ht)
    case L.TWord{}:
      CTop{True{}, ht}
    case L.TType{}:
      CTop{True{}, ht}
    case L.TAs{}:
      CTop{True{}, ht}
    case L.TP{c}:
      match c:
        case '*':
          CTop{True{}, ht}
        case ',':
          CTop{hv, ht}
        case '{':
          CIn{True{}, hv, ht}
        case _:
          CAbort{}
    case _:
      CAbort{}

def Extract.next(h: L.Tok, t: List<&2, L.Tok>, st: CS) -> CS:
  match st:
    case CTop{hv, ht}:
      Extract.top_tok(h, t, hv, ht)
    case CIn{start, hv, ht}:
      Extract.in_tok(h, t, start, hv, ht)
    case CDone{hv, ht, spec}:
      CDone{hv, ht, spec}
    case CAbort{}:
      CAbort{}

# Scan tokens until a clause is closed by `from "x"` or aborted.
def Extract.clause(toks: List<&2, L.Tok>, st: CS) -> CS:
  match toks:
    case Nil{}:
      CAbort{}
    case Con{h, +t}:
      match st:
        case CDone{hv, ht, spec}:
          CDone{hv, ht, spec}
        case CAbort{}:
          CAbort{}
        case CTop{hv, ht}:
          Extract.clause(t, Extract.next(h, t, CTop{hv, ht}))
        case CIn{start, hv, ht}:
          Extract.clause(t, Extract.next(h, t, CIn{start, hv, ht}))

def Extract.value_kind2(ht: Bool, edge: RefKind) -> RefKind:
  match ht:
    case True{}:
      KTypeOnly{}
    case False{}:
      edge

# ---- kinds ------------------------------------------------------------------------
# A clause with nothing but type-only bindings is type-only. Pulsar keeps
# `import {} from "x"` and `export {} from "x"` as edges.
def Extract.value_kind(+hv: Bool, ht: Bool, edge: RefKind) -> RefKind:
  match hv:
    case True{}:
      edge
    case False{}:
      Extract.value_kind2(ht, edge)

def Extract.finish(st: CS, edge: RefKind) -> Maybe<Ref>:
  match st:
    case CDone{hv, ht, spec}:
      Some{Ref{Extract.value_kind(hv, ht, edge), spec}}
    case CTop{hv, ht}:
      None{}
    case CIn{start, hv, ht}:
      None{}
    case CAbort{}:
      None{}

# Same, but the whole clause is explicitly `type`.
def Extract.finish_type(st: CS) -> Maybe<Ref>:
  match st:
    case CDone{hv, ht, spec}:
      Some{Ref{KTypeOnly{}, spec}}
    case CTop{hv, ht}:
      None{}
    case CIn{start, hv, ht}:
      None{}
    case CAbort{}:
      None{}

# ---- statements ----------------------------------------------------------------------
def Extract.dyn_close(t: List<&2, L.Tok>, spec: String) -> Maybe<Ref>:
  match t:
    case Con{L.TP{')'}, _}:
      Some{Ref{KDynamic{}, spec}}
    case Con{L.TP{','}, _}:
      Some{Ref{KDynamic{}, spec}}
    case _:
      None{}

# Tokens after `import`.
def Extract.try_import(+toks: List<&2, L.Tok>) -> Maybe<Ref>:
  match toks:
    case Con{L.TStr{spec}, _}:
      Some{Ref{KImport{}, spec}}
    case Con{L.TP{'('}, Con{L.TStr{spec}, t}}:
      Extract.dyn_close(t, spec)
    case Con{L.TType{}, Con{L.TFrom{}, Con{L.TStr{s2}, r2}}}:
      Extract.finish(Extract.clause(toks, CTop{False{}, False{}}), KImport{})
    case Con{L.TType{}, Con{L.TP{','}, r2}}:
      Extract.finish(Extract.clause(toks, CTop{False{}, False{}}), KImport{})
    case Con{L.TType{}, rest}:
      Extract.finish_type(Extract.clause(rest, CTop{False{}, False{}}))
    case _:
      Extract.finish(Extract.clause(toks, CTop{False{}, False{}}), KImport{})

# Tokens after `export`.
def Extract.try_export(+toks: List<&2, L.Tok>) -> Maybe<Ref>:
  match toks:
    case Con{L.TP{'*'}, _}:
      Extract.finish(Extract.clause(toks, CTop{False{}, False{}}), KExport{})
    case Con{L.TP{'{'}, _}:
      Extract.finish(Extract.clause(toks, CTop{False{}, False{}}), KExport{})
    case Con{L.TType{}, Con{L.TP{'*'}, r2}}:
      Extract.finish_type(Extract.clause(Con{L.TP{'*'}, r2}, CTop{False{}, False{}}))
    case Con{L.TType{}, Con{L.TP{'{'}, r2}}:
      Extract.finish_type(Extract.clause(Con{L.TP{'{'}, r2}, CTop{False{}, False{}}))
    case _:
      None{}

# Tokens after `require`.
def Extract.try_require(toks: List<&2, L.Tok>) -> Maybe<Ref>:
  match toks:
    case Con{L.TP{'('}, Con{L.TStr{spec}, Con{L.TP{')'}, _}}}:
      Some{Ref{KRequire{}, spec}}
    case _:
      None{}

def Extract.attempt2(h: L.Tok, t: List<&2, L.Tok>) -> Maybe<Ref>:
  match h:
    case L.TImport{}:
      Extract.try_import(t)
    case L.TExport{}:
      Extract.try_export(t)
    case L.TRequire{}:
      Extract.try_require(t)
    case _:
      None{}

def Extract.attempt(h: L.Tok, t: List<&2, L.Tok>, prev_dot: Bool) -> Maybe<Ref>:
  match prev_dot:
    case True{}:
      None{}
    case False{}:
      Extract.attempt2(h, t)

def Extract.is_dot(h: L.Tok) -> Bool:
  match h:
    case L.TP{'.'}:
      True{}
    case _:
      False{}

def Extract.push(m: Maybe<Ref>, acc: List<&2, Ref>) -> List<&2, Ref>:
  match m:
    case None{}:
      acc
    case Some{r}:
      Con{r, acc}

# All module-specifier references in a token stream (accumulated in reverse
# source order; callers must not depend on the order).
def Extract.refs_go(toks: List<&2, L.Tok>, prev_dot: Bool, acc: List<&2, Ref>) -> List<&2, Ref>:
  match toks:
    case Nil{}:
      acc
    case Con{+h, +t}:
      Extract.refs_go(t, Extract.is_dot(h), Extract.push(Extract.attempt(h, t, prev_dot), acc))

# Total entry point: token stream to references.
def Extract.refs(toks: List<&2, L.Tok>) -> List<&2, Ref>:
  Extract.refs_go(toks, False{}, Nil{})

# Source text to references.
def Extract.scan(src: String) -> List<&2, Ref>:
  Extract.refs(L.Lex.tokens(src))
