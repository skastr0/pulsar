import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { Effect } from "effect"
import type { ObserverOutput, ReviewPlan, RoutingDiff, RoutingOutput } from "@taste-codec/core"
import {
  afterToolExecute,
  createTasteCodecState,
  type TasteCodecAnalysis,
} from "../src/server/taste-codec-hooks"

const repoRoot = resolve(import.meta.dir, "../../..")

describe("Taste Codec diff-time hook", () => {
  test("surfaces structured annotations inline for this repo", async () => {
    const state = createTasteCodecState({
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
            path: resolve(repoRoot, "packages/codec-core/src/routing.ts"),
            code_edit: 'import crypto from "crypto"\nexport function route() {}',
          },
        },
        output,
        worktree: repoRoot,
        state,
      }),
    )

    const metadata = output.metadata.tasteCodec as Record<string, unknown>
    expect(output.output).toContain("Taste Codec")
    expect(output.output).toContain("security-reviewer")
    expect(metadata).toBeDefined()
  })

  test("is idempotent on the same fingerprint", async () => {
    let runs = 0
    const state = createTasteCodecState({
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

  test("surfaces codec failures as info and lets the edit proceed", async () => {
    const state = createTasteCodecState({
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

    const metadata = output.metadata.tasteCodec as Record<string, unknown>
    expect(output.output).toContain("edit was preserved")
    expect(metadata.status).toBe("error")
  })
})

const makeAnalysis = (input: {
  readonly fingerprint: string
  readonly diff: RoutingDiff
  readonly annotation: TasteCodecAnalysis["annotation"]
}): TasteCodecAnalysis => ({
  fingerprint: input.fingerprint,
  diff: input.diff,
  observerOutput: makeObserverOutput(),
  routingOutput: { triggers: [] } satisfies RoutingOutput,
  reviewPlan: {
    planId: "review-plan-test",
    sha: "abc123",
    generatedAt: "2026-04-19T10:00:00.000Z",
    reviewRequests: [],
    hardGateBlocking: false,
  } satisfies ReviewPlan,
  annotation: input.annotation,
})

const makeObserverOutput = (): ObserverOutput => ({
  categories: {
    "architectural-drift": emptyCategory(),
    "dependency-entropy": emptyCategory(),
    "abstraction-bloat": emptyCategory(),
    "legibility-decay": emptyCategory(),
    "generated-slop": emptyCategory(),
    "review-pain": emptyCategory(),
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
