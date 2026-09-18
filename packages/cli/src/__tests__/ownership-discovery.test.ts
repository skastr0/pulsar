import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Effect, Layer } from "effect"
import { makeReferenceData, ReferenceDataTag, SignalContextTag } from "@skastr0/pulsar-core/signal"
import { TS_PACK_SIGNALS, TsAnalysisLayer } from "@skastr0/pulsar-ts-pack"
import {
  CLONE_OWNERSHIP_SIGNAL_ID,
  DEFAULT_OWNERSHIP_DISCOVER_LIMITS,
  OWNERSHIP_INVENTORY_PROPOSAL_SCHEMA,
  adoptableOwnershipGroup,
  proposeOwnershipInventory,
  type OwnershipDiscoverLimits,
} from "../ownership-discovery.js"
import { readSemanticSource, type SignalRunResultLike } from "../semantic-discovery.js"

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

const ALPHA = "packages/alpha/src/helper.ts"
const BETA = "packages/beta/src/copy.ts"
const GAMMA = "packages/gamma/src/other.ts"

const cloneBody = `export function sharedRule(value: number): number {
  if (value > 10) {
    return value * 3
  }
  if (value > 5) {
    return value * 2
  }
  return value
}
`

const fixtureRepo = (): string => {
  const root = mkdtempSync(join(tmpdir(), "pulsar-ownership-discovery-"))
  roots.push(root)
  write(root, "package.json", JSON.stringify({ name: "fixture-root", private: true, workspaces: ["packages/*"] }))
  write(root, "packages/alpha/package.json", JSON.stringify({ name: "@fixture/alpha" }))
  write(root, "packages/beta/package.json", JSON.stringify({ name: "@fixture/beta" }))
  write(root, "packages/gamma/package.json", JSON.stringify({ name: "@fixture/gamma" }))
  write(root, ALPHA, cloneBody)
  write(root, BETA, cloneBody)
  write(root, GAMMA, `export const wrap = (value: number): number => value + 1\n`)
  return root
}

type Member = { file: string; name: string; startLine: number; endLine: number }

const cloneGroup = (
  index: number,
  members: ReadonlyArray<Member>,
  tokenCount: number,
  kind = "exact",
  structuralHash = `hash-${kind}-${index}`,
) => ({
  groupId: `${kind}-${index}`,
  kind,
  tokenCount,
  members,
  structuralHash,
})

const LIMITS: OwnershipDiscoverLimits = {
  maxGroups: DEFAULT_OWNERSHIP_DISCOVER_LIMITS.maxGroups,
  maxSnippetLines: DEFAULT_OWNERSHIP_DISCOVER_LIMITS.maxSnippetLines,
  maxContextBytes: DEFAULT_OWNERSHIP_DISCOVER_LIMITS.maxContextBytes,
  maxContextFiles: DEFAULT_OWNERSHIP_DISCOVER_LIMITS.maxContextFiles,
}

const cloneSignal = (groups: ReadonlyArray<unknown>, diagnosticLimit = 2): SignalRunResultLike => ({
  signalId: CLONE_OWNERSHIP_SIGNAL_ID,
  score: 0.4,
  output: {
    groups,
    totalFunctionsAnalyzed: 40,
    scoreBudgetFunctions: 12,
    scopeMode: "whole-tree",
    diagnosticLimit,
  },
  diagnostics: Array.from({ length: diagnosticLimit }, () => ({ severity: "warn" })),
})

const membersAB = (): ReadonlyArray<Member> => [
  { file: ALPHA, name: "sharedRule", startLine: 1, endLine: 9 },
  { file: BETA, name: "sharedRule", startLine: 1, endLine: 9 },
]

const membersAC = (): ReadonlyArray<Member> => [
  { file: ALPHA, name: "sharedRule", startLine: 1, endLine: 9 },
  { file: GAMMA, name: "wrap", startLine: 1, endLine: 1 },
]

const TsSl01 = TS_PACK_SIGNALS.find((signal) => signal.id === CLONE_OWNERSHIP_SIGNAL_ID)

