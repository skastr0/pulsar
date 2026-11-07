// expect: reads= escapes=2
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
declare function take(...args: unknown[]): void;
export default {
  async fetch(request: Request, env: Env) {
    const copy = { ...env }; // ESC
    take(...Object.values({ ...env })); // ESC
    return new Response(String(copy));
  },
};
