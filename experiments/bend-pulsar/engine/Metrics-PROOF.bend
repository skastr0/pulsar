import Base
import ./Metrics.bend as M
import ./Metrics-LAWS.bend as Laws
import ./Metrics-NAT.bend as N

def Laws.run_measures_trees(r, fns, cts, fs, h):
  %Equal.sym(Maybe<&2, List<&2, M.FnT>>, M.Trees.of(fns, cts), Some{fs}, h) : {M.Metrics.run2(M.Rules.cap(r), _) == Some{M.Metrics.measure_all(fs, M.Rules.cap(r))} : Maybe<&2, List<&2, M.FnM>>}
  {==}

def Laws.run_refuses_invalid(r, fns, cts, h):
  %Equal.sym(Maybe<&2, List<&2, M.FnT>>, M.Trees.of(fns, cts), None{}, h) : {M.Metrics.run2(M.Rules.cap(r), _) == None{} : Maybe<&2, List<&2, M.FnM>>}
  {==}

def Laws.measure_is_the_measures(fn, t, loc, cap):
  {==}

def Laws.measure_all_cons(f, fs, cap):
  {==}

def Laws.lines_shape(r, ms):
  {==}

def Laws.cyclomatic_skips_nested_fn(kids, next):
  {==}

def Laws.nesting_skips_nested_fn(kids, next, m):
  {==}

def Laws.npath_ignores_nested_fn_body(kids, next, cap):
  {==}

def Laws.cyclomatic_is_one_plus_decisions(t):
  {==}

def Laws.decision_branch(kids, next):
  {==}

def Laws.decision_loop(kids, next):
  {==}

def Laws.decision_short_circuit(kids, next):
  {==}

def Laws.decision_multi(kids, next):
  {==}

def Laws.decision_try(kids, next):
  {==}

def Laws.no_decision_arm(kids, next):
  {==}

def Laws.no_decision_exit(kids, next):
  {==}

def Laws.no_decision_flag(kids, next):
  {==}

def Laws.no_decision_finally(kids, next):
  {==}

def Laws.nesting_loop(kids, next, m):
  {==}

# ---- small lemmas -----------------------------------------------------------------------------
def Disc.Bool(b: Bool) -> Type:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

def Bool.ff_tt(e: {False{} == True{} : Bool}) -> Empty:
  %Equal.sym(Bool, False{}, True{}, e) : Disc.Bool(_)
  Unit{}

def Nat.add_assoc(a: Nat, +b: Nat, +c: Nat) -> {Nat.add(Nat.add(a, b), c) == Nat.add(a, Nat.add(b, c)) : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      %Nat.add_assoc(p, b, c) : {1n+Nat.add(Nat.add(p, b), c) == 1n+_ : Nat}
      {==}

# ---- C. decisions add up ------------------------------------------------------------------------
def Cc.node_add(k: M.K, +kids: M.Ct, +d: Nat, +r: Nat, +s: Nat) -> {M.Cc.node(k, kids, d, Nat.add(r, s)) == Nat.add(M.Cc.node(k, kids, d, r), s) : Nat}:
  match k:
    case M.KFn{}:
      {==}
    case M.KBranch{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KBranch{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KBranch{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KBranch{}, kids), d), r, s))
    case M.KArm{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KArm{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KArm{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KArm{}, kids), d), r, s))
    case M.KMulti{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KMulti{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KMulti{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KMulti{}, kids), d), r, s))
    case M.KLoop{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KLoop{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KLoop{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KLoop{}, kids), d), r, s))
    case M.KTry{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KTry{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KTry{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KTry{}, kids), d), r, s))
    case M.KSc{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KSc{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KSc{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KSc{}, kids), d), r, s))
    case M.KExit{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KExit{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KExit{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KExit{}, kids), d), r, s))
    case M.KFlag{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KFlag{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KFlag{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KFlag{}, kids), d), r, s))
    case M.KFin{}:
      Equal.sym(Nat, Nat.add(Nat.add(Nat.add(M.Cc.weight(M.KFin{}, kids), d), r), s), Nat.add(Nat.add(M.Cc.weight(M.KFin{}, kids), d), Nat.add(r, s)), Nat.add_assoc(Nat.add(M.Cc.weight(M.KFin{}, kids), d), r, s))

def Laws.decisions_add_up(a, b):
  match a:
    case M.Leaf{}:
      {==}
    case M.Node{k, kids, next}:
      %Equal.sym(Nat, M.Cc.seq(Laws.Ct.cat(next, b)), Nat.add(M.Cc.seq(next), M.Cc.seq(b)), Laws.decisions_add_up(next, b)) : {M.Cc.node(k, kids, M.Cc.seq(kids), _) == Nat.add(M.Cc.node(k, kids, M.Cc.seq(kids), M.Cc.seq(next)), M.Cc.seq(b)) : Nat}
      Cc.node_add(k, kids, M.Cc.seq(kids), M.Cc.seq(next), M.Cc.seq(b))

def Laws.arms_add_up(a, b):
  match a:
    case M.Leaf{}:
      {==}
    case M.Node{k, kids, next}:
      %Equal.sym(Nat, M.Cc.arms(Laws.Ct.cat(next, b)), Nat.add(M.Cc.arms(next), M.Cc.arms(b)), Laws.arms_add_up(next, b)) : {Nat.add(M.K.arm(k), _) == Nat.add(Nat.add(M.K.arm(k), M.Cc.arms(next)), M.Cc.arms(b)) : Nat}
      Equal.sym(Nat, Nat.add(Nat.add(M.K.arm(k), M.Cc.arms(next)), M.Cc.arms(b)), Nat.add(M.K.arm(k), Nat.add(M.Cc.arms(next), M.Cc.arms(b))), Nat.add_assoc(M.K.arm(k), M.Cc.arms(next), M.Cc.arms(b)))

# ---- F. findings --------------------------------------------------------------------------------
# What a membership in Rule.keep tells: the kept finding, or one already in `rest`.
def Keep.mem(b: Bool, +x: M.Finding, +rest: List<&2, M.Finding>, +y: M.Finding, hm: Laws.MemF(M.Rule.keep(b, x, rest), y)) -> Either<&2, &2, Laws.And({b == True{} : Bool}, {x == y : M.Finding}), Laws.MemF(rest, y)>:
  match b:
    case True{}:
      match hm:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{m}:
          Inr{m}
    case False{}:
      Inr{hm}

def Keep.stay(b: Bool, +x: M.Finding, +rest: List<&2, M.Finding>, +y: M.Finding, m: Laws.MemF(rest, y)) -> Laws.MemF(M.Rule.keep(b, x, rest), y):
  match b:
    case True{}:
      Inr{m}
    case False{}:
      m

def Keep.hit(b: Bool, +x: M.Finding, +rest: List<&2, M.Finding>, hb: {b == True{} : Bool}) -> Laws.MemF(M.Rule.keep(b, x, rest), x):
  match b:
    case True{}:
      Inl{{==}}
    case False{}:
      Empty.absurd(Laws.MemF(rest, x), Bool.ff_tt(hb))

# A finding for `rule` of function f is sound in any list that starts with f.
def Hit(+r: M.Rules, +rule: U32, +f: U32, +cc: Nat, +nest: Nat, +np: Nat, +loc: Nat, +t: List<&2, M.FnM>, +v: Nat, +th: Nat, +y: M.Finding, p: Laws.And({Nat.is_gt(v, th) == True{} : Bool}, {M.Finding{rule, f, v, th} == y : M.Finding}), hth: {th == Laws.Thr(r, rule) : Nat}, hv: {Laws.Field(M.FnM{f, cc, nest, np, loc}, rule) == v : Nat}) -> Laws.Sound(r, Con{M.FnM{f, cc, nest, np, loc}, t}, y):
  match p:
    case Tuple{g, e}:
      %e : Laws.Sound(r, Con{M.FnM{f, cc, nest, np, loc}, t}, _)
      Tuple{g, Tuple{hth, Inl{Tuple{{==}, hv}}}}

