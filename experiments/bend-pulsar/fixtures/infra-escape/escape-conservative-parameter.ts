// expect: reads= escapes=1 conservative
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
// Any parameter named `env` is taken for the Workers environment (the existing convention), so this
// helper's own `env` escapes too. A conservative, sound reading: keep it unless the rule changes.
export function helper(env: { a: number }) {
  return env; // ESC
}
