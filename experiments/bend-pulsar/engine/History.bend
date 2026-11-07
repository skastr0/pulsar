# History.bend - file churn, churn concentration and co-change, from history facts (#662).
#
# Facts (FACTS.md "Git history"): `H nc na`, `C commit author day`,
# `A author bot`, `CF commit file added deleted`.
# The production file set and the import graph come from the engine's own
# graph (Scope.graph), so "explained by an import" means an edge the proven
# rule accepted.
#
# Definitions, all over the analysed window:
#   human commit       a C row whose author has no `A author 1` row (bots are
#                      excluded: research/thresholds.md, MSR 2026; the same rule
#                      as Churn.of, which counts per-function churn for Hotspot)
#   bulk commit        one with more than Rules.bulk CF rows (default 100;
#                      D'Ambros et al.), dropped from co-change mining only
#   file churn         the number of human commits with a CF row for a
#                      production file (commits, not lines: research's churn
#                      unit; CF is one row per (commit, file))
#   concentration      the top Rules.top % of churned files (rounded up) hold
#                      at least Rules.share % of all file churn
#   co-change          production files a < b changed together in at least
#                      Rules.sup human, non-bulk commits, with confidence
#                      100 * support >= Rules.conf * min(n_a, n_b) (n_x: the
#                      human non-bulk commits touching x; this is the larger
#                      of the two directed confidences), and no import edge
#                      between them in either direction
#
# Rules (history.churn-concentration, history.co-change): defaults from
# research/thresholds.md, evidence weak for the exact cutoffs, so both are
# opt-in in policy; every finding prints its numbers.
#
# Every finding comes from an untrusted search and is kept only when a Bool
# checker accepts it (Cp.check, Cx.check); History-LAWS.bend states what the
# checkers guarantee, in terms of the facts.

import Base
import ../Graph.bend as G
import ./Scope.bend as S
import ./Rows.bend as W

type Cm is Data:
  Cm{c: U32, a: U32, d: U32}

type Au is Data:
  Au{a: U32, bot: U32}

type Cf is Data:
  Cf{c: U32, f: U32, ad: U32, de: U32}

type CH is Data:
  CH{nc: U32, na: U32, cms: List<&2, Cm>, aus: List<&2, Au>, cfs: List<&2, Cf>}

type Rules is Data:
  Rules{sup: U32, conf: U32, bulk: U32, top: U32, share: U32}

# A co-change pair with its witness commits.
type Cp is Data:
  Cp{a: U32, b: U32, sup: U32, na: U32, nb: U32, ws: List<&2, U32>}

# A concentration finding: k churned files ws (ascending) out of nf hold `top`
# of the `total` churn.
type Cx is Data:
  Cx{k: U32, nf: U32, top: U32, total: U32, ws: List<&2, U32>}

# file or function, and its churn in commits
type Ck is Data:
  Ck{x: U32, k: U32}

type COut is Data:
  COut{files: List<&2, Ck>, cxs: List<&2, Cx>, cps: List<&2, Cp>}

type Tri is Data:
  Tri{a: U32, b: U32, c: U32}
type Grp is Data:
  Grp{c: U32, fs: List<&2, U32>}
type PG is Data:
  PG{a: U32, b: U32, cs: List<&2, U32>}
type CD is Data:
  CD{bad: U32, h: U32, hr: U32, r: Rules, ch: CH}

# What the engine runs on: the facts and the rule numbers from the HR row.
type HIn is Data:
  HIn{ch: CH, r: Rules}
def Hist.defaults() -> Rules:
  Rules{3, 50, 100, 20, 80}

def CH.nc(ch: CH) -> U32:
  match ch:
    case CH{nc, na, cms, aus, cfs}:
      nc

def CH.na(ch: CH) -> U32:
  match ch:
    case CH{nc, na, cms, aus, cfs}:
      na

def CH.cms(ch: CH) -> List<&2, Cm>:
  match ch:
    case CH{nc, na, cms, aus, cfs}:
      cms

def CH.aus(ch: CH) -> List<&2, Au>:
  match ch:
    case CH{nc, na, cms, aus, cfs}:
      aus

def CH.cfs(ch: CH) -> List<&2, Cf>:
  match ch:
    case CH{nc, na, cms, aus, cfs}:
      cfs

def Rules.sup(r: Rules) -> U32:
  match r:
    case Rules{sup, conf, bulk, top, share}:
      sup

def Rules.conf(r: Rules) -> U32:
  match r:
    case Rules{sup, conf, bulk, top, share}:
      conf

def Rules.bulk(r: Rules) -> U32:
  match r:
    case Rules{sup, conf, bulk, top, share}:
      bulk

def Rules.top(r: Rules) -> U32:
  match r:
    case Rules{sup, conf, bulk, top, share}:
      top

def Rules.share(r: Rules) -> U32:
  match r:
    case Rules{sup, conf, bulk, top, share}:
      share

def Hist.push_u(c: Bool, +x: U32, acc: List<&2, U32>) -> List<&2, U32>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Hist.iota(fuel: Nat, +x: U32) -> List<&2, U32>:
  match fuel:
    case 0n:
      Nil{}
    case 1n+p:
      Con{x, Hist.iota(p, U32.inc(x))}

def Hist.len(xs: List<&2, U32>) -> U32:
  U32.from_nat(List.length(&2, U32, xs))

def Hist.min2(le: Bool, +a: U32, +b: U32) -> U32:
  match le:
    case True{}:
      a
    case False{}:
      b

