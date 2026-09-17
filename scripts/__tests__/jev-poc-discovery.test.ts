import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  collectSemanticCandidates,
  type DiscoveryLimits,
  type DiscoveryResult,
  type ExtentResolver,
  type SignalRunResultLike,
} from "../jev-poc/discovery.ts"

const CLONE_SIGNAL = "TS-SL-01-duplication"
const COMPLEXITY_SIGNAL = "TS-LD-01-cyclomatic-complexity"

const roots: Array<string> = []
afterAll(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

const write = (root: string, relative: string, content: string): void => {
  const target = join(root, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

const lineOfMarker = (root: string, relative: string, marker: string): number => {
  const lines = require("node:fs").readFileSync(join(root, relative), "utf8").split("\n")
  const index = lines.findIndex((line: string) => line.includes(marker))
  if (index < 0) throw new Error(`marker not found: ${marker}`)
  return index + 1
}

const HELPER = "packages/alpha/src/helper.ts"
const ALPHA_INDEX = "packages/alpha/src/index.ts"
const FORMAT = "packages/alpha/src/format.ts"
const BETA_INDEX = "packages/beta/src/index.ts"
const BETA_OTHER = "packages/beta/src/other.ts"

const HELPER_SOURCE = `export const alphaHelper = (input: number): number => {
  if (input > 10) {
    return input * 3
  }
  if (input > 5) {
    return input * 2
  }
  return input
}

export function secondHelper(label: string): string {
  return label.trim()
}
`

const ALPHA_INDEX_SOURCE = `import { alphaHelper } from "./helper.js"
import { formatRow } from "./format.js"

export const useAlpha = (values: number[]): number =>
  values.map((value) => alphaHelper(value)).reduce((left, right) => left + right, 0)

export const renderAlpha = (values: number[]): string => formatRow(values.map((value) => String(value)))
`

const FORMAT_SOURCE = `export const formatRow = (cells: ReadonlyArray<string>): string => cells.join(" | ")
`

const BETA_INDEX_SOURCE = `import { alphaHelper } from "@fixture/alpha/helper"
import { formatRow } from "@fixture/alpha"

export const betaTotal = (values: number[]): number => values.reduce((sum, value) => sum + alphaHelper(value), 0)

export const betaLabel = (values: string[]): string => formatRow(values)
`

const BETA_OTHER_SOURCE = `import { betaTotal } from "./index.js"

export const wrap = (values: number[]): number => betaTotal(values) + 1
`

/** A small asymmetric repository: two workspace packages, five source files, uneven sizes. */
const buildFixtureRepo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "jev-poc-discovery-"))
  roots.push(root)
  write(root, "package.json", JSON.stringify({ name: "fixture-root", private: true, workspaces: ["packages/*"] }))
  write(root, "packages/alpha/package.json", JSON.stringify({
    name: "@fixture/alpha",
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" }, "./helper": "./dist/helper.js" },
  }))
  write(root, "packages/beta/package.json", JSON.stringify({ name: "@fixture/beta", exports: { ".": "./dist/index.js" } }))
  write(root, HELPER, HELPER_SOURCE)
  write(root, ALPHA_INDEX, ALPHA_INDEX_SOURCE)
  write(root, FORMAT, FORMAT_SOURCE)
  write(root, BETA_INDEX, BETA_INDEX_SOURCE)
  write(root, BETA_OTHER, BETA_OTHER_SOURCE)
  return root
}

type Member = { file: string; name: string; startLine: number; endLine: number }

const cloneGroup = (index: number, members: ReadonlyArray<Member>, tokenCount: number, kind = "exact") => ({
  groupId: `${kind}-${index}`,
  kind,
  tokenCount,
  members,
  structuralHash: `hash-${kind}-${index}`,
})

const CLONE_DIAGNOSTIC_LIMIT = 2
/** Group entries in the signal output: 12 distinct groups plus one exact duplicate. */
const CLONE_GROUPS_IN_OUTPUT = 13
const CLONE_DISTINCT_GROUPS = 12

/**
 * Twelve clone groups while the signal's own diagnostic list holds two, so discovery from
 * `output.groups` and discovery from `diagnostics` cannot be confused.
 */
const cloneSignal = (root: string): SignalRunResultLike => {
  const alphaHelperLine = lineOfMarker(root, HELPER, "export const alphaHelper")
  const secondHelperLine = lineOfMarker(root, HELPER, "export function secondHelper")
  const useAlphaLine = lineOfMarker(root, ALPHA_INDEX, "export const useAlpha")
  const renderAlphaLine = lineOfMarker(root, ALPHA_INDEX, "export const renderAlpha")
  const betaTotalLine = lineOfMarker(root, BETA_INDEX, "export const betaTotal")
  const wrapLine = lineOfMarker(root, BETA_OTHER, "export const wrap")
  const groups: Array<unknown> = [
    cloneGroup(0, [
      { file: HELPER, name: "alphaHelper", startLine: alphaHelperLine, endLine: alphaHelperLine + 8 },
      { file: BETA_INDEX, name: "betaTotal", startLine: betaTotalLine, endLine: betaTotalLine },
      { file: BETA_OTHER, name: "wrap", startLine: wrapLine, endLine: wrapLine },
    ], 40),
    cloneGroup(1, [
      { file: ALPHA_INDEX, name: "useAlpha", startLine: useAlphaLine, endLine: useAlphaLine + 1 },
      { file: FORMAT, name: "formatRow", startLine: 1, endLine: 1 },
    ], 24),
    cloneGroup(2, [
      { file: HELPER, name: "secondHelper", startLine: secondHelperLine, endLine: secondHelperLine + 2 },
      { file: FORMAT, name: "formatRow", startLine: 1, endLine: 1 },
    ], 18),
  ]
  for (let index = 3; index < CLONE_DISTINCT_GROUPS; index += 1) {
    groups.push(cloneGroup(index, [
      { file: index % 2 === 0 ? BETA_INDEX : ALPHA_INDEX, name: `synthetic${index}`, startLine: 1, endLine: 1 },
      { file: BETA_OTHER, name: "wrap", startLine: wrapLine, endLine: wrapLine },
    ], 100 - index))
  }
  // A duplicate of group 0: same kind, hash and members, so it must collapse onto one candidate.
  groups.push(cloneGroup(0, [
    { file: HELPER, name: "alphaHelper", startLine: alphaHelperLine, endLine: alphaHelperLine + 8 },
    { file: BETA_INDEX, name: "betaTotal", startLine: betaTotalLine, endLine: betaTotalLine },
    { file: BETA_OTHER, name: "wrap", startLine: wrapLine, endLine: wrapLine },
  ], 40))
  void renderAlphaLine
  return {
    signalId: CLONE_SIGNAL,
    score: 0.62,
    output: {
      groups,
      totalFunctionsAnalyzed: 37,
      scoreBudgetFunctions: 12,
      scopeMode: "whole-tree",
      diagnosticLimit: CLONE_DIAGNOSTIC_LIMIT,
    },
    diagnostics: [{ severity: "warn" }, { severity: "warn" }],
  }
}

