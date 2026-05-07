import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  TsLd07,
  TsLd07Config,
} from "../signals/ts-ld-07-unsafe-type-erosion.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

describe("TS-LD-07 (unsafe type erosion)", () => {
  let repo: TempRepo

  const setup = async (): Promise<void> => {
    repo = await createTempRepo("pulsar-ts-ld-07-")
  }

  const cleanup = async (): Promise<void> => {
    await repo.cleanup()
  }

  test("fully typed source has no unsafe erosion", async () => {
    await setup()
    try {
      await repo.write(
        "src/api.ts",
        [
          "export interface Payload {",
          "  readonly id: string",
          "}",
          "",
          "export function parse(payload: Payload): string {",
          "  return payload.id",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(out.totalOccurrences).toBe(0)
      expect(out.boundaryOccurrences).toBe(0)
      expect(TsLd07.score(out)).toBe(1)
      expect(TsLd07.diagnose(out)).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("exported contract any is weighted harder than internal any", async () => {
    await setup()
    try {
      await repo.write(
        "src/contracts.ts",
        [
          "export interface PublicPayload {",
          "  readonly raw: any",
          "}",
          "",
          "export function handle(payload: any): Promise<any> {",
          "  const scratch: any = payload",
          "  return Promise.resolve(scratch)",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      const boundaryTargets = out.occurrences
        .filter((occurrence) => occurrence.boundary)
        .map((occurrence) => occurrence.target)
        .sort()

      expect(out.totalOccurrences).toBe(4)
      expect(out.boundaryOccurrences).toBe(3)
      expect(boundaryTargets).toEqual(["handle", "payload", "raw"])
      expect(out.boundaryWeightedUnsafe).toBeGreaterThan(out.weightedUnsafe / 2)
      expect(TsLd07.score(out)).toBeLessThan(0.6)
      expect(TsLd07.diagnose(out)[0]?.severity).toBe("warn")
    } finally {
      await cleanup()
    }
  })

  test("internal any erosion is visible but lower pressure", async () => {
    await setup()
    try {
      await repo.write(
        "src/internal.ts",
        [
          "function normalize(payload: any): any {",
          "  const scratch: any = payload",
          "  return scratch",
          "}",
          "",
          "export const ready = true",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(out.totalOccurrences).toBe(3)
      expect(out.boundaryOccurrences).toBe(0)
      expect(TsLd07.score(out)).toBeGreaterThan(0.5)
      expect(TsLd07.diagnose(out)[0]?.severity).toBe("info")
    } finally {
      await cleanup()
    }
  })

  test("path names do not promote unsafe types to boundary evidence", async () => {
    await setup()
    try {
      await repo.write("src/api/route.ts", "const payload: any = {}\n")
      await repo.write("src/ordinary/worker.ts", "const payload: any = {}\n")

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(out.totalOccurrences).toBe(2)
      expect(out.boundaryOccurrences).toBe(0)
      expect(new Set(out.occurrences.map((occurrence) => occurrence.kind))).toEqual(
        new Set(["variable"]),
      )
    } finally {
      await cleanup()
    }
  })

  test("generated and declaration files are excluded by default", async () => {
    await setup()
    try {
      await repo.write("src/generated/client.ts", "export const raw: any = {}\n")
      await repo.write("src/types.d.ts", "export interface External { raw: any }\n")
      await repo.write("src/real.ts", "export const ok: string = 'typed'\n")

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(out.totalOccurrences).toBe(0)
      expect(TsLd07.score(out)).toBe(1)
    } finally {
      await cleanup()
    }
  })

  test("default config decodes", () => {
    const decoded = Schema.decodeUnknownSync(TsLd07Config)(TsLd07.defaultConfig)
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
    expect(decoded.max_weighted_unsafe_per_kloc).toBeGreaterThan(0)
    expect(decoded.max_boundary_weighted_unsafe).toBeGreaterThan(0)
  })
})
