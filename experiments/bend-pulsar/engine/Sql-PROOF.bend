# engine/Sql-PROOF.bend - proofs of Sql-LAWS.bend. Gate: bend Sql-PROOF.bend --verdict
import Base
import ./Sql.bend as S
import ./Metrics-NAT.bend as N
import ./Metrics-LAWS.bend as ML
import ./Hotspot-PROOF.bend as HP
import ./Sql-LAWS.bend as Laws

def Keep.mem(hit: Bool, +x: S.Sx, +rest: List<&2, S.Sx>, +y: S.Sx, hm: Laws.MemS(S.Sq.keep(hit, x, rest), y)) -> Either<&2, &2, ML.And({hit == True{} : Bool}, {x == y : S.Sx}), Laws.MemS(rest, y)>:
  match hit:
    case True{}:
      match hm:
        case Inl{e}:
          Inl{Tuple{{==}, e}}
        case Inr{m}:
          Inr{m}
    case False{}:
      Inr{hm}

def Keep.stay(hit: Bool, +x: S.Sx, +rest: List<&2, S.Sx>, +y: S.Sx, mm: Laws.MemS(rest, y)) -> Laws.MemS(S.Sq.keep(hit, x, rest), y):
  match hit:
    case True{}:
      Inr{mm}
    case False{}:
      mm

def Keep.hit(hit: Bool, +x: S.Sx, +rest: List<&2, S.Sx>, h: {hit == True{} : Bool}) -> Laws.MemS(S.Sq.keep(hit, x, rest), x):
  %Equal.sym(Bool, hit, True{}, h) : Laws.MemS(S.Sq.keep(_, x, rest), x)
  Inl{{==}}

def Keep.off(hit: Bool, +x: S.Sx, +rest: List<&2, S.Sx>, h: {hit == False{} : Bool}) -> {S.Sq.keep(hit, x, rest) == rest : List<&2, S.Sx>}:
  %Equal.sym(Bool, hit, False{}, h) : {S.Sq.keep(_, x, rest) == rest : List<&2, S.Sx>}
  {==}

def And.ff(a: Bool, b: Bool, h: {a == False{} : Bool}) -> {Bool.and(a, b) == False{} : Bool}:
  %Equal.sym(Bool, a, False{}, h) : {Bool.and(_, b) == False{} : Bool}
  {==}


def Not.ff(x: Bool, e: {Bool.not(x) == True{} : Bool}) -> {x == False{} : Bool}:
  match x:
    case True{}:
      Empty.absurd({True{} == False{} : Bool}, N.Bool.ff_tt(e))
    case False{}:
      {==}

