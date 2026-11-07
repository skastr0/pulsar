import { Effect } from "effect";

export function h(p: Promise<number>, eff: any) {
  try { risky(); } catch (e) {}
  try { risky(); } catch (e) { console.error(e); }
  try { risky(); } catch (e) { throw e; }
  try { risky(); } catch (e) { throw new Error("x"); }
  try { risky(); } catch (e) { throw new Error("x", { cause: e }); }
  try { risky(); } catch (e) { return null; }
  try { risky(); } catch (e) { cleanup(); }
  p.catch(() => {});
  p.catch((e) => console.log(e));
  eff.pipe(Effect.catchAll(() => Effect.succeed(1)));
}
