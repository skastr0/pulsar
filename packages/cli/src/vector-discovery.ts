import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  type PulsarVector,
  validateVectorAgainstRegistry,
} from "@skastr0/pulsar-core/vector"
import { type Registry } from "@skastr0/pulsar-core/scoring"
import { Effect } from "effect"
import { loadPulsarVectorFromPath, resolveRepoRoot } from "./runtime.js"

export interface DiscoveredPulsarVector {
  readonly vector: PulsarVector | undefined
  readonly source: "explicit" | "worktree" | "organization" | "fallback"
  readonly trustBoundary:
    | "explicit-path"
    | "repo-local"
    | "organization-standard-fallback"
    | "built-in-defaults"
  readonly path: string | undefined
  readonly label: string
  readonly sourceLabel: string
}

export const discoverPulsarVector = (opts: {
  readonly repoPath: string
  readonly explicitPath?: string
  readonly registry: Registry
}): Effect.Effect<DiscoveredPulsarVector, Error, never> =>
  Effect.gen(function* () {
    if (opts.explicitPath !== undefined) {
      const path = resolve(opts.explicitPath)
      const vector = yield* loadAndValidateVector(path, opts.registry)
      return toDiscovery("explicit", path, vector)
    }

    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const worktreePath = join(repoRoot, ".pulsar", "vector.json")
    if (existsSync(worktreePath)) {
      const vector = yield* loadAndValidateVector(worktreePath, opts.registry)
      return toDiscovery("worktree", worktreePath, vector)
    }

    const organizationPath = join(homedir(), ".config", "pulsar", "vector.json")
    if (existsSync(organizationPath)) {
      const vector = yield* loadAndValidateVector(organizationPath, opts.registry)
      return toDiscovery("organization", organizationPath, vector)
    }

    return {
      vector: undefined,
      source: "fallback",
      trustBoundary: "built-in-defaults",
      path: undefined,
      label: "all-defaults",
      sourceLabel: "built-in defaults",
    } satisfies DiscoveredPulsarVector
  })

const loadAndValidateVector = (path: string, registry: Registry) =>
  Effect.gen(function* () {
    const vector = yield* loadPulsarVectorFromPath(path)
    if (vector === undefined) {
      return yield* Effect.fail(new Error(`Pulsar vector path resolved empty: ${path}`))
    }

    const validated = yield* Effect.either(validateVectorAgainstRegistry(vector, registry))
    if (validated._tag === "Left") {
      const issue = validated.left
      const message =
        issue._tag === "UnknownSignalFactorError"
          ? `Unknown signal factor in pulsar vector ${path}: ${issue.signalId}.${issue.factorPath}`
          : `Unknown signal id in pulsar vector ${path}: ${issue.id}`
      return yield* Effect.fail(
        new Error(message),
      )
    }

    return vector
  })

const toDiscovery = (
  source: DiscoveredPulsarVector["source"],
  path: string,
  vector: PulsarVector,
): DiscoveredPulsarVector => {
  switch (source) {
    case "explicit":
      return {
        vector,
        source,
        trustBoundary: "explicit-path",
        path,
        label: vector.id,
        sourceLabel: `explicit --vector (${path})`,
      }
    case "worktree":
      return {
        vector,
        source,
        trustBoundary: "repo-local",
        path,
        label: vector.id,
        sourceLabel: "repo-local .pulsar/vector.json",
      }
    case "organization":
      return {
        vector,
        source,
        trustBoundary: "organization-standard-fallback",
        path,
        label: vector.id,
        sourceLabel: "organization fallback ~/.config/pulsar/vector.json",
      }
    case "fallback":
      return {
        vector,
        source,
        trustBoundary: "built-in-defaults",
        path,
        label: vector.id,
        sourceLabel: "built-in defaults",
      }
  }
}
