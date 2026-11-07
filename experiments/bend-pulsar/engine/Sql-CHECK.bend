# bend Sql-CHECK.bend - the SQL detectors on hand-written facts (generic names).
#   tables users 1 (id 2 rowid alias, email 3, org 4), orders 5 (id 2, user 6, total 7),
#   orgs 8 (id 2), a view 11 (col 3). Index 0 users(email), index 1 users(org).
#   fk 0 orders(user) -> users: no index leads with user. fk 1 users(org) -> orgs: indexed.
#   site 0  WHERE users.email = ?       indexed, no finding
#   site 1  WHERE orders.user = ?, SELECT total   unindexed filter on orders.user
#   site 2  WHERE users.id = ?          rowid alias, no finding
#   site 3  dynamic text                sql.dynamic-text
#   site 4  LIMIT 1 OFFSET ?            sql.offset-param
#   site 5  users.email LIKE '%x'       index-defeat (email is indexed)
#   site 6  abs(orders.total) = ?       QD on an unindexed column: no finding
#   site 7  FROM t9 WHERE users.c10 = ?  drift: table 9, column 10 of users
#   site 8  ambiguous column 3          no finding
#   site 9  view.col3 = ?               a view: no unindexed finding
# Then the same facts with ddl_skipped = 1: no drift findings, SQD says incomplete.
import Base
import ./Sql.bend as S

def T.schema(+sk: U32) -> S.Schema:
  S.Schema{12, sk, [S.Dt{1, 0, 0}, S.Dt{5, 0, 0}, S.Dt{8, 0, 0}, S.Dt{11, 0, 8}], [S.Dc{1, 2, 0, 33}, S.Dc{1, 3, 1, 0}, S.Dc{1, 4, 2, 0}, S.Dc{5, 2, 0, 33}, S.Dc{5, 6, 1, 0}, S.Dc{5, 7, 2, 0}, S.Dc{8, 2, 0, 33}, S.Dc{11, 3, 0, 0}], [S.Di{0, 1, 0}, S.Di{1, 1, 0}], [S.Dx{0, 0, 3}, S.Dx{1, 0, 4}], [S.Df{0, 5, 1}, S.Df{1, 1, 8}], [S.Dg{0, 0, 6, 4294967295}, S.Dg{1, 0, 4, 4294967295}]}

def T.q() -> S.Qy:
  S.Qy{[S.Qs{0, 0, 0, 0, 1, 0}, S.Qs{1, 0, 0, 0, 1, 0}, S.Qs{2, 0, 0, 0, 1, 0}, S.Qs{3, 0, 0, 0, 5, 64}, S.Qs{4, 0, 0, 0, 1, 11}, S.Qs{5, 0, 0, 0, 1, 0}, S.Qs{6, 0, 0, 0, 1, 0}, S.Qs{7, 0, 0, 0, 1, 0}, S.Qs{8, 0, 0, 0, 1, 0}, S.Qs{9, 0, 0, 0, 1, 0}], [S.Qt{0, 1, 1}, S.Qt{1, 5, 1}, S.Qt{7, 9, 1}, S.Qt{9, 11, 1}], [S.Qu{0, 1, 3, 1}, S.Qu{1, 5, 6, 1}, S.Qu{1, 5, 7, 8}, S.Qu{2, 1, 2, 1}, S.Qu{7, 1, 10, 1}, S.Qu{8, 4294967295, 3, 1}, S.Qu{9, 11, 3, 1}], [S.Qd{5, 1, 3, 1}, S.Qd{6, 5, 7, 2}]}

def main() -> List<&2, List<&2, String>>:
  [S.Sql.lines(T.schema(0), T.q(), [1, 2, 3, 4, 5, 6]), S.Sql.lines(T.schema(1), T.q(), [1, 2, 3, 4, 5, 6]), S.Sql.lines(T.schema(0), T.q(), [1, 4])]
