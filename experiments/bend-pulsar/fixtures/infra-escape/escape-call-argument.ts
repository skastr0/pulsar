// expect: reads= escapes=3
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
declare function helper(e: Env): void;
export default {
  async fetch(request: Request, env: Env) {
    helper(env); // ESC
    const names = Object.keys(env); // ESC
    return Response.json(env); // ESC
  },
};