# Sound in the tail is sound in the whole list.
def Sound.weak(+r: M.Rules, m: M.FnM, +t: List<&2, M.FnM>, y: M.Finding, s: Laws.Sound(r, t, y)) -> Laws.Sound(r, Con{m, t}, y):
  match m y:
    case M.FnM{f, cc, nest, np, loc} M.Finding{rule, fn, v, thr}:
      match s:
        case Tuple{a, q}:
          match q:
            case Tuple{b, c}:
              Tuple{a, Tuple{b, Inr{c}}}

def One.l4(+tcc: Nat, +tn: Nat, +tp: Nat, +tl: Nat, +cap: Nat, +f: U32, +cc: Nat, +nest: Nat, +np: Nat, +loc: Nat, +t: List<&2, M.FnM>, +y: M.Finding, o: Either<&2, &2, Laws.And({Nat.is_gt(loc, tl) == True{} : Bool}, {M.Finding{4, f, loc, tl} == y : M.Finding}), Laws.MemF(M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t), y)>, ih: Laws.MemF(M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t), y) -> Laws.Sound(M.Rules{tcc, tn, tp, tl, cap}, t, y)) -> Laws.Sound(M.Rules{tcc, tn, tp, tl, cap}, Con{M.FnM{f, cc, nest, np, loc}, t}, y):
  match o:
    case Inl{p}:
      Hit(M.Rules{tcc, tn, tp, tl, cap}, 4, f, cc, nest, np, loc, t, loc, tl, y, p, {==}, {==})
    case Inr{m}:
      Sound.weak(M.Rules{tcc, tn, tp, tl, cap}, M.FnM{f, cc, nest, np, loc}, t, y, ih(m))

def One.l3(+tcc: Nat, +tn: Nat, +tp: Nat, +tl: Nat, +cap: Nat, +f: U32, +cc: Nat, +nest: Nat, +np: Nat, +loc: Nat, +t: List<&2, M.FnM>, +y: M.Finding, o: Either<&2, &2, Laws.And({Nat.is_gt(np, tp) == True{} : Bool}, {M.Finding{3, f, np, tp} == y : M.Finding}), Laws.MemF(M.Rule.check(4, f, loc, tl, M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t)), y)>, ih: Laws.MemF(M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t), y) -> Laws.Sound(M.Rules{tcc, tn, tp, tl, cap}, t, y)) -> Laws.Sound(M.Rules{tcc, tn, tp, tl, cap}, Con{M.FnM{f, cc, nest, np, loc}, t}, y):
  match o:
    case Inl{p}:
      Hit(M.Rules{tcc, tn, tp, tl, cap}, 3, f, cc, nest, np, loc, t, np, tp, y, p, {==}, {==})
    case Inr{m}:
      One.l4(tcc, tn, tp, tl, cap, f, cc, nest, np, loc, t, y, Keep.mem(Nat.is_gt(loc, tl), M.Finding{4, f, loc, tl}, M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t), y, m), ih)

def One.l2(+tcc: Nat, +tn: Nat, +tp: Nat, +tl: Nat, +cap: Nat, +f: U32, +cc: Nat, +nest: Nat, +np: Nat, +loc: Nat, +t: List<&2, M.FnM>, +y: M.Finding, o: Either<&2, &2, Laws.And({Nat.is_gt(nest, tn) == True{} : Bool}, {M.Finding{2, f, nest, tn} == y : M.Finding}), Laws.MemF(M.Rule.check(3, f, np, tp, M.Rule.check(4, f, loc, tl, M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t))), y)>, ih: Laws.MemF(M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t), y) -> Laws.Sound(M.Rules{tcc, tn, tp, tl, cap}, t, y)) -> Laws.Sound(M.Rules{tcc, tn, tp, tl, cap}, Con{M.FnM{f, cc, nest, np, loc}, t}, y):
  match o:
    case Inl{p}:
      Hit(M.Rules{tcc, tn, tp, tl, cap}, 2, f, cc, nest, np, loc, t, nest, tn, y, p, {==}, {==})
    case Inr{m}:
      One.l3(tcc, tn, tp, tl, cap, f, cc, nest, np, loc, t, y, Keep.mem(Nat.is_gt(np, tp), M.Finding{3, f, np, tp}, M.Rule.check(4, f, loc, tl, M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t)), y, m), ih)

def One.l1(+tcc: Nat, +tn: Nat, +tp: Nat, +tl: Nat, +cap: Nat, +f: U32, +cc: Nat, +nest: Nat, +np: Nat, +loc: Nat, +t: List<&2, M.FnM>, +y: M.Finding, o: Either<&2, &2, Laws.And({Nat.is_gt(cc, tcc) == True{} : Bool}, {M.Finding{1, f, cc, tcc} == y : M.Finding}), Laws.MemF(M.Rule.check(2, f, nest, tn, M.Rule.check(3, f, np, tp, M.Rule.check(4, f, loc, tl, M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t)))), y)>, ih: Laws.MemF(M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t), y) -> Laws.Sound(M.Rules{tcc, tn, tp, tl, cap}, t, y)) -> Laws.Sound(M.Rules{tcc, tn, tp, tl, cap}, Con{M.FnM{f, cc, nest, np, loc}, t}, y):
  match o:
    case Inl{p}:
      Hit(M.Rules{tcc, tn, tp, tl, cap}, 1, f, cc, nest, np, loc, t, cc, tcc, y, p, {==}, {==})
    case Inr{m}:
      One.l2(tcc, tn, tp, tl, cap, f, cc, nest, np, loc, t, y, Keep.mem(Nat.is_gt(nest, tn), M.Finding{2, f, nest, tn}, M.Rule.check(3, f, np, tp, M.Rule.check(4, f, loc, tl, M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t))), y, m), ih)

def Laws.findings_sound(r, ms, x, hm):
  match r:
    case M.Rules{+tcc, +tn, +tp, +tl, +cap}:
      match ms:
        case Nil{}:
          match hm:
        case Con{m, t}:
          match m:
            case M.FnM{+f, +cc, +nest, +np, +loc}:
              One.l1(tcc, tn, tp, tl, cap, f, cc, nest, np, loc, t, x, Keep.mem(Nat.is_gt(cc, tcc), M.Finding{1, f, cc, tcc}, M.Rule.check(2, f, nest, tn, M.Rule.check(3, f, np, tp, M.Rule.check(4, f, loc, tl, M.Metrics.findings(M.Rules{tcc, tn, tp, tl, cap}, t)))), x, hm), mm => Laws.findings_sound(M.Rules{tcc, tn, tp, tl, cap}, t, x, mm))

# A finding already in `rest` stays through one more function's checks.
def One.stay(r: M.Rules, m: M.FnM, +rest: List<&2, M.Finding>, +y: M.Finding, mm: Laws.MemF(rest, y)) -> Laws.MemF(M.Rule.one(r, m, rest), y):
  match r m:
    case M.Rules{+tcc, +tn, +tp, +tl, cap} M.FnM{+f, +cc, +nest, +np, +loc}:
      Keep.stay(Nat.is_gt(cc, tcc), M.Finding{1, f, cc, tcc}, M.Rule.check(2, f, nest, tn, M.Rule.check(3, f, np, tp, M.Rule.check(4, f, loc, tl, rest))), y, Keep.stay(Nat.is_gt(nest, tn), M.Finding{2, f, nest, tn}, M.Rule.check(3, f, np, tp, M.Rule.check(4, f, loc, tl, rest)), y, Keep.stay(Nat.is_gt(np, tp), M.Finding{3, f, np, tp}, M.Rule.check(4, f, loc, tl, rest), y, Keep.stay(Nat.is_gt(loc, tl), M.Finding{4, f, loc, tl}, rest, y, mm))))