const runTsSl01 = async (repoRoot: string): Promise<unknown> => {
  if (TsSl01 === undefined) throw new Error("TS-SL-01 is not registered")
  return Effect.runPromise(
    TsSl01.compute(TsSl01.defaultConfig, new Map()).pipe(
      Effect.provide(Layer.mergeAll(
        TsAnalysisLayer(repoRoot),
        Layer.succeed(SignalContextTag, { gitSha: "TEST", worktreePath: repoRoot, changedHunks: [] }),
        Layer.succeed(ReferenceDataTag, makeReferenceData(new Map())),
      )),
    ) as Effect.Effect<unknown, unknown, never>,
  )
}

describe("proposeOwnershipInventory", () => {
  test("reads full output.groups past the diagnostic cap and never adopts policy", () => {
    const root = fixtureRepo()
    const groups: Array<unknown> = [cloneGroup(0, membersAB(), 40)]
    for (let index = 1; index < 12; index += 1) {
      groups.push(cloneGroup(index, [
        { file: index % 2 === 0 ? ALPHA : BETA, name: `synthetic${index}`, startLine: 1, endLine: 1 },
        { file: GAMMA, name: "wrap", startLine: 1, endLine: 1 },
      ], 80 - index))
    }
    const signal = cloneSignal(groups, 2)
    const proposal = proposeOwnershipInventory({ repoRoot: root, signalResults: [signal], limits: LIMITS })
    expect(proposal.schema).toBe(OWNERSHIP_INVENTORY_PROPOSAL_SCHEMA)
    expect(proposal.adopted).toBe(false)
    expect(proposal.policy_action).toBe("none")
    expect(proposal.origin).toBe("detector_proposed")
    expect(proposal.groups.length).toBeGreaterThan(2)
    expect(proposal.coverage.clone.diagnosticLimit).toBe(2)
    expect(proposal.coverage.clone.groupsAvailable).toBe(12)
    expect(proposal.coverage.clone.groupsBeyondDiagnosticLimit).toBe(10)
    expect((signal.diagnostics ?? []).length).toBe(2)
    expect(proposal.coverage.covers_all_domain_rules).toBe(false)
    expect(proposal.known_gaps.map((gap) => gap.id)).toEqual([
      "noncloned_shared_rules_not_inventoried",
      "detector_ids_are_not_saved_obligations",
    ])
    expect(proposal.groups.every((group) => group.origin === "detector_proposed")).toBe(true)
    expect(proposal.groups.every((group) => group.owner_paths.length === 0)).toBe(true)
    expect(proposal.groups.some((group) => group.caller_paths.includes(ALPHA) && group.caller_paths.includes(BETA))).toBe(true)
  })

  test("regenerated detector ids follow the current member set; saved inventory ids are a different reassessment path", () => {
    const root = fixtureRepo()
    const before = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([cloneGroup(0, membersAB(), 40)])],
      limits: LIMITS,
    })
    const afterExtraction = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([cloneGroup(0, [
        { file: ALPHA, name: "sharedRule", startLine: 1, endLine: 9 },
        { file: GAMMA, name: "wrap", startLine: 1, endLine: 1 },
      ], 40)])],
      limits: LIMITS,
    })
    expect(before.groups[0]?.id).not.toBe(afterExtraction.groups[0]?.id)
    expect(before.known_gaps.some((gap) => gap.id === "detector_ids_are_not_saved_obligations")).toBe(true)
    expect(before.groups[0]?.caller_paths).toEqual([ALPHA, BETA].sort())
  })

  test("keeps repo-relative ids and paths stable across checkouts", () => {
    const first = fixtureRepo()
    const second = fixtureRepo()
    const groups = [cloneGroup(0, membersAB(), 40), cloneGroup(1, membersAC(), 18)]
    const left = proposeOwnershipInventory({ repoRoot: first, signalResults: [cloneSignal(groups)], limits: LIMITS })
    const right = proposeOwnershipInventory({ repoRoot: second, signalResults: [cloneSignal(groups)], limits: LIMITS })
    expect(left.groups.map((group) => group.id)).toEqual(right.groups.map((group) => group.id))
    expect(left.groups.map((group) => group.caller_paths)).toEqual(right.groups.map((group) => group.caller_paths))
    expect(left.groups.every((group) => group.caller_paths.every((path) => !path.startsWith("/")))).toBe(true)
  })

  test("merges exact/structural identical member sets and leaves overlapping groups distinct", () => {
    const root = fixtureRepo()
    const identical = membersAB()
    const overlapping = membersAC()
    const proposal = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([
        cloneGroup(0, identical, 40, "exact", "hash-a"),
        cloneGroup(1, identical, 40, "structural", "hash-b"),
        cloneGroup(2, overlapping, 18, "exact", "hash-c"),
      ])],
      limits: LIMITS,
    })
    expect(proposal.groups.length).toBe(2)
    expect(proposal.coverage.identicalMemberSetsMerged).toBeGreaterThanOrEqual(1)
    expect(proposal.coverage.overlappingDistinctGroups).toBeGreaterThanOrEqual(1)
    const merged = proposal.groups.find((group) => group.caller_paths.includes(BETA))
    expect(merged?.detector.groupKind.includes("exact")).toBe(true)
    expect(merged?.detector.groupKind.includes("structural")).toBe(true)
    expect(merged?.id).not.toBe(proposal.groups.find((group) => group.caller_paths.includes(GAMMA))?.id)
  })

  test("exposes group merge limits instead of silently dropping the rest", () => {
    const root = fixtureRepo()
    const proposal = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([cloneGroup(0, membersAB(), 40), cloneGroup(1, membersAC(), 18)])],
      limits: { ...LIMITS, maxGroups: 1 },
    })
    expect(proposal.groups.length).toBe(1)
    expect(proposal.coverage.omittedCount).toBeGreaterThan(0)
    expect(proposal.coverage.complete).toBe(false)
    expect(proposal.coverage.limits.maxGroups).toBe(1)
    expect(proposal.coverage.declared_scope.include).toEqual([])
    expect(proposal.coverage.declared_scope.exclude).toEqual([])
  })

  test("records missing signal and incomplete context without writing policy", () => {
    const root = fixtureRepo()
    const missing = proposeOwnershipInventory({ repoRoot: root, signalResults: [], limits: LIMITS })
    expect(missing.groups).toEqual([])
    expect(missing.coverage.clone.present).toBe(false)
    expect(missing.coverage.complete).toBe(false)
    expect(missing.adopted).toBe(false)

    const malformed = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [{ signalId: CLONE_OWNERSHIP_SIGNAL_ID, score: 1, output: { notGroups: [] } }],
      limits: LIMITS,
    })
    expect(malformed.coverage.clone.malformed).toBe(true)
    expect(malformed.coverage.complete).toBe(false)

    const clipped = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([cloneGroup(0, membersAB(), 40)])],
      limits: { ...LIMITS, maxContextFiles: 1, maxContextBytes: 32, maxSnippetLines: 2 },
    })
    expect(clipped.coverage.complete).toBe(false)
    expect(clipped.coverage.context.clippedGroups + clipped.groups.reduce((count, group) => count + group.limitations.length, 0)).toBeGreaterThan(0)
    expect(clipped.policy_action).toBe("none")
  })

  test("declares include/exclude as the proposal scope and does not invent owners from imports", () => {
    const root = fixtureRepo()
    write(root, "packages/beta/src/copy.ts", `import { sharedRule as local } from "../../alpha/src/helper.ts"\n${cloneBody}`)
    const proposal = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([cloneGroup(0, membersAB(), 40)])],
      limits: { ...LIMITS, include: ["packages/alpha/**", "packages/beta/**"], exclude: ["packages/gamma/**"] },
    })
    expect(proposal.coverage.declared_scope.scoped).toBe(true)
    expect(proposal.coverage.declared_scope.include).toEqual(["packages/alpha/**", "packages/beta/**"])
    expect(proposal.coverage.coversWholeRepo).toBe(false)
    expect(proposal.groups[0]?.owner_paths).toEqual([])
    expect(proposal.groups[0]?.caller_paths).toEqual([ALPHA, BETA].sort())
    expect(proposal.groups[0]?.description).toContain("not confirmed callers")
    expect(proposal.groups[0]?.description).toContain("origin:\"declared\"")
    expect(proposal.groups[0]?.description).toContain("detector evidence, not policy")
    expect(adoptableOwnershipGroup(proposal.groups[0]!)).toEqual({
      id: proposal.groups[0]!.id,
      owner_paths: [],
      caller_paths: [ALPHA, BETA].sort(),
      context_paths: proposal.groups[0]!.context_paths,
      description: proposal.groups[0]!.description,
      origin: "declared",
    })
    expect("member_selectors" in adoptableOwnershipGroup(proposal.groups[0]!)).toBe(false)
    expect("detector" in adoptableOwnershipGroup(proposal.groups[0]!)).toBe(false)
    expect(proposal.known_gaps.some((gap) => gap.detail.includes("saved ownership.json group id"))).toBe(true)
  })

  test("empty clone groups and a capped source scan are incomplete, not a vacuous inventory", () => {
    const root = fixtureRepo()
    const empty = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([])],
      limits: LIMITS,
    })
    expect(empty.groups).toEqual([])
    expect(empty.coverage.clone.present).toBe(true)
    expect(empty.coverage.clone.groupsAvailable).toBe(0)
    expect(empty.coverage.complete).toBe(false)
    expect(empty.coverage.covers_all_domain_rules).toBe(false)

    write(root, ALPHA, `import "./a.js"\nimport "./b.js"\nimport "./c.js"\n${cloneBody}`)
    const capped = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([])],
      limits: { ...LIMITS, maxImportSpecifiersPerFile: 1 },
    })
    expect(capped.groups).toEqual([])
    expect(capped.coverage.sourceScan.importSpecifierCaps).toBeGreaterThan(0)
    expect(capped.coverage.complete).toBe(false)
    expect(capped.limitations.join(" ")).toContain("source_scan_import_list_capped_files=")
  })

  test("quarantines unsafe sources through existing discovery rules", () => {
    const root = fixtureRepo()
    const outside = mkdtempSync(join(tmpdir(), "pulsar-ownership-outside-"))
    roots.push(outside)
    writeFileSync(join(outside, "escaped.ts"), "export const escaped = (): number => 1\n")
    symlinkSync(join(outside, "escaped.ts"), join(root, "packages/alpha/src/linked.ts"))
    write(root, "packages/alpha/src/.env.ts", "export const secret = 1\n")
    const proposal = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [cloneSignal([
        cloneGroup(0, [
          { file: "packages/alpha/src/linked.ts", name: "linked", startLine: 1, endLine: 1 },
          { file: GAMMA, name: "wrap", startLine: 1, endLine: 1 },
        ], 10),
        cloneGroup(1, [
          { file: "packages/alpha/src/.env.ts", name: "secret", startLine: 1, endLine: 1 },
          { file: GAMMA, name: "wrap", startLine: 1, endLine: 1 },
        ], 10),
      ])],
      limits: LIMITS,
    })
    expect(proposal.coverage.rejected.map((entry) => entry.reason).sort()).toEqual(["secret_like_path", "symlink_escapes_repo"])
    expect(proposal.coverage.complete).toBe(false)
    expect(readSemanticSource(root, "packages/alpha/src/.env.ts", { maxSourceFileBytes: 512 * 1024 })).toMatchObject({
      ok: false,
      reason: "secret_like_path",
    })
    expect(readSemanticSource(root, ALPHA, { maxSourceFileBytes: 512 * 1024 }).ok).toBe(true)
  })

  test("live TS-SL-01 output yields a usable detector-proposed inventory", async () => {
    const root = mkdtempSync(join(tmpdir(), "pulsar-ownership-live-"))
    roots.push(root)
    write(root, "package.json", JSON.stringify({ name: "live-ownership", private: true }))
    write(root, "tsconfig.json", JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true },
      include: ["src/**/*.ts"],
    }))
    write(root, "src/left.ts", cloneBody)
    write(root, "src/right.ts", cloneBody)
    write(root, "src/unique.ts", "export const onlyHere = (value: number): number => value + 4\n")
    const output = await runTsSl01(root) as { groups: ReadonlyArray<{ members: ReadonlyArray<{ file: string }> }> }
    expect(output.groups.length).toBeGreaterThan(0)
    const proposal = proposeOwnershipInventory({
      repoRoot: root,
      signalResults: [{ signalId: CLONE_OWNERSHIP_SIGNAL_ID, score: 0.5, output }],
      limits: { ...LIMITS, include: ["src/**"] },
    })
    expect(proposal.groups.length).toBeGreaterThan(0)
    expect(proposal.groups[0]?.member_selectors.length).toBeGreaterThanOrEqual(2)
    expect(proposal.groups[0]?.caller_paths.some((path) => path.startsWith("src/"))).toBe(true)
    expect(proposal.groups[0]?.id.startsWith("own:")).toBe(true)
    expect(proposal.adopted).toBe(false)
    expect(proposal.coverage.declared_scope.include).toEqual(["src/**"])
    expect(proposal.coverage.covers_all_domain_rules).toBe(false)
  }, 30_000)
})