def And.l(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {a == True{} : Bool}:
  match a:
    case True{}:
      {==}
    case False{}:
      Empty.absurd({False{} == True{} : Bool}, N.Bool.ff_tt(e))

def And.r(a: Bool, b: Bool, e: {Bool.and(a, b) == True{} : Bool}) -> {b == True{} : Bool}:
  match a:
    case True{}:
      e
    case False{}:
      Empty.absurd({b == True{} : Bool}, N.Bool.ff_tt(e))

def Un.split(+a: Bool, +b: Bool, +c: Bool, +d: Bool, +f: Bool, +e: {Bool.and(a, Bool.and(b, Bool.and(c, Bool.and(Bool.not(d), Bool.not(f))))) == True{} : Bool}) -> ML.And({a == True{} : Bool}, ML.And({b == True{} : Bool}, ML.And({c == True{} : Bool}, ML.And({d == False{} : Bool}, {f == False{} : Bool})))):
  +e1 = And.r(a, Bool.and(b, Bool.and(c, Bool.and(Bool.not(d), Bool.not(f)))), e)
  +e2 = And.r(b, Bool.and(c, Bool.and(Bool.not(d), Bool.not(f))), e1)
  +e3 = And.r(c, Bool.and(Bool.not(d), Bool.not(f)), e2)
  Tuple{And.l(a, Bool.and(b, Bool.and(c, Bool.and(Bool.not(d), Bool.not(f)))), e), Tuple{And.l(b, Bool.and(c, Bool.and(Bool.not(d), Bool.not(f))), e1), Tuple{And.l(c, Bool.and(Bool.not(d), Bool.not(f)), e2), Tuple{Not.ff(d, And.l(Bool.not(d), Bool.not(f), e3)), Not.ff(f, And.r(Bool.not(d), Bool.not(f), e3))}}}}

def Or.l(a: Bool, b: Bool, e: {a == True{} : Bool}) -> {Bool.or(a, b) == True{} : Bool}:
  %Equal.sym(Bool, a, True{}, e) : {Bool.or(_, b) == True{} : Bool}
  {==}


def Term.split(+a: Bool, +b: Bool, +c: Bool, +e: {Bool.and(a, Bool.and(b, c)) == True{} : Bool}) -> ML.And({a == True{} : Bool}, ML.And({b == True{} : Bool}, {c == True{} : Bool})):
  +e1 = And.r(a, Bool.and(b, c), e)
  Tuple{And.l(a, Bool.and(b, c), e), Tuple{And.l(b, c, e1), And.r(b, c, e1)}}

def Term.here(+i: U32, +col: U32, +any: Bool, +x: U32, +p: U32, +c: U32, +rest: List<&2, S.Dx>, o: Either<&2, &2, {Bool.and(U32.is_eq(x, i), Bool.and(U32.is_eq(c, col), Bool.or(any, U32.is_eq(p, 0)))) == True{} : Bool}, {S.Sq.term(i, col, any, rest) == True{} : Bool}>, ih: {S.Sq.term(i, col, any, rest) == True{} : Bool} -> Laws.TermW(i, col, any, rest)) -> Laws.TermW(i, col, any, Con{S.Dx{x, p, c}, rest}):
  match o:
    case Inl{e}:
      Inl{Term.split(U32.is_eq(x, i), U32.is_eq(c, col), Bool.or(any, U32.is_eq(p, 0)), e)}
    case Inr{e}:
      Inr{ih(e)}

# ---- sites ----
def Sites.go2(+site: U32, +file: U32, +fn: U32, +node: U32, +kind: U32, +flags: U32, +t: List<&2, S.Qs>, +y: S.Sx, o: Either<&2, &2, ML.And({S.Sq.bit(flags, 8) == True{} : Bool}, {S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8} == y : S.Sx}), Laws.MemS(S.Sq.sites(t), y)>, ih: Laws.MemS(S.Sq.sites(t), y) -> Laws.WitSites(t, y)) -> Laws.WitSites(Con{S.Qs{site, file, fn, node, kind, flags}, t}, y):
  match o:
    case Inl{p}:
      Inr{Inl{p}}
    case Inr{m}:
      Inr{Inr{ih(m)}}

def Sites.go(+site: U32, +file: U32, +fn: U32, +node: U32, +kind: U32, +flags: U32, +t: List<&2, S.Qs>, +y: S.Sx, o: Either<&2, &2, ML.And({S.Sq.bit(flags, 64) == True{} : Bool}, {S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64} == y : S.Sx}), Laws.MemS(S.Sq.keep(S.Sq.bit(flags, 8), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, S.Sq.sites(t)), y)>, ih: Laws.MemS(S.Sq.sites(t), y) -> Laws.WitSites(t, y)) -> Laws.WitSites(Con{S.Qs{site, file, fn, node, kind, flags}, t}, y):
  match o:
    case Inl{p}:
      Inl{p}
    case Inr{m}:
      Sites.go2(site, file, fn, node, kind, flags, t, y, Keep.mem(S.Sq.bit(flags, 8), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, S.Sq.sites(t), y, m), ih)

