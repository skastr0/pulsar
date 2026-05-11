import type { SourceFile } from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import type { TsAb02Config } from "./ts-ab-02-unused-exports-reachability.js"
import { isExcluded } from "./shared-globs.js"
import {
  buildExportConsumerIndex,
  collectExportBindings,
} from "./shared-export-analysis.js"
import { packageDisplayName, packageForFile } from "./shared-workspace.js"
import {
  buildConsumerLookupByFile,
  type ConsumerLookup,
} from "./ts-ab-02-consumer-lookup.js"
import { publicEntrypointSourceFiles } from "./ts-ab-02-public-entrypoints.js"
import {
  collectSourceExportFacts,
  declarationFactForExport,
  type TypeScriptSourceExportFacts,
} from "./ts-ab-02-source-export-facts.js"

export type ExportBinding = ReturnType<typeof collectExportBindings>[number]

interface ReachabilityAnalysis {
  readonly bindings: ReadonlyArray<ExportBinding>
  readonly consumerLookup: ReadonlyMap<string, ConsumerLookup>
  readonly packageNameByFile: ReadonlyMap<string, string | undefined>
  readonly publicEntryFiles: ReadonlySet<string>
  readonly sourceFactsByFile: ReadonlyMap<string, TypeScriptSourceExportFacts>
}

export const buildReachabilityAnalysis = (
  allSourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
  config: TsAb02Config,
): ReachabilityAnalysis => {
  const sourceFiles = allSourceFiles
    .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
  const consumerIndex = buildExportConsumerIndex(sourceFiles, packages)
  const consumerLookup = buildConsumerLookupByFile(consumerIndex)
  const publicEntryFiles = publicEntrypointSourceFiles(
    sourceFiles,
    packages,
    config.public_entry_globs,
  )
  const packageNameByFile = new Map<string, string | undefined>(
    sourceFiles.map((sourceFile) => [
      sourceFile.getFilePath(),
      packageDisplayName(packageForFile(sourceFile.getFilePath(), packages)),
    ]),
  )

  return {
    bindings: sourceFiles.flatMap((sourceFile) => collectExportBindings(sourceFile)),
    consumerLookup,
    packageNameByFile,
    publicEntryFiles,
    sourceFactsByFile: new Map(sourceFiles.map((sourceFile) => [
      sourceFile.getFilePath(),
      collectSourceExportFacts(sourceFile),
    ])),
  }
}
