import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import type { Category } from "../category.js"
import type { Diagnostic } from "../diagnostic.js"
import type { ObserverOutput } from "../observer.js"
import {
  RoutingDetector,
  RoutingPattern,
  type RoutingDiff,
} from "../routing.js"

type MockSignal = {
  readonly id: string
  readonly category: Category
  readonly score: number
  readonly output?: unknown
  readonly diagnostics?: ReadonlyArray<Diagnostic>
}

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "pulsar-routing-"))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

describe("RoutingDetector", () => {
  test("loads and decodes the shipped routing catalog", async () => {
    const detector = await Effect.runPromise(RoutingDetector.load())

    expect(detector.patterns.map((pattern) => pattern.id)).toEqual([
      "api-surface-change",
      "auth-paths-touched",
      "crypto-import-added",
      "domain-term-drift",
      "migration-added",
      "unsafe-added",
    ])
  })

  test("matches file-path patterns", () => {
    const pattern = Schema.decodeUnknownSync(RoutingPattern)({
      id: "auth-paths-touched",
      displayName: "Auth paths touched",
      triggerKind: "file-path",
      condition: { kind: "file-path", globs: ["**/auth/**"] },
      reviewerRole: "security-reviewer",
      contextPayload: [],
    })

    const detector = new RoutingDetector([pattern])
    const output = detector.detect(makeObserverOutput(), makeDiff({
      changedFiles: ["src/auth/service.ts"],
    }))

    expect(output.triggers).toHaveLength(1)
    expect(output.triggers[0]).toMatchObject({
      patternId: "auth-paths-touched",
      reviewerRole: "security-reviewer",
      sourceLocations: [{ file: "src/auth/service.ts" }],
    })
  })

  test("matches import-added patterns and attaches signal payload context", () => {
    const pattern = Schema.decodeUnknownSync(RoutingPattern)({
      id: "crypto-import-added",
      displayName: "Crypto import added",
      triggerKind: "import-added",
      condition: {
        kind: "import-added",
        specifiers: ["crypto", "jsonwebtoken"],
      },
      reviewerRole: "security-reviewer",
      contextPayload: [{ signalId: "TS-DE-04", include: "all" }],
    })

    const detector = new RoutingDetector([pattern])
    const output = detector.detect(
      makeObserverOutput([
        {
          id: "TS-DE-04",
          category: "dependency-entropy",
          score: 0.72,
          output: { dependencyHealth: "watch" },
          diagnostics: [{ severity: "warn", message: "Dependency health regressed" }],
        },
      ]),
      makeDiff({
        changedFiles: ["src/security.ts"],
        addedImports: [{ file: "src/security.ts", specifier: "crypto", line: 1 }],
      }),
    )

    expect(output.triggers).toHaveLength(1)
    expect(output.triggers[0]?.contextPayload["TS-DE-04"]).toEqual({
      score: 0.72,
      diagnostics: [{ severity: "warn", message: "Dependency health regressed" }],
      output: { dependencyHealth: "watch" },
    })
  })

  test("matches ast-match patterns", () => {
    const pattern = Schema.decodeUnknownSync(RoutingPattern)({
      id: "unsafe-added",
      displayName: "Unsafe added",
      triggerKind: "ast-match",
      condition: {
        kind: "ast-match",
        signalId: "RS-LD-01",
        outputKey: "new-unsafe-block",
      },
      reviewerRole: "safety-reviewer",
      contextPayload: [{ signalId: "RS-LD-01", include: "output" }],
    })

    const detector = new RoutingDetector([pattern])
    const output = detector.detect(
      makeObserverOutput([
        {
          id: "RS-LD-01",
          category: "legibility-decay",
          score: 0.5,
          output: { totalUnsafeBlocks: 1 },
        },
      ]),
      makeDiff({
        changedFiles: ["crates/core/src/lib.rs"],
        astMatches: [
          {
            signalId: "RS-LD-01",
            outputKey: "new-unsafe-block",
            location: { file: "crates/core/src/lib.rs", line: 12 },
          },
        ],
      }),
    )

    expect(output.triggers).toHaveLength(1)
    expect(output.triggers[0]?.sourceLocations).toEqual([
      { file: "crates/core/src/lib.rs", line: 12 },
    ])
  })

  test("matches signal-threshold patterns", () => {
    const pattern = Schema.decodeUnknownSync(RoutingPattern)({
      id: "domain-term-drift",
      displayName: "Domain term drift",
      triggerKind: "signal-threshold",
      condition: {
        kind: "signal-threshold",
        signalId: "TS-LD-05",
        below: 0.6,
      },
      reviewerRole: "domain-reviewer",
      contextPayload: [{ signalId: "TS-LD-05", include: "all" }],
    })

    const detector = new RoutingDetector([pattern])
    const output = detector.detect(
      makeObserverOutput([
        {
          id: "TS-LD-05",
          category: "legibility-decay",
          score: 0.42,
          output: { newTerms: ["ctxPayload"] },
          diagnostics: [
            {
              severity: "warn",
              message: "ctxPayload is not in the glossary",
              location: { file: "src/domain.ts", line: 8 },
            },
          ],
        },
      ]),
      makeDiff({ changedFiles: ["src/domain.ts"] }),
    )

    expect(output.triggers).toHaveLength(1)
    expect(output.triggers[0]?.reviewerRole).toBe("domain-reviewer")
    expect(output.triggers[0]?.sourceLocations).toEqual([
      { file: "src/domain.ts", line: 8 },
    ])
  })

  test("supports pattern stacking", () => {
    const detector = new RoutingDetector([
      Schema.decodeUnknownSync(RoutingPattern)({
        id: "auth-paths-touched",
        displayName: "Auth paths touched",
        triggerKind: "file-path",
        condition: { kind: "file-path", globs: ["**/auth/**"] },
        reviewerRole: "security-reviewer",
        contextPayload: [],
      }),
      Schema.decodeUnknownSync(RoutingPattern)({
        id: "crypto-import-added",
        displayName: "Crypto import added",
        triggerKind: "import-added",
        condition: { kind: "import-added", specifiers: ["crypto"] },
        reviewerRole: "security-reviewer",
        contextPayload: [],
      }),
    ])

    const output = detector.detect(
      makeObserverOutput(),
      makeDiff({
        changedFiles: ["src/auth/service.ts"],
        addedImports: [{ file: "src/auth/service.ts", specifier: "crypto", line: 1 }],
      }),
    )

    expect(output.triggers).toHaveLength(2)
    expect(output.triggers.map((trigger) => trigger.patternId).sort()).toEqual([
      "auth-paths-touched",
      "crypto-import-added",
    ])
  })

  test("custom routing patterns override shipped ids and add new ones", async () => {
    await mkdir(join(tmp, ".pulsar", "routing-patterns"), { recursive: true })
    await writeFile(
      join(tmp, ".pulsar", "routing-patterns", "custom.json"),
      `${JSON.stringify(
        [
          {
            id: "auth-paths-touched",
            displayName: "Auth paths touched override",
            triggerKind: "file-path",
            condition: { kind: "file-path", globs: ["**/auth/**"] },
            reviewerRole: "domain-reviewer",
            contextPayload: [],
          },
          {
            id: "model-files-touched",
            displayName: "Model files touched",
            triggerKind: "file-path",
            condition: { kind: "file-path", globs: ["**/models/**"] },
            reviewerRole: "data-model-reviewer",
            contextPayload: [],
          },
        ],
        null,
        2,
      )}\n`,
      "utf8",
    )

    const detector = await Effect.runPromise(RoutingDetector.load({ repoRoot: tmp }))
    const output = detector.detect(
      makeObserverOutput(),
      makeDiff({
        changedFiles: ["src/auth/service.ts", "src/models/user.ts"],
      }),
    )

    expect(output.triggers).toHaveLength(2)
    expect(output.triggers.find((trigger) => trigger.patternId === "auth-paths-touched"))
      .toMatchObject({ reviewerRole: "domain-reviewer" })
    expect(output.triggers.find((trigger) => trigger.patternId === "model-files-touched"))
      .toMatchObject({ reviewerRole: "data-model-reviewer" })
  })

  test("returns no triggers when nothing matches", () => {
    const detector = new RoutingDetector([
      Schema.decodeUnknownSync(RoutingPattern)({
        id: "migration-added",
        displayName: "Migration added",
        triggerKind: "file-path",
        condition: { kind: "file-path", globs: ["**/migrations/**"] },
        reviewerRole: "data-model-reviewer",
        contextPayload: [],
      }),
    ])

    const output = detector.detect(
      makeObserverOutput(),
      makeDiff({ changedFiles: ["src/app.ts"] }),
    )

    expect(output.triggers).toEqual([])
  })
})

