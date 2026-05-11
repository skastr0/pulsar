import { describe, expect, test } from "bun:test"
import { appendPulsarAnnotation } from "../src/server/review-surfacing"
import type { PulsarAnnotation } from "../src/server/review-surfacing"

describe("review surfacing annotations", () => {
  test("renders pending annotations with default text", () => {
    const output = makeOutput()

    appendPulsarAnnotation(output, {
      status: "pending",
      changedFiles: [],
      fingerprint: "pending-fingerprint",
    })

    expect(output.output).toBe([
      "## Pulsar — after edit to current edit",
      "",
      "ℹ Background analysis queued",
    ].join("\n"))
    expect(output.metadata).toEqual({
      pulsar: {
        status: "pending",
        changedFiles: [],
        fingerprint: "pending-fingerprint",
      },
    })
  })

  test("renders error annotations without hiding the edit", () => {
    const output = makeOutput({ output: "Edited file", metadata: { existing: true } })

    appendPulsarAnnotation(output, {
      status: "error",
      changedFiles: ["src/file.ts"],
      fingerprint: "error-fingerprint",
      message: "boom",
    })

    expect(output.output).toBe([
      "Edited file",
      "",
      "## Pulsar — after edit to src/file.ts",
      "",
      "ℹ Pulsar analysis failed but the edit was preserved: boom",
    ].join("\n"))
    expect(output.metadata).toEqual({
      existing: true,
      pulsar: {
        status: "error",
        changedFiles: ["src/file.ts"],
        fingerprint: "error-fingerprint",
        message: "boom",
      },
    })
  })

  test("renders ready evidence with existing section limits", () => {
    const output = makeOutput()

    appendPulsarAnnotation(output, {
      status: "ready",
      changedFiles: ["src/file.ts", "src/other.ts"],
      fingerprint: "ready-fingerprint",
      scoreDeltas: [
        { category: "legibility-decay", previous: 0.9, current: 0.7 },
        { category: "review-pain", previous: 0.5, current: 0.8 },
        { category: "generated-slop", previous: 1, current: 0.6 },
      ],
      newDiagnostics: Array.from({ length: 6 }, (_, index) => ({
        signalId: `TS-LD-0${index}`,
        severity: "warn",
        message: `Diagnostic ${index}`,
        file: "src/file.ts",
        line: index + 1,
      })),
      reviewRequests: Array.from({ length: 5 }, (_, index) => ({
        reviewerRole: `reviewer-${index}`,
        reason: `Reason ${index}`,
        priority: index === 0 ? "required" : "informational",
        trigger: {
          source: "score-threshold",
          detail: `Trigger ${index}`,
        },
        context: [],
      })),
    })

    expect(output.output).toBe([
      "## Pulsar — after edit to src/file.ts, src/other.ts",
      "",
      "⚠ legibility-decay score 0.70 (was 0.90)",
      "ℹ review-pain score 0.80 (was 0.50)",
      "",
      "- [TS-LD-00] Diagnostic 0 (src/file.ts:1)",
      "- [TS-LD-01] Diagnostic 1 (src/file.ts:2)",
      "- [TS-LD-02] Diagnostic 2 (src/file.ts:3)",
      "- [TS-LD-03] Diagnostic 3 (src/file.ts:4)",
      "- [TS-LD-04] Diagnostic 4 (src/file.ts:5)",
      "",
      "Review recommendations:",
      "- required reviewer-0 — Trigger 0",
      "- informational reviewer-1 — Trigger 1",
      "- informational reviewer-2 — Trigger 2",
      "- informational reviewer-3 — Trigger 3",
    ].join("\n"))
  })

  test("renders ready annotations with no evidence", () => {
    const output = makeOutput()

    appendPulsarAnnotation(output, {
      status: "ready",
      changedFiles: ["src/file.ts"],
      fingerprint: "empty-fingerprint",
    })

    expect(output.output).toBe([
      "## Pulsar — after edit to src/file.ts",
      "",
      "ℹ No new pulsar evidence surfaced for the changed files.",
    ].join("\n"))
  })
})

const makeOutput = (
  input?: Partial<{ output: string; metadata: unknown }>,
): { output: string; metadata: unknown } => ({
  output: input?.output ?? "",
  metadata: input?.metadata ?? {},
})
