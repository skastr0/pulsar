# engine/FnCtx-LAWS.bend - laws about FnCtx.bend. Proofs: FnCtx-PROOF.bend.
# Gate: `bend engine/FnCtx-PROOF.bend --verdict`.
#
# Every law is about the functions pulsar-engine runs: the per-row findings
# (Nc.erule, Nc.mrule), every row's (FnCtx.edges, FnCtx.mods) and the output
# (FnCtx.lines). Soundness and completeness are stated in fact membership, never in
# terms of the sets (Scope.set) the detector builds.
#
#   - edge rule row RE r all none tall tnone: a finding Ex{r, site, fn, target} is
#     exactly a CE fact at site, fn, target whose ctx passes (all, none), and an FC
#     fact for target whose ctx passes (tall, tnone).
#   - module rule row RM r aall anone ball bnone: a finding Mx{r, file} is exactly a
#     file with an FC fact passing (aall, anone) and an FC fact passing (ball, bnone).
#   - "passes (all, none)": Nc.ok(all, none, ctx), pinned by nc_ok_is_masks to
#     ctx & all == all and ctx & none == 0.
#
#   - order: the section runs only when FC's file column never decreases (Nc.sorted;
#     nc_sorted_complete, fnctx_unsorted_refuses). Under that check each rule's FMX
#     lines name each file once, in ascending order (nc_files_asc, nc_mrule_asc), so
#     what is printed does not depend on an unproven input order.
#
# Not covered, by design: decoding the rows (FnCtxIn, shown by fixtures) and the
# decimal formatting inside the lines.

import Base
import ../LAWS.bend as TL
import ./ClassCtx.bend as X
import ./Fanout.bend as F
import ./Fanout-LAWS.bend as FL
import ./FnCtx.bend as N
import ./Rows.bend as W

def MemFc(xs: List<&2, N.Fc>, m: N.Fc) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : N.Fc}, MemFc(t, m)>

def MemEx(xs: List<&2, N.Ex>, m: N.Ex) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : N.Ex}, MemEx(t, m)>

def MemMx(xs: List<&2, N.Mx>, m: N.Mx) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : N.Mx}, MemMx(t, m)>

def MemRe(xs: List<&2, N.Re>, m: N.Re) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : N.Re}, MemRe(t, m)>

def MemRm(xs: List<&2, N.Rm>, m: N.Rm) -> Data:
  match xs:
    case Nil{}:
      Empty
    case Con{h, t}:
      Either<&2, &2, {h == m : N.Rm}, MemRm(t, m)>

# The FC fact g is about function x, and its ctx passes the masks.
def FnAt(g: N.Fc, +x: U32, +all: U32, +none: U32) -> Data:
  match g:
    case N.Fc{fn, file, ctx}:
      TL.And({fn == x : U32}, {N.Nc.ok(all, none, ctx) == True{} : Bool})

# The FC fact g is in file f, and its ctx passes the masks.
def FileAt(g: N.Fc, +f: U32, +all: U32, +none: U32) -> Data:
  match g:
    case N.Fc{fn, file, ctx}:
      TL.And({file == f : U32}, {N.Nc.ok(all, none, ctx) == True{} : Bool})

# Some FC fact in fcs passes the masks for function x (or, for FileHas, in file f).
def FnHas(fcs: List<&2, N.Fc>, x: U32, all: U32, none: U32) -> Data:
  TL.Ex(N.Fc, g => TL.And(MemFc(fcs, g), FnAt(g, x, all, none)))

def FileHas(fcs: List<&2, N.Fc>, f: U32, all: U32, none: U32) -> Data:
  TL.Ex(N.Fc, g => TL.And(MemFc(fcs, g), FileAt(g, f, all, none)))

# Finding y of edge rule r from the CE fact e.
def EAt(e: F.Ce, +fcs: List<&2, N.Fc>, +r: U32, +all: U32, +none: U32, +tall: U32, +tnone: U32, +y: N.Ex) -> Data:
  match e:
    case F.Ce{site, fn, target, node, ld, ctx}:
      TL.And({N.Nc.ok(all, none, ctx) == True{} : Bool}, TL.And(FnHas(fcs, target, tall, tnone), {N.Ex{r, site, fn, target} == y : N.Ex}))

# Finding y of module rule r: a file with a function of each kind.
def MAt(fcs: List<&2, N.Fc>, r: U32, aall: U32, anone: U32, ball: U32, bnone: U32, y: N.Mx) -> Data:
  TL.Ex(U32, f => TL.And({N.Mx{r, f} == y : N.Mx}, TL.And(FileHas(fcs, f, aall, anone), FileHas(fcs, f, ball, bnone))))

# FC's file column, from p on, never decreases: each file is above the one before or
# equal to it.
def NonDec(xs: List<&2, N.Fc>, p: U32) -> Data:
  match xs:
    case Nil{}:
      Unit
    case Con{N.Fc{fn, file, ctx}, t}:
      TL.And(Either<&2, &2, {U32.cmp(p, file) == LT{} : Cmp}, {p == file : U32}>, NonDec(t, file))