const COMPLEXITY_THRESHOLD = 3
const complexitySignal = (root: string): SignalRunResultLike => ({
  signalId: COMPLEXITY_SIGNAL,
  score: 0.8,
  output: {
    functions: [
      { file: HELPER, name: "alphaHelper", line: lineOfMarker(root, HELPER, "export const alphaHelper"), complexity: 4 },
      { file: HELPER, name: "secondHelper", line: lineOfMarker(root, HELPER, "export function secondHelper"), complexity: 1 },
      { file: ALPHA_INDEX, name: "useAlpha", line: lineOfMarker(root, ALPHA_INDEX, "export const useAlpha"), complexity: 1 },
      { file: BETA_INDEX, name: "betaTotal", line: lineOfMarker(root, BETA_INDEX, "export const betaTotal"), complexity: 1 },
      { file: BETA_OTHER, name: "wrap", line: lineOfMarker(root, BETA_OTHER, "export const wrap"), complexity: 2 },
    ],
    byFile: new Map(),
    calibrationDecisions: [],
    diagnosticLimit: 1,
    complexityThreshold: COMPLEXITY_THRESHOLD,
    overThresholdCount: 1,
    totalFunctions: 5,
    maxComplexity: 4,
    ratioPressure: 0.4,
    maxComplexityPressure: 0.25,
  },
  diagnostics: [{ severity: "warn" }],
})

const LIMITS: DiscoveryLimits = { maxCandidates: 64, maxSnippetLines: 40, maxContextBytes: 4_096 }

/** Exact extents without a parser, so extent behaviour is testable independently of tsgo. */
const fakeResolver = (extents: Readonly<Record<string, { startLine: number; endLine: number }>>): ExtentResolver => ({
  resolveFunctionExtent: (file, name, line) => extents[`${file}:${name}:${line}`] ?? null,
})

const candidatesOf = (result: DiscoveryResult, kind: string) => result.candidates.filter((candidate) => candidate.kind === kind)

/** Reports every function as the single line the signal gave, so extents are complete and exact. */
const lineResolver: ExtentResolver = {
  resolveFunctionExtent: (_file, _name, line) => ({ startLine: line, endLine: line }),
}

