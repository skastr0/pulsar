# engine/SqlIn-PROOF.bend - proofs of SqlIn-LAWS.bend. Gate: bend SqlIn-PROOF.bend --verdict
import Base
import ./Rows.bend as W
import ./SqlIn.bend as S
import ./Sql.bend as Q
import ./Fanout.bend as F
import ./Konst.bend as K
import ./SqlIn-LAWS.bend as Laws

def Laws.sqlin_off(rows, h):
  %Equal.sym(Bool, S.Si.has(rows, 21330), False{}, h) : {S.Si.sql1(_, rows) == Some{Nil{}} : Maybe<List<&2, String>>}
  {==}

def Laws.sqlin_refuses(rows, h, hb):
  %Equal.sym(Bool, S.Si.has(rows, 21330), True{}, h) : {S.Si.sql1(_, rows) == None{} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, S.Si.bad(rows), True{}, hb) : {S.Si.sql2(Bool.not(_), rows) == None{} : Maybe<List<&2, String>>}
  {==}

def Laws.sqlin_runs(rows, h, hb):
  %Equal.sym(Bool, S.Si.has(rows, 21330), True{}, h) : {S.Si.sql1(_, rows) == Some{Q.Sql.lines(S.Si.schema(rows), S.Si.query(rows), S.Si.ons(S.Si.of(rows, 21330)))} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, S.Si.bad(rows), False{}, hb) : {S.Si.sql2(Bool.not(_), rows) == Some{Q.Sql.lines(S.Si.schema(rows), S.Si.query(rows), S.Si.ons(S.Si.of(rows, 21330)))} : Maybe<List<&2, String>>}
  {==}

def Laws.fanoutin_off(rows, h):
  %Equal.sym(Bool, S.Si.has(rows, 21062), False{}, h) : {S.Si.fo1(_, rows) == Some{Nil{}} : Maybe<List<&2, String>>}
  {==}

def Laws.fanoutin_refuses(rows, h, hb):
  %Equal.sym(Bool, S.Si.has(rows, 21062), True{}, h) : {S.Si.fo1(_, rows) == None{} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, S.Si.bad(rows), True{}, hb) : {S.Si.fo2(Bool.not(_), rows) == None{} : Maybe<List<&2, String>>}
  {==}

def Laws.fanoutin_runs(rows, h, hb):
  %Equal.sym(Bool, S.Si.has(rows, 21062), True{}, h) : {S.Si.fo1(_, rows) == Some{F.Fanout.lines(F.FoF{S.Si.css(S.Si.of(rows, 17235)), S.Si.cls(S.Si.of(rows, 17228)), S.Si.ces(S.Si.of(rows, 17221)), S.Si.rfs(S.Si.of(rows, 21062))})} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, S.Si.bad(rows), False{}, hb) : {S.Si.fo2(Bool.not(_), rows) == Some{F.Fanout.lines(F.FoF{S.Si.css(S.Si.of(rows, 17235)), S.Si.cls(S.Si.of(rows, 17228)), S.Si.ces(S.Si.of(rows, 17221)), S.Si.rfs(S.Si.of(rows, 21062))})} : Maybe<List<&2, String>>}
  {==}

def Laws.konstin_off(rows, h):
  %Equal.sym(Bool, S.Si.has(rows, 21067), False{}, h) : {S.Si.ko1(_, rows) == Some{Nil{}} : Maybe<List<&2, String>>}
  {==}

def Laws.konstin_refuses(rows, h, hb):
  %Equal.sym(Bool, S.Si.has(rows, 21067), True{}, h) : {S.Si.ko1(_, rows) == None{} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, S.Si.bad(rows), True{}, hb) : {S.Si.ko2(Bool.not(_), rows) == None{} : Maybe<List<&2, String>>}
  {==}

def Laws.konstin_runs(rows, h, hb):
  %Equal.sym(Bool, S.Si.has(rows, 21067), True{}, h) : {S.Si.ko1(_, rows) == Some{K.Konst.lines(K.KF{S.Si.css(S.Si.of(rows, 17235)), S.Si.cls(S.Si.of(rows, 17228)), S.Si.als(S.Si.of(rows, 16716)), S.Si.rks(S.Si.of(rows, 21067))})} : Maybe<List<&2, String>>}
  %Equal.sym(Bool, S.Si.bad(rows), False{}, hb) : {S.Si.ko2(Bool.not(_), rows) == Some{K.Konst.lines(K.KF{S.Si.css(S.Si.of(rows, 17235)), S.Si.cls(S.Si.of(rows, 17228)), S.Si.als(S.Si.of(rows, 16716)), S.Si.rks(S.Si.of(rows, 21067))})} : Maybe<List<&2, String>>}
  {==}
