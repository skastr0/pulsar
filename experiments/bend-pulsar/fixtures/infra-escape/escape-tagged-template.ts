// expect: reads= escapes=1
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
declare function tag(parts: TemplateStringsArray, ...values: unknown[]): string;
export default {
  async fetch(request: Request, env: Env) {
    return new Response(tag`bindings: ${env}`); // ESC
  },
};