def Hist.min(+a: U32, +b: U32) -> U32:
  Hist.min2(U32.is_le(a, b), a, b)

# Strictly ascending.
def Hist.asc(xs: List<&2, U32>, +prev: U32, +first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{+x, t}:
      Bool.and(Bool.or(first, U32.is_lt(prev, x)), Hist.asc(t, x, False{}))

def Hist.cnt(+t: G.Tr, +x: U32) -> U32:
  U32.from_nat(G.Graph.cnt_of(G.Tr.getu(t, x)))

# ---- the sets every rule reads ------------------------------------------------------------
# Authors with `A a 0`.
# Commits whose author is in `at`.
# Authors with `A a 1` (Hist.of's bot rule, so both count the same commits).
def Ch.bot_auth(aus: List<&2, Au>) -> List<&2, U32>:
  match aus:
    case Nil{}:
      Nil{}
    case Con{Au{+a, bot}, t}:
      Hist.push_u(U32.is_eq(bot, 1), a, Ch.bot_auth(t))

# Commits whose author is not in `bt`.
def Ch.hum_ids(cms: List<&2, Cm>, +bt: G.Tr) -> List<&2, U32>:
  match cms:
    case Nil{}:
      Nil{}
    case Con{Cm{+c, +a, d}, t}:
      Hist.push_u(Bool.not(S.Scope.has(bt, a)), c, Ch.hum_ids(t, bt))

def Ch.hset(+ch: CH) -> G.Tr:
  S.Scope.set(Ch.hum_ids(CH.cms(ch), S.Scope.set(Ch.bot_auth(CH.aus(ch)))))

# The commit of every CF row: a commit's size is its count here.
def Ch.cf_cs(cfs: List<&2, Cf>) -> List<&2, U32>:
  match cfs:
    case Nil{}:
      Nil{}
    case Con{Cf{c, f, ad, de}, t}:
      Con{c, Ch.cf_cs(t)}

# Commits with at most `bulk` CF rows.
def Ch.nb_ids(cms: List<&2, Cm>, +szt: G.Tr, +bulk: U32) -> List<&2, U32>:
  match cms:
    case Nil{}:
      Nil{}
    case Con{Cm{+c, a, d}, t}:
      Hist.push_u(U32.is_le(Hist.cnt(szt, c), bulk), c, Ch.nb_ids(t, szt, bulk))

def Ch.nbset(+ch: CH, +r: Rules) -> G.Tr:
  S.Scope.set(Ch.nb_ids(CH.cms(ch), G.Graph.cnt_all(Ch.cf_cs(CH.cfs(ch)), G.TE{}), Rules.bulk(r)))

# File churn list: the file of every CF row with a human commit and a production file.
def Ch.fl(cfs: List<&2, Cf>, +ht: G.Tr, +pt: G.Tr) -> List<&2, U32>:
  match cfs:
    case Nil{}:
      Nil{}
    case Con{Cf{+c, +f, ad, de}, t}:
      Hist.push_u(Bool.and(S.Scope.has(ht, c), S.Scope.has(pt, f)), f, Ch.fl(t, ht, pt))

# Co-change list: as Ch.fl, and the commit is not bulk.
def Ch.cl(cfs: List<&2, Cf>, +ht: G.Tr, +nbt: G.Tr, +pt: G.Tr) -> List<&2, U32>:
  match cfs:
    case Nil{}:
      Nil{}
    case Con{Cf{+c, +f, ad, de}, t}:
      Hist.push_u(Bool.and(Bool.and(S.Scope.has(ht, c), S.Scope.has(nbt, c)), S.Scope.has(pt, f)), f, Ch.cl(t, ht, nbt, pt))

# Function churn list: the fn of every CFN row with a human commit.
def Ck.push3(z: Bool, +k: U32, +x: U32, acc: List<&2, Ck>) -> List<&2, Ck>:
  match z:
    case True{}:
      acc
    case False{}:
      Con{Ck{x, k}, acc}

def Ck.push2(+k: U32, +x: U32, acc: List<&2, Ck>) -> List<&2, Ck>:
  Ck.push3(U32.is_eq(k, 0), k, x, acc)

# ---- churn per file and per function --------------------------------------------------------
def Ck.push(+t: G.Tr, +x: U32, acc: List<&2, Ck>) -> List<&2, Ck>:
  Ck.push2(Hist.cnt(t, x), x, acc)

# Ids 0..n-1 whose tally is non-zero, with the tally.
def Ck.all(xs: List<&2, U32>, +t: G.Tr) -> List<&2, Ck>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{x, rest}:
      Ck.push(t, x, Ck.all(rest, t))

def Ck.ids(cs: List<&2, Ck>) -> List<&2, U32>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{Ck{x, k}, t}:
      Con{x, Ck.ids(t)}

def Cs.keep(k: Bool, +x: Tri, acc: List<&2, Tri>) -> List<&2, Tri>:
  match k:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# ---- co-change: untrusted search ------------------------------------------------------------

# Files of one commit (Ch.cl order is commit-major, file-ascending), grouped.

def Cs.cl2(cfs: List<&2, Cf>, +ht: G.Tr, +nbt: G.Tr, +pt: G.Tr) -> List<&2, Tri>:
  match cfs:
    case Nil{}:
      Nil{}
    case Con{Cf{+c, +f, ad, de}, t}:
      Cs.keep(Bool.and(Bool.and(S.Scope.has(ht, c), S.Scope.has(nbt, c)), S.Scope.has(pt, f)), Tri{c, f, 0}, Cs.cl2(t, ht, nbt, pt))

def Cs.grp_add2(same: Bool, +c: U32, +f: U32, +c2: U32, fs: List<&2, U32>, t: List<&2, Grp>) -> List<&2, Grp>:
  match same:
    case True{}:
      Con{Grp{c2, Con{f, fs}}, t}
    case False{}:
      Con{Grp{c, Con{f, Nil{}}}, Con{Grp{c2, fs}, t}}

def Cs.grp_add(+c: U32, +f: U32, gs: List<&2, Grp>) -> List<&2, Grp>:
  match gs:
    case Con{Grp{+c2, fs}, t}:
      Cs.grp_add2(U32.is_eq(c2, c), c, f, c2, fs, t)
    case Nil{}:
      Con{Grp{c, Con{f, Nil{}}}, Nil{}}

# Groups, each file list descending (built back to front from an ascending list).
def Cs.groups(ts: List<&2, Tri>, acc: List<&2, Grp>) -> List<&2, Grp>:
  match ts:
    case Nil{}:
      acc
    case Con{Tri{c, f, z}, t}:
      Cs.groups(t, Cs.grp_add(c, f, acc))

# Pairs (a, b, c) with a < b for one group; fs is descending, so each head is
# larger than every later element.
def Cs.with(+b: U32, +c: U32, rest: List<&2, U32>, acc: List<&2, Tri>) -> List<&2, Tri>:
  match rest:
    case Nil{}:
      acc
    case Con{+a, t}:
      Cs.with(b, c, t, Con{Tri{a, b, c}, acc})

def Cs.pairs1(fs: List<&2, U32>, +c: U32, acc: List<&2, Tri>) -> List<&2, Tri>:
  match fs:
    case Nil{}:
      acc
    case Con{+b, +t}:
      Cs.pairs1(t, c, Cs.with(b, c, t, acc))

def Cs.pairs(gs: List<&2, Grp>, acc: List<&2, Tri>) -> List<&2, Tri>:
  match gs:
    case Nil{}:
      acc
    case Con{Grp{+c, fs}, t}:
      Cs.pairs(t, Cs.pairs1(fs, c, acc))

def Tri.lt(+x: Tri, +y: Tri) -> Bool:
  match x y:
    case Tri{+a, +b, +c} Tri{+a2, +b2, +c2}:
      Bool.or(U32.is_lt(a, a2), Bool.and(U32.is_eq(a, a2), Bool.or(U32.is_lt(b, b2), Bool.and(U32.is_eq(b, b2), U32.is_lt(c, c2)))))

def Cs.pg_add2(same: Bool, +a: U32, +b: U32, +c: U32, +a2: U32, +b2: U32, cs: List<&2, U32>, rest: List<&2, PG>) -> List<&2, PG>:
  match same:
    case True{}:
      Con{PG{a2, b2, Con{c, cs}}, rest}
    case False{}:
      Con{PG{a, b, Con{c, Nil{}}}, Con{PG{a2, b2, cs}, rest}}

# Sorted triples to pair candidates: consecutive equal (a, b) collect commits.

def Cs.pg_add(+t: Tri, gs: List<&2, PG>) -> List<&2, PG>:
  match t gs:
    case Tri{+a, +b, c} Con{PG{+a2, +b2, cs}, rest}:
      Cs.pg_add2(Bool.and(U32.is_eq(a, a2), U32.is_eq(b, b2)), a, b, c, a2, b2, cs, rest)
    case Tri{a, b, c} Nil{}:
      Con{PG{a, b, Con{c, Nil{}}}, Nil{}}

# Built back to front from the descending (reversed) sorted triples, so each
# commit list comes out ascending.
def Cs.pgs(ts: List<&2, Tri>, acc: List<&2, PG>) -> List<&2, PG>:
  match ts:
    case Nil{}:
      acc
    case Con{+t, rest}:
      Cs.pgs(rest, Cs.pg_add(t, acc))

def Cs.cand3(ok: Bool, +x: Cp, acc: List<&2, Cp>) -> List<&2, Cp>:
  match ok:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

# Support and confidence only: the import test runs once per surviving pair, in
# the checker (Graph.edge walks a row, so testing every pair was the cost).
def Cs.cand2(+sup: U32, +na: U32, +nb: U32, +r: Rules, +adj: List<&2, List<&2, U32>>, +a: U32, +b: U32, cs: List<&2, U32>, acc: List<&2, Cp>) -> List<&2, Cp>:
  Cs.cand3(Bool.and(U32.is_ge(sup, Rules.sup(r)), U32.is_ge(U32.mul(100, sup), U32.mul(Rules.conf(r), Hist.min(na, nb)))), Cp{a, b, sup, na, nb, cs}, acc)

def Cs.cand(+tl: G.Tr, +r: Rules, +adj: List<&2, List<&2, U32>>, g: PG, acc: List<&2, Cp>) -> List<&2, Cp>:
  match g:
    case PG{+a, +b, +cs}:
      Cs.cand2(Hist.len(cs), Hist.cnt(tl, a), Hist.cnt(tl, b), r, adj, a, b, cs, acc)

def Cs.cands(gs: List<&2, PG>, +tl: G.Tr, +r: Rules, +adj: List<&2, List<&2, U32>>) -> List<&2, Cp>:
  match gs:
    case Nil{}:
      Nil{}
    case Con{g, t}:
      Cs.cand(tl, r, adj, g, Cs.cands(t, tl, r, adj))

def Tri.half_k(k: Bool, x: Tri, r: List<&2, Tri>) -> List<&2, Tri>:
  match k:
    case True{}:
      Con{x, r}
    case False{}:
      r

# Every other element, starting with the first when k.
def Tri.half(xs: List<&2, Tri>, +k: Bool) -> List<&2, Tri>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{x, t}:
      Tri.half_k(k, x, Tri.half(t, Bool.not(k)))

# ---- merge sorts (untrusted searches) ----
def Tri.hd(+b: Bool, x: Tri, y: Tri) -> Tri:
  match b:
    case True{}:
      x
    case False{}:
      y

def Tri.pl(+b: Bool, x: Tri, xt: List<&2, Tri>) -> List<&2, Tri>:
  match b:
    case True{}:
      xt
    case False{}:
      Con{x, xt}

def Tri.pr(+b: Bool, y: Tri, yt: List<&2, Tri>) -> List<&2, Tri>:
  match b:
    case True{}:
      Con{y, yt}
    case False{}:
      yt

def Tri.merge(fuel: Nat, xs: List<&2, Tri>, ys: List<&2, Tri>) -> List<&2, Tri>:
  match fuel:
    case 0n:
      List.append(&2, Tri, xs, ys)
    case 1n+p:
      match xs ys:
        case Nil{} ys2:
          ys2
        case xs2 Nil{}:
          xs2
        case Con{+x, xt} Con{+y, yt}:
          +b = Tri.lt(x, y)
          Con{Tri.hd(b, x, y), Tri.merge(p, Tri.pl(b, x, xt), Tri.pr(b, y, yt))}

def Tri.sort(fuel: Nat, xs: List<&2, Tri>) -> List<&2, Tri>:
  match fuel:
    case 0n:
      xs
    case 1n+p:
      match xs:
        case Nil{}:
          Nil{}
        case Con{x, Nil{}}:
          Con{x, Nil{}}
        case Con{+x, Con{+y, +t}}:
          +q = p
          Tri.merge(Nat.add(2n, List.length(&2, Tri, t)), Tri.sort(q, Tri.half(Con{x, Con{y, t}}, True{})), Tri.sort(q, Tri.half(Con{x, Con{y, t}}, False{})))

def Cs.search2(ts: List<&2, Tri>, +r: Rules, +adj: List<&2, List<&2, U32>>, +tl: G.Tr) -> List<&2, Cp>:
  Cs.cands(Cs.pgs(List.reverse(&2, Tri, Tri.sort(64n, ts)), Nil{}), tl, r, adj)

def Cs.search(+ch: CH, +r: Rules, +pt: G.Tr, +adj: List<&2, List<&2, U32>>, +ht: G.Tr, +nbt: G.Tr) -> List<&2, Cp>:
  Cs.search2(Cs.pairs(Cs.groups(Cs.cl2(CH.cfs(ch), ht, nbt, pt), Nil{}), Nil{}), r, adj, G.Graph.cnt_all(Ch.cl(CH.cfs(ch), ht, nbt, pt), G.TE{}))

# ---- co-change: the checker -----------------------------------------------------------------
# ---- the (commit, file) set: a trie over 64-bit keys, the commit's bits then the file's ----
def Wd.cat(n: Nat, a: Word(n), b: Word(32n)) -> Word(Nat.add(n, 32n)):
  match n:
    case 0n:
      match a:
        case WNil{}:
          b
    case 1n+p:
      match a:
        case WCon{x, at}:
          WCon{x, Wd.cat(p, at, b)}

def P2.key(c: U32, f: U32) -> Word(64n):
  match c f:
    case U32{wc} U32{wf}:
      Wd.cat(32n, wc, wf)

def P2.ins(cfs: List<&2, Cf>, t: G.Tr) -> G.Tr:
  match cfs:
    case Nil{}:
      t
    case Con{Cf{c, f, ad, de}, r}:
      P2.ins(r, G.Tr.put(64n, t, P2.key(c, f), 0n))

# Every (commit, file) of a CF row.
def P2.set(cfs: List<&2, Cf>) -> G.Tr:
  P2.ins(cfs, G.TE{})

def P2.has(+t: G.Tr, +c: U32, +f: U32) -> Bool:
  S.Scope.has2(G.Tr.get(64n, t, P2.key(c, f)))

# Every witness commit is human, not bulk, and has a CF row for a and for b.
def Cp.w1(+cft: G.Tr, +ht: G.Tr, +nbt: G.Tr, +a: U32, +b: U32, +c: U32) -> Bool:
  Bool.and(Bool.and(P2.has(cft, c, a), P2.has(cft, c, b)), Bool.and(S.Scope.has(ht, c), S.Scope.has(nbt, c)))

def Cp.ws_ok(ws: List<&2, U32>, +cft: G.Tr, +ht: G.Tr, +nbt: G.Tr, +a: U32, +b: U32) -> Bool:
  match ws:
    case Nil{}:
      True{}
    case Con{+c, t}:
      Bool.and(Cp.w1(cft, ht, nbt, a, b, c), Cp.ws_ok(t, cft, ht, nbt, a, b))

def Cp.files(+pt: G.Tr, +a: U32, +b: U32) -> Bool:
  Bool.and(U32.is_lt(a, b), Bool.and(S.Scope.has(pt, a), S.Scope.has(pt, b)))

def Cp.support(+r: Rules, +sup: U32, +ws: List<&2, U32>) -> Bool:
  Bool.and(Bool.and(U32.is_eq(sup, Hist.len(ws)), U32.is_ge(sup, Rules.sup(r))), Hist.asc(ws, 0, True{}))

def Cp.conf(+r: Rules, +tl: G.Tr, +a: U32, +b: U32, +sup: U32, +na: U32, +nb: U32) -> Bool:
  Bool.and(Bool.and(U32.is_eq(na, Hist.cnt(tl, a)), U32.is_eq(nb, Hist.cnt(tl, b))), U32.is_ge(U32.mul(100, sup), U32.mul(Rules.conf(r), Hist.min(na, nb))))

def Cp.noimp(+adj: List<&2, List<&2, U32>>, +a: U32, +b: U32) -> Bool:
  Bool.and(Bool.not(G.Graph.edge(adj, a, b)), Bool.not(G.Graph.edge(adj, b, a)))

def Cp.check(+cft: G.Tr, +r: Rules, +pt: G.Tr, +adj: List<&2, List<&2, U32>>, +ht: G.Tr, +nbt: G.Tr, +tl: G.Tr, +p: Cp) -> Bool:
  match p:
    case Cp{+a, +b, +sup, +na, +nb, +ws}:
      Bool.and(Bool.and(Cp.files(pt, a, b), Cp.support(r, sup, ws)), Bool.and(Bool.and(Cp.ws_ok(ws, cft, ht, nbt, a, b), Cp.conf(r, tl, a, b, sup, na, nb)), Cp.noimp(adj, a, b)))

def Cp.push(c: Bool, +x: Cp, acc: List<&2, Cp>) -> List<&2, Cp>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Cp.keep(cs: List<&2, Cp>, +cft: G.Tr, +r: Rules, +pt: G.Tr, +adj: List<&2, List<&2, U32>>, +ht: G.Tr, +nbt: G.Tr, +tl: G.Tr) -> List<&2, Cp>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{+c, t}:
      Cp.push(Cp.check(cft, r, pt, adj, ht, nbt, tl, c), c, Cp.keep(t, cft, r, pt, adj, ht, nbt, tl))

def Hist.tl(+ch: CH, +pt: G.Tr, +ht: G.Tr, +nbt: G.Tr) -> G.Tr:
  G.Graph.cnt_all(Ch.cl(CH.cfs(ch), ht, nbt, pt), G.TE{})

def Hist.pairs2(+ch: CH, +r: Rules, +pt: G.Tr, +adj: List<&2, List<&2, U32>>, +ht: G.Tr, +nbt: G.Tr) -> List<&2, Cp>:
  Cp.keep(Cs.search(ch, r, pt, adj, ht, nbt), P2.set(CH.cfs(ch)), r, pt, adj, ht, nbt, Hist.tl(ch, pt, ht, nbt))

# The reported co-change pairs.
def Hist.pairs(+ch: CH, +r: Rules, +pt: G.Tr, +adj: List<&2, List<&2, U32>>) -> List<&2, Cp>:
  Hist.pairs2(ch, r, pt, adj, Ch.hset(ch), Ch.nbset(ch, r))

# ---- concentration ------------------------------------------------------------------------------
# Churned production files by churn, largest first (ties: smaller id first). Untrusted.
def Ck.lt(+x: Ck, +y: Ck) -> Bool:
  match x y:
    case Ck{+a, +k} Ck{+a2, +k2}:
      Bool.or(U32.is_lt(k2, k), Bool.and(U32.is_eq(k, k2), U32.is_lt(a, a2)))

def Ck.take(n: Nat, xs: List<&2, Ck>) -> List<&2, U32>:
  match n xs:
    case 0n _:
      Nil{}
    case 1n+p Nil{}:
      Nil{}
    case 1n+p Con{Ck{x, k}, t}:
      Con{x, Ck.take(p, t)}

# k = ceil(nf * top / 100).
def Hist.topk(+nf: U32, +top: U32) -> U32:
  U32.div(U32.add(U32.mul(nf, top), 99), 100)

def Hist.sumc(ws: List<&2, U32>, +t: G.Tr) -> U32:
  match ws:
    case Nil{}:
      0
    case Con{x, rest}:
      U32.add(Hist.cnt(t, x), Hist.sumc(rest, t))

def Cx.a(+nf: U32, +total: U32, +k: U32, +nf2: U32, +total2: U32, +ws: List<&2, U32>) -> Bool:
  Bool.and(Bool.and(U32.is_eq(nf2, nf), U32.is_eq(total2, total)), Bool.and(U32.is_eq(k, Hist.len(ws)), Hist.asc(ws, 0, True{})))

def Cx.b(+r: Rules, +flt: G.Tr, +nf: U32, +total: U32, +k: U32, +top: U32, +ws: List<&2, U32>) -> Bool:
  Bool.and(Bool.and(U32.is_lt(U32.mul(k, 100), U32.add(U32.mul(nf, Rules.top(r)), 100)), U32.is_eq(top, Hist.sumc(ws, flt))), Bool.and(U32.is_ge(total, 1), U32.is_ge(U32.mul(100, top), U32.mul(Rules.share(r), total))))

def Cx.check(+r: Rules, +flt: G.Tr, +nf: U32, +total: U32, c: Cx) -> Bool:
  match c:
    case Cx{+k, +nf2, +top, +total2, +ws}:
      Bool.and(Cx.a(nf, total, k, nf2, total2, ws), Cx.b(r, flt, nf2, total2, k, top, ws))

def Cx.push(c: Bool, x: Cx, acc: List<&2, Cx>) -> List<&2, Cx>:
  match c:
    case True{}:
      Con{x, acc}
    case False{}:
      acc

def Cx.keep(cs: List<&2, Cx>, +r: Rules, +flt: G.Tr, +nf: U32, +total: U32) -> List<&2, Cx>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{+c, t}:
      Cx.push(Cx.check(r, flt, nf, total, c), c, Cx.keep(t, r, flt, nf, total))

def Cx.search2(+ws: List<&2, U32>, +r: Rules, +flt: G.Tr, +nf: U32, +total: U32) -> List<&2, Cx>:
  Con{Cx{Hist.len(ws), nf, Hist.sumc(ws, flt), total, ws}, Nil{}}

def Ck.half_k(k: Bool, x: Ck, r: List<&2, Ck>) -> List<&2, Ck>:
  match k:
    case True{}:
      Con{x, r}
    case False{}:
      r

# Every other element, starting with the first when k.
def Ck.half(xs: List<&2, Ck>, +k: Bool) -> List<&2, Ck>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{x, t}:
      Ck.half_k(k, x, Ck.half(t, Bool.not(k)))

def Ck.hd(+b: Bool, x: Ck, y: Ck) -> Ck:
  match b:
    case True{}:
      x
    case False{}:
      y

def Ck.pl(+b: Bool, x: Ck, xt: List<&2, Ck>) -> List<&2, Ck>:
  match b:
    case True{}:
      xt
    case False{}:
      Con{x, xt}

def Ck.pr(+b: Bool, y: Ck, yt: List<&2, Ck>) -> List<&2, Ck>:
  match b:
    case True{}:
      Con{y, yt}
    case False{}:
      yt

def Ck.merge(fuel: Nat, xs: List<&2, Ck>, ys: List<&2, Ck>) -> List<&2, Ck>:
  match fuel:
    case 0n:
      List.append(&2, Ck, xs, ys)
    case 1n+p:
      match xs ys:
        case Nil{} ys2:
          ys2
        case xs2 Nil{}:
          xs2
        case Con{+x, xt} Con{+y, yt}:
          +b = Ck.lt(x, y)
          Con{Ck.hd(b, x, y), Ck.merge(p, Ck.pl(b, x, xt), Ck.pr(b, y, yt))}

def Ck.sort(fuel: Nat, xs: List<&2, Ck>) -> List<&2, Ck>:
  match fuel:
    case 0n:
      xs
    case 1n+p:
      match xs:
        case Nil{}:
          Nil{}
        case Con{x, Nil{}}:
          Con{x, Nil{}}
        case Con{+x, Con{+y, +t}}:
          +q = p
          Ck.merge(Nat.add(2n, List.length(&2, Ck, t)), Ck.sort(q, Ck.half(Con{x, Con{y, t}}, True{})), Ck.sort(q, Ck.half(Con{x, Con{y, t}}, False{})))

def Uu.half_k(k: Bool, x: U32, r: List<&2, U32>) -> List<&2, U32>:
  match k:
    case True{}:
      Con{x, r}
    case False{}:
      r

# Every other element, starting with the first when k.
def Uu.half(xs: List<&2, U32>, +k: Bool) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case Con{x, t}:
      Uu.half_k(k, x, Uu.half(t, Bool.not(k)))

def Uu.hd(+b: Bool, x: U32, y: U32) -> U32:
  match b:
    case True{}:
      x
    case False{}:
      y

def Uu.pl(+b: Bool, x: U32, xt: List<&2, U32>) -> List<&2, U32>:
  match b:
    case True{}:
      xt
    case False{}:
      Con{x, xt}

def Uu.pr(+b: Bool, y: U32, yt: List<&2, U32>) -> List<&2, U32>:
  match b:
    case True{}:
      Con{y, yt}
    case False{}:
      yt

def Uu.merge(fuel: Nat, xs: List<&2, U32>, ys: List<&2, U32>) -> List<&2, U32>:
  match fuel:
    case 0n:
      List.append(&2, U32, xs, ys)
    case 1n+p:
      match xs ys:
        case Nil{} ys2:
          ys2
        case xs2 Nil{}:
          xs2
        case Con{+x, xt} Con{+y, yt}:
          +b = U32.is_lt(x, y)
          Con{Uu.hd(b, x, y), Uu.merge(p, Uu.pl(b, x, xt), Uu.pr(b, y, yt))}

def Uu.sort(fuel: Nat, xs: List<&2, U32>) -> List<&2, U32>:
  match fuel:
    case 0n:
      xs
    case 1n+p:
      match xs:
        case Nil{}:
          Nil{}
        case Con{x, Nil{}}:
          Con{x, Nil{}}
        case Con{+x, Con{+y, +t}}:
          +q = p
          Uu.merge(Nat.add(2n, List.length(&2, U32, t)), Uu.sort(q, Uu.half(Con{x, Con{y, t}}, True{})), Uu.sort(q, Uu.half(Con{x, Con{y, t}}, False{})))

def Cx.search(+r: Rules, +flt: G.Tr, +files: List<&2, Ck>, +nf: U32, +total: U32) -> List<&2, Cx>:
  Cx.search2(Uu.sort(64n, Ck.take(U32.to_nat(Hist.topk(nf, Rules.top(r))), Ck.sort(64n, files))), r, flt, nf, total)

def Hist.files(+n: U32, +flt: G.Tr) -> List<&2, Ck>:
  Ck.all(Hist.iota(U32.to_nat(n), 0), flt)

def Hist.flt(+ch: CH, +pt: G.Tr) -> G.Tr:
  G.Graph.cnt_all(Ch.fl(CH.cfs(ch), Ch.hset(ch), pt), G.TE{})

def Hist.total(+ch: CH, +pt: G.Tr) -> U32:
  Hist.len(Ch.fl(CH.cfs(ch), Ch.hset(ch), pt))

def Hist.conc2(+r: Rules, +flt: G.Tr, +files: List<&2, Ck>, +total: U32) -> List<&2, Cx>:
  Cx.keep(Cx.search(r, flt, files, U32.from_nat(List.length(&2, Ck, files)), total), r, flt, U32.from_nat(List.length(&2, Ck, files)), total)

# The reported concentration finding (at most one).
def Hist.conc(+ch: CH, +r: Rules, +n: U32, +pt: G.Tr) -> List<&2, Cx>:
  Hist.conc2(r, Hist.flt(ch, pt), Hist.files(n, Hist.flt(ch, pt)), Hist.total(ch, pt))

# ---- validity -----------------------------------------------------------------------------------
def Hist.lt2(+pa: U32, +pb: U32, +a: U32, +b: U32) -> Bool:
  Bool.or(U32.is_lt(pa, a), Bool.and(U32.is_eq(pa, a), U32.is_lt(pb, b)))

def Va.cms(xs: List<&2, Cm>, +nc: U32, +na: U32, +pa: U32, +first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Cm{+c, +a, d}, t}:
      Bool.and(Bool.and(Bool.and(U32.is_lt(c, nc), U32.is_lt(a, na)), Bool.or(first, U32.is_lt(pa, c))), Va.cms(t, nc, na, c, False{}))

def Va.aus(xs: List<&2, Au>, +na: U32, +pa: U32, +first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Au{+a, +bot}, t}:
      Bool.and(Bool.and(Bool.and(U32.is_lt(a, na), U32.is_le(bot, 1)), Bool.or(first, U32.is_lt(pa, a))), Va.aus(t, na, a, False{}))

def Va.cfs(xs: List<&2, Cf>, +nc: U32, +n: U32, +pa: U32, +pb: U32, +first: Bool) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{Cf{+c, +f, ad, de}, t}:
      Bool.and(Bool.and(Bool.and(U32.is_lt(c, nc), U32.is_lt(f, n)), Bool.or(first, Hist.lt2(pa, pb, c, f))), Va.cfs(t, nc, n, c, f, False{}))

# At most 2^24 elements, counted in U32 without overflow.
def Va.short_cf(xs: List<&2, Cf>, +k: U32) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case Con{x, t}:
      Bool.and(U32.is_lt(k, 16777216), Va.short_cf(t, U32.add(k, 1)))

# Ids are below the header counts and the file count n, every relation is
# strictly ascending, the counts fit in 2^24, and the rule numbers are at most
# 100 (so no product overflows a U32).
def Hist.valid(+ch: CH, +r: Rules, +n: U32) -> Bool:
  Bool.and(Bool.and(Bool.and(U32.is_le(CH.nc(ch), 16777216), U32.is_le(CH.na(ch), 16777216)), Bool.and(Bool.and(U32.is_le(Rules.conf(r), 100), U32.is_le(Rules.share(r), 100)), U32.is_le(Rules.top(r), 100))), Bool.and(Bool.and(Va.cms(CH.cms(ch), CH.nc(ch), CH.na(ch), 0, True{}), Va.aus(CH.aus(ch), CH.na(ch), 0, True{})), Bool.and(Va.cfs(CH.cfs(ch), CH.nc(ch), n, 0, 0, True{}), Va.short_cf(CH.cfs(ch), 0))))

# ---- entry point ---------------------------------------------------------------------------------
def Hist.out(+ch: CH, +r: Rules, +n: U32, +pt: G.Tr, +adj: List<&2, List<&2, U32>>) -> COut:
  COut{Hist.files(n, Hist.flt(ch, pt)), Hist.conc(ch, r, n, pt), Hist.pairs(ch, r, pt, adj)}

def Hist.run2(ok: Bool, +ch: CH, +r: Rules, +n: U32, +pt: G.Tr, +adj: List<&2, List<&2, U32>>) -> Maybe<COut>:
  match ok:
    case True{}:
      Some{Hist.out(ch, r, n, pt, adj)}
    case False{}:
      None{}

# None when the facts are invalid. n is the file count, pt the production set
# and adj the engine's production import graph.
def Hist.run(+ch: CH, +r: Rules, +n: U32, +pt: G.Tr, +adj: List<&2, List<&2, U32>>) -> Maybe<COut>:
  Hist.run2(Hist.valid(ch, r, n), ch, r, n, pt, adj)

# ---- output --------------------------------------------------------------------------------------
def CRep.ids(c: List<&2, U32>) -> List<&2, String>:
  match c:
    case Nil{}:
      Nil{}
    case Con{h, t}:
      Con{U32.show(h), CRep.ids(t)}

def CRep.line(tag: String, xs: List<&2, U32>) -> String:
  tag ++ " " ++ String.join(CRep.ids(xs), " ")

def CRep.cks(+tag: String, +cs: List<&2, Ck>) -> List<&2, String>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{Ck{x, k}, t}:
      Con{CRep.line(tag, [x, k]), CRep.cks(tag, t)}

def CRep.cxs(cs: List<&2, Cx>) -> List<&2, String>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{Cx{k, nf, top, total, ws}, t}:
      Con{CRep.line("CHX", List.append(&2, U32, [k, nf, top, total], ws)), CRep.cxs(t)}

def CRep.cps(cs: List<&2, Cp>) -> List<&2, String>:
  match cs:
    case Nil{}:
      Nil{}
    case Con{Cp{a, b, sup, na, nb, ws}, t}:
      Con{CRep.line("CHP", List.append(&2, U32, [a, b, sup, na, nb], ws)), CRep.cps(t)}

def CRep.summary(+r: Rules, +files: List<&2, Ck>, +cxs: List<&2, Cx>, +cps: List<&2, Cp>) -> String:
  CRep.line("CHS", [U32.from_nat(List.length(&2, Ck, files)), U32.from_nat(List.length(&2, Cx, cxs)), U32.from_nat(List.length(&2, Cp, cps)), Rules.sup(r), Rules.conf(r), Rules.bulk(r), Rules.top(r), Rules.share(r)])

def CRep.res(+r: Rules, +files: List<&2, Ck>, +cxs: List<&2, Cx>, +cps: List<&2, Cp>) -> List<&2, String>:
  Con{"pulsar-history 0", List.append(&2, String, CRep.cks("CHF", files), List.append(&2, String, CRep.cxs(cxs), List.append(&2, String, CRep.cps(cps), Con{CRep.summary(r, files, cxs, cps), Nil{}})))}

def Hist.lines(+r: Rules, o: COut) -> List<&2, String>:
  match o:
    case COut{+files, +cxs, +cps}:
      CRep.res(r, files, cxs, cps)

# ---- decoding (unproven, like Rows.bend) -----------------------------------------------------------

def Cd.bad(d: CD) -> CD:
  match d:
    case CD{bad, h, hr, r, ch}:
      CD{1, h, hr, r, ch}

def Cd.h(fs: List<&2, U32>, d: CD) -> CD:
  match fs d:
    case Con{a, Con{b, Nil{}}} CD{bad, h, hr, r, CH{nc, na, cms, aus, cfs}}:
      CD{U32.add(bad, h), 1, hr, r, CH{a, b, cms, aus, cfs}}
    case _ d2:
      Cd.bad(d2)

def Cd.c(fs: List<&2, U32>, d: CD) -> CD:
  match fs d:
    case Con{a, Con{b, Con{c, Nil{}}}} CD{bad, h, hr, r, CH{nc, na, cms, aus, cfs}}:
      CD{bad, h, hr, r, CH{nc, na, Con{Cm{a, b, c}, cms}, aus, cfs}}
    case _ d2:
      Cd.bad(d2)

def Cd.a(fs: List<&2, U32>, d: CD) -> CD:
  match fs d:
    case Con{a, Con{b, Nil{}}} CD{bad, h, hr, r, CH{nc, na, cms, aus, cfs}}:
      CD{bad, h, hr, r, CH{nc, na, cms, Con{Au{a, b}, aus}, cfs}}
    case _ d2:
      Cd.bad(d2)

def Cd.cf(fs: List<&2, U32>, d: CD) -> CD:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Nil{}}}}} CD{bad, h, hr, r, CH{nc, na, cms, aus, cfs}}:
      CD{bad, h, hr, r, CH{nc, na, cms, aus, Con{Cf{a, b, c, e}, cfs}}}
    case _ d2:
      Cd.bad(d2)