def Laws.sql_sites_sound(qs, y, hm):
  match qs:
    case Nil{}:
      match hm:
    case Con{h, t}:
      match h:
        case S.Qs{+site, +file, +fn, +node, +kind, +flags}:
          Sites.go(site, file, fn, node, kind, flags, t, y, Keep.mem(S.Sq.bit(flags, 64), S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64}, S.Sq.keep(S.Sq.bit(flags, 8), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, S.Sq.sites(t)), y, hm), mm => Laws.sql_sites_sound(t, y, mm))

def Sites.stay(m: S.Qs, +t: List<&2, S.Qs>, +y: S.Sx, mm: Laws.MemS(S.Sq.sites(t), y)) -> Laws.MemS(S.Sq.sites(Con{m, t}), y):
  match m:
    case S.Qs{+site, file, fn, node, kind, +flags}:
      Keep.stay(S.Sq.bit(flags, 64), S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64}, S.Sq.keep(S.Sq.bit(flags, 8), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, S.Sq.sites(t)), y, Keep.stay(S.Sq.bit(flags, 8), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, S.Sq.sites(t), y, mm))

def Laws.sql_dynamic_complete(qs, site, file, fn, node, kind, flags, hm, h):
  match qs:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(S.Qs, m, S.Qs{site, file, fn, node, kind, flags}, e) : Laws.MemS(S.Sq.sites(Con{_, t}), S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64})
          Keep.hit(S.Sq.bit(flags, 64), S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64}, S.Sq.keep(S.Sq.bit(flags, 8), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, S.Sq.sites(t)), h)
        case Inr{mm}:
          Sites.stay(m, t, S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64}, Laws.sql_dynamic_complete(t, site, file, fn, node, kind, flags, mm, h))

def Laws.sql_offset_complete(qs, site, file, fn, node, kind, flags, hm, h):
  match qs:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(S.Qs, m, S.Qs{site, file, fn, node, kind, flags}, e) : Laws.MemS(S.Sq.sites(Con{_, t}), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8})
          Keep.stay(S.Sq.bit(flags, 64), S.Sx{1, site, S.Sq.none(), S.Sq.none(), 64}, S.Sq.keep(S.Sq.bit(flags, 8), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, S.Sq.sites(t)), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, Keep.hit(S.Sq.bit(flags, 8), S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, S.Sq.sites(t), h))
        case Inr{mm}:
          Sites.stay(m, t, S.Sx{2, site, S.Sq.none(), S.Sq.none(), 8}, Laws.sql_offset_complete(t, site, file, fn, node, kind, flags, mm, h))

# ---- defeat ----
def G_defeat.go(+s: S.Schema, +site: U32, +table: U32, +col: U32, +kind: U32, +t: List<&2, S.Qd>, +y: S.Sx, o: Either<&2, &2, ML.And({S.Sq.defeats(s, table, col) == True{} : Bool}, {S.Sx{3, site, table, col, kind} == y : S.Sx}), Laws.MemS(S.Sq.defeat_all(s, t), y)>, ih: Laws.MemS(S.Sq.defeat_all(s, t), y) -> Laws.Wit_defeat(s, t, y)) -> Laws.Wit_defeat(s, Con{S.Qd{site, table, col, kind}, t}, y):
  match o:
    case Inl{p}:
      Inl{p}
    case Inr{m}:
      Inr{ih(m)}

def Laws.sql_defeat_sound(s, xs, y, hm):
  match xs:
    case Nil{}:
      match hm:
    case Con{h, t}:
      match h:
        case S.Qd{+site, +table, +col, +kind}:
          G_defeat.go(s, site, table, col, kind, t, y, Keep.mem(S.Sq.defeats(s, table, col), S.Sx{3, site, table, col, kind}, S.Sq.defeat_all(s, t), y, hm), mm => Laws.sql_defeat_sound(s, t, y, mm))