describe("collectSemanticCandidates: sources and completeness", () => {
  test("discovers clone groups beyond the signal's diagnostic top-N, from output.groups", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [cloneSignal(root)], LIMITS)
    const cloneCandidates = candidatesOf(result, "clone-group")

    // The signal reports 13 group entries; the duplicate collapses, leaving 12 candidates.
    expect(cloneCandidates.length).toBe(CLONE_DISTINCT_GROUPS)
    expect(result.coverage.baseline.cloneGroupsAvailable).toBe(CLONE_GROUPS_IN_OUTPUT)
    expect(result.coverage.baseline.signalDiagnosticLimit).toBe(CLONE_DIAGNOSTIC_LIMIT)
    expect(result.coverage.baseline.cloneGroupsBeyondSignalDiagnosticLimit).toBe(CLONE_GROUPS_IN_OUTPUT - CLONE_DIAGNOSTIC_LIMIT)
    // The signal's own diagnostics hold two entries; discovery reaches past them.
    expect((cloneSignal(root).diagnostics ?? []).length).toBe(CLONE_DIAGNOSTIC_LIMIT)
    expect(cloneCandidates.some((candidate) => candidate.provenance.outputPath === "output.groups[11]")).toBe(true)
    expect(result.coverage.signals.find((entry) => entry.signalId === CLONE_SIGNAL)?.candidatesSelected).toBe(CLONE_DISTINCT_GROUPS)
  })

  test("reports the exact omitted count while bounding the omitted list, and never claims completeness", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], {
      ...LIMITS, maxCandidates: 3, maxOmittedListed: 2,
    })
    expect(result.candidates.length).toBe(3)
    expect(result.coverage.selectedCandidates).toBe(3)
    expect(result.coverage.totalCandidates).toBe(CLONE_GROUPS_IN_OUTPUT + 5)
    expect(result.coverage.omittedCount).toBe(CLONE_GROUPS_IN_OUTPUT + 5 - 3 - 1)
    expect(result.coverage.duplicatesRemoved).toBe(1)
    expect(result.coverage.omitted.length).toBe(2)
    expect(result.coverage.omitted.map((entry) => entry.reason)).toEqual(["duplicate_candidate", "max_candidates"])
    expect(result.coverage.omittedCount).toBeGreaterThan(result.coverage.omitted.length)
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.limitations.join(" ")).toContain("candidates_omitted_by_maxCandidates=")
  })

  test("deduplicates repeated ids and records them as omitted duplicates", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [cloneSignal(root)], LIMITS)
    const ids = result.candidates.map((candidate) => candidate.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.coverage.omitted.filter((entry) => entry.reason === "duplicate_candidate").length).toBe(1)
    expect(result.coverage.duplicatesRemoved).toBe(1)
    // Deduplication alone is not a clip; this run is incomplete because the complexity signal is absent.
    expect(result.coverage.omittedCount).toBe(0)
    expect(result.coverage.limitations.join(" ")).toContain("required_signal_missing:")
  })

  test("is deterministic in ids and order, and stable under signal input order", () => {
    const root = buildFixtureRepo()
    const forward = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], LIMITS)
    const reversed = collectSemanticCandidates(root, [complexitySignal(root), cloneSignal(root)], LIMITS)
    expect(forward.candidates.map((candidate) => candidate.id)).toEqual(reversed.candidates.map((candidate) => candidate.id))
    const sorted = [...forward.candidates].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.primary.file.localeCompare(right.primary.file) ||
      left.primary.startLine - right.primary.startLine ||
      left.id.localeCompare(right.id),
    )
    expect(forward.candidates.map((candidate) => candidate.id)).toEqual(sorted.map((candidate) => candidate.id))
    for (const candidate of forward.candidates) {
      expect(candidate.id).toMatch(new RegExp(`^${candidate.kind}:${candidate.signalId}:[0-9a-f]{16}$`))
      expect(candidate.semanticStatus).toBe("not_assessed")
      expect(candidate.facts).not.toHaveProperty("verdict")
      expect(candidate.facts).not.toHaveProperty("isDuplicate")
    }
    expect(forward.candidates.map((candidate) => candidate.provenance.sourceRank).length).toBe(forward.candidates.length)
  })

  test("reports absent signals instead of inventing candidates", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [complexitySignal(root)], LIMITS)
    const clone = result.coverage.signals.find((entry) => entry.signalId === CLONE_SIGNAL)
    expect(clone?.present).toBe(false)
    expect(clone?.candidatesAvailable).toBe(0)
    expect(clone?.score).toBeNull()
    expect(result.coverage.baseline.cloneGroupsAvailable).toBeNull()
    expect(result.coverage.baseline.signalDiagnosticLimit).toBeNull()
    // An absent required signal is unknown inventory, never an empty clean repository.
    expect(clone?.malformed).toBe(false)
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.coversWholeRepo).toBe(false)
    expect(result.coverage.limitations.join(" ")).toContain("required_signal_missing:TS-SL-01-duplication")
  })

  test("a malformed required signal output is incomplete, not an empty inventory", () => {
    const root = buildFixtureRepo()
    const malformed: SignalRunResultLike = { signalId: CLONE_SIGNAL, score: 0.5, output: { groups: "not-an-array" } }
    const result = collectSemanticCandidates(root, [malformed, complexitySignal(root)], LIMITS, { extents: lineResolver })
    const clone = result.coverage.signals.find((entry) => entry.signalId === CLONE_SIGNAL)
    expect(clone?.present).toBe(true)
    expect(clone?.malformed).toBe(true)
    expect(clone?.candidatesAvailable).toBe(0)
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.limitations.join(" ")).toContain("required_signal_output_malformed:TS-SL-01-duplication")
    const notAnObject: SignalRunResultLike = { signalId: CLONE_SIGNAL, score: 0.5, output: "nope" }
    const second = collectSemanticCandidates(root, [notAnObject, complexitySignal(root)], LIMITS, { extents: lineResolver })
    expect(second.coverage.signals.find((entry) => entry.signalId === CLONE_SIGNAL)?.malformed).toBe(true)
    expect(second.coverage.complete).toBe(false)
  })

  test("includes low-complexity functions, not only the over-threshold ones", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [complexitySignal(root)], LIMITS)
    const functions = candidatesOf(result, "complexity-function")
    expect(functions.length).toBe(5)
    expect(functions.map((candidate) => candidate.facts["functionName"]).sort()).toEqual([
      "alphaHelper", "betaTotal", "secondHelper", "useAlpha", "wrap",
    ])
    expect(result.coverage.baseline.complexityOverThreshold).toBe(1)
    expect(result.coverage.baseline.complexityFunctionsAvailable).toBe(5)
    // A threshold-crossing function is not privileged in the output.
    expect(functions.some((candidate) => candidate.facts["complexity"] === 1)).toBe(true)
  })
})

