import { Effect } from "effect";
import { D1Client } from "@effect/sql-d1";
import { SqliteClient } from "@effect/sql-sqlite-do";

// Statements built in a loop and run once, in one batch: the batch is the only query site.
export const insertAll = Effect.gen(function* () {
  const db = yield* D1Client.D1Client;
  const stmts = [];
  for (const x of [1, 2]) {
    stmts.push(db`insert into t values (${x})`);
  }
  yield* db.batch(stmts);
});

// A statement run on each iteration: a query site in the loop, also through `.pipe`.
export const insertEach = Effect.gen(function* () {
  const db = yield* D1Client.D1Client;
  for (const x of [1, 2]) {
    yield* db`insert into t values (${x})`;
    yield* db`update t set n = ${x}`.pipe(Effect.asVoid);
  }
});

// Yielded through a conditional, both branches run here; stored or passed on, they do not.
export const local = Effect.gen(function* () {
  const sql = yield* SqliteClient.SqliteClient;
  const q = sql`select 1`;
  yield* Effect.all([sql`select 2`, q]);
  yield* (Math.PI > 3 ? sql`select 3` : sql`select 4`);
});
