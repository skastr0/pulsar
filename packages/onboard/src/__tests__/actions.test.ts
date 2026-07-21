import { describe, expect, test } from "bun:test"
import { actionForOption, validateChoiceAgainstCatalog } from "../actions.js"
import { buildPlan } from "../calibration.js"
import type { CatalogEntry, RepoDetection } from "../types.js"

const detection: RepoDetection = {
  languages: ["TypeScript"],
  frameworks: [],
  fileCount: 1,
  contributors: 1,
  visibility: "private",
  repoPath: "/repo",
}

const entry: CatalogEntry = {
  id: "TS-LD-02",
  title: "Function size",
  pack: "ts",
  category: "legibility-decay",
  measures: "size",
  whyItMatters: "review",
  evidence: "file-local",
  evidenceHint: "files",
  question: "What is true?",
  options: [
    {
      label: "Keep",
      summary: "Keep",
      calibrationKind: "keep-default",
      calibrationTarget: "human prose only",
      framing: "keep",
    },
    {
      label: "Set config",
      summary: "Set config",
      calibrationKind: "vector-config",
      calibrationTarget: "signal_overrides[\"TS-LD-02\"].config.a / config.b",
      framing: "sharpen",
    },
    {
      label: "Set weight",
      summary: "Set weight",
      calibrationKind: "vector-weight",
      calibrationTarget: "descriptive target without value",
      framing: "sharpen",
    },
    {
      label: "Activate",
      summary: "Activate",
      calibrationKind: "vector-active",
      calibrationTarget: "descriptive target",
      framing: "sharpen",
    },
    {
      label: "Conventions",
      summary: "Conventions",
      calibrationKind: "conventions",
      calibrationTarget: "conventions.json -> tags[]",
      framing: "sharpen",
    },
  ],
  defaultOptionIndex: 0,
}

describe("typed onboarding calibration actions", () => {
  test("captures numeric, boolean, array, and object JSON without parsing catalog prose", () => {
    expect(actionForOption(entry, 1, '{"key":"max_file_loc","value":420}')).toEqual({
      kind: "vector-config",
      key: "max_file_loc",
      value: 420,
    })
    expect(actionForOption(entry, 1, '{"key":"exclude_globs","value":["**/gen/**"]}')).toEqual({
      kind: "vector-config",
      key: "exclude_globs",
      value: ["**/gen/**"],
    })
    expect(actionForOption(entry, 1, '{"key":"policy","value":{"strict":true}}')).toEqual({
      kind: "vector-config",
      key: "policy",
      value: { strict: true },
    })
    expect(actionForOption(entry, 2, "1.25")).toEqual({ kind: "vector-weight", value: 1.25 })
    expect(actionForOption(entry, 3, "false")).toEqual({ kind: "vector-active", value: false })
  })

  test("keep is explicit and unsupported conventions stay visible", () => {
    expect(actionForOption(entry, 0)).toEqual({ kind: "keep-default" })
    expect(actionForOption(entry, 4)).toEqual({
      kind: "unsupported",
      reason: "conventions calibration requires a typed conventions action",
    })
  })

  test("requires exact catalog ids, option indexes, and action kinds", () => {
    expect(() =>
      validateChoiceAgainstCatalog(
        { signalId: "TS-LD-02-function-size-distribution", optionIndex: 0, action: { kind: "keep-default" } },
        [entry],
      ),
    ).toThrow("Unknown exact catalog signal id")
    expect(() =>
      validateChoiceAgainstCatalog(
        { signalId: "TS-LD-02", optionIndex: 20, action: { kind: "keep-default" } },
        [entry],
      ),
    ).toThrow("Unknown option")
    expect(() =>
      validateChoiceAgainstCatalog(
        { signalId: "TS-LD-02", optionIndex: 1, action: { kind: "keep-default" } },
        [entry],
      ),
    ).toThrow("does not match")
  })

  test("baseline acceptance is single-source and plans are deterministic", () => {
    expect(() =>
      buildPlan({
        choices: [{ signalId: "TS-SEC-03", optionIndex: 2, action: { kind: "baseline-accept" } }],
        enabledPacks: [],
        baseline: "reject",
        seed: {},
        detection,
      }),
    ).toThrow("requires plan baseline=accept")

    const plan = buildPlan({
      choices: [
        { signalId: "TS-ZZ-02", optionIndex: 0, action: { kind: "keep-default" } },
        { signalId: "TS-AA-01", optionIndex: 1, action: { kind: "vector-weight", value: 1.1 } },
      ],
      enabledPacks: ["nextjs", "effect", "nextjs"],
      baseline: "not-provided",
      seed: { team: "small", shape: "app" },
      detection,
    })
    expect(plan.choices.map((choice) => choice.signalId)).toEqual(["TS-AA-01", "TS-ZZ-02"])
    expect(plan.enabledPacks).toEqual(["effect", "nextjs"])
    expect(Object.keys(plan.seed)).toEqual(["shape", "team"])
  })
})
