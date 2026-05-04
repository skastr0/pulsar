import {
  CalibrationContextTag,
  computeDiagnosticHash,
  type CalibrationDecision,
  type CalibrationProcessorError,
  type CalibrationSlotOutput,
  type Diagnostic,
  type ResolvedCalibrationContext,
  type Signal,
  SignalComputeError,
  type TypeScriptCallExpressionFact,
  type TypeScriptExportDeclarationFact,
  type TypeScriptExportReachabilityValue,
  type TypeScriptExportSpecifierFact,
  type TypeScriptImportBindingFact,
  type TypeScriptLocalBindingFact,
} from "@taste-codec/core"
import { Effect, Option, Schema } from "effect"
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
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly counts: Readonly<Record<ExportClassification, number>>
  readonly boundaryConfined: ReadonlyArray<ExportReachability>
  readonly diagnosticLimit: number
}

type ExportBinding = ReturnType<typeof collectExportBindings>[number]

interface ReachabilityAnalysis {
  readonly bindings: ReadonlyArray<ExportBinding>
  readonly consumerLookup: ReadonlyMap<string, ConsumerLookup>
  readonly packageNameByFile: ReadonlyMap<string, string | undefined>
  readonly publicEntryFiles: ReadonlySet<string>
  readonly sourceFactsByFile: ReadonlyMap<string, TypeScriptSourceExportFacts>
}

interface TypeScriptSourceExportFacts {
  readonly imports: ReadonlyArray<TypeScriptImportBindingFact>
  readonly localBindings: ReadonlyArray<TypeScriptLocalBindingFact>
  readonly exportSpecifiers: ReadonlyArray<TypeScriptExportSpecifierFact>
}