def Laws.findings_complete_cyclomatic(tcc, tnest, tnp, tloc, cap, ms, fn, cc, nest, np, loc, hm, h):
  match ms:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(M.FnM, m, M.FnM{fn, cc, nest, np, loc}, e) : Laws.MemF(M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, Con{_, t}), M.Finding{1, fn, cc, tcc})
          Keep.hit(Nat.is_gt(cc, tcc), M.Finding{1, fn, cc, tcc}, M.Rule.check(2, fn, nest, tnest, M.Rule.check(3, fn, np, tnp, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t)))), h)
        case Inr{mm}:
          One.stay(M.Rules{tcc, tnest, tnp, tloc, cap}, m, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t), M.Finding{1, fn, cc, tcc}, Laws.findings_complete_cyclomatic(tcc, tnest, tnp, tloc, cap, t, fn, cc, nest, np, loc, mm, h))

def Laws.findings_complete_nesting(tcc, tnest, tnp, tloc, cap, ms, fn, cc, nest, np, loc, hm, h):
  match ms:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(M.FnM, m, M.FnM{fn, cc, nest, np, loc}, e) : Laws.MemF(M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, Con{_, t}), M.Finding{2, fn, nest, tnest})
          Keep.stay(Nat.is_gt(cc, tcc), M.Finding{1, fn, cc, tcc}, M.Rule.check(2, fn, nest, tnest, M.Rule.check(3, fn, np, tnp, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t)))), M.Finding{2, fn, nest, tnest}, Keep.hit(Nat.is_gt(nest, tnest), M.Finding{2, fn, nest, tnest}, M.Rule.check(3, fn, np, tnp, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t))), h))
        case Inr{mm}:
          One.stay(M.Rules{tcc, tnest, tnp, tloc, cap}, m, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t), M.Finding{2, fn, nest, tnest}, Laws.findings_complete_nesting(tcc, tnest, tnp, tloc, cap, t, fn, cc, nest, np, loc, mm, h))

def Laws.findings_complete_npath(tcc, tnest, tnp, tloc, cap, ms, fn, cc, nest, np, loc, hm, h):
  match ms:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(M.FnM, m, M.FnM{fn, cc, nest, np, loc}, e) : Laws.MemF(M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, Con{_, t}), M.Finding{3, fn, np, tnp})
          Keep.stay(Nat.is_gt(cc, tcc), M.Finding{1, fn, cc, tcc}, M.Rule.check(2, fn, nest, tnest, M.Rule.check(3, fn, np, tnp, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t)))), M.Finding{3, fn, np, tnp}, Keep.stay(Nat.is_gt(nest, tnest), M.Finding{2, fn, nest, tnest}, M.Rule.check(3, fn, np, tnp, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t))), M.Finding{3, fn, np, tnp}, Keep.hit(Nat.is_gt(np, tnp), M.Finding{3, fn, np, tnp}, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t)), h)))
        case Inr{mm}:
          One.stay(M.Rules{tcc, tnest, tnp, tloc, cap}, m, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t), M.Finding{3, fn, np, tnp}, Laws.findings_complete_npath(tcc, tnest, tnp, tloc, cap, t, fn, cc, nest, np, loc, mm, h))

def Laws.findings_complete_length(tcc, tnest, tnp, tloc, cap, ms, fn, cc, nest, np, loc, hm, h):
  match ms:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(M.FnM, m, M.FnM{fn, cc, nest, np, loc}, e) : Laws.MemF(M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, Con{_, t}), M.Finding{4, fn, loc, tloc})
          Keep.stay(Nat.is_gt(cc, tcc), M.Finding{1, fn, cc, tcc}, M.Rule.check(2, fn, nest, tnest, M.Rule.check(3, fn, np, tnp, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t)))), M.Finding{4, fn, loc, tloc}, Keep.stay(Nat.is_gt(nest, tnest), M.Finding{2, fn, nest, tnest}, M.Rule.check(3, fn, np, tnp, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t))), M.Finding{4, fn, loc, tloc}, Keep.stay(Nat.is_gt(np, tnp), M.Finding{3, fn, np, tnp}, M.Rule.check(4, fn, loc, tloc, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t)), M.Finding{4, fn, loc, tloc}, Keep.hit(Nat.is_gt(loc, tloc), M.Finding{4, fn, loc, tloc}, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t), h))))
        case Inr{mm}:
          One.stay(M.Rules{tcc, tnest, tnp, tloc, cap}, m, M.Metrics.findings(M.Rules{tcc, tnest, tnp, tloc, cap}, t), M.Finding{4, fn, loc, tloc}, Laws.findings_complete_length(tcc, tnest, tnp, tloc, cap, t, fn, cc, nest, np, loc, mm, h))

