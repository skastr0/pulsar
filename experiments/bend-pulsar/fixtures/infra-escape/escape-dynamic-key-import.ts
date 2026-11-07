// expect: reads= escapes=1
// Fixture for the env-escape rule (README.md). Lines ending in `// ESC` are escape sites.
import { env } from "cloudflare:workers";
type Env = Record<string, any>;
declare function other(): any;
declare function use(x: unknown): void;
declare const cond: boolean;
declare const k: string;
export function read(name: string) {
  return env[name]; // ESC
}