describe("collectSemanticCandidates: extents", () => {
  test("asks the injected resolver for exactly the file, name and line the signal reported", () => {
    const root = buildFixtureRepo()
    const asked: Array<string> = []
    const resolver: ExtentResolver = {
      resolveFunctionExtent: (file, name, line) => {
        asked.push(`${file}:${name}:${line}`)
        return { startLine: line, endLine: line + 1 }
      },
    }
    const result = collectSemanticCandidates(root, [complexitySignal(root)], LIMITS, { extents: resolver })
    const expected = complexitySignal(root).output as { functions: Array<{ file: string; name: string; line: number }> }
    expect(asked.sort()).toEqual(expected.functions.map((fn) => `${fn.file}:${fn.name}:${fn.line}`).sort())
    expect(result.coverage.extents.requested).toBe(5)
    expect(result.coverage.extents.resolved).toBe(5)
    expect(result.coverage.extents.missing).toBe(0)
    expect(result.coverage.extents.resolver).toBe("injected")
    // Clone members carry parser-exact ranges from the signal, so they are never asked for.
    const withClones = collectSemanticCandidates(root, [cloneSignal(root)], LIMITS, { extents: resolver })
    expect(withClones.coverage.extents.requested).toBe(0)
    expect(withClones.coverage.extents.resolver).toBe("not_needed")
    expect(asked.length).toBe(5)
  })

  test("resolves a multi-line extent through the injected resolver and marks it complete", () => {
    const root = buildFixtureRepo()
    const line = lineOfMarker(root, HELPER, "export const alphaHelper")
    const result = collectSemanticCandidates(root, [complexitySignal(root)], LIMITS, {
      extents: fakeResolver({ [`${HELPER}:alphaHelper:${line}`]: { startLine: line, endLine: line + 8 } }),
    })
    const alphaHelper = candidatesOf(result, "complexity-function").find((candidate) => candidate.facts["functionName"] === "alphaHelper")!
    expect(alphaHelper.primary.extentSource).toBe("parser")
    expect(alphaHelper.primary.extentComplete).toBe(true)
    expect(alphaHelper.primary.snippet.split("\n").length).toBe(9)
  })

  test("marks the extent explicitly missing instead of presenting a guessed window", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [complexitySignal(root)], LIMITS, { extents: fakeResolver({}) })
    const functions = candidatesOf(result, "complexity-function")
    for (const candidate of functions) {
      expect(candidate.primary.extentSource).toBe("signal_line_only")
      expect(candidate.primary.extentComplete).toBe(false)
      // Only the reported line: no fabricated window that looks like the whole function.
      expect(candidate.primary.startLine).toBe(candidate.primary.endLine)
      expect(candidate.primary.snippetLines).toBe(1)
      expect(candidate.limitations.join(" ")).toContain("function_extent_missing:")
      expect(candidate.limitations.join(" ")).toContain("extent_incomplete_no_parser:")
    }
    expect(result.coverage.extents.resolver).toBe("injected")
    expect(result.coverage.extents.requested).toBe(5)
    expect(result.coverage.extents.missing).toBe(5)
    expect(result.coverage.extents.resolved).toBe(0)
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.limitations.join(" ")).toContain("function_extents_missing=5")
  })

  test("takes exact extents from an injected resolver and records the source as injected", () => {
    const root = buildFixtureRepo()
    const line = lineOfMarker(root, HELPER, "export const alphaHelper")
    const result = collectSemanticCandidates(root, [complexitySignal(root)], LIMITS, {
      extents: fakeResolver({ [`${HELPER}:alphaHelper:${line}`]: { startLine: line, endLine: line + 8 } }),
    })
    const alphaHelper = candidatesOf(result, "complexity-function").find((candidate) => candidate.facts["functionName"] === "alphaHelper")
    expect(alphaHelper!.primary.endLine - alphaHelper!.primary.startLine).toBe(8)
    expect(alphaHelper!.primary.extentComplete).toBe(true)
    expect(result.coverage.extents.resolver).toBe("injected")
    expect(result.coverage.extents.resolved).toBe(1)
    // Clone members already carry parser-exact ranges, so they are never asked for.
    const withClones = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], LIMITS, { extents: fakeResolver({}) })
    expect(candidatesOf(withClones, "clone-group").every((candidate) => candidate.primary.extentComplete)).toBe(true)
    expect(candidatesOf(withClones, "clone-group").every((candidate) => candidate.primary.extentSource === "parser")).toBe(true)
  })

  test("truncates extent resolution at maxExtentFiles and reports it", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, maxExtentFiles: 1 }, { extents: fakeResolver({}) })
    expect(result.coverage.extents.truncated).toBe(true)
    expect(result.coverage.limitations.join(" ")).toContain("extent_resolution_truncated_at_maxExtentFiles=1")
    expect(result.coverage.complete).toBe(false)
  })
})

describe("collectSemanticCandidates: safety", () => {
  test("rejects paths escaping the repository, symlink escapes, secret paths and non-source inputs", () => {
    const root = buildFixtureRepo()
    const outside = mkdtempSync(join(tmpdir(), "jev-poc-outside-"))
    roots.push(outside)
    writeFileSync(join(outside, "escaped.ts"), "export const escaped = (): number => 1\n")
    // A symlink inside the repository that resolves outside it.
    symlinkSync(join(outside, "escaped.ts"), join(root, "packages/alpha/src/linked.ts"))
    write(root, "packages/alpha/src/.env.ts", "export const secret = 1\n")
    write(root, "packages/alpha/src/keymaterial.ts", "-----BEGIN RSA PRIVATE KEY-----\nnot really\n")

    const clone = cloneSignal(root)
    const output = clone.output as { groups: Array<unknown> }
    const member = (file: string, name: string) => ({ file, name, startLine: 1, endLine: 1 })
    output.groups = [
      cloneGroup(0, [member("../../outside.ts", "escaped"), member(BETA_OTHER, "wrap")], 10),
      cloneGroup(1, [member("packages/alpha/src/linked.ts", "linked"), member(BETA_OTHER, "wrap")], 10),
      cloneGroup(2, [member("packages/alpha/src/.env.ts", "secret"), member(BETA_OTHER, "wrap")], 10),
      cloneGroup(3, [member("packages/alpha/src/keymaterial.ts", "keymaterial"), member(BETA_OTHER, "wrap")], 10),
      cloneGroup(4, [member("docs/notes.md", "notes"), member(BETA_OTHER, "wrap")], 10),
    ]
    const result = collectSemanticCandidates(root, [clone], LIMITS)
    const reasons = result.coverage.rejected.map((entry) => entry.reason).sort()
    expect(reasons).toEqual([
      "non_source_input",
      "path_escapes_repo",
      "secret_like_content",
      "secret_like_path",
      "symlink_escapes_repo",
    ])
    expect(result.coverage.rejected.every((entry) => entry.kind === "clone-group")).toBe(true)
    expect(result.candidates.length).toBe(0)
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.limitations.join(" ")).toContain("candidates_rejected_by_safety_rules=5")
  })

  test("drops a non-primary unsafe member but keeps the group, recording the drop", () => {
    const root = buildFixtureRepo()
    const clone = cloneSignal(root)
    const output = clone.output as { groups: Array<unknown> }
    output.groups = [
      cloneGroup(0, [
        { file: HELPER, name: "alphaHelper", startLine: 1, endLine: 9 },
        { file: "docs/notes.md", name: "notes", startLine: 1, endLine: 1 },
      ], 12),
      cloneGroup(1, [
        { file: "docs/notes.md", name: "notes", startLine: 1, endLine: 1 },
        { file: HELPER, name: "alphaHelper", startLine: 1, endLine: 9 },
      ], 12),
    ]
    const result = collectSemanticCandidates(root, [clone], LIMITS)
    // The first group keeps its safe member and says its member set is incomplete; the second
    // loses its primary and is rejected outright.
    expect(result.candidates.length).toBe(1)
    expect(result.candidates[0]!.primary.file).toBe(HELPER)
    expect(result.candidates[0]!.limitations.join(" ")).toContain("dropped_member:docs/notes.md:non_source_input")
    expect(result.candidates[0]!.limitations.join(" ")).toContain("member_set_incomplete:expected=2:admissible=1")
    expect(result.candidates[0]!.facts["memberCount"]).toBe(2)
    expect(result.candidates[0]!.facts["admissibleMemberCount"]).toBe(1)
    expect(result.coverage.rejected.map((entry) => entry.reason)).toEqual(["non_source_input"])
  })
})