def G_defeat.stay(+s: S.Schema, m: S.Qd, +t: List<&2, S.Qd>, +y: S.Sx, mm: Laws.MemS(S.Sq.defeat_all(s, t), y)) -> Laws.MemS(S.Sq.defeat_all(s, Con{m, t}), y):
  match m:
    case S.Qd{+site, +table, +col, +kind}:
      Keep.stay(S.Sq.defeats(s, table, col), S.Sx{3, site, table, col, kind}, S.Sq.defeat_all(s, t), y, mm)

def Laws.sql_defeat_complete(s, xs, site, table, col, kind, hm, h):
  match xs:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(S.Qd, m, S.Qd{site, table, col, kind}, e) : Laws.MemS(S.Sq.defeat_all(s, Con{_, t}), S.Sx{3, site, table, col, kind})
          Keep.hit(S.Sq.defeats(s, table, col), S.Sx{3, site, table, col, kind}, S.Sq.defeat_all(s, t), h)
        case Inr{mm}:
          G_defeat.stay(s, m, t, S.Sx{3, site, table, col, kind}, Laws.sql_defeat_complete(s, t, site, table, col, kind, mm, h))

# ---- unindexed ----
def G_unindexed.go(+s: S.Schema, +site: U32, +table: U32, +col: U32, +role: U32, +t: List<&2, S.Qu>, +y: S.Sx, o: Either<&2, &2, ML.And({S.Sq.unindexed(s, table, col, role) == True{} : Bool}, {S.Sx{4, site, table, col, role} == y : S.Sx}), Laws.MemS(S.Sq.unindexed_all(s, t), y)>, ih: Laws.MemS(S.Sq.unindexed_all(s, t), y) -> Laws.Wit_unindexed(s, t, y)) -> Laws.Wit_unindexed(s, Con{S.Qu{site, table, col, role}, t}, y):
  match o:
    case Inl{p}:
      Inl{p}
    case Inr{m}:
      Inr{ih(m)}

def Laws.sql_unindexed_sound(s, xs, y, hm):
  match xs:
    case Nil{}:
      match hm:
    case Con{h, t}:
      match h:
        case S.Qu{+site, +table, +col, +role}:
          G_unindexed.go(s, site, table, col, role, t, y, Keep.mem(S.Sq.unindexed(s, table, col, role), S.Sx{4, site, table, col, role}, S.Sq.unindexed_all(s, t), y, hm), mm => Laws.sql_unindexed_sound(s, t, y, mm))

def G_unindexed.stay(+s: S.Schema, m: S.Qu, +t: List<&2, S.Qu>, +y: S.Sx, mm: Laws.MemS(S.Sq.unindexed_all(s, t), y)) -> Laws.MemS(S.Sq.unindexed_all(s, Con{m, t}), y):
  match m:
    case S.Qu{+site, +table, +col, +role}:
      Keep.stay(S.Sq.unindexed(s, table, col, role), S.Sx{4, site, table, col, role}, S.Sq.unindexed_all(s, t), y, mm)

def Laws.sql_unindexed_complete(s, xs, site, table, col, role, hm, h):
  match xs:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(S.Qu, m, S.Qu{site, table, col, role}, e) : Laws.MemS(S.Sq.unindexed_all(s, Con{_, t}), S.Sx{4, site, table, col, role})
          Keep.hit(S.Sq.unindexed(s, table, col, role), S.Sx{4, site, table, col, role}, S.Sq.unindexed_all(s, t), h)
        case Inr{mm}:
          G_unindexed.stay(s, m, t, S.Sx{4, site, table, col, role}, Laws.sql_unindexed_complete(s, t, site, table, col, role, mm, h))

