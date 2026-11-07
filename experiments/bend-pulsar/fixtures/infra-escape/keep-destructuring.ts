// expect: reads=A,DB,KV,SECRET escapes=0
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
export default {
  async fetch(request: Request, env: Env) {
    const { DB, KV } = env;
    const { SECRET: s } = env;
    const { A = 1 } = env;
    return new Response(String(DB) + String(KV) + String(s) + String(A));
  },
};