# ---- D. nesting ---------------------------------------------------------------------------------
def Nat.sub_zero(+a: Nat) -> {Nat.sub(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      {==}

def Nat.max_zero(+a: Nat) -> {Nat.max(a, 0n) == a : Nat}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      {==}

def Laws.nesting_then_if_nests(b):
  {==}

def Laws.nesting_else_if_is_flat(a, b):
  %Equal.sym(Nat, Nat.sub(M.Nest.seq(b, M.MPre{}), 0n), M.Nest.seq(b, M.MPre{}), Nat.sub_zero(M.Nest.seq(b, M.MPre{}))) : {1n+Nat.max(M.Nest.seq(a, M.MAny{}), Nat.max(_, 0n)) == 1n+Nat.max(M.Nest.seq(a, M.MAny{}), M.Nest.seq(b, M.MPre{})) : Nat}
  %Equal.sym(Nat, Nat.max(M.Nest.seq(b, M.MPre{}), 0n), M.Nest.seq(b, M.MPre{}), Nat.max_zero(M.Nest.seq(b, M.MPre{}))) : {1n+Nat.max(M.Nest.seq(a, M.MAny{}), _) == 1n+Nat.max(M.Nest.seq(a, M.MAny{}), M.Nest.seq(b, M.MPre{})) : Nat}
  {==}

# ---- N1. the shipped NPath is the recurrence, capped ---------------------------------------------
def Np.kids_cap(k: M.K, +a: M.Agg, +c: Nat) -> {M.Np.kids(k, Laws.Cap(a, c), c) == Laws.Cap(Laws.Npx.kids(k, a), c) : M.Agg}:
  match k:
    case M.KFn{}:
      {==}
    case M.KBranch{}:
      {==}
    case M.KArm{}:
      {==}
    case M.KMulti{}:
      {==}
    case M.KLoop{}:
      {==}
    case M.KTry{}:
      {==}
    case M.KSc{}:
      {==}
    case M.KExit{}:
      {==}
    case M.KFlag{}:
      {==}
    case M.KFin{}:
      {==}

# min(min(min(s,c) + x, c) + y, c) = min(s + x + y, c)
def Np.add2(+s: Nat, +x: Nat, +y: Nat, +c: Nat) -> {M.Sat.add(M.Sat.add(Nat.min(s, c), x, c), y, c) == Nat.min(Nat.add(Nat.add(s, x), y), c) : Nat}:
  %Equal.sym(Nat, Nat.min(Nat.add(Nat.min(s, c), x), c), Nat.min(Nat.add(s, x), c), N.Cap.add_l(s, x, c)) : {Nat.min(Nat.add(_, y), c) == Nat.min(Nat.add(Nat.add(s, x), y), c) : Nat}
  N.Cap.add_l(Nat.add(s, x), y, c)

def Np.value_cap(k: M.K, +p: Nat, +s: Nat, +n: Nat, +sc: Nat, +d: Nat, +f: Nat, +c: Nat) -> {M.Np.val(k, Nat.min(p, c), Nat.min(s, c), n, sc, d, Nat.min(f, c), c) == Nat.min(Laws.Npx.val(k, p, s, n, sc, d, f), c) : Nat}:
  match k:
    case M.KBranch{}:
      Np.add2(s, Nat.sub(2n, n), sc, c)
    case M.KMulti{}:
      Np.add2(s, Nat.sub(1n, Nat.min(d, n)), sc, c)
    case M.KLoop{}:
      Np.add2(p, 1n, sc, c)
    case M.KTry{}:
      %Equal.sym(Nat, Nat.min(Nat.add(Nat.min(s, c), Nat.sub(1n, n)), c), Nat.min(Nat.add(s, Nat.sub(1n, n)), c), N.Cap.add_l(s, Nat.sub(1n, n), c)) : {Nat.min(Nat.mul(_, Nat.min(f, c)), c) == Nat.min(Nat.mul(Nat.add(s, Nat.sub(1n, n)), f), c) : Nat}
      N.Cap.mul(Nat.add(s, Nat.sub(1n, n)), f, c)
    case M.KArm{}:
      {==}
    case M.KFn{}:
      {==}
    case M.KSc{}:
      {==}
    case M.KExit{}:
      {==}
    case M.KFlag{}:
      {==}
    case M.KFin{}:
      {==}

def Np.sum_cap(k: M.K, +ap: Nat, +rs: Nat, +c: Nat) -> {M.Sat.add(Nat.mul(M.K.arm(k), Nat.min(ap, c)), Nat.min(rs, c), c) == Nat.min(Nat.add(Laws.Npx.armv(k, ap), rs), c) : Nat}:
  match k:
    case M.KArm{}:
      %Equal.sym(Nat, Nat.add(Nat.min(ap, c), 0n), Nat.min(ap, c), N.Nat.add_zero_r(Nat.min(ap, c))) : {Nat.min(Nat.add(_, Nat.min(rs, c)), c) == Nat.min(Nat.add(ap, rs), c) : Nat}
      N.Cap.add(ap, rs, c)
    case M.KBranch{}:
      N.Nat.min_idem(rs, c)
    case M.KMulti{}:
      N.Nat.min_idem(rs, c)
    case M.KLoop{}:
      N.Nat.min_idem(rs, c)
    case M.KTry{}:
      N.Nat.min_idem(rs, c)
    case M.KSc{}:
      N.Nat.min_idem(rs, c)
    case M.KExit{}:
      N.Nat.min_idem(rs, c)
    case M.KFn{}:
      N.Nat.min_idem(rs, c)
    case M.KFlag{}:
      N.Nat.min_idem(rs, c)
    case M.KFin{}:
      N.Nat.min_idem(rs, c)

def Np.fin_cap(k: M.K, +ap: Nat, +rf: Nat, +c: Nat) -> {M.Sat.mul(M.Np.fin_of(k, Nat.min(ap, c), c), Nat.min(rf, c), c) == Nat.min(Nat.mul(Laws.Npx.fin_of(k, ap), rf), c) : Nat}:
  match k:
    case M.KFin{}:
      N.Cap.mul(ap, rf, c)
    case M.KBranch{}:
      N.Cap.mul(1n, rf, c)
    case M.KArm{}:
      N.Cap.mul(1n, rf, c)
    case M.KMulti{}:
      N.Cap.mul(1n, rf, c)
    case M.KLoop{}:
      N.Cap.mul(1n, rf, c)
    case M.KTry{}:
      N.Cap.mul(1n, rf, c)
    case M.KSc{}:
      N.Cap.mul(1n, rf, c)
    case M.KExit{}:
      N.Cap.mul(1n, rf, c)
    case M.KFn{}:
      N.Cap.mul(1n, rf, c)
    case M.KFlag{}:
      N.Cap.mul(1n, rf, c)

def Np.cons_cap(+k: M.K, a: M.Agg, r: M.Agg, +c: Nat) -> {M.Np.cons(k, Laws.Cap(a, c), Laws.Cap(r, c), c) == Laws.Cap(Laws.Npx.cons(k, a, r), c) : M.Agg}:
  match a r:
    case M.Agg{+ap, +as, +an, +asc, +ad, +af} M.Agg{+rp, +rs, +rn, +rsc, +rd, +rf}:
      %Equal.sym(Nat, M.Np.val(k, Nat.min(ap, c), Nat.min(as, c), an, asc, ad, Nat.min(af, c), c), Nat.min(Laws.Npx.val(k, ap, as, an, asc, ad, af), c), Np.value_cap(k, ap, as, an, asc, ad, af, c)) : {M.Agg{Nat.min(Nat.mul(_, Nat.min(rp, c)), c), M.Sat.add(Nat.mul(M.K.arm(k), Nat.min(ap, c)), Nat.min(rs, c), c), Nat.add(M.K.arm(k), rn), Nat.add(M.K.sc(k), rsc), Nat.add(M.K.flag(k), rd), M.Sat.mul(M.Np.fin_of(k, Nat.min(ap, c), c), Nat.min(rf, c), c)} == Laws.Cap(Laws.Npx.cons(k, M.Agg{ap, as, an, asc, ad, af}, M.Agg{rp, rs, rn, rsc, rd, rf}), c) : M.Agg}
      %Equal.sym(Nat, Nat.min(Nat.mul(Nat.min(Laws.Npx.val(k, ap, as, an, asc, ad, af), c), Nat.min(rp, c)), c), Nat.min(Nat.mul(Laws.Npx.val(k, ap, as, an, asc, ad, af), rp), c), N.Cap.mul(Laws.Npx.val(k, ap, as, an, asc, ad, af), rp, c)) : {M.Agg{_, M.Sat.add(Nat.mul(M.K.arm(k), Nat.min(ap, c)), Nat.min(rs, c), c), Nat.add(M.K.arm(k), rn), Nat.add(M.K.sc(k), rsc), Nat.add(M.K.flag(k), rd), M.Sat.mul(M.Np.fin_of(k, Nat.min(ap, c), c), Nat.min(rf, c), c)} == Laws.Cap(Laws.Npx.cons(k, M.Agg{ap, as, an, asc, ad, af}, M.Agg{rp, rs, rn, rsc, rd, rf}), c) : M.Agg}
      %Equal.sym(Nat, M.Sat.add(Nat.mul(M.K.arm(k), Nat.min(ap, c)), Nat.min(rs, c), c), Nat.min(Nat.add(Laws.Npx.armv(k, ap), rs), c), Np.sum_cap(k, ap, rs, c)) : {M.Agg{Nat.min(Nat.mul(Laws.Npx.val(k, ap, as, an, asc, ad, af), rp), c), _, Nat.add(M.K.arm(k), rn), Nat.add(M.K.sc(k), rsc), Nat.add(M.K.flag(k), rd), M.Sat.mul(M.Np.fin_of(k, Nat.min(ap, c), c), Nat.min(rf, c), c)} == Laws.Cap(Laws.Npx.cons(k, M.Agg{ap, as, an, asc, ad, af}, M.Agg{rp, rs, rn, rsc, rd, rf}), c) : M.Agg}
      %Equal.sym(Nat, M.Sat.mul(M.Np.fin_of(k, Nat.min(ap, c), c), Nat.min(rf, c), c), Nat.min(Nat.mul(Laws.Npx.fin_of(k, ap), rf), c), Np.fin_cap(k, ap, rf, c)) : {M.Agg{Nat.min(Nat.mul(Laws.Npx.val(k, ap, as, an, asc, ad, af), rp), c), Nat.min(Nat.add(Laws.Npx.armv(k, ap), rs), c), Nat.add(M.K.arm(k), rn), Nat.add(M.K.sc(k), rsc), Nat.add(M.K.flag(k), rd), _} == Laws.Cap(Laws.Npx.cons(k, M.Agg{ap, as, an, asc, ad, af}, M.Agg{rp, rs, rn, rsc, rd, rf}), c) : M.Agg}
      {==}

def Laws.npath_is_nejmeh_capped(t, cap):
  match t:
    case M.Leaf{}:
      {==}
    case M.Node{+k, +kids, +next}:
      %Equal.sym(M.Agg, M.Np.agg(kids, cap), Laws.Cap(Laws.Npx.agg(kids), cap), Laws.npath_is_nejmeh_capped(kids, cap)) : {M.Np.cons(k, M.Np.kids(k, _, cap), M.Np.agg(next, cap), cap) == Laws.Cap(Laws.Npx.cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next)), cap) : M.Agg}
      %Equal.sym(M.Agg, M.Np.agg(next, cap), Laws.Cap(Laws.Npx.agg(next), cap), Laws.npath_is_nejmeh_capped(next, cap)) : {M.Np.cons(k, M.Np.kids(k, Laws.Cap(Laws.Npx.agg(kids), cap), cap), _, cap) == Laws.Cap(Laws.Npx.cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next)), cap) : M.Agg}
      %Equal.sym(M.Agg, M.Np.kids(k, Laws.Cap(Laws.Npx.agg(kids), cap), cap), Laws.Cap(Laws.Npx.kids(k, Laws.Npx.agg(kids)), cap), Np.kids_cap(k, Laws.Npx.agg(kids), cap)) : {M.Np.cons(k, _, Laws.Cap(Laws.Npx.agg(next), cap), cap) == Laws.Cap(Laws.Npx.cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next)), cap) : M.Agg}
      Np.cons_cap(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next), cap)