# ---- fk ----
def G_fk.go(+s: S.Schema, +dgs: List<&2, S.Dg>, +fk: U32, +table: U32, +ref: U32, +t: List<&2, S.Df>, +y: S.Sx, o: Either<&2, &2, ML.And({S.Sq.fk_bad(s, table, S.Sq.fk_first(fk, dgs)) == True{} : Bool}, {S.Sx{5, fk, table, S.Sq.fk_first(fk, dgs), ref} == y : S.Sx}), Laws.MemS(S.Sq.fk_all(s, t, dgs), y)>, ih: Laws.MemS(S.Sq.fk_all(s, t, dgs), y) -> Laws.Wit_fk(s, dgs, t, y)) -> Laws.Wit_fk(s, dgs, Con{S.Df{fk, table, ref}, t}, y):
  match o:
    case Inl{p}:
      Inl{p}
    case Inr{m}:
      Inr{ih(m)}

def Laws.sql_fk_sound(s, dgs, xs, y, hm):
  match xs:
    case Nil{}:
      match hm:
    case Con{h, t}:
      match h:
        case S.Df{+fk, +table, +ref}:
          G_fk.go(s, dgs, fk, table, ref, t, y, Keep.mem(S.Sq.fk_bad(s, table, S.Sq.fk_first(fk, dgs)), S.Sx{5, fk, table, S.Sq.fk_first(fk, dgs), ref}, S.Sq.fk_all(s, t, dgs), y, hm), mm => Laws.sql_fk_sound(s, dgs, t, y, mm))

def G_fk.stay(+s: S.Schema, +dgs: List<&2, S.Dg>, m: S.Df, +t: List<&2, S.Df>, +y: S.Sx, mm: Laws.MemS(S.Sq.fk_all(s, t, dgs), y)) -> Laws.MemS(S.Sq.fk_all(s, Con{m, t}, dgs), y):
  match m:
    case S.Df{+fk, +table, +ref}:
      Keep.stay(S.Sq.fk_bad(s, table, S.Sq.fk_first(fk, dgs)), S.Sx{5, fk, table, S.Sq.fk_first(fk, dgs), ref}, S.Sq.fk_all(s, t, dgs), y, mm)

def Laws.sql_fk_complete(s, dgs, xs, fk, table, ref, hm, h):
  match xs:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(S.Df, m, S.Df{fk, table, ref}, e) : Laws.MemS(S.Sq.fk_all(s, Con{_, t}, dgs), S.Sx{5, fk, table, S.Sq.fk_first(fk, dgs), ref})
          Keep.hit(S.Sq.fk_bad(s, table, S.Sq.fk_first(fk, dgs)), S.Sx{5, fk, table, S.Sq.fk_first(fk, dgs), ref}, S.Sq.fk_all(s, t, dgs), h)
        case Inr{mm}:
          G_fk.stay(s, dgs, m, t, S.Sx{5, fk, table, S.Sq.fk_first(fk, dgs), ref}, Laws.sql_fk_complete(s, dgs, t, fk, table, ref, mm, h))

# ---- drift_t ----
def G_drift_t.go(+s: S.Schema, +site: U32, +table: U32, +mode: U32, +t: List<&2, S.Qt>, +y: S.Sx, o: Either<&2, &2, ML.And({S.Sq.drift_t(s, table) == True{} : Bool}, {S.Sx{6, site, table, S.Sq.none(), mode} == y : S.Sx}), Laws.MemS(S.Sq.drift_ts(s, t), y)>, ih: Laws.MemS(S.Sq.drift_ts(s, t), y) -> Laws.Wit_drift_t(s, t, y)) -> Laws.Wit_drift_t(s, Con{S.Qt{site, table, mode}, t}, y):
  match o:
    case Inl{p}:
      Inl{p}
    case Inr{m}:
      Inr{ih(m)}

def Laws.sql_drift_t_sound(s, xs, y, hm):
  match xs:
    case Nil{}:
      match hm:
    case Con{h, t}:
      match h:
        case S.Qt{+site, +table, +mode}:
          G_drift_t.go(s, site, table, mode, t, y, Keep.mem(S.Sq.drift_t(s, table), S.Sx{6, site, table, S.Sq.none(), mode}, S.Sq.drift_ts(s, t), y, hm), mm => Laws.sql_drift_t_sound(s, t, y, mm))

