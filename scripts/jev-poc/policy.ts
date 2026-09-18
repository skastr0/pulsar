import { readFileSync, realpathSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Data, Effect, Schema } from "effect"
import { collectProjectModuleSourceFiles } from "../../packages/project-module-sdk/src/loader-source-files.ts"
import { hashProjectModuleSource, materializeProjectModuleImportTarget } from "../../packages/project-module-sdk/src/loader-materialize.ts"
import { canonical, sha256 } from "../jev-spike/model.ts"
import type { SemanticCandidate } from "../../packages/cli/src/semantic-discovery.ts"

const integer = (minimum: number, maximum: number) => Schema.Int.check(Schema.isBetween({ minimum, maximum }))
const probability = Schema.Finite.check(Schema.isBetween({ minimum: 0.5, maximum: 1 }))
export const Rule = Schema.Struct({
  id: Schema.NonEmptyString,
  appliesTo: Schema.Array(Schema.Literals(["clone-group", "complexity-function"])),
  criterion: Schema.NonEmptyString,
  penaltyPoints: Schema.Finite.check(Schema.isBetween({ minimum: 0.1, maximum: 100 })),
})
export type Rule = typeof Rule.Type
export const Policy = Schema.Struct({
  schema: Schema.Literal("pulsar.semantic-policy.v1alpha1"),
  id: Schema.NonEmptyString,
  include: Schema.Array(Schema.NonEmptyString),
  exclude: Schema.Array(Schema.NonEmptyString),
  rules: Schema.Array(Rule),
  greenAt: integer(1, 100),
  redBelow: integer(0, 99),
  minProbability: probability,
  minMargin: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  budgets: Schema.Struct({
    maxCandidates: integer(1, 1000),
    maxCalls: integer(1, 4000),
    maxSnippetLines: integer(5, 2000),
    maxContextBytes: integer(1000, 100000),
  }),
})
export type Policy = typeof Policy.Type
/** Project-owned executable calibration, not a closed rule DSL or a personal fallback. */
export interface SemanticPolicyModule extends Policy {
  readonly selectRules?: (candidate: SemanticCandidate) => ReadonlyArray<string>
}
export class SemanticError extends Data.TaggedError("SemanticError")<{
  readonly operation: string
}> {}

export function decodePolicy(value: unknown): Policy {
  const policy = Schema.decodeUnknownSync(Policy, { onExcessProperty: "error" })(value)
  if (!policy.include.length || !policy.rules.length || policy.redBelow >= policy.greenAt) {
    throw new Error("Policy requires scope, rules and redBelow < greenAt")
  }
  if (new Set(policy.rules.map((rule) => rule.id)).size !== policy.rules.length) throw new Error("Duplicate rule IDs")
  for (const rule of policy.rules) if (!rule.appliesTo.length) throw new Error(`Rule ${rule.id} has no candidate kinds`)
  return policy
}

export const POLICY_PATH = ".pulsar/modules/semantic-policy.ts"
export const loadSemanticPolicy = Effect.fn("Semantic.loadPolicy")(function* (repoRoot: string, trusted: boolean) {
  if (!trusted) return yield* Effect.fail(new SemanticError({ operation: "--trust-project-code is required for the repo-owned semantic module" }))
  const target = yield* Effect.try({
    try: () => {
      const path = realpathSync(join(repoRoot, POLICY_PATH))
      const rel = relative(realpathSync(repoRoot), path)
      if (rel.startsWith("..") || resolve(repoRoot, rel) !== path) throw new Error("Policy escapes repository")
      return path
    },
    catch: () => new SemanticError({ operation: `Read repo-owned ${POLICY_PATH}; no semantic default or personal fallback is assumed` }),
  })
  const ref = { id: "semantic-policy", kind: "repo-local" as const, path: POLICY_PATH, enabled: true }
  const files = yield* collectProjectModuleSourceFiles(ref, target, repoRoot, (path) => relative(repoRoot, path))
  const sourceHash = yield* hashProjectModuleSource(ref, target, files)
  const importTarget = yield* materializeProjectModuleImportTarget(
    ref, target, repoRoot, repoRoot, repoRoot, sourceHash, files, ["semantic-policy"], true,
  )
  if ((yield* hashProjectModuleSource(ref, target, files)) !== sourceHash) {
    return yield* Effect.fail(new SemanticError({ operation: "Policy source changed while loading" }))
  }
  const loaded = yield* Effect.tryPromise({
    try: () => import(pathToFileURL(importTarget).href) as Promise<{ default: SemanticPolicyModule }>,
    catch: () => new SemanticError({ operation: "Load trusted semantic policy module" }),
  })
  const module = loaded.default
  const policy = yield* Effect.try({
    try: () => {
      const { selectRules: _, ...data } = module
      if (module.selectRules !== undefined && typeof module.selectRules !== "function") throw new Error("Invalid selector")
      return decodePolicy(data)
    },
    catch: () => new SemanticError({ operation: "Validate semantic policy; inspect schema, scope, rules and budgets" }),
  })
  const sourceFiles = yield* Effect.try({
    try: () => files.map((file) => ({ file: relative(repoRoot, file.path), hash: sha256(readFileSync(file.path, "utf8")) })),
    catch: () => new SemanticError({ operation: "Fingerprint semantic policy dependencies" }),
  })
  return {
    policy,
    sourceHash,
    fingerprint: sha256(canonical({ sourceHash, policy })),
    selectRules: (candidate: SemanticCandidate): ReadonlyArray<Rule> => {
      const applicable = policy.rules.filter((rule) => rule.appliesTo.includes(candidate.kind))
      if (!module.selectRules) return applicable
      const selected = module.selectRules(candidate)
      if (canonical(selected) !== canonical(module.selectRules(candidate))) throw new Error("Non-deterministic rule selector")
      if (new Set(selected).size !== selected.length || selected.some((id) => !applicable.some((rule) => rule.id === id))) {
        throw new Error("Selector returned duplicate, unknown or inapplicable rules")
      }
      return applicable.filter((rule) => selected.includes(rule.id))
    },
    verifySource: () => sourceFiles.every((file) => sha256(readFileSync(join(repoRoot, file.file), "utf8")) === file.hash),
    // Capture every owned static dependency, rather than just the policy entry point.
    sourceFiles,
  }
})
