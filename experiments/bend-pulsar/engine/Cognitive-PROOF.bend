# engine/Cognitive-PROOF.bend - proofs of Cognitive-LAWS.bend. Gate: bend Cognitive-PROOF.bend --verdict
import Base
import ./Metrics.bend as M
import ./Cognitive.bend as C
import ./Metrics-NAT.bend as N
import ./Metrics-LAWS.bend as ML
import ./Metrics-PROOF.bend as MP
import ./Cognitive-LAWS.bend as Laws

def Laws.cog_multi_arm_free(kids, next, ctx, lvl, ops):
  {==}

# a + 0 + 0 = a
def Z.two(+a: Nat) -> {Nat.add(Nat.add(a, 0n), 0n) == a : Nat}:
  %Equal.sym(Nat, Nat.add(Nat.add(a, 0n), 0n), Nat.add(a, 0n), N.Nat.add_zero_r(Nat.add(a, 0n))) : {_ == a : Nat}
  N.Nat.add_zero_r(a)

# a + 0 + 0 + 0 = a
def Z.three(+a: Nat) -> {Nat.add(Nat.add(Nat.add(a, 0n), 0n), 0n) == a : Nat}:
  %Equal.sym(Nat, Nat.add(Nat.add(Nat.add(a, 0n), 0n), 0n), Nat.add(Nat.add(a, 0n), 0n), N.Nat.add_zero_r(Nat.add(Nat.add(a, 0n), 0n))) : {_ == a : Nat}
  Z.two(a)

def Laws.cog_if_at_level(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 0n), 0n), lvl, Z.two(lvl)) : {1n+_ == 1n+lvl : Nat}
  {==}

def Laws.cog_loop_nests(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 2n+Nat.add(Nat.add(lvl, 0n), 0n)), 0n), Nat.add(lvl, 2n+Nat.add(Nat.add(lvl, 0n), 0n)), N.Nat.add_zero_r(Nat.add(lvl, 2n+Nat.add(Nat.add(lvl, 0n), 0n)))) : {1n+_ == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 0n), 0n), lvl, Z.two(lvl)) : {1n+Nat.add(lvl, 2n+_) == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  {==}

def Laws.cog_else_if_flat(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 1n), 0n), Nat.add(lvl, 1n), N.Nat.add_zero_r(Nat.add(lvl, 1n))) : {1n+_ == 1n+Nat.add(lvl, 1n) : Nat}
  {==}

def Laws.cog_then_if_nests(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)), 0n), Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)), N.Nat.add_zero_r(Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)))) : {1n+_ == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n), Nat.add(Nat.add(lvl, 0n), 0n), N.Nat.add_zero_r(Nat.add(Nat.add(lvl, 0n), 0n))) : {1n+Nat.add(lvl, 2n+_) == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 0n), 0n), lvl, Z.two(lvl)) : {1n+Nat.add(lvl, 2n+_) == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  {==}

def Laws.cog_else_plain(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 0n), 0n), lvl, Z.two(lvl)) : {2n+_ == 2n+lvl : Nat}
  {==}

def Laws.cog_else_costs_one(kids, next, ctx, lvl, os):
  match ctx:
    case C.CAny{}:
      {==}
    case C.CBr0{}:
      {==}
    case C.CBr1{}:
      {==}
    case C.CBr0E{}:
      {==}
    case C.CBr1E{}:
      {==}
    case C.CBr0N{}:
      {==}
    case C.CBr1N{}:
      {==}
    case C.CMulti{}:
      {==}
    case C.CTry0{}:
      {==}
    case C.CTry1{}:
      {==}
    case C.CElif{}:
      {==}

def Laws.cog_else_block_if_nests(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)), 0n), Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)), N.Nat.add_zero_r(Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)))) : {2n+_ == 2n+Nat.add(lvl, 2n+lvl) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n), lvl, Z.three(lvl)) : {2n+Nat.add(lvl, 2n+_) == 2n+Nat.add(lvl, 2n+lvl) : Nat}
  {==}

def Laws.cog_ternary_else_nests(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)), 0n), Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)), N.Nat.add_zero_r(Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)))) : {1n+_ == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n), lvl, Z.three(lvl)) : {1n+Nat.add(lvl, 2n+_) == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  {==}

def Laws.cog_elif_else(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 2n), 0n), Nat.add(lvl, 2n), N.Nat.add_zero_r(Nat.add(lvl, 2n))) : {1n+_ == 1n+Nat.add(lvl, 2n) : Nat}
  {==}

def Laws.cog_unknown_else_if(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 1n), 0n), Nat.add(lvl, 1n), N.Nat.add_zero_r(Nat.add(lvl, 1n))) : {1n+_ == 1n+Nat.add(lvl, 1n) : Nat}
  {==}

def Laws.cog_unknown_then_nests(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)), 0n), Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)), N.Nat.add_zero_r(Nat.add(lvl, 2n+Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n)))) : {1n+_ == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n), lvl, Z.three(lvl)) : {1n+Nat.add(lvl, 2n+_) == 1n+Nat.add(lvl, 2n+lvl) : Nat}
  {==}

def Laws.cog_unknown_else_free(lvl, os):
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 0n), 0n), lvl, Z.two(lvl)) : {1n+_ == 1n+lvl : Nat}
  {==}

def Laws.cog_catch(lvl, ops):
  %Equal.sym(Nat, Nat.add(Nat.add(Nat.add(lvl, 0n), 0n), 0n), Nat.add(Nat.add(lvl, 0n), 0n), N.Nat.add_zero_r(Nat.add(Nat.add(lvl, 0n), 0n))) : {1n+_ == 1n+lvl : Nat}
  %Equal.sym(Nat, Nat.add(Nat.add(lvl, 0n), 0n), lvl, Z.two(lvl)) : {1n+_ == 1n+lvl : Nat}
  {==}

