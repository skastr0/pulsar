# engine/SqlIn-LAWS.bend - laws tying the SQL, fan-out and constant-argument sections
# (and the hot-path section) to the shipped detectors. Proofs: SqlIn-PROOF.bend.
#
# Reading the rows into lists (Si.of and the constructors) is not proven, by the
# verification scope. These laws state what each section does with the lists read:
# no section without its rule row, None when a row has the wrong field count, and
# otherwise exactly the detector's lines (whose shape laws are in Sql-, Fanout- and
# Konst-LAWS.bend).

import Base
import ./Rows.bend as W
import ./SqlIn.bend as S
import ./Sql.bend as Q
import ./Fanout.bend as F
import ./Grow.bend as R
import ./Konst.bend as K
import ./Hot.bend as H

law sqlin_off:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21330) == False{} : Bool}
  {S.SqlIn.lines(rows) == Some{Nil{}} : Maybe<List<&2, String>>}

law sqlin_refuses:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21330) == True{} : Bool}
  for hb: {S.Si.bad(rows) == True{} : Bool}
  {S.SqlIn.lines(rows) == None{} : Maybe<List<&2, String>>}

law sqlin_runs:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21330) == True{} : Bool}
  for hb: {S.Si.bad(rows) == False{} : Bool}
  {S.SqlIn.lines(rows) == Some{Q.Sql.lines(S.Si.schema(rows), S.Si.query(rows), S.Si.ons(S.Si.of(rows, 21330)))} : Maybe<List<&2, String>>}

law fanoutin_off:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21062) == False{} : Bool}
  {S.FanoutIn.lines(rows) == Some{Nil{}} : Maybe<List<&2, String>>}

law fanoutin_refuses:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21062) == True{} : Bool}
  for hb: {S.Si.bad(rows) == True{} : Bool}
  {S.FanoutIn.lines(rows) == None{} : Maybe<List<&2, String>>}

law fanoutin_runs:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21062) == True{} : Bool}
  for hb: {S.Si.bad(rows) == False{} : Bool}
  {S.FanoutIn.lines(rows) == Some{F.Fanout.lines(F.FoF{S.Si.css(S.Si.of(rows, 17235)), S.Si.cls(S.Si.of(rows, 17228)), S.Si.ces(S.Si.of(rows, 17221)), S.Si.rfs(S.Si.of(rows, 21062))})} : Maybe<List<&2, String>>}

law konstin_off:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21067) == False{} : Bool}
  {S.KonstIn.lines(rows) == Some{Nil{}} : Maybe<List<&2, String>>}

law konstin_refuses:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21067) == True{} : Bool}
  for hb: {S.Si.bad(rows) == True{} : Bool}
  {S.KonstIn.lines(rows) == None{} : Maybe<List<&2, String>>}

law konstin_runs:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21067) == True{} : Bool}
  for hb: {S.Si.bad(rows) == False{} : Bool}
  {S.KonstIn.lines(rows) == Some{K.Konst.lines(K.KF{S.Si.css(S.Si.of(rows, 17235)), S.Si.cls(S.Si.of(rows, 17228)), S.Si.als(S.Si.of(rows, 16716)), S.Si.rks(S.Si.of(rows, 21067))})} : Maybe<List<&2, String>>}

# The hot-path section: Hot-LAWS.bend states what H.Hot.lines prints for Si.hf(rows).
law hotin_off:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21064) == False{} : Bool}
  {S.HotIn.lines(rows) == Some{Nil{}} : Maybe<List<&2, String>>}

law hotin_refuses:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21064) == True{} : Bool}
  for hb: {S.Si.bad(rows) == True{} : Bool}
  {S.HotIn.lines(rows) == None{} : Maybe<List<&2, String>>}

law hotin_runs:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21064) == True{} : Bool}
  for hb: {S.Si.bad(rows) == False{} : Bool}
  {S.HotIn.lines(rows) == Some{H.Hot.lines(S.Si.hf(rows))} : Maybe<List<&2, String>>}

law growin_off:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21063) == False{} : Bool}
  {S.GrowIn.lines(rows) == Some{Nil{}} : Maybe<List<&2, String>>}

law growin_refuses:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21063) == True{} : Bool}
  for hb: {S.Si.bad(rows) == True{} : Bool}
  {S.GrowIn.lines(rows) == None{} : Maybe<List<&2, String>>}

law growin_runs:
  for +rows: List<&2, W.Row>
  for h: {S.Si.has(rows, 21063) == True{} : Bool}
  for hb: {S.Si.bad(rows) == False{} : Bool}
  {S.GrowIn.lines(rows) == Some{R.Grow.lines(S.Si.gf(rows))} : Maybe<List<&2, String>>}
