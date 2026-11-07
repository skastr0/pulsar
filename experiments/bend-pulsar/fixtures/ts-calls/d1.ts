import { Effect } from "effect";
import { D1Client } from "@effect/sql-d1";
import { SqliteClient } from "@effect/sql-sqlite-do";

export const run = Effect.gen(function* () {
  const db = yield* D1Client.D1Client;
  const q = db`select 1`;
  yield* db.batch([q]);
  yield* db.unsafe("select 2");
  yield* db.other();
});

export const local = Effect.gen(function* () {
  const sql = yield* SqliteClient.SqliteClient;
  yield* sql`select 3`;
  yield* sql.batch([]);
});