describe("collectSemanticCandidates: repository-owned scope", () => {
  test("filters by include before maxCandidates, so scope never competes with the cap", () => {
    const root = buildFixtureRepo()
    const unscoped = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], LIMITS)
    const scoped = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], {
      ...LIMITS, maxCandidates: 2, include: [HELPER],
    })
    // Only two functions are in scope, so the cap removes nothing: scope is applied first.
    expect(scoped.coverage.scope.scoped).toBe(true)
    expect(scoped.coverage.omittedCount).toBe(0)
    expect(scoped.coverage.baseline.inScopeCloneGroups).toBe(0)
    expect(scoped.coverage.baseline.inScopeComplexityFunctions).toBe(2)
    expect(scoped.candidates.length).toBe(2)
    expect(scoped.candidates.every((candidate) => candidate.primary.file === HELPER)).toBe(true)
    expect(scoped.candidates.every((candidate) => candidate.members.every((member) => member.file === HELPER))).toBe(true)
    expect(scoped.coverage.baseline.inScopeCloneGroups + scoped.coverage.baseline.inScopeComplexityFunctions)
      .toBeLessThan(unscoped.coverage.baseline.inScopeCloneGroups + unscoped.coverage.baseline.inScopeComplexityFunctions)
  })

  test("excludes by glob, reports out-of-scope candidates, and never claims whole-repo coverage", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], {
      ...LIMITS, exclude: ["packages/beta/**", "**/*.md"],
    })
    expect(result.candidates.every((candidate) => !candidate.primary.file.startsWith("packages/beta/"))).toBe(true)
    expect(result.coverage.scope.outOfScopeCount).toBeGreaterThan(0)
    expect(result.coverage.scope.outOfScope.every((entry) => entry.reason === "outside_repository_scope")).toBe(true)
    expect(result.coverage.scope.inScopeCandidates).toBeGreaterThan(0)
    // The signal's own totals still describe the whole repository; the scoped counts are separate.
    expect(result.coverage.baseline.cloneGroupsAvailable).toBe(CLONE_GROUPS_IN_OUTPUT)
    expect(result.coverage.baseline.inScopeCloneGroups).toBeLessThan(result.coverage.baseline.cloneGroupsAvailable!)
    expect(result.coverage.scope.exclude).toEqual(["packages/beta/**", "**/*.md"])
    expect(result.coverage.coversWholeRepo).toBe(false)
  })

  test("prunes excluded paths from the context scan and keeps an unscoped run whole-repo clean", () => {
    const root = buildFixtureRepo()
    const scoped = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, exclude: ["packages/beta/**"] })
    const alphaHelper = candidatesOf(scoped, "complexity-function").find((candidate) => candidate.facts["functionName"] === "alphaHelper")!
    expect(alphaHelper.context.every((pointer) => !pointer.file.startsWith("packages/beta/"))).toBe(true)

    const whole = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], LIMITS, { extents: lineResolver })
    expect(whole.coverage.scope.scoped).toBe(false)
    expect(whole.coverage.scope.outOfScopeCount).toBe(0)
    expect(whole.coverage.complete).toBe(true)
    expect(whole.coverage.limitations).toEqual([])
    // Repeated references to the same module do not consume the context budget again.
    expect(whole.coverage.context.clippedCandidates).toBe(0)
    expect(whole.coverage.context.omittedPointers).toBe(0)
    expect(whole.coverage.coversWholeRepo).toBe(true)
    // Without a resolver the same run is honestly incomplete rather than whole-repo green.
    const unresolved = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], LIMITS)
    expect(unresolved.coverage.complete).toBe(false)
    expect(unresolved.coverage.coversWholeRepo).toBe(false)
  })

  test("treats a bare directory path as everything under it and rejects empty patterns", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, include: ["packages/alpha/src"] })
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.every((candidate) => candidate.primary.file.startsWith("packages/alpha/src/"))).toBe(true)
    expect(() => collectSemanticCandidates(root, [], { ...LIMITS, exclude: [""] })).toThrow(/exclude/)
  })
})

