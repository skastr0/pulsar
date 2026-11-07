// expect: reads= escapes=3
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
declare const holder: { env?: Env };
export default {
  async fetch(request: Request, env: Env) {
    const alias = env; // ESC
    holder.env = env; // ESC
    let later: Env | undefined;
    later = env; // ESC
    return new Response(String(alias) + String(later));
  },
};
