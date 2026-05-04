import {
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { normalize, resolve } from "node:path"
import { Node, type SourceFile } from "ts-morph"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import type { PackageInfo } from "../discovery.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import {
  buildExportConsumerIndex,
  collectExportBindings,
  countSameFileReferences,
  type ExportConsumer,
} from "./shared-export-analysis.js"
import {
  boundaryOfFile,
  packageDisplayName,
  packageForFile,
  type BoundaryRule,
} from "./shared-workspace.js"
import {
  stripKnownExtension,
  stripRuntimeExtension,
} from "./shared-path-extensions.js"

const BoundaryRuleSchema = Schema.Struct({
  name: Schema.String,
  globs: Schema.Array(Schema.String),
})

export const TsAb02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  public_entry_globs: Schema.Array(Schema.String),
  boundary_rules: Schema.Array(BoundaryRuleSchema),
  top_n_diagnostics: Schema.Number,
})
export type TsAb02Config = typeof TsAb02Config.Type

export type ExportClassification = "unused" | "internal-only" | "cross-module" | "cross-package"
export type ExportEvidence = "runtime" | "type-only" | "test-hook"

export interface ExportReachability {
  readonly exportFile: string
  readonly exportName: string
  readonly declarationFiles: ReadonlyArray<string>
  readonly classification: ExportClassification
  readonly evidence: ExportEvidence
  readonly penaltyWeight: number
  readonly viaReExport: boolean
  readonly referenceFiles: ReadonlyArray<string>
  readonly sameFileReferenceCount: number
  readonly boundaryStatus: "cross-boundary" | "same-boundary" | "unmapped"
  readonly crossBoundaryFiles: ReadonlyArray<string>
}

export interface TsAb02Output {
  readonly exports: ReadonlyArray<ExportReachability>
  readonly counts: Readonly<Record<ExportClassification, number>>
  readonly boundaryConfined: ReadonlyArray<ExportReachability>
  readonly diagnosticLimit: number
}