describe("collectSemanticCandidates: limits and context", () => {
  test("clips snippets at maxSnippetLines and marks them incomplete", () => {
    const root = buildFixtureRepo()
    const line = lineOfMarker(root, HELPER, "export const alphaHelper")
    const result = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, maxSnippetLines: 2 }, {
      extents: fakeResolver({ [`${HELPER}:alphaHelper:${line}`]: { startLine: line, endLine: line + 8 } }),
    })
    const alphaHelper = candidatesOf(result, "complexity-function").find((candidate) => candidate.facts["functionName"] === "alphaHelper")
    expect(alphaHelper!.primary.snippetLines).toBe(2)
    expect(alphaHelper!.primary.clipped).toBe(true)
    expect(alphaHelper!.primary.extentComplete).toBe(false)
    expect(alphaHelper!.primary.snippet.split("\n").length).toBe(2)
    expect(alphaHelper!.limitations.join(" ")).toContain("snippet_clipped:")
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.limitations.join(" ")).toContain("snippets_clipped_at_maxSnippetLines=2")
  })

  test("bounds context by maxContextBytes and maxContextFiles, recording the clip", () => {
    const root = buildFixtureRepo()
    const tight = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, maxContextBytes: 8 })
    const indexCandidate = candidatesOf(tight, "complexity-function").find((candidate) => candidate.facts["functionName"] === "useAlpha")
    expect(indexCandidate!.limitations.join(" ")).toContain("context_clipped_by_maxContextBytes")
    expect(indexCandidate!.context.every((pointer) => Buffer.byteLength(pointer.snippet, "utf8") <= 8)).toBe(true)

    const capped = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, maxContextFiles: 1 })
    const cappedCandidate = candidatesOf(capped, "complexity-function").find((candidate) => candidate.facts["functionName"] === "useAlpha")
    expect(cappedCandidate!.context.length).toBeLessThanOrEqual(1)
    expect(cappedCandidate!.limitations.join(" ")).toContain("context_clipped_by_maxContextFiles")
  })

  test("gathers import, consumer and same-file context automatically", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [complexitySignal(root)], LIMITS)
    const functions = candidatesOf(result, "complexity-function")

    const useAlpha = functions.find((candidate) => candidate.facts["functionName"] === "useAlpha")!
    const importPointers = useAlpha.context.filter((pointer) => pointer.role === "import")
    const importTargets = importPointers.map((pointer) => pointer.file).sort()
    expect(importTargets).toEqual([FORMAT, HELPER])
    // Context is a bounded read of the whole target module, never a one-line pointer, and the
    // reason names the importer's own line rather than inventing a line inside the target.
    const helperPointer = importPointers.find((pointer) => pointer.file === HELPER)!
    expect(helperPointer.extentSource).toBe("file_window")
    expect(helperPointer.startLine).toBe(1)
    expect(helperPointer.snippetLines).toBeGreaterThan(1)
    expect(helperPointer.clipped).toBe(false)
    expect(helperPointer.extentComplete).toBe(true)
    expect(helperPointer.snippet).toContain("export const alphaHelper")
    expect(helperPointer.reason).toContain(`declared at ${ALPHA_INDEX}:1`)
    for (const pointer of useAlpha.context) {
      expect(pointer.extentSource).toBe("file_window")
      expect(pointer.startLine).toBe(1)
      // A whole-module window ends at the file's last line, whatever the file's length.
      expect(pointer.endLine).toBe(pointer.snippetLines)
    }
    expect(importPointers.find((pointer) => pointer.file === FORMAT)!.snippetLines).toBe(1)
    // beta imports `@fixture/alpha`, which resolves to alpha's index, so it is a consumer of it.
    expect(useAlpha.context.filter((pointer) => pointer.role === "consumer").map((pointer) => pointer.file)).toEqual([BETA_INDEX])

    const alphaHelper = functions.find((candidate) => candidate.facts["functionName"] === "alphaHelper")!
    const consumers = alphaHelper.context.filter((pointer) => pointer.role === "consumer").map((pointer) => pointer.file).sort()
    expect(consumers).toEqual([ALPHA_INDEX, BETA_INDEX])
    expect(alphaHelper.context.find((pointer) => pointer.role === "consumer")!.reason).toContain("module-level consumer evidence")

    const sameFile = alphaHelper.context.filter((pointer) => pointer.role === "same-file")
    expect(sameFile.length).toBe(1)
    expect(sameFile[0]!.file).toBe(HELPER)
    expect(sameFile[0]!.reason).toContain("enclosing module")

    const wrap = functions.find((candidate) => candidate.facts["functionName"] === "wrap")!
    expect(wrap.context.filter((pointer) => pointer.role === "import").map((pointer) => pointer.file)).toEqual([BETA_INDEX])
  }, 120_000)

  test("reads enclosing declarations for every clone member without requiring sibling selection", () => {
    const root = buildFixtureRepo()
    write(root, "src/a.ts", "const allowed = new Set(['en', 'fr'])\nexport const accepts = (x: string) => allowed.has(x)\n")
    write(root, "src/b.ts", "const allowed = new Set(['image/png'])\nexport const accepts = (x: string) => allowed.has(x)\n")
    const signal = { signalId: CLONE_SIGNAL, score: 1, output: { groups: [cloneGroup(0, [
      { file: "src/a.ts", name: "accepts", startLine: 2, endLine: 2 },
      { file: "src/b.ts", name: "accepts", startLine: 2, endLine: 2 },
    ], 20)] } }
    const result = collectSemanticCandidates(root, [signal], { ...LIMITS, maxCandidates: 1 })
    const context = result.candidates[0]!.context
    expect(context.find((p) => p.file === "src/a.ts")!.snippet).toContain("'en', 'fr'")
    expect(context.find((p) => p.file === "src/b.ts")!.snippet).toContain("'image/png'")
    expect(context.every((p) => p.extentSource === "file_window")).toBe(true)
  })

  test("never claims completeness for a clean sample with a truncated source scan", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [cloneSignal(root)], { ...LIMITS, maxSourceFilesScanned: 1 })
    expect(result.coverage.sourceScan.truncated).toBe(true)
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.limitations.join(" ")).toContain("source_scan_truncated_at_maxSourceFilesScanned=1")
  })

  test("rejects invalid limits rather than silently defaulting", () => {
    const root = buildFixtureRepo()
    expect(() => collectSemanticCandidates(root, [], { ...LIMITS, maxCandidates: 0 })).toThrow(/maxCandidates/)
    expect(() => collectSemanticCandidates(root, [], { ...LIMITS, maxSnippetLines: -1 })).toThrow(/maxSnippetLines/)
    expect(() => collectSemanticCandidates(root, [], { ...LIMITS, maxContextBytes: Number.NaN })).toThrow(/maxContextBytes/)
  })
})

