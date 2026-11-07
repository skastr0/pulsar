import { Effect } from "effect";
import { SqlClient } from "@effect/sql";
import { SqlSchema } from "@effect/sql";

export const q = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`select 1`;
  yield* sql.unsafe("select 2");
  yield* sql.other();
});

export const typed = (sql: SqlClient.SqlClient) => sql`select 3`;

export const imm = () => SqlSchema.findAll({})(undefined);
