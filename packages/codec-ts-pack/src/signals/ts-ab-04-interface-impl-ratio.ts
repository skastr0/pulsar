import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { Node, type InterfaceDeclaration, type SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { buildPublicExportedDeclarationSet } from "./shared-export-analysis.js"
import { declarationKey } from "./shared-type-analysis.js"

export const TsAb04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  public_entry_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsAb04Config = typeof TsAb04Config.Type

export interface SingleImplPair {
  readonly interfaceFile: string
  readonly interfaceName: string
  readonly implementationFile: string
  readonly implementationName: string
  readonly hasTestSubstitute: boolean
}

export interface DeadInterface {
  readonly interfaceFile: string
  readonly interfaceName: string
  readonly line: number
}

export interface TsAb04Output {
  readonly pairs: ReadonlyArray<SingleImplPair>
  readonly flaggedPairs: ReadonlyArray<SingleImplPair>
  readonly totalInterfaces: number
  readonly ratio: number
  readonly deadInterfaces: ReadonlyArray<DeadInterface>
  readonly diagnosticLimit: number
}

export const TsAb04: Signal<TsAb04Config, TsAb04Output, TsProjectTag> = {
  id: "TS-AB-04",
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: TsAb04Config,
  defaultConfig: {
    exclude_globs: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    test_globs: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
    public_entry_globs: ["**/src/index.ts", "**/index.ts"],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsAb04Output => {
          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
          const productionFiles = sourceFiles.filter(
            (sourceFile) => !matchesAnyGlob(sourceFile.getFilePath(), config.test_globs),
          )
          const testFiles = sourceFiles.filter((sourceFile) =>
            matchesAnyGlob(sourceFile.getFilePath(), config.test_globs),
          )
          const publicDeclarations = buildPublicExportedDeclarationSet(
            productionFiles,
            config.public_entry_globs,
          )

          const interfaces = productionFiles
            .flatMap((sourceFile) => sourceFile.getInterfaces())
            .filter((iface) => !publicDeclarations.has(declarationKey(iface)))

          const prodClasses = productionFiles.flatMap((sourceFile) => sourceFile.getClasses())
          const prodObjects = productionFiles.flatMap(collectObjectLiteralVariables)
          const testClasses = testFiles.flatMap((sourceFile) => sourceFile.getClasses())
          const testObjects = testFiles.flatMap(collectObjectLiteralVariables)

          const pairs: Array<SingleImplPair> = []
          const deadInterfaces: Array<DeadInterface> = []

          for (const iface of interfaces) {
            const productionImplementations = collectImplementations(iface, prodClasses, prodObjects)
            const hasTestSubstitute =
              collectImplementations(iface, testClasses, testObjects).length > 0

            if (productionImplementations.length === 0) {
              deadInterfaces.push({
                interfaceFile: iface.getSourceFile().getFilePath(),
                interfaceName: iface.getName(),
                line: iface.getStartLineNumber(),
              })
              continue
            }

            if (productionImplementations.length === 1) {
              const implementation = productionImplementations[0]!
              pairs.push({
                interfaceFile: iface.getSourceFile().getFilePath(),
                interfaceName: iface.getName(),
                implementationFile: implementation.file,
                implementationName: implementation.name,
                hasTestSubstitute,
              })
            }
          }

          const flaggedPairs = pairs
            .filter((pair) => !pair.hasTestSubstitute)
            .sort((left, right) => {
              const interfaceCompare = left.interfaceFile.localeCompare(right.interfaceFile)
              if (interfaceCompare !== 0) return interfaceCompare
              return left.interfaceName.localeCompare(right.interfaceName)
            })

          return {
            pairs,
            flaggedPairs,
            totalInterfaces: interfaces.length,
            ratio: interfaces.length === 0 ? 0 : flaggedPairs.length / interfaces.length,
            deadInterfaces: deadInterfaces.sort((left, right) => {
              const fileCompare = left.interfaceFile.localeCompare(right.interfaceFile)
              if (fileCompare !== 0) return fileCompare
              return left.interfaceName.localeCompare(right.interfaceName)
            }),
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-04",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => Math.max(0, 1 - Math.min(1, out.ratio / 0.5)),
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    diagnostics.push(
      ...out.flaggedPairs.map((pair) => ({
        severity: "warn" as const,
        message:
          `Single-implementation interface ${pair.interfaceName} -> ${pair.implementationName}`,
        location: { file: pair.interfaceFile },
        data: {
          interfaceFile: pair.interfaceFile,
          interfaceName: pair.interfaceName,
          implementationFile: pair.implementationFile,
          implementationName: pair.implementationName,
        },
      })),
    )
    diagnostics.push(
      ...out.deadInterfaces.map((iface) => ({
        severity: "warn" as const,
        message: `Dead interface with no implementation: ${iface.interfaceName}`,
        location: { file: iface.interfaceFile, line: iface.line },
        data: {
          interfaceFile: iface.interfaceFile,
          interfaceName: iface.interfaceName,
        },
      })),
    )
    return diagnostics.slice(0, out.diagnosticLimit)
  },
}

type ImplementationDescriptor = { readonly file: string; readonly name: string }

const collectObjectLiteralVariables = (sourceFile: SourceFile) =>
  sourceFile
    .getVariableDeclarations()
    .filter((declaration) => Node.isObjectLiteralExpression(declaration.getInitializer()))

const collectImplementations = (
  iface: InterfaceDeclaration,
  classes: ReadonlyArray<ReturnType<SourceFile["getClasses"]>[number]>,
  objectLiterals: ReadonlyArray<ReturnType<SourceFile["getVariableDeclarations"]>[number]>,
): ReadonlyArray<ImplementationDescriptor> => {
  const interfaceType = iface.getType()
  const interfaceKey = declarationKey(iface)
  const descriptors = new Map<string, ImplementationDescriptor>()

  for (const classDeclaration of classes) {
    const explicit = classDeclaration
      .getImplements()
      .flatMap((heritage) => heritage.getType().getSymbol()?.getDeclarations() ?? [])
      .some((declaration) => declarationKey(declaration) === interfaceKey)
    const structural = classDeclaration.getType().isAssignableTo(interfaceType)
    if (!explicit && !structural) continue
    const name = classDeclaration.getName() ?? "<anonymous-class>"
    descriptors.set(`${classDeclaration.getSourceFile().getFilePath()}:${name}`, {
      file: classDeclaration.getSourceFile().getFilePath(),
      name,
    })
  }

  for (const declaration of objectLiterals) {
    if (!declaration.getType().isAssignableTo(interfaceType)) continue
    const name = declaration.getName()
    descriptors.set(`${declaration.getSourceFile().getFilePath()}:${name}`, {
      file: declaration.getSourceFile().getFilePath(),
      name,
    })
  }

  return [...descriptors.values()].sort((left, right) => {
    const fileCompare = left.file.localeCompare(right.file)
    if (fileCompare !== 0) return fileCompare
    return left.name.localeCompare(right.name)
  })
}