describe("collectSemanticCandidates: absolute signal paths and confinement", () => {
  const absoluteCloneSignal = (root: string): SignalRunResultLike => {
    const signal = cloneSignal(root)
    const output = signal.output as { groups: Array<{ members: Array<{ file: string }> }> }
    for (const group of output.groups) {
      for (const member of group.members) member.file = join(root, member.file)
    }
    return signal
  }
  const absoluteComplexitySignal = (root: string): SignalRunResultLike => {
    const signal = complexitySignal(root)
    const output = signal.output as { functions: Array<{ file: string }> }
    for (const fn of output.functions) fn.file = join(root, fn.file)
    return signal
  }

  test("normalizes absolute in-repo paths before ids, scope, extents and output", () => {
    const root = buildFixtureRepo()
    const relative = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], LIMITS, { extents: lineResolver })
    const asked: Array<string> = []
    const absolute = collectSemanticCandidates(root, [absoluteCloneSignal(root), absoluteComplexitySignal(root)], LIMITS, {
      extents: {
        resolveFunctionExtent: (file, name, line) => {
          asked.push(`${file}:${name}:${line}`)
          return { startLine: line, endLine: line }
        },
      },
    })
    // Same content, same ids, whether the signal reported relative or absolute paths.
    expect(absolute.candidates.map((candidate) => candidate.id)).toEqual(relative.candidates.map((candidate) => candidate.id))
    for (const candidate of absolute.candidates) {
      expect(candidate.primary.file.startsWith("/")).toBe(false)
      expect(candidate.primary.file).not.toContain(root)
      expect(candidate.primary.file).not.toContain("..")
      for (const member of candidate.members) expect(member.file.startsWith("/")).toBe(false)
      for (const pointer of candidate.context) expect(pointer.file.startsWith("/")).toBe(false)
    }
    expect(absolute.coverage.rejected).toEqual([])
    expect(absolute.coverage.complete).toBe(true)
    expect(absolute.coverage.duplicatesRemoved).toBe(1)
    expect(absolute.coverage.limitations).toEqual([])
    // The extent callback is asked with repo-relative paths, matching the parent's map keys.
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((entry) => !entry.startsWith("/"))).toBe(true)
    // Each (file, name, line) triple is asked once, even when two functions share a file.
    expect([...asked].sort()).toEqual([...new Set(asked)].sort())
  })

  test("keeps ids stable across two checkouts of the same content", () => {
    const first = buildFixtureRepo()
    const second = buildFixtureRepo()
    expect(first).not.toBe(second)
    const idsAt = (root: string) =>
      collectSemanticCandidates(root, [absoluteCloneSignal(root), absoluteComplexitySignal(root)], LIMITS, { extents: lineResolver })
        .candidates.map((candidate) => candidate.id)
    const left = idsAt(first)
    expect(left.length).toBeGreaterThan(0)
    expect(idsAt(second)).toEqual(left)
    // And the relative-path form agrees with both.
    expect(collectSemanticCandidates(first, [cloneSignal(first), complexitySignal(first)], LIMITS, { extents: lineResolver })
      .candidates.map((candidate) => candidate.id)).toEqual(left)
  })

  test("still rejects an absolute path outside the repository after normalization", () => {
    const root = buildFixtureRepo()
    const outside = mkdtempSync(join(tmpdir(), "jev-poc-abs-"))
    roots.push(outside)
    writeFileSync(join(outside, "elsewhere.ts"), "export const elsewhere = (): number => 1\n")
    const signal = cloneSignal(root)
    const output = signal.output as { groups: Array<unknown> }
    output.groups = [
      cloneGroup(0, [
        { file: join(outside, "elsewhere.ts"), name: "elsewhere", startLine: 1, endLine: 1 },
        { file: HELPER, name: "alphaHelper", startLine: 1, endLine: 9 },
      ], 10),
    ]
    const result = collectSemanticCandidates(root, [signal], LIMITS)
    expect(result.candidates.length).toBe(0)
    expect(result.coverage.rejected.map((entry) => entry.reason)).toEqual(["path_outside_repo_root"])
    expect(result.coverage.complete).toBe(false)
  })

  test("rejects a candidate reached through a symlinked parent directory", () => {
    const root = buildFixtureRepo()
    const outside = mkdtempSync(join(tmpdir(), "jev-poc-dirlink-"))
    roots.push(outside)
    writeFileSync(join(outside, "escaped.ts"), "export const escaped = (): number => 1\n")
    // The leaf is a regular file; only its parent directory escapes the repository.
    symlinkSync(outside, join(root, "packages/alpha/linked-dir"))
    const signal = cloneSignal(root)
    const output = signal.output as { groups: Array<unknown> }
    output.groups = [
      cloneGroup(0, [
        { file: "packages/alpha/linked-dir/escaped.ts", name: "escaped", startLine: 1, endLine: 1 },
        { file: HELPER, name: "alphaHelper", startLine: 1, endLine: 9 },
      ], 10),
    ]
    const result = collectSemanticCandidates(root, [signal], LIMITS)
    expect(result.candidates.length).toBe(0)
    expect(result.coverage.rejected.map((entry) => entry.reason)).toEqual(["parent_symlink_escapes_repo"])
  })

  test("skips disposable .pulsar state so materialized copies are not false consumers", () => {
    const root = buildFixtureRepo()
    // A copy of a real module inside disposable state that imports the candidate file.
    write(root, ".pulsar/cache/copy.ts", `import { alphaHelper } from "../../packages/alpha/src/helper.js"\nexport const copy = (): number => alphaHelper(1)\n`)
    write(root, ".pulsar/semantic-runs/snapshot.ts", `import { formatRow } from "../../packages/alpha/src/format.js"\nexport const snap = (): string => formatRow(["a"])\n`)
    const result = collectSemanticCandidates(root, [complexitySignal(root)], LIMITS, { extents: lineResolver })
    const alphaHelper = candidatesOf(result, "complexity-function").find((candidate) => candidate.facts["functionName"] === "alphaHelper")!
    expect(alphaHelper.context.every((pointer) => !pointer.file.startsWith(".pulsar/"))).toBe(true)
    expect(alphaHelper.context.filter((pointer) => pointer.role === "consumer").map((pointer) => pointer.file).sort()).toEqual([ALPHA_INDEX, BETA_INDEX])
    expect(result.coverage.sourceScan.filesSkipped).toBeGreaterThan(0)
  })
})

