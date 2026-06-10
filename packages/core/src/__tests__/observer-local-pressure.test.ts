import { describe, expect, test } from "bun:test"
import { poisonRampPressure, type PoisonRampConfig } from "../observer-local-pressure.js"

const DEFAULTS: PoisonRampConfig = {
  local_warning_threshold: 0.4,
  local_poison_threshold: 0.75,
}

describe("poisonRampPressure", () => {
  test("anchor values at default thresholds", () => {
    expect(poisonRampPressure(0, DEFAULTS)).toBe(0)
    expect(poisonRampPressure(0.39, DEFAULTS)).toBe(0)
    expect(poisonRampPressure(0.4, DEFAULTS)).toBe(0)
    // Midpoint of the ramp: ramp factor 0.5 applied to the pressure itself.
    expect(poisonRampPressure(0.575, DEFAULTS)).toBeCloseTo(0.2875, 10)
    // Full passthrough from the poison threshold upward.
    expect(poisonRampPressure(0.75, DEFAULTS)).toBeCloseTo(0.75, 10)
    expect(poisonRampPressure(0.9, DEFAULTS)).toBeCloseTo(0.9, 10)
    expect(poisonRampPressure(1, DEFAULTS)).toBe(1)
  })

  test("continuity: no adjacent step exceeds the Lipschitz bound anywhere in [0, 1]", () => {
    // Max slope at defaults is (2 * 0.75 - 0.4) / 0.35 ≈ 3.15, so with a
    // 0.0005 grid the largest legitimate adjacent delta is ~0.0016. A
    // cliff (like the old 0.5625 → 0.75 jump at the poison threshold)
    // shows up as a delta two orders of magnitude larger.
    const step = 0.0005
    let previous = poisonRampPressure(0, DEFAULTS)
    let maxDelta = 0
    for (let x = step; x <= 1 + step / 2; x += step) {
      const current = poisonRampPressure(Math.min(1, x), DEFAULTS)
      maxDelta = Math.max(maxDelta, Math.abs(current - previous))
      previous = current
    }
    expect(maxDelta).toBeLessThan(0.002)
  })

  test("monotonic: more pressure in never yields less poison grade out", () => {
    const step = 0.0005
    let previous = poisonRampPressure(0, DEFAULTS)
    for (let x = step; x <= 1 + step / 2; x += step) {
      const current = poisonRampPressure(Math.min(1, x), DEFAULTS)
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
  })

  test("degenerate config warn == poison falls back to a step at the poison threshold", () => {
    const config: PoisonRampConfig = {
      local_warning_threshold: 0.5,
      local_poison_threshold: 0.5,
    }
    expect(poisonRampPressure(0.49, config)).toBe(0)
    expect(poisonRampPressure(0.5, config)).toBe(0.5)
    expect(poisonRampPressure(0.8, config)).toBe(0.8)
  })

  test("degenerate config warn > poison never yields NaN", () => {
    const config: PoisonRampConfig = {
      local_warning_threshold: 0.9,
      local_poison_threshold: 0.3,
    }
    for (const x of [0, 0.2, 0.3, 0.5, 0.9, 1]) {
      const result = poisonRampPressure(x, config)
      expect(Number.isFinite(result)).toBe(true)
      expect(result).toBe(x >= 0.3 ? x : 0)
    }
  })
})
