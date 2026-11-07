import { SqlClient } from "effect/sql";

export async function q(sql: SqlClient.SqlClient) {
  await sql`select 1`;
}