describe("collectSemanticCandidates: extent and scan completeness", () => {
  test("enforces maxExtentFiles instead of only reporting it", () => {
    const root = buildFixtureRepo()
    const asked: Array<string> = []
    const result = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, maxExtentFiles: 1 }, {
      extents: {
        resolveFunctionExtent: (file, _name, line) => {
          asked.push(file)
          return { startLine: line, endLine: line }
        },
      },
    })
    expect(result.coverage.extents.truncated).toBe(true)
    // Only the one opened file may reach the resolver.
    expect(new Set(asked).size).toBe(1)
    expect(result.coverage.extents.filesConsulted).toBe(1)
    const notOpened = result.candidates.filter((candidate) => candidate.limitations.some((entry) => entry.startsWith("extent_file_not_opened:")))
    expect(notOpened.length).toBeGreaterThan(0)
    expect(notOpened.every((candidate) => candidate.primary.extentSource === "signal_line_only")).toBe(true)
    expect(result.coverage.complete).toBe(false)
  })

  test("counts only complexity candidates in the extent totals", () => {
    const root = buildFixtureRepo()
    const clonesOnly = collectSemanticCandidates(root, [cloneSignal(root)], LIMITS, { extents: lineResolver })
    expect(clonesOnly.coverage.extents.requested).toBe(0)
    expect(clonesOnly.coverage.extents.resolved).toBe(0)
    expect(clonesOnly.coverage.extents.missing).toBe(0)
    expect(clonesOnly.coverage.extents.resolver).toBe("not_needed")
    expect(candidatesOf(clonesOnly, "clone-group").length).toBeGreaterThan(0)

    const both = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], LIMITS, { extents: lineResolver })
    expect(both.coverage.extents.requested).toBe(5)
    expect(both.coverage.extents.resolved).toBe(5)
    expect(both.coverage.extents.missing).toBe(0)
  })

  test("reports an out-of-file range instead of silently clamping it", () => {
    const root = buildFixtureRepo()
    const signal = cloneSignal(root)
    const output = signal.output as { groups: Array<unknown> }
    output.groups = [
      cloneGroup(0, [
        { file: HELPER, name: "alphaHelper", startLine: 1, endLine: 9 },
        { file: FORMAT, name: "formatRow", startLine: 1, endLine: 500 },
      ], 10),
    ]
    const result = collectSemanticCandidates(root, [signal], LIMITS)
    const candidate = result.candidates[0]!
    const beyond = candidate.members.find((member) => member.file === FORMAT)!
    expect(beyond.clipped).toBe(true)
    expect(beyond.extentComplete).toBe(false)
    expect(candidate.limitations.join(" ")).toContain(`extent_out_of_file:${FORMAT}:1-500`)
    expect(result.coverage.complete).toBe(false)
  })

  test("a size-capped or import-capped source scan is not silently complete", () => {
    const root = buildFixtureRepo()
    const sizeCapped = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, maxSourceFileBytes: 40 }, { extents: lineResolver })
    expect(sizeCapped.coverage.sourceScan.filesSizeCapped).toBeGreaterThan(0)
    expect(sizeCapped.coverage.complete).toBe(false)
    expect(sizeCapped.coverage.limitations.join(" ")).toContain("source_scan_size_capped_files=")

    const importCapped = collectSemanticCandidates(root, [complexitySignal(root)], { ...LIMITS, maxImportSpecifiersPerFile: 1 }, { extents: lineResolver })
    expect(importCapped.coverage.sourceScan.importSpecifierCaps).toBeGreaterThan(0)
    expect(importCapped.coverage.complete).toBe(false)
    expect(importCapped.coverage.limitations.join(" ")).toContain("source_scan_import_list_capped_files=")
  })

  test("reports how much context the caps actually dropped", () => {
    const root = buildFixtureRepo()
    const result = collectSemanticCandidates(root, [cloneSignal(root), complexitySignal(root)], { ...LIMITS, maxContextFiles: 1 }, { extents: lineResolver })
    const useAlpha = candidatesOf(result, "complexity-function").find((candidate) => candidate.facts["functionName"] === "useAlpha")!
    expect(useAlpha.context.length).toBe(1)
    expect(useAlpha.limitations.join(" ")).toMatch(/context_clipped_by_maxContextFiles:omitted=[1-9]/)
    // The omission is reported even when one collection alone would have fit the cap.
    expect(result.coverage.context.clippedCandidates).toBeGreaterThan(0)
    expect(result.coverage.context.omittedPointers).toBeGreaterThan(0)
    // Omitted contracts can change the judgment; a context cap cannot buy green.
    expect(result.coverage.complete).toBe(false)
  })

  test("empty or malformed inventories cannot produce a vacuous green sample", () => {
    const root = buildFixtureRepo()
    const empty = [
      { signalId: CLONE_SIGNAL, score: 1, output: { groups: [] } },
      { signalId: COMPLEXITY_SIGNAL, score: 1, output: { functions: [] } },
    ]
    expect(collectSemanticCandidates(root, empty, LIMITS).coverage.complete).toBe(false)
    const malformed = collectSemanticCandidates(root, [
      { ...empty[0]!, output: { groups: [{ members: [null, null] }] } },
      { ...empty[1]!, output: { functions: [null, { file: HELPER }] } },
    ], LIMITS)
    expect(malformed.coverage.signals.every((signal) => signal.malformed)).toBe(true)
    expect(malformed.coverage.complete).toBe(false)
  })
})