def Laws.cog_and_each(rest, ctx, lvl, os):
  {==}

def Laws.cog_or_each(rest, ctx, lvl, os):
  {==}

def Laws.cog_op_change(lvl):
  {==}

def Laws.cog_label_jump(rest, ctx, lvl, os):
  {==}

def Laws.cog_plain_exit_free(rest, ctx, lvl, os):
  {==}

def CS.eta(s: C.CS) -> {C.CS{C.CS.n(s), C.CS.ops(s)} == s : C.CS}:
  match s:
    case C.CS{n, ops}:
      {==}

def Laws.cog_nested_fn_free(next, ctx, lvl, ops):
  CS.eta(C.Cog.seq(next, ctx, lvl, ops))

def Laws.cog_lines(thr, fs, ops):
  {==}

def Laws.cog_measure_cons(fn, t, loc, test, rest, ops):
  {==}

def Laws.cog_skips_tests(thr, fn, v, ms):
  {==}

# ---- F. findings ------------------------------------------------------------------------------
def Snd.weak(+thr: Nat, m: C.CgM, +t: List<&2, C.CgM>, x: M.Finding, s: Laws.Sound(thr, t, x)) -> Laws.Sound(thr, Con{m, t}, x):
  match m x:
    case C.CgM{f, cog, test} M.Finding{rule, fn, vv, tt}:
      match s:
        case Tuple{a, Tuple{b, Tuple{d, w}}}:
          Tuple{a, Tuple{b, Tuple{d, Inr{w}}}}

def Snd.hit(+thr: Nat, +f: U32, +v: Nat, +t: List<&2, C.CgM>, +x: M.Finding, p: ML.And({Nat.is_gt(v, thr) == True{} : Bool}, {M.Finding{8, f, v, thr} == x : M.Finding})) -> Laws.Sound(thr, Con{C.CgM{f, v, False{}}, t}, x):
  match p:
    case Tuple{g, e}:
      %e : Laws.Sound(thr, Con{C.CgM{f, v, False{}}, t}, _)
      Tuple{{==}, Tuple{g, Tuple{{==}, Inl{Tuple{{==}, Tuple{{==}, {==}}}}}}}

def Snd.pick(+thr: Nat, +f: U32, +v: Nat, +t: List<&2, C.CgM>, +x: M.Finding, o: Either<&2, &2, ML.And({Nat.is_gt(v, thr) == True{} : Bool}, {M.Finding{8, f, v, thr} == x : M.Finding}), ML.MemF(C.Cog.findings(thr, t), x)>, ih: ML.MemF(C.Cog.findings(thr, t), x) -> Laws.Sound(thr, t, x)) -> Laws.Sound(thr, Con{C.CgM{f, v, False{}}, t}, x):
  match o:
    case Inl{p}:
      Snd.hit(thr, f, v, t, x, p)
    case Inr{m}:
      Snd.weak(thr, C.CgM{f, v, False{}}, t, x, ih(m))

def Snd.go(test: Bool, +thr: Nat, +f: U32, +v: Nat, +t: List<&2, C.CgM>, +x: M.Finding, hm: ML.MemF(C.Cog.findings(thr, Con{C.CgM{f, v, test}, t}), x), ih: ML.MemF(C.Cog.findings(thr, t), x) -> Laws.Sound(thr, t, x)) -> Laws.Sound(thr, Con{C.CgM{f, v, test}, t}, x):
  match test:
    case True{}:
      Snd.weak(thr, C.CgM{f, v, True{}}, t, x, ih(hm))
    case False{}:
      Snd.pick(thr, f, v, t, x, MP.Keep.mem(Nat.is_gt(v, thr), M.Finding{8, f, v, thr}, C.Cog.findings(thr, t), x, hm), ih)

def Laws.cog_findings_sound(thr, ms, x, hm):
  match ms:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match m:
        case C.CgM{+f, +v, test}:
          Snd.go(test, thr, f, v, t, x, hm, mm => Laws.cog_findings_sound(thr, t, x, mm))

def Cmp.stay(+thr: Nat, m: C.CgM, +t: List<&2, C.CgM>, +y: M.Finding, mm: ML.MemF(C.Cog.findings(thr, t), y)) -> ML.MemF(C.Cog.findings(thr, Con{m, t}), y):
  match m:
    case C.CgM{+f, +v, test}:
      match test:
        case True{}:
          mm
        case False{}:
          MP.Keep.stay(Nat.is_gt(v, thr), M.Finding{8, f, v, thr}, C.Cog.findings(thr, t), y, mm)

def Laws.cog_findings_complete(thr, ms, fn, v, hm, h):
  match ms:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(C.CgM, m, C.CgM{fn, v, False{}}, e) : ML.MemF(C.Cog.findings(thr, Con{_, t}), M.Finding{8, fn, v, thr})
          MP.Keep.hit(Nat.is_gt(v, thr), M.Finding{8, fn, v, thr}, C.Cog.findings(thr, t), h)
        case Inr{mm}:
          Cmp.stay(thr, m, t, M.Finding{8, fn, v, thr}, Laws.cog_findings_complete(thr, t, fn, v, mm, h))

def Laws.cog_fms_nil(cap, ops):
  {==}

def Laws.cog_fms_aligned(fn, t, loc, test, rest, cap, ops):
  {==}

def Laws.cog_unscored_op_free(rest, ctx, lvl, os):
  {==}
