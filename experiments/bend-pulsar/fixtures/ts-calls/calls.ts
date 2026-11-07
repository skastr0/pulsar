import { Effect } from "effect";
import { orDie } from "effect/Effect";

export const a = async () => {
  console.log("x");
  for (const i of [1]) {
    Date.now();
  }
  const d = new Date();
  const e = new Date(0);
  return d;
};

export const b = (eff: any) => {
  Effect.runPromise(eff);
  return orDie(eff);
};

export const c = Effect.gen(function* () {
  Effect.runSync(1);
});
