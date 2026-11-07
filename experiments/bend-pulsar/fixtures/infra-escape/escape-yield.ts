// expect: reads= escapes=1
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
export function* gen(env: Env) {
  yield env; // ESC
}
