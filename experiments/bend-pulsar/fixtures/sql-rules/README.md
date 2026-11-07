# sql-rules

A generic SQLite schema (2 migrations, 3 tables, 2 foreign keys, 2 indexes) and 10 queries, one for each SQL rule case. `expected.txt` is the engine's SQL section for `pulsar facts` of this directory with `SR 1` .. `SR 6` appended, so every rule is on.

Checked against sqlite's own planner: `EXPLAIN QUERY PLAN` on the same DDL shows SCAN for the unindexed filter (`db/queries.sql` line 2) and SEARCH for the indexed and rowid lookups (lines 1 and 3). The index-defeating predicates (lines 5 and 10) get full index scans, and lines 8 and 9 fail with "no such table" and "no such column" (schema drift). The rules are per column, not per plan: `u.status` (line 7) is flagged although the planner drives `u` by rowid. A leading-wildcard `LIKE` on an unindexed column (line 4) is not flagged, because no index would help.