def G_drift_t.stay(+s: S.Schema, m: S.Qt, +t: List<&2, S.Qt>, +y: S.Sx, mm: Laws.MemS(S.Sq.drift_ts(s, t), y)) -> Laws.MemS(S.Sq.drift_ts(s, Con{m, t}), y):
  match m:
    case S.Qt{+site, +table, +mode}:
      Keep.stay(S.Sq.drift_t(s, table), S.Sx{6, site, table, S.Sq.none(), mode}, S.Sq.drift_ts(s, t), y, mm)

def Laws.sql_drift_t_complete(s, xs, site, table, mode, hm, h):
  match xs:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(S.Qt, m, S.Qt{site, table, mode}, e) : Laws.MemS(S.Sq.drift_ts(s, Con{_, t}), S.Sx{6, site, table, S.Sq.none(), mode})
          Keep.hit(S.Sq.drift_t(s, table), S.Sx{6, site, table, S.Sq.none(), mode}, S.Sq.drift_ts(s, t), h)
        case Inr{mm}:
          G_drift_t.stay(s, m, t, S.Sx{6, site, table, S.Sq.none(), mode}, Laws.sql_drift_t_complete(s, t, site, table, mode, mm, h))

# ---- drift_c ----
def G_drift_c.go(+s: S.Schema, +site: U32, +table: U32, +col: U32, +role: U32, +t: List<&2, S.Qu>, +y: S.Sx, o: Either<&2, &2, ML.And({S.Sq.drift_c(s, table, col) == True{} : Bool}, {S.Sx{6, site, table, col, role} == y : S.Sx}), Laws.MemS(S.Sq.drift_cs(s, t), y)>, ih: Laws.MemS(S.Sq.drift_cs(s, t), y) -> Laws.Wit_drift_c(s, t, y)) -> Laws.Wit_drift_c(s, Con{S.Qu{site, table, col, role}, t}, y):
  match o:
    case Inl{p}:
      Inl{p}
    case Inr{m}:
      Inr{ih(m)}

def Laws.sql_drift_c_sound(s, xs, y, hm):
  match xs:
    case Nil{}:
      match hm:
    case Con{h, t}:
      match h:
        case S.Qu{+site, +table, +col, +role}:
          G_drift_c.go(s, site, table, col, role, t, y, Keep.mem(S.Sq.drift_c(s, table, col), S.Sx{6, site, table, col, role}, S.Sq.drift_cs(s, t), y, hm), mm => Laws.sql_drift_c_sound(s, t, y, mm))

def G_drift_c.stay(+s: S.Schema, m: S.Qu, +t: List<&2, S.Qu>, +y: S.Sx, mm: Laws.MemS(S.Sq.drift_cs(s, t), y)) -> Laws.MemS(S.Sq.drift_cs(s, Con{m, t}), y):
  match m:
    case S.Qu{+site, +table, +col, +role}:
      Keep.stay(S.Sq.drift_c(s, table, col), S.Sx{6, site, table, col, role}, S.Sq.drift_cs(s, t), y, mm)

def Laws.sql_drift_c_complete(s, xs, site, table, col, role, hm, h):
  match xs:
    case Nil{}:
      match hm:
    case Con{m, t}:
      match hm:
        case Inl{e}:
          %Equal.sym(S.Qu, m, S.Qu{site, table, col, role}, e) : Laws.MemS(S.Sq.drift_cs(s, Con{_, t}), S.Sx{6, site, table, col, role})
          Keep.hit(S.Sq.drift_c(s, table, col), S.Sx{6, site, table, col, role}, S.Sq.drift_cs(s, t), h)
        case Inr{mm}:
          G_drift_c.stay(s, m, t, S.Sx{6, site, table, col, role}, Laws.sql_drift_c_complete(s, t, site, table, col, role, mm, h))

