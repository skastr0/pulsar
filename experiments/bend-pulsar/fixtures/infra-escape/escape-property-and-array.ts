// expect: reads= escapes=3
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
export default {
  async fetch(request: Request, env: Env) {
    const a = { env }; // ESC
    const b = { e: env }; // ESC
    const c = [env]; // ESC
    return new Response(String(a) + String(b) + String(c));
  },
};
