import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { createTempRepo } from "../../packages/ts-pack/src/__tests__/test-repo.ts"
import { boundContext, quartzContext, type QuartzContext } from "../jev-poc/quartz-context.ts"
import type { SourcePointer } from "../jev-poc/discovery.ts"
import { sha256, type Request } from "../jev-spike/model.ts"
import { contextConsumption, contextRequest, externalSignature } from "../jev-quartz-context.ts"

const pointer = (root: string): SourcePointer => ({ file: "src/rule.ts", startLine: 2, endLine: 2,
  extentSource: "parser", extentComplete: true, fileSha256: sha256(readFileSync(join(root, "src/rule.ts"), "utf8")),
  snippet: "", snippetLines: 1, snippetSha256: sha256(""), clipped: false,
})

test.each(["function", "arrow"])("Quartz follows %s references through aliases, not same-name decoys", async kind => {
  const repo = await createTempRepo("quartz-context-")
  try {
    await repo.write("src/rule.ts", `const ceiling = 17\n${kind === "function" ? "export function normalize(value: number) { return Math.min(ceiling, value) }" : "export const normalize = (value: number) => Math.min(ceiling, value)"}\n`)
    await repo.write("src/caller.ts", "import { normalize as bound } from './rule.js'\nexport function consume(value: number) { return bound(value) + 3 + policy.offset }\nconst policy = { offset: 11 }\n")
    await repo.write("src/decoy.ts", "function normalize(value: string) { return value.trim() }\nexport const unrelated = normalize('x')\n")
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: repo.root }).exitCode).toBe(0)
    expect(Bun.spawnSync(["git", "add", "."], { cwd: repo.root }).exitCode).toBe(0)
    const result = await Effect.runPromise(quartzContext(repo.root, [pointer(repo.root)]))
    expect(result.roots).toHaveLength(1)
    const callers = result.edges.filter(e => e.kind === "reference")
    expect(callers.some(e => e.file === "src/caller.ts" && e.line === 2)).toBe(true)
    expect(callers.some(e => e.file === "src/decoy.ts")).toBe(false)
    expect(result.declarations.some(d => d.name === "ceiling" && d.source === "ceiling = 17")).toBe(true)
    expect(result.declarations.some(d => d.file === "src/caller.ts" && d.source.includes("+ 3"))).toBe(true)
    expect(result.declarations.some(d => d.name === "policy" && d.source.includes("offset: 11"))).toBe(true)
    expect(result.externalContracts.some(d => d.name === "min" && d.source.includes("min("))).toBe(true)
    expect(result.inventory.some(f => f.file === "src/decoy.ts")).toBe(true)
    expect(result.complete).toBe(false)
    expect(result.limitations).toContain("one_hop_dependencies_only; transitive behavior and dynamic dispatch are not established")
    const changed = { ...pointer(repo.root), fileSha256: "not-the-current-file" }
    await expect(Effect.runPromise(quartzContext(repo.root, [changed]))).rejects.toMatchObject({ operation: expect.stringContaining("Source drift") })
  } finally { await repo.cleanup() }
}, 30_000)

test("a byte cap never silently truncates a declaration or keeps an incomplete graph", () => {
  const context: QuartzContext = { version: "quartz-context-spike-v1", inventory: [], roots: ["r"],
    declarations: [{ id: "r", file: "a.ts", startLine: 1, endLine: 2, name: "r", kind: "function", source: "x".repeat(1_000), fileSha256: "hash" }],
    edges: [], externalContracts: [], limitations: [], complete: true, scope: "test",
  }
  expect(boundContext(context, 10_000)).toEqual(context)
  const bounded = boundContext(context, 200)
  expect(bounded.complete).toBe(false)
  expect(bounded.declarations).toEqual([])
  expect(bounded.limitations).toContain("packet_exceeds_byte_budget:200")
})

test("the treatment preserves questions, rule, bodies and non-context limitations", () => {
  const request: Request = { model: "test", state: { evidence: { members: ["body"], context: ["old window"], limitations: ["context_clipped", "function_extent_missing"] }, repository_rule: "same rule", prior_judgments: { relationship: "same hypothesis" } }, questions: { readiness: { type: "choice", instructions: "same question", criteria: { yes: "yes", no: "no" } } } }
  const graph: QuartzContext = { version: "quartz-context-spike-v1", inventory: [], roots: [], declarations: [], edges: [], externalContracts: [], limitations: ["not complete"], complete: false, scope: "test" }
  expect(contextRequest(request, "file-windows", graph)).toEqual(request)
  const treatment = contextRequest(request, "quartz-neighborhood", graph)
  expect(treatment.questions).toEqual(request.questions)
  expect(treatment.state.repository_rule).toEqual(request.state.repository_rule)
  expect(treatment.state.prior_judgments).toEqual(request.state.prior_judgments)
  expect(treatment.state.evidence).toEqual({ members: ["body"], context: [], limitations: ["function_extent_missing"] })
  expect(() => contextRequest(request, "quartz-neighborhood", { ...graph, roots: ["missing"] })).toThrow("Dangling")
})

test("a confident violation cannot override incomplete compiler evidence", () => {
  const finding = { candidateId: "a", ruleId: "b", penaltyPoints: 20, verdict: "violated" as const, relationship: "shared_rule", refinement: "independent_owners", direction: "consolidate_rule", reason: "policy_judgment" }
  expect(contextConsumption(true, finding)).toEqual(finding)
  expect(contextConsumption(false, finding)).toMatchObject({ verdict: "unknown", direction: null, reason: "context_coverage_incomplete" })
})

test("external documentation compaction preserves declaration tokens and string literals", () => {
  expect(externalSignature('interface X { /** docs */ literal: "/** keep */"; fn(x: number): string }')).toBe('interface X {   literal: "/** keep */"; fn(x: number): string }')
  const template = 'type T = `prefix${"/** keep */"}`'
  expect(externalSignature(template)).toBe(template)
})
