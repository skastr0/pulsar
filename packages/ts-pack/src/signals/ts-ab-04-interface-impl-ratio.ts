import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { Node, SyntaxKind, type InterfaceDeclaration, type SourceFile } from "ts-morph"
import { createModuleResolver, type ModuleResolver } from "../graph/module-graph.js"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { hasExportModifier } from "./shared-ts-morph-modifiers.js"

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
  readonly deadInterfaceRatio: number
  readonly singleImplementationPressure: number
  readonly deadInterfacePressure: number
  readonly diagnosticLimit: number
}

export const TsAb04: Signal<TsAb04Config, TsAb04Output, TsProjectTag> = {
  id: "TS-AB-04-interface-implementation-ratio",
  title: "Interface implementation ratio",
  aliases: ["TS-AB-04"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  cacheVersion: "structural-interface-usage-v1",
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
          const publicInterfaces = buildPublicInterfaceKeySet(
            productionFiles,
            config.public_entry_globs,
          )

          const candidateInterfaces = productionFiles
            .flatMap((sourceFile) => sourceFile.getInterfaces())
            .filter((iface) => !publicInterfaces.has(interfaceKey(iface)))

          const prodImplementations = buildImplementationIndex(productionFiles)
          const testImplementations = buildImplementationIndex(testFiles)

          const pairs: Array<SingleImplPair> = []
          const deadInterfaces: Array<DeadInterface> = []
          let totalInterfaces = 0

          for (const iface of candidateInterfaces) {
            const productionImplementations = prodImplementations.get(iface.getName()) ?? []
            const hasTestSubstitute =
              (testImplementations.get(iface.getName()) ?? []).length > 0

            if (productionImplementations.length === 0) {
              if (hasStructuralTypeUsage(iface)) {
                continue
              }
              totalInterfaces += 1
              deadInterfaces.push({
                interfaceFile: iface.getSourceFile().getFilePath(),
                interfaceName: iface.getName(),
                line: iface.getStartLineNumber(),
              })
              continue
            }

            totalInterfaces += 1
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

          const ratio = totalInterfaces === 0 ? 0 : flaggedPairs.length / totalInterfaces
          const deadInterfaceRatio =
            totalInterfaces === 0 ? 0 : deadInterfaces.length / totalInterfaces
          const singleImplementationPressure = Math.min(1, ratio / 0.5)
          const deadInterfacePressure = Math.min(0.25, deadInterfaceRatio * 0.25)

          return {
            pairs,
            flaggedPairs,
            totalInterfaces,
            ratio,
            deadInterfaces: deadInterfaces.sort((left, right) => {
              const fileCompare = left.interfaceFile.localeCompare(right.interfaceFile)
              if (fileCompare !== 0) return fileCompare
              return left.interfaceName.localeCompare(right.interfaceName)
            }),
            deadInterfaceRatio,
            singleImplementationPressure,
            deadInterfacePressure,
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-04-interface-implementation-ratio",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) =>
    Math.max(
      0,
      1 - Math.max(out.singleImplementationPressure, out.deadInterfacePressure),
    ),
  outputMetadata: (out) =>
    out.totalInterfaces === 0 ? { applicability: "not_applicable" as const } : undefined,
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

const buildPublicInterfaceKeySet = (
  sourceFiles: ReadonlyArray<SourceFile>,
  publicEntryGlobs: ReadonlyArray<string>,
): ReadonlySet<string> => {
  const sourceFileByPath = new Map(
    sourceFiles.map((sourceFile) => [sourceFile.getFilePath(), sourceFile] as const),
  )
  const resolver = createModuleResolver(sourceFiles, [])
  const publicKeys = new Set<string>()
  const visited = new Set<string>()

  for (const sourceFile of sourceFiles) {
    if (!matchesAnyGlob(sourceFile.getFilePath(), publicEntryGlobs)) continue
    collectPublicInterfacesFromExports(sourceFile, sourceFileByPath, resolver, publicKeys, visited)
  }

  return publicKeys
}

const collectPublicInterfacesFromExports = (
  sourceFile: SourceFile,
  sourceFileByPath: ReadonlyMap<string, SourceFile>,
  resolver: ModuleResolver,
  publicKeys: Set<string>,
  visited: Set<string>,
): void => {
  const file = sourceFile.getFilePath()
  if (visited.has(file)) return
  visited.add(file)

  for (const iface of sourceFile.getInterfaces()) {
    if (hasExportModifier(iface)) {
      publicKeys.add(interfaceKey(iface))
    }
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    const targetPath = resolver.resolve(file, declaration)
    const targetFile = targetPath === undefined ? undefined : sourceFileByPath.get(targetPath)
    const namedExports = declaration.getNamedExports()

    if (targetFile === undefined) continue

    if (namedExports.length > 0) {
      for (const specifier of namedExports) {
        const iface = targetFile.getInterface(specifier.getName())
        if (iface !== undefined) {
          publicKeys.add(interfaceKey(iface))
        }
      }
      continue
    }

    collectPublicInterfacesFromExports(targetFile, sourceFileByPath, resolver, publicKeys, visited)
  }
}

const interfaceKey = (iface: InterfaceDeclaration): string =>
  `${iface.getSourceFile().getFilePath()}:${iface.getName()}`

const hasStructuralTypeUsage = (iface: InterfaceDeclaration): boolean => {
  const nameNode = iface.getNameNode()
  return iface.findReferencesAsNodes().some((reference) => {
    if (
      reference.getSourceFile().getFilePath() === iface.getSourceFile().getFilePath() &&
      reference.getStart() === nameNode.getStart()
    ) {
      return false
    }
    return !isImplementationReference(reference)
  })
}

const isImplementationReference = (reference: Node): boolean =>
  isClassImplementsReference(reference) || isTypedObjectLiteralReference(reference)

const isClassImplementsReference = (reference: Node): boolean => {
  const heritageExpression = reference.getFirstAncestorByKind(
    SyntaxKind.ExpressionWithTypeArguments,
  )
  const heritageClause = heritageExpression?.getParentIfKind(SyntaxKind.HeritageClause)
  return heritageClause?.getToken() === SyntaxKind.ImplementsKeyword
}

const isTypedObjectLiteralReference = (reference: Node): boolean => {
  const variableDeclaration = reference.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
  if (variableDeclaration === undefined) return false
  const initializer = variableDeclaration.getInitializer()
  if (!Node.isObjectLiteralExpression(initializer)) return false
  const typeNode = variableDeclaration.getTypeNode()
  if (typeNode === undefined) return false
  return reference.getStart() >= typeNode.getStart() && reference.getEnd() <= typeNode.getEnd()
}

const buildImplementationIndex = (
  sourceFiles: ReadonlyArray<SourceFile>,
): ReadonlyMap<string, ReadonlyArray<ImplementationDescriptor>> => {
  const byInterface = new Map<string, Map<string, ImplementationDescriptor>>()

  const add = (interfaceName: string | undefined, descriptor: ImplementationDescriptor): void => {
    if (interfaceName === undefined || interfaceName.length === 0) return
    const bucket = byInterface.get(interfaceName) ?? new Map<string, ImplementationDescriptor>()
    bucket.set(`${descriptor.file}:${descriptor.name}`, descriptor)
    byInterface.set(interfaceName, bucket)
  }

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.getFilePath()

    for (const classDeclaration of sourceFile.getClasses()) {
      const name = classDeclaration.getName() ?? "<anonymous-class>"
      for (const heritage of classDeclaration.getImplements()) {
        add(rootReferenceName(heritage.getExpression().getText()), { file, name })
      }
    }

    for (const declaration of sourceFile.getVariableDeclarations()) {
      if (!Node.isObjectLiteralExpression(declaration.getInitializer())) continue
      add(rootReferenceName(declaration.getTypeNode()?.getText()), {
        file,
        name: declaration.getName(),
      })
    }
  }

  return new Map(
    [...byInterface.entries()].map(([interfaceName, descriptors]) => [
      interfaceName,
      [...descriptors.values()].sort(compareImplementationDescriptors),
    ]),
  )
}

const rootReferenceName = (text: string | undefined): string | undefined => {
  const trimmed = text?.trim()
  if (trimmed === undefined || trimmed.length === 0) return undefined
  const match = /^[$A-Z_a-z][$\w]*/.exec(trimmed)
  return match?.[0]
}

const compareImplementationDescriptors = (
  left: ImplementationDescriptor,
  right: ImplementationDescriptor,
): number => {
  const fileCompare = left.file.localeCompare(right.file)
  if (fileCompare !== 0) return fileCompare
  return left.name.localeCompare(right.name)
}
