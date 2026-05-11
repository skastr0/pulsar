import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import { generateReviewPlan, type ReviewPlan, type RoutingDiff, type RoutingOutput } from "@skastr0/pulsar-core/routing"
import type { PulsarVector } from "@skastr0/pulsar-core/vector"
import {
  afterToolExecute,
  createPulsarState,
} from "../src/server/pulsar-hooks"
import type { PulsarAnalysis } from "../src/server/pulsar-hook-types"

const repoRoot = resolve(import.meta.dir, "../../..")

describe("Pulsar diff-time hook", () => {
  test("surfaces structured annotations inline for this repo", async () => {
    const state = createPulsarState({
      inlineWaitMs: 1,
      analyzer: async ({ fingerprint, diff }) =>
        makeAnalysis({
          fingerprint,
          diff,
          annotation: {
            status: "ready",
            fingerprint,
            changedFiles: diff.changedFiles,
            newDiagnostics: [
              {
                signalId: "TS-LD-01",
                severity: "warn",
                message: "New function exceeds complexity threshold",
                file: diff.changedFiles[0],
                line: 12,
              },
            ],
            reviewRequests: [
              {
                reviewerRole: "security-reviewer",
                reason: "Auth paths touched",
                priority: "required",
                trigger: {
                  source: "structural-pattern",
                  detail: "Matched structural pattern auth-paths-touched",
                },
                context: [],
              },
            ],
          },
        }),
    })

    const output: { title: string; output: string; metadata: Record<string, unknown> } = {
      title: "edit",
      output: "Edited file",
      metadata: {},
    }
    await Effect.runPromise(
      afterToolExecute({
        input: {
          tool: "morph-mcp_edit_file",
          sessionID: "session-1",
          callID: "call-1",
          args: {
            path: resolve(repoRoot, "packages/core/src/routing.ts"),
            code_edit: 'import crypto from "crypto"\nexport function route() {}',
          },
        },
        output,
        worktree: repoRoot,
        state,
      }),
    )

    const metadata = output.metadata.pulsar as Record<string, unknown>
    expect(output.output).toContain("Pulsar")
    expect(output.output).toContain("security-reviewer")
    expect(metadata).toBeDefined()
  })

  test("threads changed-file hunks into diff-time analysis", async () => {
    let seenDiff: RoutingDiff | undefined
    const state = createPulsarState({
      inlineWaitMs: 1,
      analyzer: async ({ fingerprint, diff }) => {
        seenDiff = diff
        return makeAnalysis({
          fingerprint,
          diff,
          annotation: {
            status: "ready",
            fingerprint,
            changedFiles: diff.changedFiles,
          },
        })
      },
    })

    const output: { title: string; output: string; metadata: Record<string, unknown> } = {
      title: "edit",
      output: "Edited file",
      metadata: {},
    }
    const editedFile = resolve(repoRoot, "packages/core/src/routing.ts")
    const editedFileRelative = "packages/core/src/routing.ts"
    await Effect.runPromise(
      afterToolExecute({
        input: {
          tool: "morph-mcp_edit_file",
          sessionID: "session-hunks",
          callID: "call-hunks",
          args: {
            path: editedFile,
            code_edit: "export const routed = true",
          },
        },
        output,
        worktree: repoRoot,
        state,
      }),
    )

    expect(seenDiff?.changedHunks).toEqual([
      {
        file: editedFileRelative,
        oldStart: 1,
        oldLines: Number.MAX_SAFE_INTEGER,
        newStart: 1,
        newLines: Number.MAX_SAFE_INTEGER,
      },
    ])
  })

  test("is idempotent on the same fingerprint", async () => {
    let runs = 0
    const state = createPulsarState({
      inlineWaitMs: 1,
      analyzer: async ({ fingerprint, diff }) => {
        runs += 1
        return makeAnalysis({
          fingerprint,
          diff,
          annotation: {
            status: "ready",
            fingerprint,
            changedFiles: diff.changedFiles,
          },
        })
      },
    })

    const input = {
      tool: "morph-mcp_edit_file",
      sessionID: "session-1",
      callID: "call-1",
      args: {
        path: resolve(repoRoot, "apps/opencode-plugin/src/server.ts"),
        code_edit: "export const value = 1",
      },
    }

    const first: { title: string; output: string; metadata: Record<string, unknown> } = {
      title: "edit",
      output: "first",
      metadata: {},
    }
    await Effect.runPromise(
      afterToolExecute({ input, output: first, worktree: repoRoot, state }),
    )

    const second: { title: string; output: string; metadata: Record<string, unknown> } = {
      title: "edit",
      output: "second",
      metadata: {},
    }
    await Effect.runPromise(
      afterToolExecute({ input, output: second, worktree: repoRoot, state }),
    )

    expect(runs).toBe(1)
    expect(second.output).toBe("second")
  })

  test("surfaces pulsar failures as info and lets the edit proceed", async () => {
    const state = createPulsarState({
      inlineWaitMs: 1,
      analyzer: async () => {
        throw new Error("boom")
      },
    })

    const output: { title: string; output: string; metadata: Record<string, unknown> } = {
      title: "edit",
      output: "Edited file",
      metadata: {},
    }
    await Effect.runPromise(
      afterToolExecute({
        input: {
          tool: "morph-mcp_edit_file",
          sessionID: "session-err",
          callID: "call-err",
          args: {
            path: resolve(repoRoot, "apps/opencode-plugin/src/server.ts"),
            code_edit: 'import { thing } from "crypto"',
          },
        },
        output,
        worktree: repoRoot,
        state,
      }),
    )

    const metadata = output.metadata.pulsar as Record<string, unknown>
    expect(output.output).toContain("edit was preserved")
    expect(metadata.status).toBe("error")
  })

  test("forwards worktree vectors into diff-time analysis", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "pulsar-hook-vector-"))
    try {
      await mkdir(join(worktree, ".pulsar"), { recursive: true })
      await writeFile(
        join(worktree, ".pulsar/vector.json"),
        JSON.stringify(
          {
            id: "diff-vector",
            domain: "typescript",
            signal_overrides: { "TS-SL-01": { weight: 1.2 } },
            review_routing: {
              score_thresholds: {
                "consolidation-reviewer": 0.7,
              },
            },
          } satisfies PulsarVector,
          null,
          2,
        ),
      )

      let seenVector: PulsarVector | undefined
      const state = createPulsarState({
        inlineWaitMs: 1,
        analyzer: async ({ fingerprint, diff, vector }) => {
          seenVector = vector
          const observerOutput = makeObserverOutput({
            "generated-slop": {
              score: 0.65,
              signals: { "TS-SL-01": 0.65 },
              signalCount: 1,
              activeSignalIds: ["TS-SL-01"],
            },
          })
          const reviewPlan = generateReviewPlan(observerOutput, { triggers: [] }, vector, {
            generatedAt: "2026-04-19T10:00:00.000Z",
            sha: "abc123",
          })
          return makeAnalysis({
            fingerprint,
            diff,
            observerOutput,
            reviewPlan,
            annotation: {
              status: "ready",
              fingerprint,
              changedFiles: diff.changedFiles,
              reviewRequests: reviewPlan.reviewRequests,
            },
          })
        },
      })

      const output: { title: string; output: string; metadata: Record<string, unknown> } = {
        title: "edit",
        output: "Edited file",
        metadata: {},
      }
      await Effect.runPromise(
        afterToolExecute({
          input: {
            tool: "morph-mcp_edit_file",
            sessionID: "session-vector",
            callID: "call-vector",
            args: {
              path: join(worktree, "src/generated.ts"),
              code_edit: "export const generated = true",
            },
          },
          output,
          worktree,
          state,
        }),
      )

      const metadata = output.metadata.pulsar as Record<string, unknown>
      expect(seenVector?.id).toBe("diff-vector")
      expect(output.output).toContain("consolidation-reviewer")
      expect(metadata).toBeDefined()
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })

  test("uses vector thresholds to distinguish aligned and non-aligned diff-time scores", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "pulsar-hook-threshold-"))
    try {
      await mkdir(join(worktree, ".pulsar"), { recursive: true })
      await writeFile(
        join(worktree, ".pulsar/vector.json"),
        JSON.stringify(
          {
            id: "ai-slop-defense",
            domain: "typescript",
            signal_overrides: { "TS-SL-01": { weight: 1.7 } },
            review_routing: {
              score_thresholds: {
                "consolidation-reviewer": 0.82,
              },
            },
          } satisfies PulsarVector,
          null,
          2,
        ),
      )

      const state = createPulsarState({
        inlineWaitMs: 1,
        analyzer: async ({ fingerprint, diff, vector }) => {
          const generatedSlopScore = diff.changedFiles[0]?.includes("non-aligned") === true
            ? 0.74
            : 0.86
          const observerOutput = makeObserverOutput({
            "generated-slop": {
              score: generatedSlopScore,
              signals: { "TS-SL-01": generatedSlopScore },
              signalCount: 1,
              activeSignalIds: ["TS-SL-01"],
            },
          })
          const reviewPlan = generateReviewPlan(observerOutput, { triggers: [] }, vector, {
            generatedAt: "2026-04-19T10:00:00.000Z",
            sha: "abc123",
          })
          return makeAnalysis({
            fingerprint,
            diff,
            observerOutput,
            reviewPlan,
            annotation: {
              status: "ready",
              fingerprint,
              changedFiles: diff.changedFiles,
              reviewRequests: reviewPlan.reviewRequests,
            },
          })
        },
      })

      const alignedOutput: { title: string; output: string; metadata: Record<string, unknown> } = {
        title: "edit",
        output: "Edited aligned file",
        metadata: {},
      }
      await Effect.runPromise(
        afterToolExecute({
          input: {
            tool: "morph-mcp_edit_file",
            sessionID: "session-vector-threshold",
            callID: "call-aligned",
            args: {
              path: join(worktree, "src/aligned.ts"),
              code_edit: "export const smallAdapter = true",
            },
          },
          output: alignedOutput,
          worktree,
          state,
        }),
      )

      const alignedMetadata = alignedOutput.metadata.pulsar as PulsarAnalysis["annotation"]
      expect(alignedMetadata.reviewRequests).toEqual([])
      expect(alignedOutput.output).not.toContain("consolidation-reviewer")

      const nonAlignedOutput: { title: string; output: string; metadata: Record<string, unknown> } = {
        title: "edit",
        output: "Edited non-aligned file",
        metadata: {},
      }
      await Effect.runPromise(
        afterToolExecute({
          input: {
            tool: "morph-mcp_edit_file",
            sessionID: "session-vector-threshold",
            callID: "call-non-aligned",
            args: {
              path: join(worktree, "src/non-aligned.ts"),
              code_edit: "export const repeatedGeneratedShape = true",
            },
          },
          output: nonAlignedOutput,
          worktree,
          state,
        }),
      )

      const nonAlignedMetadata = nonAlignedOutput.metadata.pulsar as PulsarAnalysis["annotation"]
      expect(nonAlignedMetadata.reviewRequests).toHaveLength(1)
      expect(nonAlignedMetadata.reviewRequests?.[0]).toMatchObject({
        reviewerRole: "consolidation-reviewer",
        priority: "required",
        trigger: {
          source: "score-threshold",
          detail: "generated-slop scored 0.74 below threshold 0.82",
        },
      })
      expect(nonAlignedOutput.output).toContain("consolidation-reviewer")
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })
})

