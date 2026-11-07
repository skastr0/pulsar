// Statements prepared in a loop and run in one batch: the batch is the only query site.
export const all = async (db: D1Database, xs: number[]) => {
  const stmts = [];
  for (const x of xs) {
    stmts.push(db.prepare("insert into t values (?)").bind(x));
  }
  await db.batch(stmts);
};

// A statement prepared and run on each iteration, through its receiver chain: a site in the loop.
export const each = async (db: D1Database, xs: number[]) => {
  for (const x of xs) {
    await db.prepare("insert into t values (?)").bind(x).run();
  }
};