def Cd.hr(fs: List<&2, U32>, d: CD) -> CD:
  match fs d:
    case Con{a, Con{b, Con{c, Con{e, Con{g, Nil{}}}}}} CD{bad, h, hr, r, ch}:
      CD{U32.add(bad, hr), h, 1, Rules{a, b, c, e, g}, ch}
    case _ d2:
      Cd.bad(d2)

# Tags packed as Rows.bend packs them: H 72, C 67, A 65, CF 17222, HR 18514.
def Cd.add(tag: U32, fs: List<&2, U32>, d: CD) -> CD:
  match tag:
    case 72:
      Cd.h(fs, d)
    case 67:
      Cd.c(fs, d)
    case 65:
      Cd.a(fs, d)
    case 17222:
      Cd.cf(fs, d)
    case 18514:
      Cd.hr(fs, d)
    case _:
      d

def Cd.go(rows: List<&2, W.Row>, d: CD) -> CD:
  match rows:
    case Nil{}:
      d
    case Con{W.Row{tag, fs}, t}:
      Cd.go(t, Cd.add(tag, fs, d))

def Cd.fin2(ok: Bool, ch: CH, r: Rules) -> Maybe<HIn>:
  match ok:
    case True{}:
      Some{HIn{ch, r}}
    case False{}:
      None{}

def Cd.fin(d: CD) -> Maybe<HIn>:
  match d:
    case CD{bad, h, hr, r, CH{nc, na, cms, aus, cfs}}:
      Cd.fin2(Bool.and(U32.is_eq(bad, 0), Bool.and(U32.is_eq(h, 1), U32.is_eq(hr, 1))), CH{nc, na, List.reverse(&2, Cm, cms), List.reverse(&2, Au, aus), List.reverse(&2, Cf, cfs)}, r)

# None for a malformed row, or not exactly one H header and one HR row.
def Hist.decode(rows: List<&2, W.Row>) -> Maybe<HIn>:
  Cd.fin(Cd.go(rows, CD{0, 0, 0, Rules{0, 0, 0, 0, 0}, CH{0, 0, Nil{}, Nil{}, Nil{}}}))