export const TsAb02: Signal<TsAb02Config, TsAb02Output, TsProjectTag | TsPackageInfoTag> = {
  id: "TS-AB-02",
  tier: 1,
  category: "abstraction-bloat",
  kind: "structural",
  configSchema: TsAb02Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/docs/**",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "fixtures/**",
      "**/fixtures/**",
      "playground/**",
      "playground-*/**",
      "playgrounds/**",
      "**/playground/**",
      "**/playground-*/**",
      "**/playgrounds/**",
      "**/_generated/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/prototypes/**",
      "**/explorations/**",
      "**/test-support/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    public_entry_globs: [
      "**/src/index.ts",
      "**/index.ts",
      "**/runtime-api.ts",
      "**/setup-api.ts",
      "**/*.config.ts",
      "**/*.config.tsx",
      "**/*.config.mts",
      "**/*.config.cts",
    ],
    boundary_rules: [],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const result = yield* Effect.try({
        try: (): TsAb02Output => {
          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
          const consumerIndex = buildExportConsumerIndex(sourceFiles, packages)
          const consumerLookup = buildConsumerLookupByFile(consumerIndex)
          const manifestEntrypointFiles = packageEntrypointSourceFiles(sourceFiles, packages)
          const publicEntryFiles = publicEntrypointSourceFiles(
            sourceFiles,
            manifestEntrypointFiles,
            config.public_entry_globs,
          )
          const packageNameByFile = new Map<string, string | undefined>(
            sourceFiles.map((sourceFile) => [
              sourceFile.getFilePath(),
              packageDisplayName(packageForFile(sourceFile.getFilePath(), packages)),
            ]),
          )
          const entries = sourceFiles
            .flatMap((sourceFile) => collectExportBindings(sourceFile))
            .map((binding) => {
              const consumers = matchingConsumers(
                consumerLookup.get(binding.exportFile),
                binding.exportName,
              )
              return classifyExport(
                binding,
                consumers,
                packageNameByFile.get(binding.exportFile),
                config.boundary_rules,
                publicEntryFiles.has(binding.exportFile) ||
                  isReExportedByPublicEntrypoint(consumers, publicEntryFiles),
              )
            })
            .sort(compareReachability)

          return {
            exports: entries,
            counts: {
              unused: entries.filter((entry) => entry.classification === "unused").length,
              "internal-only": entries.filter((entry) => entry.classification === "internal-only").length,
              "cross-module": entries.filter((entry) => entry.classification === "cross-module").length,
              "cross-package": entries.filter((entry) => entry.classification === "cross-package").length,
            },
            boundaryConfined: entries.filter(
              (entry) =>
                config.boundary_rules.length > 0 &&
                entry.boundaryStatus === "same-boundary" &&
                entry.classification !== "cross-package",
            ),
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-02",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.exports.length === 0) return 1
    const weightedUnused = out.exports.reduce((sum, entry) => sum + reachabilityPenalty(entry), 0)
    return Math.max(0, 1 - weightedUnused / out.exports.length)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []

    diagnostics.push(
      ...out.boundaryConfined.map((entry) => ({
        severity: "block" as const,
        message:
          `Export ${entry.exportName} is not used across its declared boundary: ` +
          `${entry.exportFile}`,
        location: { file: entry.exportFile },
        data: {
          hash: computeDiagnosticHash(`${entry.exportFile}|${entry.exportName}|boundary-confined`),
          exportFile: entry.exportFile,
          exportName: entry.exportName,
          classification: entry.classification,
          referenceFiles: entry.referenceFiles.slice(),
        },
      })),
    )

    diagnostics.push(
      ...out.exports
        .filter(
          (entry) =>
            entry.classification === "unused" ||
            entry.classification === "internal-only",
        )
        .map((entry) => ({
          severity:
            reachabilityPenalty(entry) >= 1
              ? ("warn" as const)
              : ("info" as const),
          message:
            `Export ${entry.exportName} in ${entry.exportFile}: ` +
            `${entry.classification}${entry.evidence !== "runtime" ? ` (${entry.evidence})` : ""}`,
          location: { file: entry.exportFile },
          data: {
            exportFile: entry.exportFile,
            exportName: entry.exportName,
            declarationFiles: entry.declarationFiles.slice(),
            classification: entry.classification,
            evidence: entry.evidence,
            penaltyWeight: entry.penaltyWeight,
            referenceFiles: entry.referenceFiles.slice(),
            sameFileReferenceCount: entry.sameFileReferenceCount,
            viaReExport: entry.viaReExport,
            boundaryStatus: entry.boundaryStatus,
            crossBoundaryFiles: entry.crossBoundaryFiles.slice(),
          },
        })),
    )

    return diagnostics.slice(0, out.diagnosticLimit)
  },
}

const classifyExport = (
  binding: ReturnType<typeof collectExportBindings>[number],
  consumers: ReadonlyArray<ExportConsumer>,
  ownPackage: string | undefined,
  boundaryRules: ReadonlyArray<BoundaryRule>,
  isPublicEntrypoint: boolean,
): ExportReachability => {
  const referenceFiles = consumers
    .map((consumer) => consumer.consumerFile)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right))

  const crossPackage = consumers.some(
    (consumer) =>
      consumer.consumerPackage !== undefined &&
      ownPackage !== undefined &&
      consumer.consumerPackage !== ownPackage,
  )

  const sameFileReferences =
    isPublicEntrypoint || referenceFiles.length > 0
      ? 0
      : countSameFileReferences(binding)

  const classification: ExportClassification =
    isPublicEntrypoint
      ? "cross-package"
      : referenceFiles.length > 0
      ? crossPackage
        ? "cross-package"
        : "cross-module"
      : sameFileReferences > 0
        ? "internal-only"
        : "unused"

  const exportBoundary = boundaryOfFile(binding.exportFile, boundaryRules)
  const crossBoundaryFiles = referenceFiles.filter((file) => {
    const consumerBoundary = boundaryOfFile(file, boundaryRules)
    return exportBoundary !== undefined && consumerBoundary !== undefined && consumerBoundary !== exportBoundary
  })

  const evidence = exportEvidence(binding)

  return {
    exportFile: binding.exportFile,
    exportName: binding.exportName,
    declarationFiles: binding.declarationFiles,
    classification,
    evidence,
    penaltyWeight: evidencePenaltyWeight(evidence),
    viaReExport: binding.viaReExport,
    referenceFiles,
    sameFileReferenceCount: sameFileReferences,
    boundaryStatus:
      exportBoundary === undefined
        ? "unmapped"
        : crossBoundaryFiles.length > 0
          ? "cross-boundary"
          : "same-boundary",
    crossBoundaryFiles,
  }
}

const reachabilityPenalty = (entry: ExportReachability): number => {
  if (entry.classification === "unused") return entry.penaltyWeight
  if (entry.classification === "internal-only") return entry.penaltyWeight * 0.5
  return 0
}

const exportEvidence = (binding: ReturnType<typeof collectExportBindings>[number]): ExportEvidence => {
  if (isTestHookExportName(binding.exportName)) return "test-hook"
  if (binding.localDeclarations.length > 0 && binding.localDeclarations.every(isTypeOnlyDeclaration)) {
    return "type-only"
  }
  return "runtime"
}

const isTestHookExportName = (name: string): boolean =>
  /(?:ForTest|ForTesting|Test|Testing|Fixture|Mock)(?:$|[A-Z_])/u.test(name)

const isTypeOnlyDeclaration = (node: Node): boolean =>
  Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node)

const evidencePenaltyWeight = (evidence: ExportEvidence): number => {
  if (evidence === "runtime") return 1
  if (evidence === "type-only") return 0.35
  return 0.2
}

interface ConsumerLookup {
  readonly named: ReadonlyMap<string, ReadonlyArray<ExportConsumer>>
  readonly star: ReadonlyArray<ExportConsumer>
}

