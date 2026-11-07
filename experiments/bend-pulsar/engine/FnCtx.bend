# FnCtx.bend - function-context rules: call edges and modules judged by the context a
# function runs in (core, generic; pure core).
#
# A function's context is the `FC fn file ctx` fact: the CS ctx bits in force in it (1
# async, 2 pack-defined effect context, 8 and 16 the file's policy scopes, 32 interop
# callback; FACTS.md). Two rule kinds read it. Both name no technology: contexts are bit
# masks, and every rule instance is data from a pack catalog or the repo's policy. The CLI
# writes the rule rows only for active rules, so the facts alone never make a finding.
#
#   RE rule all none tall tnone           edge rule: a call edge `CE site fn target ..
#                                         ctx` whose ctx has every bit of `all` and none
#                                         of `none`, to a function whose FC ctx has every
#                                         bit of `tall` and none of `tnone`
#   RM rule aall anone ball bnone         module rule: a file holding a function whose FC
#                                         ctx passes (aall, anone) and a function whose FC
#                                         ctx passes (ball, bnone)
#
# Output (FnCtx.lines): `pulsar-fnctx 0`, then per RE row in row order one
# `ECX rule site fn target` per CE fact in CE order, then per RM row in row order one
# `FMX rule file` per file (ascending: FC must be in file order, or the section refuses),
# then `FNCS n`, the count.
#
# Generalisation: both are filters over numbers (context bits, rule masks). The Effect
# pack's two instances (#705) are a promise bridge (an interop callback in Effect-first
# scope calling an async repo function) and a mixed module (an Effect-first file holding
# Effect code and async functions); a pack for any other runtime boundary states its own
# masks. Laws: FnCtx-LAWS.bend.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./ClassCtx.bend as X
import ./Fanout.bend as F
import ./Rows.bend as W

type Fc is Data:
  Fc{fn: U32, file: U32, ctx: U32}

type Re is Data:
  Re{r: U32, all: U32, none: U32, tall: U32, tnone: U32}

type Rm is Data:
  Rm{r: U32, aall: U32, anone: U32, ball: U32, bnone: U32}

type Ex is Data:
  Ex{r: U32, site: U32, fn: U32, target: U32}

type Mx is Data:
  Mx{r: U32, file: U32}

type NF is Data:
  NF{ces: List<&2, F.Ce>, fcs: List<&2, Fc>, res: List<&2, Re>, rms: List<&2, Rm>}

# ---- the context test -------------------------------------------------------------------------
# Every bit of `all`, and no bit of `none`.
def Nc.ok(+all: U32, +none: U32, +ctx: U32) -> Bool:
  Bool.and(U32.is_eq(U32.and(ctx, all), all), U32.is_eq(U32.and(ctx, none), 0))

# ---- edge rules -------------------------------------------------------------------------------
# The functions whose context passes the masks.
def Nc.fns(fcs: List<&2, Fc>, +all: U32, +none: U32) -> List<&2, U32>:
  match fcs:
    case Nil{}:
      Nil{}
    case Con{Fc{+fn, file, +ctx}, t}:
      X.Cx.push_u(Nc.ok(all, none, ctx), fn, Nc.fns(t, all, none))

def Nc.keep_e(b: Bool, x: Ex, acc: List<&2, Ex>) -> List<&2, Ex>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Nc.edges(ces: List<&2, F.Ce>, +r: U32, +all: U32, +none: U32, +tset: G.Tr) -> List<&2, Ex>:
  match ces:
    case Nil{}:
      Nil{}
    case Con{F.Ce{+site, +fn, +target, node, ld, +ctx}, t}:
      Nc.keep_e(Bool.and(Nc.ok(all, none, ctx), S.Scope.has(tset, target)), Ex{r, site, fn, target}, Nc.edges(t, r, all, none, tset))

def Nc.erule(+ces: List<&2, F.Ce>, +fcs: List<&2, Fc>, e: Re) -> List<&2, Ex>:
  match e:
    case Re{+r, +all, +none, +tall, +tnone}:
      Nc.edges(ces, r, all, none, S.Scope.set(Nc.fns(fcs, tall, tnone)))

def Nc.erules(+ces: List<&2, F.Ce>, +fcs: List<&2, Fc>, res: List<&2, Re>) -> List<&2, Ex>:
  match res:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      List.append(&2, Ex, Nc.erule(ces, fcs, h), Nc.erules(ces, fcs, t))

# ---- module rules -----------------------------------------------------------------------------
# The files of the functions whose context passes the masks.
def Nc.files_ok(fcs: List<&2, Fc>, +all: U32, +none: U32) -> List<&2, U32>:
  match fcs:
    case Nil{}:
      Nil{}
    case Con{Fc{fn, +file, +ctx}, t}:
      X.Cx.push_u(Nc.ok(all, none, ctx), file, Nc.files_ok(t, all, none))

