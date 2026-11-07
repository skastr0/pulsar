// expect: reads= escapes=0
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
export default {
  async fetch(request: Request, env: Env) {
    if (typeof env === "undefined") return new Response("none");
    if (env === undefined) return new Response("none");
    if ("DB" in env) return new Response("db");
    if (env) return new Response("env");
    return new Response("ok");
  },
};
