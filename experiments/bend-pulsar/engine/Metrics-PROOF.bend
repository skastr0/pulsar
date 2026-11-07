import Base
import ./Metrics.bend as M
import ./Metrics-LAWS.bend as Laws

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