def Sorted(xs: List<&2, N.Fc>) -> Data:
  match xs:
    case Nil{}:
      Unit
    case Con{N.Fc{fn, file, ctx}, t}:
      NonDec(t, file)

# Strictly ascending from p: each element is above the one before (so none repeats).
def AscU(xs: List<&2, U32>, p: U32) -> Data:
  match xs:
    case Nil{}:
      Unit
    case Con{h, t}:
      TL.And({U32.cmp(p, h) == LT{} : Cmp}, AscU(t, h))

def Asc(xs: List<&2, U32>) -> Data:
  match xs:
    case Nil{}:
      Unit
    case Con{h, t}:
      AscU(t, h)

# The same for the file column of module findings.
def AscMxU(xs: List<&2, N.Mx>, p: U32) -> Data:
  match xs:
    case Nil{}:
      Unit
    case Con{N.Mx{r, f}, t}:
      TL.And({U32.cmp(p, f) == LT{} : Cmp}, AscMxU(t, f))

def AscMx(xs: List<&2, N.Mx>) -> Data:
  match xs:
    case Nil{}:
      Unit
    case Con{N.Mx{r, f}, t}:
      AscMxU(t, f)

# ---- the context test ----------------------------------------------------------------------------
# N1. every bit of all, and no bit of none, written out over U32 bit operations.
law nc_ok_is_masks:
  for +all: U32
  for +none: U32
  for +ctx: U32
  {N.Nc.ok(all, none, ctx) == Bool.and(U32.is_eq((ctx .&. all : U32), all), U32.is_eq((ctx .&. none : U32), 0)) : Bool}

# ---- edge rules ----------------------------------------------------------------------------------
# N2. soundness: each finding of an RE row is a CE fact and an FC fact that pass its masks.
law nc_erule_sound:
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +r: U32
  for +all: U32
  for +none: U32
  for +tall: U32
  for +tnone: U32
  for +y: N.Ex
  for hm: MemEx(N.Nc.erule(ces, fcs, N.Re{r, all, none, tall, tnone}), y)
  TL.Ex(F.Ce, e => TL.And(FL.MemCe(ces, e), EAt(e, fcs, r, all, none, tall, tnone, y)))

# N3. completeness: every CE fact passing the masks, to a function whose FC fact passes
# the target masks, is a finding.
law nc_erule_complete:
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +r: U32
  for +all: U32
  for +none: U32
  for +tall: U32
  for +tnone: U32
  for +site: U32
  for +fn: U32
  for +target: U32
  for +node: U32
  for +ld: U32
  for +ctx: U32
  for +file: U32
  for +tctx: U32
  for he: FL.MemCe(ces, F.Ce{site, fn, target, node, ld, ctx})
  for hx: {N.Nc.ok(all, none, ctx) == True{} : Bool}
  for hf: MemFc(fcs, N.Fc{target, file, tctx})
  for ht: {N.Nc.ok(tall, tnone, tctx) == True{} : Bool}
  MemEx(N.Nc.erule(ces, fcs, N.Re{r, all, none, tall, tnone}), N.Ex{r, site, fn, target})

# N4. the edge findings are the union of the RE rows' findings.
law nc_edges_sound:
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +res: List<&2, N.Re>
  for +rms: List<&2, N.Rm>
  for +y: N.Ex
  for hm: MemEx(N.FnCtx.edges(N.NF{ces, fcs, res, rms}), y)
  TL.Ex(N.Re, k => TL.And(MemRe(res, k), MemEx(N.Nc.erule(ces, fcs, k), y)))

law nc_edges_complete:
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +res: List<&2, N.Re>
  for +rms: List<&2, N.Rm>
  for +k: N.Re
  for +y: N.Ex
  for hk: MemRe(res, k)
  for hm: MemEx(N.Nc.erule(ces, fcs, k), y)
  MemEx(N.FnCtx.edges(N.NF{ces, fcs, res, rms}), y)

# ---- module rules --------------------------------------------------------------------------------
# N5. soundness: each finding of an RM row is a file with an FC fact passing each side.
law nc_mrule_sound:
  for +fcs: List<&2, N.Fc>
  for +r: U32
  for +aall: U32
  for +anone: U32
  for +ball: U32
  for +bnone: U32
  for +y: N.Mx
  for hm: MemMx(N.Nc.mrule(fcs, N.Rm{r, aall, anone, ball, bnone}), y)
  MAt(fcs, r, aall, anone, ball, bnone, y)