const makeAnalysis = (input: {
  readonly fingerprint: string
  readonly diff: RoutingDiff
  readonly observerOutput?: ObserverOutput
  readonly reviewPlan?: ReviewPlan
  readonly annotation: PulsarAnalysis["annotation"]
}): PulsarAnalysis => ({
  fingerprint: input.fingerprint,
  diff: input.diff,
  observerOutput: input.observerOutput ?? makeObserverOutput(),
  routingOutput: { triggers: [] } satisfies RoutingOutput,
  reviewPlan: input.reviewPlan ?? {
    planId: "review-plan-test",
    sha: "abc123",
    generatedAt: "2026-04-19T10:00:00.000Z",
    reviewRequests: [],
    hardGateBlocking: false,
  } satisfies ReviewPlan,
  annotation: input.annotation,
})

const makeObserverOutput = (
  categories?: Partial<ObserverOutput["categories"]>,
): ObserverOutput => ({
  categories: {
    "architectural-drift": categories?.["architectural-drift"] ?? emptyCategory(),
    "dependency-entropy": categories?.["dependency-entropy"] ?? emptyCategory(),
    "abstraction-bloat": categories?.["abstraction-bloat"] ?? emptyCategory(),
    "legibility-decay": categories?.["legibility-decay"] ?? emptyCategory(),
    "generated-slop": categories?.["generated-slop"] ?? emptyCategory(),
    "review-pain": categories?.["review-pain"] ?? emptyCategory(),
  },
  minimum: undefined,
  weighted_mean: 1,
  hard_gate_status: "pass",
  hard_gate_violations: [],
  inactiveSignals: [],
  signalResults: new Map(),
})

const emptyCategory = () => ({
  score: 1,
  signals: {},
  signalCount: 0,
  activeSignalIds: [],
})