def Np.prod_cap(a: M.Agg, +c: Nat) -> {M.Np.prod(Laws.Cap(a, c)) == Nat.min(M.Np.prod(a), c) : Nat}:
  match a:
    case M.Agg{prod, sum, arms, sc, dflt, fin}:
      {==}

def Laws.npath_printed_is_min(t, cap):
  %Equal.sym(M.Agg, M.Np.agg(t, cap), Laws.Cap(Laws.Npx.agg(t), cap), Laws.npath_is_nejmeh_capped(t, cap)) : {M.Np.prod(_) == Nat.min(Laws.Npx.of(t), cap) : Nat}
  Np.prod_cap(Laws.Npx.agg(t), cap)

# ---- N3. a sequence multiplies ------------------------------------------------------------------
def Npx.prod_cons(+k: M.K, a: M.Agg, r: M.Agg) -> {M.Np.prod(Laws.Npx.cons(k, a, r)) == Nat.mul(Laws.Npx.value(k, a), M.Np.prod(r)) : Nat}:
  match a r:
    case M.Agg{ap, as, an, asc, ad, af} M.Agg{rp, rs, rn, rsc, rd, rf}:
      {==}

def Laws.npath_sequence_is_product(a, b):
  match a:
    case M.Leaf{}:
      Equal.sym(Nat, Nat.mul(1n, Laws.Npx.of(b)), Laws.Npx.of(b), N.Nat.mul_one_l(Laws.Npx.of(b)))
    case M.Node{+k, +kids, +next}:
      %Equal.sym(Nat, M.Np.prod(Laws.Npx.cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(Laws.Ct.cat(next, b)))), Nat.mul(Laws.Npx.value(k, Laws.Npx.kids(k, Laws.Npx.agg(kids))), Laws.Npx.of(Laws.Ct.cat(next, b))), Npx.prod_cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(Laws.Ct.cat(next, b)))) : {_ == Nat.mul(M.Np.prod(Laws.Npx.cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next))), Laws.Npx.of(b)) : Nat}
      %Equal.sym(Nat, M.Np.prod(Laws.Npx.cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next))), Nat.mul(Laws.Npx.value(k, Laws.Npx.kids(k, Laws.Npx.agg(kids))), Laws.Npx.of(next)), Npx.prod_cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next))) : {Nat.mul(Laws.Npx.value(k, Laws.Npx.kids(k, Laws.Npx.agg(kids))), Laws.Npx.of(Laws.Ct.cat(next, b))) == Nat.mul(_, Laws.Npx.of(b)) : Nat}
      %Equal.sym(Nat, Laws.Npx.of(Laws.Ct.cat(next, b)), Nat.mul(Laws.Npx.of(next), Laws.Npx.of(b)), Laws.npath_sequence_is_product(next, b)) : {Nat.mul(Laws.Npx.value(k, Laws.Npx.kids(k, Laws.Npx.agg(kids))), _) == Nat.mul(Nat.mul(Laws.Npx.value(k, Laws.Npx.kids(k, Laws.Npx.agg(kids))), Laws.Npx.of(next)), Laws.Npx.of(b)) : Nat}
      Equal.sym(Nat, Nat.mul(Nat.mul(Laws.Npx.value(k, Laws.Npx.kids(k, Laws.Npx.agg(kids))), Laws.Npx.of(next)), Laws.Npx.of(b)), Nat.mul(Laws.Npx.value(k, Laws.Npx.kids(k, Laws.Npx.agg(kids))), Nat.mul(Laws.Npx.of(next), Laws.Npx.of(b))), N.Nat.mul_assoc(Laws.Npx.value(k, Laws.Npx.kids(k, Laws.Npx.agg(kids))), Laws.Npx.of(next), Laws.Npx.of(b)))

def Laws.npath_printed_sequence(a, b, cap):
  %Equal.sym(Nat, M.Np.of(Laws.Ct.cat(a, b), cap), Nat.min(Laws.Npx.of(Laws.Ct.cat(a, b)), cap), Laws.npath_printed_is_min(Laws.Ct.cat(a, b), cap)) : {_ == Nat.min(Nat.mul(Laws.Npx.of(a), Laws.Npx.of(b)), cap) : Nat}
  %Equal.sym(Nat, Laws.Npx.of(Laws.Ct.cat(a, b)), Nat.mul(Laws.Npx.of(a), Laws.Npx.of(b)), Laws.npath_sequence_is_product(a, b)) : {Nat.min(_, cap) == Nat.min(Nat.mul(Laws.Npx.of(a), Laws.Npx.of(b)), cap) : Nat}
  {==}

# ---- N5. at least one path ----------------------------------------------------------------------
def Agg.fin(a: M.Agg) -> Nat:
  match a:
    case M.Agg{prod, sum, arms, sc, dflt, fin}:
      fin

def Agg.sum(a: M.Agg) -> Nat:
  match a:
    case M.Agg{prod, sum, arms, sc, dflt, fin}:
      sum

def Agg.arms(a: M.Agg) -> Nat:
  match a:
    case M.Agg{prod, sum, arms, sc, dflt, fin}:
      arms

def Agg.sc(a: M.Agg) -> Nat:
  match a:
    case M.Agg{prod, sum, arms, sc, dflt, fin}:
      sc

# Every NPath an Agg carries is at least 1, and its arms sum to at least their count.
def Inv(+a: M.Agg) -> Data:
  Laws.And(N.Le(1n, M.Np.prod(a)), Laws.And(N.Le(1n, Agg.fin(a)), N.Le(Agg.arms(a), Agg.sum(a))))

def Le.one_succ(+m: Nat) -> N.Le(1n, 1n+m):
  N.Le.succ(0n, m, N.Le.zero(m))

