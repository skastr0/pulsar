// expect: reads=BUCKET,CACHE,DB,KV escapes=0
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
export default {
  async fetch(request: Request, env: Env) {
    await env.DB.prepare("select 1").all();
    await env.KV.get("k");
    use(env["BUCKET"]);
    use(env[`CACHE`]);
    return new Response("ok");
  },
};