# ---- the index lookup ----
def Term.of(+i: U32, +col: U32, +any: Bool, dxs: List<&2, S.Dx>, e: {S.Sq.term(i, col, any, dxs) == True{} : Bool}) -> Laws.TermW(i, col, any, dxs):
  match dxs:
    case Nil{}:
      Empty.absurd(Laws.TermW(i, col, any, Nil{}), N.Bool.ff_tt(e))
    case Con{S.Dx{+x, +p, +c}, +rest}:
      Term.here(i, col, any, x, p, c, rest, HP.Split.or(Bool.and(U32.is_eq(x, i), Bool.and(U32.is_eq(c, col), Bool.or(any, U32.is_eq(p, 0)))), S.Sq.term(i, col, any, rest), e), ee => Term.of(i, col, any, rest, ee))

def Idx.here(+table: U32, +col: U32, +any: Bool, +i: U32, +t: U32, +f: U32, +rest: List<&2, S.Di>, +dxs: List<&2, S.Dx>, o: Either<&2, &2, {Bool.and(U32.is_eq(t, table), S.Sq.term(i, col, any, dxs)) == True{} : Bool}, {S.Sq.indexed(table, col, any, rest, dxs) == True{} : Bool}>, ih: {S.Sq.indexed(table, col, any, rest, dxs) == True{} : Bool} -> Laws.IdxW(table, col, any, rest, dxs)) -> Laws.IdxW(table, col, any, Con{S.Di{i, t, f}, rest}, dxs):
  match o:
    case Inl{+e}:
      Inl{Tuple{And.l(U32.is_eq(t, table), S.Sq.term(i, col, any, dxs), e), Term.of(i, col, any, dxs, And.r(U32.is_eq(t, table), S.Sq.term(i, col, any, dxs), e))}}
    case Inr{e}:
      Inr{ih(e)}

def Laws.sql_indexed_sound(table, col, any, dis, dxs, e):
  match dis:
    case Nil{}:
      Empty.absurd(Laws.IdxW(table, col, any, Nil{}, dxs), N.Bool.ff_tt(e))
    case Con{S.Di{+i, +t, +f}, +rest}:
      Idx.here(table, col, any, i, t, f, rest, dxs, HP.Split.or(Bool.and(U32.is_eq(t, table), S.Sq.term(i, col, any, dxs)), S.Sq.indexed(table, col, any, rest, dxs), e), ee => Laws.sql_indexed_sound(table, col, any, rest, dxs, ee))

def Term.any(+i: U32, +col: U32, +any: Bool, dxs: List<&2, S.Dx>, w: Laws.TermW(i, col, any, dxs)) -> {S.Sq.term(i, col, any, dxs) == True{} : Bool}:
  match dxs:
    case Nil{}:
      match w:
    case Con{S.Dx{+x, +p, +c}, +rest}:
      match w:
        case Inl{Tuple{e1, Tuple{e2, e3}}}:
          Or.l(Bool.and(U32.is_eq(x, i), Bool.and(U32.is_eq(c, col), Bool.or(any, U32.is_eq(p, 0)))), S.Sq.term(i, col, any, rest), HP.And.both(U32.is_eq(x, i), Bool.and(U32.is_eq(c, col), Bool.or(any, U32.is_eq(p, 0))), e1, HP.And.both(U32.is_eq(c, col), Bool.or(any, U32.is_eq(p, 0)), e2, e3)))
        case Inr{q}:
          HP.Or.r(Bool.and(U32.is_eq(x, i), Bool.and(U32.is_eq(c, col), Bool.or(any, U32.is_eq(p, 0)))), S.Sq.term(i, col, any, rest), Term.any(i, col, any, rest, q))

