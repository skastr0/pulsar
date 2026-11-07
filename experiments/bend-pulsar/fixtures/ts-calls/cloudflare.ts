import { env } from "cloudflare:workers";

export const a = async (db: D1Database) => {
  const stmt = db.prepare("select 1");
  await db.exec("select 2");
  await db.batch([stmt]);
  return db.dump();
};

export class Counter {
  constructor(private ctx: DurableObjectState) {}
}

export const b = (ctx: DurableObjectState, sql: SqlStorage, storage: DurableObjectStorage) => {
  ctx.storage.sql.exec("select 3");
  sql.exec("select 4");
  storage.sql.exec("select 5");
};

export const c = () => env.DB;