const buildConsumerLookupByFile = (
  consumerIndex: ReadonlyMap<string, ReadonlyArray<ExportConsumer>>,
): ReadonlyMap<string, ConsumerLookup> => {
  const lookupByFile = new Map<string, ConsumerLookup>()

  for (const [file, consumers] of consumerIndex) {
    const named = new Map<string, Array<ExportConsumer>>()
    const star: Array<ExportConsumer> = []

    for (const consumer of consumers) {
      if (consumer.exportName === "*") {
        star.push(consumer)
        continue
      }

      const bucket = named.get(consumer.exportName) ?? []
      bucket.push(consumer)
      named.set(consumer.exportName, bucket)
    }

    lookupByFile.set(file, { named, star })
  }

  return lookupByFile
}

const publicEntrypointSourceFiles = (
  sourceFiles: ReadonlyArray<SourceFile>,
  manifestEntrypointFiles: ReadonlySet<string>,
  publicEntryGlobs: ReadonlyArray<string>,
): ReadonlySet<string> => {
  const publicFiles = new Set<string>(manifestEntrypointFiles)
  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath()
    if (matchesAnyGlob(filePath, publicEntryGlobs)) {
      publicFiles.add(filePath)
    }
  }
  return publicFiles
}

const isReExportedByPublicEntrypoint = (
  consumers: ReadonlyArray<ExportConsumer>,
  publicEntryFiles: ReadonlySet<string>,
): boolean =>
  consumers.some(
    (consumer) =>
      consumer.kind === "re-export" && publicEntryFiles.has(consumer.consumerFile),
  )

const matchingConsumers = (
  lookup: ConsumerLookup | undefined,
  exportName: string,
): ReadonlyArray<ExportConsumer> => {
  if (lookup === undefined) return []
  const named = lookup.named.get(exportName) ?? []
  if (exportName === "default") return named
  if (named.length === 0) return lookup.star
  if (lookup.star.length === 0) return named
  return [...named, ...lookup.star]
}

const packageEntrypointSourceFiles = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
): ReadonlySet<string> => {
  const sourcePathLookup = new Map<string, string>()
  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.getFilePath())
    sourcePathLookup.set(filePath, filePath)
    sourcePathLookup.set(stripKnownExtension(filePath), filePath)
  }

  const entrypointFiles = new Set<string>()
  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.getFilePath())
    if (isAgentToolEntrypoint(filePath)) {
      entrypointFiles.add(filePath)
    }
  }

  for (const pkg of packages) {
    for (const entrypoint of pkg.manifest?.entrypoints ?? []) {
      const resolvedEntrypoint = resolveEntrypointSourceFile(pkg.path, entrypoint, sourcePathLookup)
      if (resolvedEntrypoint !== undefined) {
        entrypointFiles.add(resolvedEntrypoint)
      }
    }
  }
  return entrypointFiles
}

const resolveEntrypointSourceFile = (
  packagePath: string,
  entrypoint: string,
  sourcePathLookup: ReadonlyMap<string, string>,
): string | undefined => {
  if (entrypoint.startsWith("#") || /^[a-z]+:/iu.test(entrypoint)) {
    return undefined
  }

  const normalized = normalizePath(resolve(packagePath, entrypoint))
  for (const candidate of entrypointSourceCandidates(normalized)) {
    const resolved = sourcePathLookup.get(candidate) ?? sourcePathLookup.get(stripKnownExtension(candidate))
    if (resolved !== undefined) return resolved
  }
  return undefined
}

const entrypointSourceCandidates = (entrypointPath: string): ReadonlyArray<string> => {
  const candidates = new Set<string>([entrypointPath])
  const withoutRuntimeExtension = stripRuntimeExtension(entrypointPath)
  candidates.add(withoutRuntimeExtension)

  for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
    candidates.add(`${withoutRuntimeExtension}${extension}`)
  }

  const sourcePath = entrypointPath.replace(/\/dist\//u, "/src/")
  candidates.add(sourcePath)
  const sourceWithoutRuntimeExtension = stripRuntimeExtension(sourcePath)
  candidates.add(sourceWithoutRuntimeExtension)
  for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
    candidates.add(`${sourceWithoutRuntimeExtension}${extension}`)
  }

  return [...candidates]
}

const isAgentToolEntrypoint = (path: string): boolean =>
  /\/\.opencode\/tools?\/[^/]+\.[cm]?tsx?$/u.test(path) ||
  /\/\.opencode\/plugins\/[^/]+\.[cm]?tsx?$/u.test(path) ||
  /\/\.pi\/extensions\/[^/]+\.[cm]?tsx?$/u.test(path)

const normalizePath = (path: string): string => normalize(path).replace(/\\/g, "/")

const compareReachability = (left: ExportReachability, right: ExportReachability): number => {
  const rank = (entry: ExportReachability): number => {
    switch (entry.classification) {
      case "unused":
        return 0
      case "internal-only":
        return 1
      case "cross-module":
        return 2
      case "cross-package":
        return 3
    }
  }

  const rankCompare = rank(left) - rank(right)
  if (rankCompare !== 0) return rankCompare
  const penaltyCompare = reachabilityPenalty(right) - reachabilityPenalty(left)
  if (penaltyCompare !== 0) return penaltyCompare
  const fileCompare = left.exportFile.localeCompare(right.exportFile)
  if (fileCompare !== 0) return fileCompare
  return left.exportName.localeCompare(right.exportName)
}