# The files of FC, once per run of equal files. The section runs only when FC's file column
# never decreases (Nc.sorted, checked below), so each file comes once and in ascending order
# (FnCtx-LAWS nc_files_asc, nc_mrule_asc).
def Nc.files_go(fcs: List<&2, Fc>, +prev: U32) -> List<&2, U32>:
  match fcs:
    case Nil{}:
      Nil{}
    case Con{Fc{fn, +file, ctx}, t}:
      X.Cx.push_u(Bool.not(U32.is_eq(file, prev)), file, Nc.files_go(t, file))

def Nc.files(fcs: List<&2, Fc>) -> List<&2, U32>:
  match fcs:
    case Nil{}:
      Nil{}
    case Con{Fc{fn, +file, ctx}, t}:
      Con{file, Nc.files_go(t, file)}

# FC's file column never decreases. The CLI writes FC in fn order and numbers fn ids file
# by file, so a real run passes; a run that does not is refused (FnCtxIn.go).
def Nc.sorted_go(fcs: List<&2, Fc>, +prev: U32) -> Bool:
  match fcs:
    case Nil{}:
      True{}
    case Con{Fc{fn, +file, ctx}, t}:
      Bool.and(Bool.not(Cmp.is_lt(U32.cmp(file, prev))), Nc.sorted_go(t, file))

def Nc.sorted(fcs: List<&2, Fc>) -> Bool:
  match fcs:
    case Nil{}:
      True{}
    case Con{Fc{fn, +file, ctx}, t}:
      Nc.sorted_go(t, file)

def Nc.keep_m(b: Bool, x: Mx, acc: List<&2, Mx>) -> List<&2, Mx>:
  match b:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Nc.mods(fs: List<&2, U32>, +r: U32, +sa: G.Tr, +sb: G.Tr) -> List<&2, Mx>:
  match fs:
    case Nil{}:
      Nil{}
    case Con{+f, t}:
      Nc.keep_m(Bool.and(S.Scope.has(sa, f), S.Scope.has(sb, f)), Mx{r, f}, Nc.mods(t, r, sa, sb))

def Nc.mrule(+fcs: List<&2, Fc>, m: Rm) -> List<&2, Mx>:
  match m:
    case Rm{+r, +aall, +anone, +ball, +bnone}:
      Nc.mods(Nc.files(fcs), r, S.Scope.set(Nc.files_ok(fcs, aall, anone)), S.Scope.set(Nc.files_ok(fcs, ball, bnone)))

def Nc.mrules(+fcs: List<&2, Fc>, rms: List<&2, Rm>) -> List<&2, Mx>:
  match rms:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      List.append(&2, Mx, Nc.mrule(fcs, h), Nc.mrules(fcs, t))

# ---- the findings -----------------------------------------------------------------------------
def FnCtx.edges(f: NF) -> List<&2, Ex>:
  match f:
    case NF{ces, fcs, res, rms}:
      Nc.erules(ces, fcs, res)

def FnCtx.mods(f: NF) -> List<&2, Mx>:
  match f:
    case NF{ces, fcs, res, rms}:
      Nc.mrules(fcs, rms)

# ---- output -----------------------------------------------------------------------------------
def Nc.eline(x: Ex) -> String:
  match x:
    case Ex{r, site, fn, target}:
      "ECX " ++ U32.show(r) ++ " " ++ U32.show(site) ++ " " ++ U32.show(fn) ++ " " ++ U32.show(target)

def Nc.elines(xs: List<&2, Ex>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Nc.eline(h), Nc.elines(t)}

def Nc.mline(x: Mx) -> String:
  match x:
    case Mx{r, file}:
      "FMX " ++ U32.show(r) ++ " " ++ U32.show(file)

def Nc.mlines(xs: List<&2, Mx>) -> List<&2, String>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{Nc.mline(h), Nc.mlines(t)}

def Nc.count(+es: List<&2, Ex>, +ms: List<&2, Mx>) -> String:
  "FNCS " ++ Nat.show(Nat.add(List.length(&2, Ex, es), List.length(&2, Mx, ms)))

def FnCtx.lines(+f: NF) -> List<&2, String>:
  +es = FnCtx.edges(f)
  +ms = FnCtx.mods(f)
  Con{"pulsar-fnctx 0", List.append(&2, String, Nc.elines(es), List.append(&2, String, Nc.mlines(ms), [Nc.count(es, ms)]))}