export const TsAb02: Signal<TsAb02Config, TsAb02Output, TsProjectTag | TsPackageInfoTag> = {
  id: "TS-AB-02",
  tier: 1,
  category: "abstraction-bloat",
  kind: "structural",
  cacheVersion: "calibrated-export-reachability-v2",
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
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const exportReachabilityCalibration =
        Option.isSome(calibration) &&
        calibration.value.processors.some((processor) =>
          processor.slot === "typescript.export-reachability"
        )
          ? calibration.value
          : undefined
      const analysis = yield* Effect.try({
        try: () => buildReachabilityAnalysis(project.getSourceFiles(), packages, config),
        catch: toSignalComputeError,
      })
      const entries: Array<ExportReachability> = []
      const calibrationDecisions: Array<CalibrationDecision> = []

      for (const binding of analysis.bindings) {
        const consumers = matchingConsumers(
          analysis.consumerLookup.get(binding.exportFile),
          binding.exportName,
        )
        const defaultPublicEntrypoint =
          analysis.publicEntryFiles.has(binding.exportFile) ||
          isReExportedByPublicEntrypoint(consumers, analysis.publicEntryFiles)
        const reachability = yield* calibrateExportReachability(
          binding,
          defaultPublicEntrypoint,
          exportReachabilityCalibration,
          analysis.sourceFactsByFile.get(binding.exportFile),
        ).pipe(Effect.mapError(toSignalComputeError))
        calibrationDecisions.push(...reachability.decisions)
        entries.push(classifyExport(
          binding,
          consumers,
          analysis.packageNameByFile.get(binding.exportFile),
          config.boundary_rules,
          reachability.value.isPublicEntrypoint,
        ))
      }

      const sortedEntries = entries.sort(compareReachability)
      return {
        exports: sortedEntries,
        calibrationDecisions,
        counts: {
          unused: sortedEntries.filter((entry) => entry.classification === "unused").length,
          "internal-only": sortedEntries.filter((entry) => entry.classification === "internal-only").length,
          "cross-module": sortedEntries.filter((entry) => entry.classification === "cross-module").length,
          "cross-package": sortedEntries.filter((entry) => entry.classification === "cross-package").length,
        },
        boundaryConfined: sortedEntries.filter(
          (entry) =>
            config.boundary_rules.length > 0 &&
            entry.boundaryStatus === "same-boundary" &&
            entry.classification !== "cross-package",
        ),
        diagnosticLimit: config.top_n_diagnostics,
      }
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

const buildReachabilityAnalysis = (
  allSourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
  config: TsAb02Config,
): ReachabilityAnalysis => {
  const sourceFiles = allSourceFiles
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

const calibrateExportReachability = (
  binding: ExportBinding,
  isPublicEntrypoint: boolean,
  calibration: ResolvedCalibrationContext | undefined,
  sourceFacts: TypeScriptSourceExportFacts | undefined,
): Effect.Effect<
  CalibrationSlotOutput<"typescript.export-reachability">,
  CalibrationProcessorError,
  never
> => {
  const input: TypeScriptExportReachabilityValue = {
    exportFile: binding.exportFile,
    exportName: binding.exportName,
    declarationFiles: binding.declarationFiles,
    declarationKinds: binding.localDeclarations.map((declaration) => declaration.getKindName()),
    declarations: binding.localDeclarations.map((declaration) =>
      declarationFactForExport(binding.exportName, declaration)
    ),
    ...(sourceFacts === undefined
      ? {}
      : {
          sourceImports: sourceFacts.imports,
          sourceLocalBindings: sourceFacts.localBindings,
          sourceExportSpecifiers: sourceFacts.exportSpecifiers,
        }),
    isPublicEntrypoint,
  }
  if (calibration === undefined) {
    return Effect.succeed({ value: input, decisions: [] })
  }
  return calibration.runSlot("typescript.export-reachability", input)
}

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  new SignalComputeError({
    signalId: "TS-AB-02",
    message: String(cause),
    cause,
  })

const SOURCE_EXPORT_FACT_CACHE = new WeakMap<SourceFile, TypeScriptSourceExportFacts>()

const collectSourceExportFacts = (
  sourceFile: SourceFile,
): TypeScriptSourceExportFacts => {
  const cached = SOURCE_EXPORT_FACT_CACHE.get(sourceFile)
  if (cached !== undefined) return cached

  const facts: TypeScriptSourceExportFacts = {
    imports: importBindingFacts(sourceFile),
    localBindings: localBindingFacts(sourceFile),
    exportSpecifiers: exportSpecifierFacts(sourceFile),
  }
  SOURCE_EXPORT_FACT_CACHE.set(sourceFile, facts)
  return facts
}

const importBindingFacts = (sourceFile: SourceFile): ReadonlyArray<TypeScriptImportBindingFact> =>
  sourceFile.getImportDeclarations().flatMap((declaration) => {
    const moduleSpecifier = declaration.getModuleSpecifierValue()
    const bindings: Array<TypeScriptImportBindingFact> = []
    const defaultImport = declaration.getDefaultImport()
    if (defaultImport !== undefined) {
      bindings.push({
        moduleSpecifier,
        importKind: "default",
        importedName: "default",
        localName: defaultImport.getText(),
      })
    }

    const namespaceImport = declaration.getNamespaceImport()
    if (namespaceImport !== undefined) {
      bindings.push({
        moduleSpecifier,
        importKind: "namespace",
        importedName: "*",
        localName: namespaceImport.getText(),
      })
    }

    for (const namedImport of declaration.getNamedImports()) {
      bindings.push({
        moduleSpecifier,
        importKind: "named",
        importedName: namedImport.getNameNode().getText(),
        localName: namedImport.getAliasNode()?.getText() ?? namedImport.getNameNode().getText(),
      })
    }
    return bindings
  })

const localBindingFacts = (sourceFile: SourceFile): ReadonlyArray<TypeScriptLocalBindingFact> =>
  sourceFile.getVariableStatements()
    .flatMap((statement) => statement.getDeclarations())
    .map((declaration): TypeScriptLocalBindingFact | undefined => {
      const localName = identifierName(declaration.getNameNode())
      if (localName === undefined) return undefined
      const initializerCall = callFact(declaration.getInitializer())
      return {
        localName,
        ...(initializerCall === undefined ? {} : { initializerCall }),
      }
    })
    .filter((fact): fact is TypeScriptLocalBindingFact => fact !== undefined)

const exportSpecifierFacts = (
  sourceFile: SourceFile,
): ReadonlyArray<TypeScriptExportSpecifierFact> =>
  sourceFile.getExportDeclarations().flatMap((declaration) => {
    if (!declaration.hasNamedExports()) return []
    const moduleSpecifier = declaration.getModuleSpecifierValue()
    return declaration.getNamedExports().map((specifier) => ({
      exportedName: specifier.getAliasNode()?.getText() ?? specifier.getNameNode().getText(),
      localName: specifier.getNameNode().getText(),
      ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
    }))
  })

const declarationFactForExport = (
  exportName: string,
  declaration: Node,
): TypeScriptExportDeclarationFact => {
  const base = {
    declarationKind: declaration.getKindName(),
    exportName,
  }

  if (Node.isVariableDeclaration(declaration)) {
    const localName = identifierName(declaration.getNameNode())
    const initializerCall = callFact(declaration.getInitializer())
    return {
      ...base,
      ...(localName === undefined ? {} : { localName }),
      ...(initializerCall === undefined ? {} : { initializerCall }),
    }
  }

  if (Node.isExportAssignment(declaration)) {
    const expression = declaration.getExpression()
    const expressionIdentifier = identifierName(expression)
    const expressionCall = callFact(expression)
    return {
      ...base,
      ...(expressionIdentifier === undefined ? {} : { expressionIdentifier }),
      ...(expressionCall === undefined ? {} : { expressionCall }),
    }
  }

  const named = declaration as { getNameNode?: () => Node; getName?: () => string | undefined }
  const localName = named.getNameNode !== undefined
    ? identifierName(named.getNameNode())
    : named.getName?.()
  return {
    ...base,
    ...(localName === undefined ? {} : { localName }),
  }
}

const callFact = (node: Node | undefined): TypeScriptCallExpressionFact | undefined => {
  if (node === undefined || !Node.isCallExpression(node)) return undefined
  const callee = node.getExpression()
  const calleeName = callCalleeName(callee)
  return {
    calleeText: callee.getText(),
    ...(calleeName === undefined ? {} : { calleeName }),
  }
}

const callCalleeName = (node: Node): string | undefined => {
  if (Node.isIdentifier(node)) return node.getText()
  if (Node.isPropertyAccessExpression(node)) return node.getNameNode().getText()
  return undefined
}

const identifierName = (node: Node): string | undefined =>
  Node.isIdentifier(node) ? node.getText() : undefined

const classifyExport = (
  binding: ExportBinding,
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