def Le.one_mul(+x: Nat, +y: Nat, hx: N.Le(1n, x), hy: N.Le(1n, y)) -> N.Le(1n, Nat.mul(x, y)):
  N.Le.trans(1n, x, Nat.mul(x, y), hx, N.Le.mul_pos(x, y, hy))

def Le.sub1(+z: Nat) -> N.Le(Nat.sub(1n, z), 1n):
  match z:
    case 0n:
      N.Le.refl(1n)
    case 1n+q:
      N.Le.zero(1n)

# s + (1+j - n) >= 1 when s >= n.
def Pos.sub(+n: Nat, +s: Nat, +j: Nat, hn: N.Le(n, s)) -> N.Le(1n, Nat.add(s, Nat.sub(1n+j, n))):
  match n:
    case 0n:
      N.Le.trans(1n, 1n+j, Nat.add(s, 1n+j), Le.one_succ(j), N.Le.add_l(1n+j, s))
    case 1n+m:
      N.Le.trans(1n, s, Nat.add(s, Nat.sub(1n+j, 1n+m)), N.Le.trans(1n, 1n+m, s, Le.one_succ(m), hn), N.Le.add_r(s, Nat.sub(1n+j, 1n+m)))

def Pos.multi(+n: Nat, +s: Nat, +d: Nat, hn: N.Le(n, s)) -> N.Le(1n, Nat.add(s, Nat.sub(1n, Nat.min(d, n)))):
  match n:
    case 0n:
      %Equal.sym(Nat, Nat.min(d, 0n), 0n, N.Nat.min_zero_r(d)) : N.Le(1n, Nat.add(s, Nat.sub(1n, _)))
      N.Le.add_l(1n, s)
    case 1n+m:
      N.Le.trans(1n, s, Nat.add(s, Nat.sub(1n, Nat.min(d, 1n+m))), N.Le.trans(1n, 1n+m, s, Le.one_succ(m), hn), N.Le.add_r(s, Nat.sub(1n, Nat.min(d, 1n+m))))

def Pos.val(k: M.K, +p: Nat, +s: Nat, +n: Nat, +sc: Nat, +d: Nat, +f: Nat, hp: N.Le(1n, p), hf: N.Le(1n, f), hn: N.Le(n, s)) -> N.Le(1n, Laws.Npx.val(k, p, s, n, sc, d, f)):
  match k:
    case M.KBranch{}:
      N.Le.trans(1n, Nat.add(s, Nat.sub(2n, n)), Nat.add(Nat.add(s, Nat.sub(2n, n)), sc), Pos.sub(n, s, 1n, hn), N.Le.add_r(Nat.add(s, Nat.sub(2n, n)), sc))
    case M.KMulti{}:
      N.Le.trans(1n, Nat.add(s, Nat.sub(1n, Nat.min(d, n))), Nat.add(Nat.add(s, Nat.sub(1n, Nat.min(d, n))), sc), Pos.multi(n, s, d, hn), N.Le.add_r(Nat.add(s, Nat.sub(1n, Nat.min(d, n))), sc))
    case M.KLoop{}:
      N.Le.trans(1n, Nat.add(p, 1n), Nat.add(Nat.add(p, 1n), sc), N.Le.add_l(1n, p), N.Le.add_r(Nat.add(p, 1n), sc))
    case M.KTry{}:
      Le.one_mul(Nat.add(s, Nat.sub(1n, n)), f, Pos.sub(n, s, 0n, hn), hf)
    case M.KArm{}:
      hp
    case M.KSc{}:
      N.Le.refl(1n)
    case M.KExit{}:
      N.Le.refl(1n)
    case M.KFn{}:
      N.Le.refl(1n)
    case M.KFlag{}:
      N.Le.refl(1n)
    case M.KFin{}:
      N.Le.refl(1n)

def Pos.fin(k: M.K, +ap: Nat, hp: N.Le(1n, ap)) -> N.Le(1n, Laws.Npx.fin_of(k, ap)):
  match k:
    case M.KFin{}:
      hp
    case M.KBranch{}:
      N.Le.refl(1n)
    case M.KArm{}:
      N.Le.refl(1n)
    case M.KMulti{}:
      N.Le.refl(1n)
    case M.KLoop{}:
      N.Le.refl(1n)
    case M.KTry{}:
      N.Le.refl(1n)
    case M.KSc{}:
      N.Le.refl(1n)
    case M.KExit{}:
      N.Le.refl(1n)
    case M.KFn{}:
      N.Le.refl(1n)
    case M.KFlag{}:
      N.Le.refl(1n)

def Pos.arms(k: M.K, +ap: Nat, +rn: Nat, +rs: Nat, hp: N.Le(1n, ap), hr: N.Le(rn, rs)) -> N.Le(Nat.add(M.K.arm(k), rn), Nat.add(Laws.Npx.armv(k, ap), rs)):
  match k:
    case M.KArm{}:
      N.Le.add_both(1n, ap, rn, rs, hp, hr)
    case M.KBranch{}:
      hr
    case M.KMulti{}:
      hr
    case M.KLoop{}:
      hr
    case M.KTry{}:
      hr
    case M.KSc{}:
      hr
    case M.KExit{}:
      hr
    case M.KFn{}:
      hr
    case M.KFlag{}:
      hr
    case M.KFin{}:
      hr

def Inv.cons(+k: M.K, a: M.Agg, r: M.Agg, ia: Inv(a), ir: Inv(r)) -> Inv(Laws.Npx.cons(k, a, r)):
  match a r:
    case M.Agg{+ap, +as, +an, +asc, +ad, +af} M.Agg{+rp, +rs, +rn, +rsc, +rd, +rf}:
      match ia ir:
        case Tuple{+hap, Tuple{haf, han}} Tuple{hrp, Tuple{hrf, hrn}}:
          Tuple{Le.one_mul(Laws.Npx.val(k, ap, as, an, asc, ad, af), rp, Pos.val(k, ap, as, an, asc, ad, af, hap, haf, han), hrp), Tuple{Le.one_mul(Laws.Npx.fin_of(k, ap), rf, Pos.fin(k, ap, hap), hrf), Pos.arms(k, ap, rn, rs, hap, hrn)}}

def Inv.empty() -> Inv(Laws.Npx.empty()):
  Tuple{N.Le.refl(1n), Tuple{N.Le.refl(1n), N.Le.refl(0n)}}

def Inv.kids(k: M.K, +a: M.Agg, ia: Inv(a)) -> Inv(Laws.Npx.kids(k, a)):
  match k:
    case M.KFn{}:
      Inv.empty()
    case M.KBranch{}:
      ia
    case M.KArm{}:
      ia
    case M.KMulti{}:
      ia
    case M.KLoop{}:
      ia
    case M.KTry{}:
      ia
    case M.KSc{}:
      ia
    case M.KExit{}:
      ia
    case M.KFlag{}:
      ia
    case M.KFin{}:
      ia

def Inv.agg(t: M.Ct) -> Inv(Laws.Npx.agg(t)):
  match t:
    case M.Leaf{}:
      Inv.empty()
    case M.Node{+k, +kids, +next}:
      Inv.cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next), Inv.kids(k, Laws.Npx.agg(kids), Inv.agg(kids)), Inv.agg(next))

def Inv.prod(+a: M.Agg, i: Inv(a)) -> N.Le(1n, M.Np.prod(a)):
  match i:
    case Tuple{h, rest}:
      h

def Laws.npath_at_least_one(t):
  Inv.prod(Laws.Npx.agg(t), Inv.agg(t))