# ---- decoding rows (reader; unproven) ---------------------------------------------------------
# Tags: CE 17221 (6 fields), FC 17987 (3), RE 21061 (5), RM 21069 (5). Other tags belong to
# other detectors and are skipped. Rows keep their file order, which the CLI sorts.
type ND is Data:
  ND{bad: U32, f: NF}

def Nd.has(rows: List<&2, W.Row>, +tag: U32) -> Bool:
  match rows:
    case Nil{}:
      False{}
    case Con{W.Row{t, fs}, rest}:
      Bool.or(U32.is_eq(t, tag), Nd.has(rest, tag))

def Nd.bad(d: ND) -> ND:
  match d:
    case ND{bad, f}:
      ND{1, f}

def Nd.ce(fs: List<&2, U32>, d: ND) -> ND:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Con{g, Con{h, Nil{}}}}}}} ND{bad, NF{ces, fcs, res, rms}}:
      ND{bad, NF{Con{F.Ce{a, b, c, e, g, h}, ces}, fcs, res, rms}}
    case _ d2:
      Nd.bad(d2)

def Nd.fc(fs: List<&2, U32>, d: ND) -> ND:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} ND{bad, NF{ces, fcs, res, rms}}:
      ND{bad, NF{ces, Con{Fc{a, b, c}, fcs}, res, rms}}
    case _ d2:
      Nd.bad(d2)

def Nd.re(fs: List<&2, U32>, d: ND) -> ND:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Con{g, Nil{}}}}}} ND{bad, NF{ces, fcs, res, rms}}:
      ND{bad, NF{ces, fcs, Con{Re{a, b, c, e, g}, res}, rms}}
    case _ d2:
      Nd.bad(d2)

def Nd.rm(fs: List<&2, U32>, d: ND) -> ND:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Con{g, Nil{}}}}}} ND{bad, NF{ces, fcs, res, rms}}:
      ND{bad, NF{ces, fcs, res, Con{Rm{a, b, c, e, g}, rms}}}
    case _ d2:
      Nd.bad(d2)

def Nd.add(tag: U32, fs: List<&2, U32>, d: ND) -> ND:
  match tag:
    case 17221:
      Nd.ce(fs, d)
    case 17987:
      Nd.fc(fs, d)
    case 21061:
      Nd.re(fs, d)
    case 21069:
      Nd.rm(fs, d)
    case _:
      d

def Nd.go(rows: List<&2, W.Row>, d: ND) -> ND:
  match rows:
    case Nil{}:
      d
    case Con{W.Row{tag, fs}, t}:
      Nd.go(t, Nd.add(tag, fs, d))

def Nd.fin2(ok: Bool, f: NF) -> Maybe<NF>:
  match ok:
    case True{}:
      Some{f}
    case False{}:
      None{}

def Nd.fin(d: ND) -> Maybe<NF>:
  match d:
    case ND{bad, NF{ces, fcs, res, rms}}:
      Nd.fin2(U32.is_eq(bad, 0), NF{List.reverse(&2, F.Ce, ces), List.reverse(&2, Fc, fcs), List.reverse(&2, Re, res), List.reverse(&2, Rm, rms)})

def FnCtx.decode(rows: List<&2, W.Row>) -> Maybe<NF>:
  Nd.fin(Nd.go(rows, ND{0, NF{Nil{}, Nil{}, Nil{}, Nil{}}}))

# ---- the section ------------------------------------------------------------------------------
# It runs when there is an RE or RM row (the CLI writes them only for active rules); a row of
# a tag read here with the wrong field count, or FC out of file order (Nc.sorted), refuses it
# (None). FnCtx-LAWS E1-E4.
def FnCtxIn.ok(ok: Bool, +f: NF) -> Maybe<List<&2, String>>:
  match ok:
    case True{}:
      Some{FnCtx.lines(f)}
    case False{}:
      None{}

def FnCtxIn.go(m: Maybe<NF>) -> Maybe<List<&2, String>>:
  match m:
    case None{}:
      None{}
    case Some{NF{ces, +fcs, res, rms}}:
      FnCtxIn.ok(Nc.sorted(fcs), NF{ces, fcs, res, rms})

def FnCtxIn.go1(on: Bool, +rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  match on:
    case True{}:
      FnCtxIn.go(FnCtx.decode(rows))
    case False{}:
      Some{Nil{}}

def FnCtxIn.on(+rows: List<&2, W.Row>) -> Bool:
  Bool.or(Nd.has(rows, 21061), Nd.has(rows, 21069))

def FnCtxIn.lines(+rows: List<&2, W.Row>) -> Maybe<List<&2, String>>:
  FnCtxIn.go1(FnCtxIn.on(rows), rows)
