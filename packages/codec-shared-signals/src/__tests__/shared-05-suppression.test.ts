import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  Shared05Suppression,
  type Shared05SuppressionOutput,
} from "../shared-05-suppression.js"

const tsSuppressions = {
  suppressions: [{}],
  unjustifiedCount: 1,
  expiredCount: 0,
  missingJustificationCount: 1,
}

const rsSuppressions = {
  suppressions: [{}],
  missingJustificationCount: 1,
  expiredJustificationCount: 0,
}

const noRustSuppressions = {
  suppressions: [],
  missingJustificationCount: 0,
  expiredJustificationCount: 0,
}

describe("SHARED-05 suppression governance", () => {
  test("stays score-neutral for single-language runs", async () => {
    const out = await Effect.runPromise(
      Shared05Suppression.compute(
        Shared05Suppression.defaultConfig,
        new Map<string, unknown>([["TS-SL-03", tsSuppressions]]),
      ) as Effect.Effect<Shared05SuppressionOutput, unknown, never>,
    )

    expect(out.languageCount).toBe(1)
    expect(out.unjustifiedCount).toBe(1)
    expect(Shared05Suppression.score(out)).toBe(1)
    expect(Shared05Suppression.diagnose(out)[0]?.severity).toBe("info")
  })

  test("stays score-neutral when another language pack has no suppressions", async () => {
    const out = await Effect.runPromise(
      Shared05Suppression.compute(
        Shared05Suppression.defaultConfig,
        new Map<string, unknown>([
          ["TS-SL-03", tsSuppressions],
          ["RS-SL-02", noRustSuppressions],
        ]),
      ) as Effect.Effect<Shared05SuppressionOutput, unknown, never>,
    )

    expect(out.languageCount).toBe(1)
    expect(out.unjustifiedCount).toBe(1)
    expect(Shared05Suppression.score(out)).toBe(1)
    expect(Shared05Suppression.diagnose(out)[0]?.severity).toBe("info")
  })

  test("applies governance pressure when suppressions span language packs", async () => {
    const out = await Effect.runPromise(
      Shared05Suppression.compute(
        Shared05Suppression.defaultConfig,
        new Map<string, unknown>([
          ["TS-SL-03", tsSuppressions],
          ["RS-SL-02", rsSuppressions],
        ]),
      ) as Effect.Effect<Shared05SuppressionOutput, unknown, never>,
    )

    expect(out.languageCount).toBe(2)
    expect(out.unjustifiedCount).toBe(2)
    expect(Shared05Suppression.score(out)).toBeLessThan(1)
    expect(Shared05Suppression.diagnose(out)[0]?.severity).toBe("warn")
  })
})