# ---- N6-N8. adding an arm never lowers NPath ----------------------------------------------------
# as + x <= (bp + as) + y, when x <= bp.
def Mono.gen(+as: Nat, +x: Nat, +bp: Nat, +y: Nat, hx: N.Le(x, bp)) -> N.Le(Nat.add(as, x), Nat.add(Nat.add(bp, as), y)):
  %N.Nat.add_comm(as, bp) : N.Le(Nat.add(as, x), Nat.add(_, y))
  N.Le.trans(Nat.add(as, x), Nat.add(as, bp), Nat.add(Nat.add(as, bp), y), N.Le.add_mono_l(as, x, bp, hx), N.Le.add_r(Nat.add(as, bp), y))

def Mono.sub2(+n: Nat) -> N.Le(Nat.sub(2n, n), Nat.add(1n, Nat.sub(1n, n))):
  match n:
    case 0n:
      N.Le.refl(2n)
    case 1n+m:
      Le.sub1(m)

def Mono.branch_in(+as: Nat, +an: Nat, +bp: Nat, hb: N.Le(1n, bp)) -> N.Le(Nat.add(as, Nat.sub(2n, an)), Nat.add(Nat.add(bp, as), Nat.sub(1n, an))):
  %N.Nat.add_comm(as, bp) : N.Le(Nat.add(as, Nat.sub(2n, an)), Nat.add(_, Nat.sub(1n, an)))
  %Equal.sym(Nat, Nat.add(Nat.add(as, bp), Nat.sub(1n, an)), Nat.add(as, Nat.add(bp, Nat.sub(1n, an))), N.Nat.add_assoc(as, bp, Nat.sub(1n, an))) : N.Le(Nat.add(as, Nat.sub(2n, an)), _)
  N.Le.add_mono_l(as, Nat.sub(2n, an), Nat.add(bp, Nat.sub(1n, an)), N.Le.trans(Nat.sub(2n, an), Nat.add(1n, Nat.sub(1n, an)), Nat.add(bp, Nat.sub(1n, an)), Mono.sub2(an), N.Le.add_mono(1n, bp, Nat.sub(1n, an), hb)))

def Mono.val_branch(a: M.Agg, b: M.Agg, hb: N.Le(1n, M.Np.prod(b))) -> N.Le(Laws.Npx.value(M.KBranch{}, a), Laws.Npx.value(M.KBranch{}, Laws.Npx.cons(M.KArm{}, b, a))):
  match a b:
    case M.Agg{ap, +as, +an, +asc, ad, af} M.Agg{+bp, bs, bn, bsc, bd, bf}:
      N.Le.add_mono(Nat.add(as, Nat.sub(2n, an)), Nat.add(Nat.add(bp, as), Nat.sub(1n, an)), asc, Mono.branch_in(as, an, bp, hb))

def Mono.val_multi(a: M.Agg, b: M.Agg, hb: N.Le(1n, M.Np.prod(b))) -> N.Le(Laws.Npx.value(M.KMulti{}, a), Laws.Npx.value(M.KMulti{}, Laws.Npx.cons(M.KArm{}, b, a))):
  match a b:
    case M.Agg{ap, +as, +an, +asc, +ad, af} M.Agg{+bp, bs, bn, bsc, bd, bf}:
      N.Le.add_mono(Nat.add(as, Nat.sub(1n, Nat.min(ad, an))), Nat.add(Nat.add(bp, as), Nat.sub(1n, Nat.min(ad, 1n+an))), asc, Mono.gen(as, Nat.sub(1n, Nat.min(ad, an)), bp, Nat.sub(1n, Nat.min(ad, 1n+an)), N.Le.trans(Nat.sub(1n, Nat.min(ad, an)), 1n, bp, Le.sub1(Nat.min(ad, an)), hb)))

def Mono.val_try(a: M.Agg, b: M.Agg, hb: N.Le(1n, M.Np.prod(b))) -> N.Le(Laws.Npx.value(M.KTry{}, a), Laws.Npx.value(M.KTry{}, Laws.Npx.cons(M.KArm{}, b, a))):
  match a b:
    case M.Agg{ap, +as, +an, asc, ad, +af} M.Agg{+bp, bs, bn, bsc, bd, bf}:
      %Equal.sym(Nat, Nat.add(af, 0n), af, N.Nat.add_zero_r(af)) : N.Le(Nat.mul(Nat.add(as, Nat.sub(1n, an)), af), Nat.mul(Nat.add(Nat.add(bp, as), 0n), _))
      N.Le.mul_mono(Nat.add(as, Nat.sub(1n, an)), Nat.add(Nat.add(bp, as), 0n), af, Mono.gen(as, Nat.sub(1n, an), bp, 0n, N.Le.trans(Nat.sub(1n, an), 1n, bp, Le.sub1(an), hb)))

# A node's NPath grows with its own value, whatever follows it.
def Mono.lift(+k: M.K, +a: M.Agg, +a2: M.Agg, +r: M.Agg, hv: N.Le(Laws.Npx.value(k, a), Laws.Npx.value(k, a2))) -> N.Le(M.Np.prod(Laws.Npx.cons(k, a, r)), M.Np.prod(Laws.Npx.cons(k, a2, r))):
  %Equal.sym(Nat, M.Np.prod(Laws.Npx.cons(k, a, r)), Nat.mul(Laws.Npx.value(k, a), M.Np.prod(r)), Npx.prod_cons(k, a, r)) : N.Le(_, M.Np.prod(Laws.Npx.cons(k, a2, r)))
  %Equal.sym(Nat, M.Np.prod(Laws.Npx.cons(k, a2, r)), Nat.mul(Laws.Npx.value(k, a2), M.Np.prod(r)), Npx.prod_cons(k, a2, r)) : N.Le(Nat.mul(Laws.Npx.value(k, a), M.Np.prod(r)), _)
  N.Le.mul_mono(Laws.Npx.value(k, a), Laws.Npx.value(k, a2), M.Np.prod(r), hv)

# The printed NPath grows with Nejmeh's.
def Mono.printed(+x: M.Ct, +y: M.Ct, +cap: Nat, h: N.Le(Laws.Npx.of(x), Laws.Npx.of(y))) -> N.Le(M.Np.of(x, cap), M.Np.of(y, cap)):
  %Equal.sym(Nat, M.Np.of(x, cap), Nat.min(Laws.Npx.of(x), cap), Laws.npath_printed_is_min(x, cap)) : N.Le(_, M.Np.of(y, cap))
  %Equal.sym(Nat, M.Np.of(y, cap), Nat.min(Laws.Npx.of(y), cap), Laws.npath_printed_is_min(y, cap)) : N.Le(Nat.min(Laws.Npx.of(x), cap), _)
  N.Nat.min_mono(Laws.Npx.of(x), Laws.Npx.of(y), cap, h)

def Laws.npath_arm_monotone_branch(body, kids, next, cap):
  Mono.printed(M.Node{M.KBranch{}, kids, next}, M.Node{M.KBranch{}, M.Node{M.KArm{}, body, kids}, next}, cap, Mono.lift(M.KBranch{}, Laws.Npx.agg(kids), Laws.Npx.cons(M.KArm{}, Laws.Npx.agg(body), Laws.Npx.agg(kids)), Laws.Npx.agg(next), Mono.val_branch(Laws.Npx.agg(kids), Laws.Npx.agg(body), Laws.npath_at_least_one(body))))

def Laws.npath_arm_monotone_multi(body, kids, next, cap):
  Mono.printed(M.Node{M.KMulti{}, kids, next}, M.Node{M.KMulti{}, M.Node{M.KArm{}, body, kids}, next}, cap, Mono.lift(M.KMulti{}, Laws.Npx.agg(kids), Laws.Npx.cons(M.KArm{}, Laws.Npx.agg(body), Laws.Npx.agg(kids)), Laws.Npx.agg(next), Mono.val_multi(Laws.Npx.agg(kids), Laws.Npx.agg(body), Laws.npath_at_least_one(body))))

