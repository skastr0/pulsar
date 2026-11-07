import { SqlClient } from "effect/sql";

export const q = (sql: SqlClient.SqlClient) => sql`select 1`;
