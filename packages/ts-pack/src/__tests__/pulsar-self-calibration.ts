import {
  makeResolvedCalibrationContext,
  type ActiveProjectModule,
  type AnyCalibrationProcessor,
  type ResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

type RepoLocalProjectModule = {
  readonly activeModule: ActiveProjectModule
  readonly processors: ReadonlyArray<AnyCalibrationProcessor>
}

export const makePulsarSelfCalibrationContext = async (
  repoRoot: string,
): Promise<ResolvedCalibrationContext> => {
  const module = await import(pathToFileURL(pulsarSelfModulePath).href) as {
    readonly default: RepoLocalProjectModule
  }
  return makeResolvedCalibrationContext({
    repoFacts: {
      repoRoot,
      fingerprint: "repo-facts-v1",
      detectedTechnologies: ["typescript"],
      sourceExtensions: [".ts"],
    },
    activeModules: [module.default.activeModule],
    processors: module.default.processors,
  })
}

const pulsarSelfModulePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../.pulsar/modules/pulsar-self.ts",
)