# N6. completeness: a file with an FC fact passing each side is a finding.
law nc_mrule_complete:
  for +fcs: List<&2, N.Fc>
  for +r: U32
  for +aall: U32
  for +anone: U32
  for +ball: U32
  for +bnone: U32
  for +f: U32
  for +fa: U32
  for +ca: U32
  for +fb: U32
  for +cb: U32
  for +ha: MemFc(fcs, N.Fc{fa, f, ca})
  for hxa: {N.Nc.ok(aall, anone, ca) == True{} : Bool}
  for hb: MemFc(fcs, N.Fc{fb, f, cb})
  for hxb: {N.Nc.ok(ball, bnone, cb) == True{} : Bool}
  MemMx(N.Nc.mrule(fcs, N.Rm{r, aall, anone, ball, bnone}), N.Mx{r, f})

# N7. the module findings are the union of the RM rows' findings.
law nc_mods_sound:
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +res: List<&2, N.Re>
  for +rms: List<&2, N.Rm>
  for +y: N.Mx
  for hm: MemMx(N.FnCtx.mods(N.NF{ces, fcs, res, rms}), y)
  TL.Ex(N.Rm, k => TL.And(MemRm(rms, k), MemMx(N.Nc.mrule(fcs, k), y)))

law nc_mods_complete:
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +res: List<&2, N.Re>
  for +rms: List<&2, N.Rm>
  for +k: N.Rm
  for +y: N.Mx
  for hk: MemRm(rms, k)
  for hm: MemMx(N.Nc.mrule(fcs, k), y)
  MemMx(N.FnCtx.mods(N.NF{ces, fcs, res, rms}), y)

# ---- the order of FC ------------------------------------------------------------------------------
# N9. the check accepts every FC whose file column never decreases (so every real run:
# the CLI writes FC in fn order, and fn ids are numbered file by file).
law nc_sorted_complete:
  for +fcs: List<&2, N.Fc>
  for h: Sorted(fcs)
  {N.Nc.sorted(fcs) == True{} : Bool}

# N10. under the check, the files a module rule walks are strictly ascending: each once.
law nc_files_asc:
  for +fcs: List<&2, N.Fc>
  for h: {N.Nc.sorted(fcs) == True{} : Bool}
  Asc(N.Nc.files(fcs))

# N11. so a module rule's findings name each file once, in ascending file order.
law nc_mrule_asc:
  for +fcs: List<&2, N.Fc>
  for +r: U32
  for +aall: U32
  for +anone: U32
  for +ball: U32
  for +bnone: U32
  for h: {N.Nc.sorted(fcs) == True{} : Bool}
  AscMx(N.Nc.mrule(fcs, N.Rm{r, aall, anone, ball, bnone}))

# ---- output --------------------------------------------------------------------------------------
# N8. the printed lines are built from the findings and nothing else: the header, one
# ECX line per edge finding in order, one FMX line per module finding in order, the count.
law nc_lines_shape:
  for +f: N.NF
  {N.FnCtx.lines(f) == Con{"pulsar-fnctx 0", List.append(&2, String, N.Nc.elines(N.FnCtx.edges(f)), List.append(&2, String, N.Nc.mlines(N.FnCtx.mods(f)), [N.Nc.count(N.FnCtx.edges(f), N.FnCtx.mods(f))]))} : List<&2, String>}

# ---- the section ---------------------------------------------------------------------------------
# E1. with an RE or RM row, the section is FnCtx.lines of the decoded facts.
law fnctx_on:
  for +rows: List<&2, W.Row>
  for on: {N.FnCtxIn.on(rows) == True{} : Bool}
  {N.FnCtxIn.lines(rows) == N.FnCtxIn.go(N.FnCtx.decode(rows)) : Maybe<List<&2, String>>}

# E2. decoded facts with FC in file order print FnCtx.lines; facts that do not decode,
# or FC out of file order (E4), refuse the section.
law fnctx_go_lines:
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +res: List<&2, N.Re>
  for +rms: List<&2, N.Rm>
  for h: {N.Nc.sorted(fcs) == True{} : Bool}
  {N.FnCtxIn.go(Some{N.NF{ces, fcs, res, rms}}) == Some{N.FnCtx.lines(N.NF{ces, fcs, res, rms})} : Maybe<List<&2, String>>}

law fnctx_go_refuses:
  {N.FnCtxIn.go(None{}) == None{} : Maybe<List<&2, String>>}

# E4. FC out of file order refuses the section (exit 2), whatever else the rows hold.
law fnctx_unsorted_refuses:
  for +ces: List<&2, F.Ce>
  for +fcs: List<&2, N.Fc>
  for +res: List<&2, N.Re>
  for +rms: List<&2, N.Rm>
  for h: {N.Nc.sorted(fcs) == False{} : Bool}
  {N.FnCtxIn.go(Some{N.NF{ces, fcs, res, rms}}) == None{} : Maybe<List<&2, String>>}

# E3. with no RE or RM row no rule of this kind is on: no lines.
law fnctx_off:
  for +rows: List<&2, W.Row>
  for off: {N.FnCtxIn.on(rows) == False{} : Bool}
  {N.FnCtxIn.lines(rows) == Some{Nil{}} : Maybe<List<&2, String>>}