def Laws.sql_indexed_complete(table, col, any, dis, dxs, w):
  match dis:
    case Nil{}:
      match w:
    case Con{S.Di{+i, +t, +f}, +rest}:
      match w:
        case Inl{q}:
          match q:
            case Tuple{e1, tw}:
              Or.l(Bool.and(U32.is_eq(t, table), S.Sq.term(i, col, any, dxs)), S.Sq.indexed(table, col, any, rest, dxs), HP.And.both(U32.is_eq(t, table), S.Sq.term(i, col, any, dxs), e1, Term.any(i, col, any, dxs, tw)))
        case Inr{q}:
          HP.Or.r(Bool.and(U32.is_eq(t, table), S.Sq.term(i, col, any, dxs)), S.Sq.indexed(table, col, any, rest, dxs), Laws.sql_indexed_complete(table, col, any, rest, dxs, q))

def Laws.sql_unindexed_means(ok, sk, dts, dcs, dis, dxs, dfs, dgs, table, col, role, e):
  Un.split(S.Sq.filter_role(role), S.Sq.base(table, dts), S.Sq.col(table, col, False{}, dcs), S.Sq.indexed(table, col, False{}, dis, dxs), S.Sq.col(table, col, True{}, dcs), e)

# ---- drift needs a complete schema ----
def Laws.sql_drift_tables_need_complete(ok, sk, dts, dcs, dis, dxs, dfs, dgs, h, qts):
  match qts:
    case Nil{}:
      {==}
    case Con{S.Qt{+site, +table, +mode}, t}:
      Equal.trans(List<&2, S.Sx>, S.Sq.keep(Bool.and(U32.is_eq(sk, 0), Bool.not(S.Sq.table(table, dts))), S.Sx{6, site, table, S.Sq.none(), mode}, S.Sq.drift_ts(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, t)), S.Sq.drift_ts(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, t), Nil{}, Keep.off(Bool.and(U32.is_eq(sk, 0), Bool.not(S.Sq.table(table, dts))), S.Sx{6, site, table, S.Sq.none(), mode}, S.Sq.drift_ts(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, t), And.ff(U32.is_eq(sk, 0), Bool.not(S.Sq.table(table, dts)), h)), Laws.sql_drift_tables_need_complete(ok, sk, dts, dcs, dis, dxs, dfs, dgs, h, t))

def Laws.sql_drift_cols_need_complete(ok, sk, dts, dcs, dis, dxs, dfs, dgs, h, qus):
  match qus:
    case Nil{}:
      {==}
    case Con{S.Qu{+site, +table, +col, +role}, t}:
      Equal.trans(List<&2, S.Sx>, S.Sq.keep(Bool.and(U32.is_eq(sk, 0), Bool.and(Bool.not(U32.is_eq(table, S.Sq.none())), Bool.and(S.Sq.table(table, dts), Bool.not(S.Sq.col(table, col, False{}, dcs))))), S.Sx{6, site, table, col, role}, S.Sq.drift_cs(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, t)), S.Sq.drift_cs(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, t), Nil{}, Keep.off(Bool.and(U32.is_eq(sk, 0), Bool.and(Bool.not(U32.is_eq(table, S.Sq.none())), Bool.and(S.Sq.table(table, dts), Bool.not(S.Sq.col(table, col, False{}, dcs))))), S.Sx{6, site, table, col, role}, S.Sq.drift_cs(S.Schema{ok, sk, dts, dcs, dis, dxs, dfs, dgs}, t), And.ff(U32.is_eq(sk, 0), Bool.and(Bool.not(U32.is_eq(table, S.Sq.none())), Bool.and(S.Sq.table(table, dts), Bool.not(S.Sq.col(table, col, False{}, dcs)))), h)), Laws.sql_drift_cols_need_complete(ok, sk, dts, dcs, dis, dxs, dfs, dgs, h, t))

def Laws.sql_findings_shape(s, qs, qts, qus, qds):
  {==}

def Laws.sql_fks_shape(ok, sk, dts, dcs, dis, dxs, dfs, dgs):
  {==}

def Laws.sql_lines_shape(s, q):
  {==}
