// expect: reads=DB escapes=0
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
declare class DurableObject { env: Env; ctx: unknown; }
export class Room extends DurableObject {
  async load() {
    return this.env.DB.prepare("select 1").all();
  }
}
