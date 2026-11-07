// expect: reads= escapes=0
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
// A local `env` is not the Workers environment (semantic resolution), so returning it is no escape.
export function local() {
  const env = { A: 1 };
  return env;
}