const makeDiff = (partial: Partial<RoutingDiff>): RoutingDiff => ({
  changedFiles: partial.changedFiles ?? [],
  changedHunks: partial.changedHunks ?? [],
  addedFiles: partial.addedFiles ?? [],
  addedImports: partial.addedImports ?? [],
  astMatches: partial.astMatches ?? [],
  signalChanges: partial.signalChanges ?? {},
})

const makeObserverOutput = (signals: ReadonlyArray<MockSignal> = []): ObserverOutput => {
  const categories: ObserverOutput["categories"] = {
    "architectural-drift": emptyCategory(),
    "dependency-entropy": emptyCategory(),
    "abstraction-bloat": emptyCategory(),
    "legibility-decay": emptyCategory(),
    "generated-slop": emptyCategory(),
    "review-pain": emptyCategory(),
  }
  const signalResults = new Map<string, { score: number; output: unknown; diagnostics: ReadonlyArray<Diagnostic>; signalId: string }>()

  for (const signal of signals) {
    const entry = categories[signal.category]
    categories[signal.category] = {
      score: signal.score,
      signalCount: entry.signalCount + 1,
      activeSignalIds: [...entry.activeSignalIds, signal.id],
      signals: {
        ...entry.signals,
        [signal.id]: signal.score,
      },
    }
    signalResults.set(signal.id, {
      signalId: signal.id,
      score: signal.score,
      output: signal.output,
      diagnostics: signal.diagnostics ?? [],
    })
  }

  return {
    categories,
    minimum: undefined,
    weighted_mean: 1,
    hard_gate_status: "pass",
    hard_gate_violations: [],
    inactiveSignals: [],
    signalResults,
  }
}

const emptyCategory = () => ({
  score: 1,
  signals: {},
  signalCount: 0,
  activeSignalIds: [],
})
