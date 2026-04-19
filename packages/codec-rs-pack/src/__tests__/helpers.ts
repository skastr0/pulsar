import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type SignalContext,
  InMemoryCacheLayer,
  ReferenceDataTag,
  SignalContextTag,
  makeReferenceData,
  type Signal,
} from "@taste-codec/core"
import { Effect, Layer } from "effect"
import {
  RustProjectLayer,
  RustProjectTag,
  type RustProject,
} from "../project.js"

export const createRustWorkspace = async (
  prefix: string,
  files: Readonly<Record<string, string>>,
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, relativePath)
    await mkdir(join(fullPath, ".."), { recursive: true })
    await writeFile(fullPath, content)
  }
  return root
}

export const cleanupWorkspace = async (root: string): Promise<void> => {
  await rm(root, { recursive: true, force: true })
}

export const referenceLayer = (entries: Readonly<Record<string, unknown>> = {}) =>
  Layer.succeed(ReferenceDataTag, makeReferenceData(new Map(Object.entries(entries))))

export const runSignalCompute = async <Config, Output>(
  signal: Signal<Config, Output, any>,
  repoRoot: string,
  config: Config,
  entries: Readonly<Record<string, unknown>> = {},
): Promise<Output> => {
  const program = signal.compute(config, new Map()).pipe(
    Effect.provide(
      Layer.mergeAll(
        RustProjectLayer(repoRoot),
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: repoRoot,
          changedHunks: [],
        }),
        referenceLayer(entries),
        InMemoryCacheLayer,
      ),
    ),
  )
  return Effect.runPromise(program as Effect.Effect<Output, unknown, never>)
}

export const runSignalComputeWithContext = async <Config, Output>(
  signal: Signal<Config, Output, any>,
  repoRoot: string,
  config: Config,
  context: SignalContext,
  entries: Readonly<Record<string, unknown>> = {},
): Promise<Output> => {
  const program = signal.compute(config, new Map()).pipe(
    Effect.provide(
      Layer.mergeAll(
        RustProjectLayer(repoRoot),
        Layer.succeed(SignalContextTag, context),
        referenceLayer(entries),
        InMemoryCacheLayer,
      ),
    ),
  )
  return Effect.runPromise(program as Effect.Effect<Output, unknown, never>)
}

export const runSignalComputeWithProject = async <Config, Output>(
  signal: Signal<Config, Output, any>,
  project: RustProject,
  config: Config,
  entries: Readonly<Record<string, unknown>> = {},
): Promise<Output> => {
  const program = signal.compute(config, new Map()).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(RustProjectTag, project),
        Layer.succeed(SignalContextTag, {
          gitSha: "HEAD",
          worktreePath: project.worktreePath,
          changedHunks: [],
        }),
        referenceLayer(entries),
        InMemoryCacheLayer,
      ),
    ),
  )
  return Effect.runPromise(program as Effect.Effect<Output, unknown, never>)
}

export const runSignalComputeWithProjectAndContext = async <Config, Output>(
  signal: Signal<Config, Output, any>,
  project: RustProject,
  config: Config,
  context: SignalContext,
  entries: Readonly<Record<string, unknown>> = {},
): Promise<Output> => {
  const program = signal.compute(config, new Map()).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(RustProjectTag, project),
        Layer.succeed(SignalContextTag, context),
        referenceLayer(entries),
        InMemoryCacheLayer,
      ),
    ),
  )
  return Effect.runPromise(program as Effect.Effect<Output, unknown, never>)
}
