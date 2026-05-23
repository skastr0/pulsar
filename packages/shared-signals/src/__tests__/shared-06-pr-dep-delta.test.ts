import { describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import {
  Shared06PrDepDelta,
  type Shared06PrDepDeltaOutput,
} from "../shared-06-pr-dep-delta.js"

const tsMeasuredChurn = {
  linesAdded: 1200,
  linesDeleted: 900,
  filesChanged: ["packages/app/src/index.ts"],
  newCrossPackageEdges: [],
  newCrossBoundaryEdges: [],
  diffMode: "git-commit-range",
  dependencyDeltaMode: "measured",
} as const

const tsDependencyEdges = {
  linesAdded: 20,
  linesDeleted: 10,
  filesChanged: ["packages/app/src/index.ts"],
  newCrossPackageEdges: [{ id: "package" }],
  newCrossBoundaryEdges: [{ id: "boundary-a" }, { id: "boundary-b" }],
  diffMode: "git-commit-range",
  dependencyDeltaMode: "measured",
} as const

const rsDependencyEdge = {
  linesAdded: 0,
  linesDeleted: 0,
  filesChanged: ["crates/app/src/lib.rs"],
  newCrossCrateEdges: [{ id: "crate" }],
  diffMode: "git-commit-range",
} as const

const tsClean = {
  linesAdded: 0,
  linesDeleted: 0,
  filesChanged: [],
  newCrossPackageEdges: [],
  newCrossBoundaryEdges: [],
  diffMode: "git-commit-range",
  dependencyDeltaMode: "measured",
} as const

const rsClean = {
  linesAdded: 0,
  linesDeleted: 0,
  filesChanged: [],
  newCrossCrateEdges: [],
  diffMode: "git-commit-range",
} as const

const runPrDelta = (
  inputs: ReadonlyMap<string, unknown>,
  config: Partial<typeof Shared06PrDepDelta.defaultConfig> = {},
): Promise<Shared06PrDepDeltaOutput> =>
  Effect.runPromise(
    Shared06PrDepDelta.compute(
      { ...Shared06PrDepDelta.defaultConfig, ...config },
      new Map(inputs),
    ) as Effect.Effect<Shared06PrDepDeltaOutput, unknown, never>,
  )

describe("SHARED-06 PR dependency delta", () => {
  test("declares identity, compound inputs, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-06"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-06")
    const decoded = Schema.decodeUnknownSync(Shared06PrDepDelta.configSchema)(
      Shared06PrDepDelta.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as Shared06PrDepDeltaOutput)

    expect(Shared06PrDepDelta).toMatchObject({
      id: "SHARED-06-pr-dependency-delta",
      title: "PR dependency delta",
      aliases: ["SHARED-06"],
      tier: 1.5,
      category: "review-pain",
      kind: "compound",
      cacheVersion: "empty-diff-applicability-v2-evidence-state-diagnostics",
    })
    expect(decoded).toEqual({ top_n_diagnostics: 10 })
    expect(Shared06PrDepDelta.inputs).toEqual([
      {
        id: "TS-RP-02-pr-size",
        optional: true,
        cacheFingerprint: "shared-06-typescript-pr-delta-input-v1",
      },
      {
        id: "RS-RP-03-pr-size",
        optional: true,
        cacheFingerprint: "shared-06-rust-pr-delta-input-v1",
      },
    ])
    expect(registered?.id).toBe(Shared06PrDepDelta.id)
    expect(registered?.cacheVersion).toContain(Shared06PrDepDelta.cacheVersion)
    expect(registry.byId.get("SHARED-06")?.id).toBe(Shared06PrDepDelta.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("line churn without measured dependency edges is score-neutral context", async () => {
    const out = await runPrDelta(
      new Map<string, unknown>([["TS-RP-02", tsMeasuredChurn]]),
    )

    expect(out.dependencyDeltaState).toBe("measured")
    expect(out.totalNewDependencyEdges).toBe(0)
    expect(out.linesAdded).toBe(1200)
    expect(out.linesDeleted).toBe(900)
    expect(out.byLanguage.typescript).toMatchObject({
      newDependencyEdges: 0,
      crossBoundaryEdges: 0,
      crossPackageEdges: 0,
      linesAdded: 1200,
      linesDeleted: 900,
      diffMode: "git-commit-range",
      dependencyDeltaMode: "measured",
    })
    expect(Shared06PrDepDelta.score(out)).toBe(1)
    expect(Shared06PrDepDelta.outputMetadata?.(out)).toBeUndefined()
    expect(Shared06PrDepDelta.diagnose(out).map((diagnostic) => diagnostic.severity)).toEqual([
      "info",
      "info",
    ])
    expect(Shared06PrDepDelta.diagnose(out)[0]?.message).toContain("+1200 / -900")
  })

  test("dependency edges create review pressure by edge kind", async () => {
    const out = await runPrDelta(
      new Map<string, unknown>([
        ["TS-RP-02", tsDependencyEdges],
        ["RS-RP-03", rsDependencyEdge],
      ]),
    )

    expect(out.dependencyDeltaState).toBe("measured")
    expect(out.totalNewDependencyEdges).toBe(4)
    expect(out.crossBoundaryEdges).toBe(2)
    expect(out.crossPackageEdges).toBe(1)
    expect(out.crossCrateEdges).toBe(1)
    expect(out.byLanguage).toEqual({
      typescript: {
        newDependencyEdges: 3,
        crossBoundaryEdges: 2,
        crossPackageEdges: 1,
        linesAdded: 20,
        linesDeleted: 10,
        diffMode: "git-commit-range",
        dependencyDeltaMode: "measured",
      },
      rust: {
        newDependencyEdges: 1,
        crossCrateEdges: 1,
        linesAdded: 0,
        linesDeleted: 0,
        diffMode: "git-commit-range",
        dependencyDeltaMode: "measured",
      },
    })
    expect(Shared06PrDepDelta.score(out)).toBeCloseTo(0.35)
    expect(Shared06PrDepDelta.outputMetadata?.(out)).toBeUndefined()
    const diagnostics = Shared06PrDepDelta.diagnose(out)
    expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      "warn",
      "warn",
      "warn",
    ])
    expect(diagnostics[0]?.data).toMatchObject({
      dependencyDeltaState: "measured",
      totalNewDependencyEdges: 4,
      crossBoundaryEdges: 2,
      crossPackageEdges: 1,
      crossCrateEdges: 1,
      linesAdded: 20,
      linesDeleted: 10,
    })
    expect(diagnostics[1]?.data).toMatchObject({
      language: "typescript",
      newDependencyEdges: 3,
      crossBoundaryEdges: 2,
      crossPackageEdges: 1,
    })
    expect(diagnostics[2]?.data).toMatchObject({
      language: "rust",
      newDependencyEdges: 1,
      crossCrateEdges: 1,
    })
  })

  test("canonical input ids and aliases produce the same deterministic output", async () => {
    const canonical = await runPrDelta(
      new Map<string, unknown>([
        ["TS-RP-02-pr-size", tsDependencyEdges],
        ["RS-RP-03-pr-size", rsDependencyEdge],
      ]),
    )
    const aliases = await runPrDelta(
      new Map<string, unknown>([
        ["RS-RP-03", rsDependencyEdge],
        ["TS-RP-02", tsDependencyEdges],
      ]),
    )

    expect(aliases).toEqual(canonical)
    expect(Shared06PrDepDelta.score(aliases)).toBe(Shared06PrDepDelta.score(canonical))
  })

  test("missing optional inputs and clean measured diffs are not applicable", async () => {
    const missing = await runPrDelta(new Map())
    const clean = await runPrDelta(
      new Map<string, unknown>([
        ["TS-RP-02", tsClean],
        ["RS-RP-03", rsClean],
      ]),
    )

    expect(missing).toMatchObject({
      dependencyDeltaState: "not_applicable",
      totalNewDependencyEdges: 0,
      linesAdded: 0,
      linesDeleted: 0,
      topDiagnostics: 10,
      byLanguage: {},
    })
    expect(clean).toMatchObject({
      dependencyDeltaState: "measured",
      totalNewDependencyEdges: 0,
      linesAdded: 0,
      linesDeleted: 0,
      byLanguage: {
        typescript: {
          newDependencyEdges: 0,
        },
        rust: {
          newDependencyEdges: 0,
        },
      },
    })
    expect(Shared06PrDepDelta.score(missing)).toBe(1)
    expect(Shared06PrDepDelta.outputMetadata?.(missing)).toEqual({
      applicability: "not_applicable",
    })
    expect(Shared06PrDepDelta.outputMetadata?.(clean)).toEqual({
      applicability: "not_applicable",
    })
  })

  test("preserves insufficient evidence for missing or unavailable dependency-delta facts", async () => {
    const missing = await runPrDelta(
      new Map<string, unknown>([
        [
          "TS-RP-02",
          {
            ...tsClean,
            diffMode: "missing",
            dependencyDeltaMode: "unavailable",
          },
        ],
      ]),
    )
    const tsFallback = await runPrDelta(
      new Map<string, unknown>([
        [
          "TS-RP-02",
          {
            ...tsClean,
            linesAdded: 5,
            filesChanged: ["src/changed.ts"],
            diffMode: "changed-hunks-fallback",
            dependencyDeltaMode: "unavailable",
          },
        ],
      ]),
    )
    const rsFallback = await runPrDelta(
      new Map<string, unknown>([
        [
          "RS-RP-03",
          {
            ...rsClean,
            linesAdded: 5,
            filesChanged: ["crates/app/src/lib.rs"],
            diffMode: "changed-hunks-fallback",
          },
        ],
      ]),
    )

    expect(missing.dependencyDeltaState).toBe("missing")
    expect(tsFallback.dependencyDeltaState).toBe("unavailable")
    expect(rsFallback.dependencyDeltaState).toBe("unavailable")
    expect(Shared06PrDepDelta.score(missing)).toBe(1)
    expect(Shared06PrDepDelta.outputMetadata?.(missing)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(Shared06PrDepDelta.outputMetadata?.(tsFallback)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(Shared06PrDepDelta.outputMetadata?.(rsFallback)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(Shared06PrDepDelta.diagnose(missing)[0]?.severity).toBe("warn")
    expect(Shared06PrDepDelta.diagnose(tsFallback)[0]?.data).toMatchObject({
      dependencyDeltaState: "unavailable",
      linesAdded: 5,
    })
    expect(Shared06PrDepDelta.diagnose(rsFallback)[1]?.data).toMatchObject({
      language: "rust",
      dependencyDeltaMode: "unavailable",
    })
  })

  test("normalizes diagnostic limits and caps ordered payloads", async () => {
    const out = await runPrDelta(
      new Map<string, unknown>([
        ["TS-RP-02", tsDependencyEdges],
        ["RS-RP-03", rsDependencyEdge],
      ]),
      { top_n_diagnostics: 2.9 },
    )
    const hiddenNaN = await runPrDelta(
      new Map<string, unknown>([
        ["TS-RP-02", tsDependencyEdges],
        ["RS-RP-03", rsDependencyEdge],
      ]),
      { top_n_diagnostics: Number.NaN },
    )
    const hiddenNegative = await runPrDelta(
      new Map<string, unknown>([
        ["TS-RP-02", tsDependencyEdges],
        ["RS-RP-03", rsDependencyEdge],
      ]),
      { top_n_diagnostics: -1 },
    )
    const hiddenInfinity = await runPrDelta(
      new Map<string, unknown>([
        ["TS-RP-02", tsDependencyEdges],
        ["RS-RP-03", rsDependencyEdge],
      ]),
      { top_n_diagnostics: Number.POSITIVE_INFINITY },
    )

    const diagnostics = Shared06PrDepDelta.diagnose(out)

    expect(out.topDiagnostics).toBe(2)
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]?.message).toContain("4 new dependency edges")
    expect(diagnostics[1]?.message).toBe("TypeScript PR dependency delta: 3 new dependency edges (+20 / -10)")
    expect(hiddenNaN.topDiagnostics).toBe(0)
    expect(hiddenNegative.topDiagnostics).toBe(0)
    expect(hiddenInfinity.topDiagnostics).toBe(0)
    expect(Shared06PrDepDelta.diagnose(hiddenNaN)).toEqual([])
    expect(Shared06PrDepDelta.diagnose(hiddenNegative)).toEqual([])
    expect(Shared06PrDepDelta.diagnose(hiddenInfinity)).toEqual([])
  })

  test("score pressure is monotonic by edge kind and floors at zero", async () => {
    const packageEdge = await runPrDelta(
      new Map<string, unknown>([
        [
          "TS-RP-02",
          {
            ...tsClean,
            linesAdded: 1,
            newCrossPackageEdges: [{}],
          },
        ],
      ]),
    )
    const crateEdge = await runPrDelta(
      new Map<string, unknown>([
        [
          "RS-RP-03",
          {
            ...rsClean,
            linesAdded: 1,
            newCrossCrateEdges: [{}],
          },
        ],
      ]),
    )
    const boundaryEdge = await runPrDelta(
      new Map<string, unknown>([
        [
          "TS-RP-02",
          {
            ...tsClean,
            linesAdded: 1,
            newCrossBoundaryEdges: [{}],
          },
        ],
      ]),
    )
    const saturated = await runPrDelta(
      new Map<string, unknown>([
        [
          "TS-RP-02",
          {
            ...tsClean,
            linesAdded: 1,
            newCrossBoundaryEdges: Array.from({ length: 10 }, () => ({})),
            newCrossPackageEdges: Array.from({ length: 10 }, () => ({})),
          },
        ],
        [
          "RS-RP-03",
          {
            ...rsClean,
            linesAdded: 1,
            newCrossCrateEdges: Array.from({ length: 10 }, () => ({})),
          },
        ],
      ]),
    )

    expect(Shared06PrDepDelta.score(boundaryEdge)).toBeLessThan(
      Shared06PrDepDelta.score(crateEdge),
    )
    expect(Shared06PrDepDelta.score(crateEdge)).toBeLessThan(
      Shared06PrDepDelta.score(packageEdge),
    )
    expect(Shared06PrDepDelta.score(saturated)).toBe(0)
  })
})