def Laws.npath_arm_monotone_try(body, kids, next, cap):
  Mono.printed(M.Node{M.KTry{}, kids, next}, M.Node{M.KTry{}, M.Node{M.KArm{}, body, kids}, next}, cap, Mono.lift(M.KTry{}, Laws.Npx.agg(kids), Laws.Npx.cons(M.KArm{}, Laws.Npx.agg(body), Laws.Npx.agg(kids)), Laws.Npx.agg(next), Mono.val_try(Laws.Npx.agg(kids), Laws.Npx.agg(body), Laws.npath_at_least_one(body))))

# ---- N9-N10. two worked cases -------------------------------------------------------------------
def Nat.mul_one_r(+x: Nat) -> {Nat.mul(x, 1n) == x : Nat}:
  Equal.trans(Nat, Nat.mul(x, 1n), Nat.mul(1n, x), x, N.Nat.mul_comm(x, 1n), N.Nat.mul_one_l(x))

def If.lemma(b: M.Agg) -> {M.Np.prod(Laws.Npx.cons(M.KBranch{}, Laws.Npx.cons(M.KArm{}, b, Laws.Npx.empty()), Laws.Npx.empty())) == 1n+M.Np.prod(b) : Nat}:
  match b:
    case M.Agg{+bp, bs, bn, bsc, bd, bf}:
      %Equal.sym(Nat, Nat.mul(Nat.add(Nat.add(Nat.add(bp, 0n), 1n), 0n), 1n), Nat.add(Nat.add(Nat.add(bp, 0n), 1n), 0n), Nat.mul_one_r(Nat.add(Nat.add(Nat.add(bp, 0n), 1n), 0n))) : {_ == 1n+bp : Nat}
      %Equal.sym(Nat, Nat.add(Nat.add(Nat.add(bp, 0n), 1n), 0n), Nat.add(Nat.add(bp, 0n), 1n), N.Nat.add_zero_r(Nat.add(Nat.add(bp, 0n), 1n))) : {_ == 1n+bp : Nat}
      %Equal.sym(Nat, Nat.add(bp, 0n), bp, N.Nat.add_zero_r(bp)) : {Nat.add(_, 1n) == 1n+bp : Nat}
      %Equal.sym(Nat, Nat.add(bp, 1n), 1n+Nat.add(bp, 0n), N.Nat.add_succ_r(bp, 0n)) : {_ == 1n+bp : Nat}
      %Equal.sym(Nat, Nat.add(bp, 0n), bp, N.Nat.add_zero_r(bp)) : {1n+_ == 1n+bp : Nat}
      {==}

def Laws.npath_if_without_else(body):
  If.lemma(Laws.Npx.agg(body))

def Loop.lemma(b: M.Agg) -> {M.Np.prod(Laws.Npx.cons(M.KLoop{}, b, Laws.Npx.empty())) == Nat.add(1n+M.Np.prod(b), Agg.sc(b)) : Nat}:
  match b:
    case M.Agg{+bp, bs, bn, +bsc, bd, bf}:
      %Equal.sym(Nat, Nat.mul(Nat.add(Nat.add(bp, 1n), bsc), 1n), Nat.add(Nat.add(bp, 1n), bsc), Nat.mul_one_r(Nat.add(Nat.add(bp, 1n), bsc))) : {_ == Nat.add(1n+bp, bsc) : Nat}
      %Equal.sym(Nat, Nat.add(bp, 1n), 1n+Nat.add(bp, 0n), N.Nat.add_succ_r(bp, 0n)) : {Nat.add(_, bsc) == Nat.add(1n+bp, bsc) : Nat}
      %Equal.sym(Nat, Nat.add(bp, 0n), bp, N.Nat.add_zero_r(bp)) : {Nat.add(1n+_, bsc) == Nat.add(1n+bp, bsc) : Nat}
      {==}

def Npx.sc_cons(+k: M.K, a: M.Agg, r: M.Agg) -> {Agg.sc(Laws.Npx.cons(k, a, r)) == Nat.add(M.K.sc(k), Agg.sc(r)) : Nat}:
  match a r:
    case M.Agg{ap, as, an, asc, ad, af} M.Agg{rp, rs, rn, rsc, rd, rf}:
      {==}

def Sc.agg(t: M.Ct) -> {Agg.sc(Laws.Npx.agg(t)) == Laws.Sc(t) : Nat}:
  match t:
    case M.Leaf{}:
      {==}
    case M.Node{+k, +kids, +next}:
      %Equal.sym(Nat, Agg.sc(Laws.Npx.cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next))), Nat.add(M.K.sc(k), Agg.sc(Laws.Npx.agg(next))), Npx.sc_cons(k, Laws.Npx.kids(k, Laws.Npx.agg(kids)), Laws.Npx.agg(next))) : {_ == Nat.add(M.K.sc(k), Laws.Sc(next)) : Nat}
      %Equal.sym(Nat, Agg.sc(Laws.Npx.agg(next)), Laws.Sc(next), Sc.agg(next)) : {Nat.add(M.K.sc(k), _) == Nat.add(M.K.sc(k), Laws.Sc(next)) : Nat}
      {==}

def Laws.npath_loop(body):
  %Sc.agg(body) : {M.Np.prod(Laws.Npx.cons(M.KLoop{}, Laws.Npx.agg(body), Laws.Npx.empty())) == Nat.add(1n+Laws.Npx.of(body), _) : Nat}
  Loop.lemma(Laws.Npx.agg(body))

def Laws.npath_printed_at_least_one(t, cap):
  %Equal.sym(Nat, M.Np.of(t, cap), Nat.min(Laws.Npx.of(t), cap), Laws.npath_printed_is_min(t, cap)) : N.Le(Nat.min(1n, cap), _)
  N.Nat.min_mono(1n, Laws.Npx.of(t), cap, Laws.npath_at_least_one(t))

def Laws.npath_printed_if_without_else(body, cap):
  %Equal.sym(Nat, M.Np.of(M.Node{M.KBranch{}, M.Node{M.KArm{}, body, M.Leaf{}}, M.Leaf{}}, cap), Nat.min(Laws.Npx.of(M.Node{M.KBranch{}, M.Node{M.KArm{}, body, M.Leaf{}}, M.Leaf{}}), cap), Laws.npath_printed_is_min(M.Node{M.KBranch{}, M.Node{M.KArm{}, body, M.Leaf{}}, M.Leaf{}}, cap)) : {_ == Nat.min(1n+Laws.Npx.of(body), cap) : Nat}
  %Equal.sym(Nat, Laws.Npx.of(M.Node{M.KBranch{}, M.Node{M.KArm{}, body, M.Leaf{}}, M.Leaf{}}), 1n+Laws.Npx.of(body), Laws.npath_if_without_else(body)) : {Nat.min(_, cap) == Nat.min(1n+Laws.Npx.of(body), cap) : Nat}
  {==}

def Laws.npath_printed_loop(body, cap):
  %Equal.sym(Nat, M.Np.of(M.Node{M.KLoop{}, body, M.Leaf{}}, cap), Nat.min(Laws.Npx.of(M.Node{M.KLoop{}, body, M.Leaf{}}), cap), Laws.npath_printed_is_min(M.Node{M.KLoop{}, body, M.Leaf{}}, cap)) : {_ == Nat.min(Nat.add(1n+Laws.Npx.of(body), Laws.Sc(body)), cap) : Nat}
  %Equal.sym(Nat, Laws.Npx.of(M.Node{M.KLoop{}, body, M.Leaf{}}), Nat.add(1n+Laws.Npx.of(body), Laws.Sc(body)), Laws.npath_loop(body)) : {Nat.min(_, cap) == Nat.min(Nat.add(1n+Laws.Npx.of(body), Laws.Sc(body)), cap) : Nat}
  {==}
