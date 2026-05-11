import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReferenceDataTag, SignalContextTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import type { Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Layer } from "effect"
import { TsProjectLayer } from "../ts-project.js"

export interface TempRepo {
  readonly root: string
  readonly write: (relPath: string, content: string) => Promise<string>
  readonly writeJson: (relPath: string, value: unknown) => Promise<string>
  readonly cleanup: () => Promise<void>
}

export const createTempRepo = async (prefix: string): Promise<TempRepo> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const write = async (relPath: string, content: string): Promise<string> => {
    const fullPath = join(root, relPath)
    await mkdir(join(fullPath, ".."), { recursive: true })
    await writeFile(fullPath, content)
    return fullPath
  }
  const writeJson = async (relPath: string, value: unknown): Promise<string> =>
    write(relPath, JSON.stringify(value, null, 2))

  await writeJson("tsconfig.json", {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
    },
    include: ["**/*.ts"],
  })
  await writeJson("package.json", {
    name: "temp-workspace",
    private: true,
  })

  return {
    root,
    write,
    writeJson,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

export const runSignal = async <Config, Output>(
  repo: string,
  signal: Signal<Config, Output, any>,
  config: Config,
  referenceEntries: Readonly<Record<string, unknown>> = {},
): Promise<Output> => {
  const layer = Layer.mergeAll(
    TsProjectLayer(repo),
    Layer.succeed(SignalContextTag, {
      gitSha: "TEST",
      worktreePath: repo,
      changedHunks: [],
    }),
    Layer.succeed(
      ReferenceDataTag,
      makeReferenceData(new Map(Object.entries(referenceEntries))),
    ),
  )

  return Effect.runPromise(
    signal.compute(config, new Map()).pipe(Effect.provide(layer)) as Effect.Effect<
      Output,
      unknown,
      never
    >,
  )
}
