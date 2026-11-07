import { DurableObject } from "cloudflare:workers";

export class Counter extends DurableObject {
  bump() {
    this.ctx.storage.sql.exec("update c set n = n + 1");
  }
}

export class Plain {
  constructor(private ctx: DurableObjectState) {}

  read() {
    return this.ctx.storage.sql.exec("select 1");
  }

  other() {
    return this.nothing.sql.exec("select 2");
  }
}
