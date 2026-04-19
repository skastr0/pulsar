import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  inferTasteVectorFromQuiz,
  loadQuizItems,
  selectNextQuizItem,
  summarizeQuizTradeoff,
  weightOf,
  type QuizItem,
} from "../index.js"

describe("pairwise quiz elicitation", () => {
  test("loads the shipped TypeScript item bank", async () => {
    const items = await Effect.runPromise(loadQuizItems("typescript"))
    expect(items.length).toBeGreaterThanOrEqual(50)
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })

  test("adaptive selection avoids already-answered items", () => {
    const items: ReadonlyArray<QuizItem> = [
      {
        id: "item-a",
        domain: "typescript",
        prompt: "Which style do you prefer?",
        a_title: "compact",
        b_title: "explicit",
        a_code: "a",
        b_code: "b",
        a_signals: { "TS-LD-06": 0.4 },
        b_signals: { "TS-LD-06": 1.4 },
      },
      {
        id: "item-b",
        domain: "typescript",
        prompt: "Which style do you prefer?",
        a_title: "speed",
        b_title: "seam",
        a_code: "a",
        b_code: "b",
        a_signals: { "TS-AD-01": 0.4 },
        b_signals: { "TS-AD-01": 1.4 },
      },
    ]

    const first = selectNextQuizItem({ items, responses: [] })
    expect(first).toBeDefined()
    const second = selectNextQuizItem({
      items,
      responses: [
        {
          item_id: first?.id ?? "item-a",
          answer: "a",
          answered_at: "2026-04-19T00:00:00.000Z",
        },
      ],
    })
    expect(second?.id).not.toBe(first?.id)
  })

  test("inference produces a provenance-backed vector delta", () => {
    const items: ReadonlyArray<QuizItem> = [
      {
        id: "annotations",
        domain: "typescript",
        prompt: "Which style do you prefer?",
        a_title: "compact",
        b_title: "annotated",
        a_code: "a",
        b_code: "b",
        a_signals: { "TS-LD-06": 0.3, "TS-RP-02": 1.2 },
        b_signals: { "TS-LD-06": 1.4, "TS-RP-02": 0.8 },
      },
      {
        id: "suppressions",
        domain: "typescript",
        prompt: "Which style do you prefer?",
        a_title: "ts-ignore",
        b_title: "typed narrowing",
        a_code: "a",
        b_code: "b",
        a_signals: { "TS-SL-03": 0.2 },
        b_signals: { "TS-SL-03": 1.5 },
      },
    ]

    const vector = inferTasteVectorFromQuiz({
      baseVector: undefined,
      items,
      responses: [
        { item_id: "annotations", answer: "b", answered_at: "2026-04-19T00:00:00.000Z" },
        { item_id: "suppressions", answer: "b", answered_at: "2026-04-19T00:01:00.000Z" },
      ],
      vectorId: "elicited-vector",
      outputPath: ".taste-codec/vector.json",
      recordedAt: "2026-04-19T00:02:00.000Z",
    })

    expect(weightOf("TS-LD-06", vector)).toBeGreaterThan(1)
    expect(weightOf("TS-SL-03", vector)).toBeGreaterThan(1)
    expect(vector.provenance?.[0]?.source).toBe("quiz")
  })

  test("tradeoff summaries stay explanatory instead of opaque", () => {
    const summary = summarizeQuizTradeoff({
      id: "summary",
      domain: "typescript",
      prompt: "Which style do you prefer?",
      a_title: "compact mapping",
      b_title: "typed mapping",
      a_code: "a",
      b_code: "b",
      a_signals: { "TS-LD-06": 0.4 },
      b_signals: { "TS-LD-06": 1.3 },
    })

    expect(summary).toContain("TS-LD-06")
    expect(summary).toContain("typed mapping")
  })
})
