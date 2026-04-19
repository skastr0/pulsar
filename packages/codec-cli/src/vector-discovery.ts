import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  validateVectorAgainstRegistry,
  type Registry,
  type TasteVector,
} from "@taste-codec/core"
import { Effect } from "effect"
import { loadTasteVectorFromPath, resolveRepoRoot } from "./runtime.js"

export interface DiscoveredTasteVector {
  readonly vector: TasteVector | undefined
  readonly source: "explicit" | "worktree" | "personal" | "fallback"
  readonly path: string | undefined
  readonly label: string
}

export const discoverTasteVector = (opts: {
  readonly repoPath: string
  readonly explicitPath?: string
  readonly registry: Registry
}) =>
  Effect.gen(function* () {
    if (opts.explicitPath !== undefined) {
      const path = resolve(opts.explicitPath)
      const vector = yield* loadAndValidateVector(path, opts.registry)
      return toDiscovery("explicit", path, vector)
    }

    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const worktreePath = join(repoRoot, ".taste-codec", "vector.json")
    if (existsSync(worktreePath)) {
      const vector = yield* loadAndValidateVector(worktreePath, opts.registry)
      return toDiscovery("worktree", worktreePath, vector)
    }

    const personalPath = join(homedir(), ".config", "taste-codec", "vector.json")
    if (existsSync(personalPath)) {
      const vector = yield* loadAndValidateVector(personalPath, opts.registry)
      return toDiscovery("personal", personalPath, vector)
    }

    return {
      vector: undefined,
      source: "fallback",
      path: undefined,
      label: "all-defaults",
    } satisfies DiscoveredTasteVector
  })

const loadAndValidateVector = (path: string, registry: Registry) =>
  Effect.gen(function* () {
    const vector = yield* loadTasteVectorFromPath(path)
    if (vector === undefined) {
      return yield* Effect.fail(new Error(`Taste vector path resolved empty: ${path}`))
    }

    const validated = yield* Effect.either(validateVectorAgainstRegistry(vector, registry))
    if (validated._tag === "Left") {
      return yield* Effect.fail(
        new Error(`Unknown signal id in taste vector ${path}: ${validated.left.id}`),
      )
    }

    return vector
  })

const toDiscovery = (
  source: DiscoveredTasteVector["source"],
  path: string,
  vector: TasteVector,
): DiscoveredTasteVector => ({
  vector,
  source,
  path,
  label: vector.id,
})
