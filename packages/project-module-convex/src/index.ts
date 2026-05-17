import { Effect } from "effect"
import {
  addSourceCategory,
  defineProcessor,
  defineProjectModule,
  markTypeScriptExportPublicEntrypoint,
  type TypeScriptCallExpressionFact,
  type TypeScriptExportReachabilityValue,
  type TypeScriptImportBindingFact,
  type TypeScriptLocalBindingFact,
} from "@skastr0/pulsar-project-module-sdk"

export const CONVEX_PROJECT_MODULE_ID = "@skastr0/pulsar-project-module-convex" as const
export const CONVEX_GENERATED_TAXONOMY_RULE_ID = "convex.generated-artifact.v1" as const
export const CONVEX_PUBLIC_ENTRYPOINT_RULE_ID = "convex.public-entrypoint.v1" as const

export const convexProjectModule = defineProjectModule({
  id: CONVEX_PROJECT_MODULE_ID,
  version: "0.1.1",
  scope: "technology",
  source: "package",
  processors: [
    defineProcessor({
      id: "convex-generated-taxonomy",
      slot: "taxonomy.file-classifier",
      role: "filter",
      priority: 20,
      fingerprint: "convex-generated-taxonomy-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isConvexGeneratedPath(current.value.path)) return current
          return addSourceCategory(current, runtime, "generated", {
            ruleId: CONVEX_GENERATED_TAXONOMY_RULE_ID,
            reason: "Convex generated API output",
            evidence: [{ kind: "path", value: current.value.path }],
            metadata: { generator: "convex" },
          })
        }),
    }),
    defineProcessor({
      id: "convex-public-entrypoints",
      slot: "typescript.export-reachability",
      role: "resolver",
      priority: 20,
      fingerprint: "convex-public-entrypoints-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isConvexPublicEntrypointExport(current.value)) return current
          return markTypeScriptExportPublicEntrypoint(current, runtime, {
            ruleId: CONVEX_PUBLIC_ENTRYPOINT_RULE_ID,
            reason: "Convex runtime module exports are invoked externally by the Convex runtime",
            evidence: [
              { kind: "path", value: current.value.exportFile },
              { kind: "symbol", value: current.value.exportName },
            ],
            metadata: { technology: "convex" },
          })
        }),
    }),
  ],
})

export const isConvexGeneratedPath = (filePath: string): boolean => {
  const normalized = filePath.replaceAll("\\", "/")
  return normalized === "convex/_generated" ||
    normalized.includes("/convex/_generated/") ||
    normalized.startsWith("convex/_generated/")
}

export const isConvexPublicEntrypointExport = (
  value: TypeScriptExportReachabilityValue,
): boolean => {
  const imports = value.sourceImports ?? []
  const localBindings = value.sourceLocalBindings ?? []
  if (isConvexSchemaEntrypoint(value, imports, localBindings)) return true
  if (!isConvexRuntimeEntrypointPath(value.exportFile)) return false
  if (isConvexHttpEntrypoint(value, imports, localBindings)) {
    return true
  }
  return exportCallsConvexFactory(value, imports, localBindings, CONVEX_RUNTIME_FACTORIES)
}

export const isConvexRuntimeEntrypointPath = (filePath: string): boolean => {
  const normalized = filePath.replaceAll("\\", "/")
  if (!/\.[cm]?tsx?$/u.test(normalized) || /\.d\.[cm]?ts$/u.test(normalized)) {
    return false
  }

  const segments = normalized.split("/").filter(Boolean)
  const convexIndex = segments.lastIndexOf("convex")
  if (convexIndex < 0) return false

  const localSegments = segments.slice(convexIndex + 1)
  if (localSegments.length === 0) return false
  if (localSegments[0] === "_generated") return false

  const fileName = localSegments[localSegments.length - 1]
  return fileName !== "schema.ts" &&
    fileName !== "schema.tsx" &&
    fileName !== "schema.mts" &&
    fileName !== "schema.cts"
}

const CONVEX_SERVER_MODULE = "convex/server"
const CONVEX_GENERATED_SERVER_MODULE = "./_generated/server"
const CONVEX_RUNTIME_FACTORIES = new Set([
  "query",
  "mutation",
  "action",
  "internalQuery",
  "internalMutation",
  "internalAction",
  "httpAction",
])

const isConvexSchemaEntrypoint = defineConvexServerDefaultEntrypointPredicate({
  filePattern: /(?:^|\/)convex\/schema\.[cm]?tsx?$/u,
  factoryNames: new Set(["defineSchema"]),
})

const isConvexHttpEntrypoint = defineConvexServerDefaultEntrypointPredicate({
  filePattern: /(?:^|\/)convex\/http\.[cm]?tsx?$/u,
  factoryNames: new Set(["httpRouter"]),
})

type ConvexServerDefaultEntrypointSpec = {
  readonly filePattern: RegExp
  readonly factoryNames: ReadonlySet<string>
}

type ConvexServerDefaultEntrypointPredicate = (
  value: TypeScriptExportReachabilityValue,
  imports: ReadonlyArray<TypeScriptImportBindingFact>,
  localBindings: ReadonlyArray<TypeScriptLocalBindingFact>,
) => boolean

function defineConvexServerDefaultEntrypointPredicate(
  spec: ConvexServerDefaultEntrypointSpec,
): ConvexServerDefaultEntrypointPredicate {
  return (value, imports, localBindings) =>
    isConvexServerDefaultEntrypoint(value, imports, localBindings, spec)
}

const isConvexServerDefaultEntrypoint = (
  value: TypeScriptExportReachabilityValue,
  imports: ReadonlyArray<TypeScriptImportBindingFact>,
  localBindings: ReadonlyArray<TypeScriptLocalBindingFact>,
  spec: ConvexServerDefaultEntrypointSpec,
): boolean =>
  value.exportName === "default" &&
  spec.filePattern.test(value.exportFile.replaceAll("\\", "/")) &&
  exportCallsImportedFactory(value, imports, localBindings, spec.factoryNames, (specifier) =>
    specifier === CONVEX_SERVER_MODULE
  )

const exportCallsConvexFactory = (
  value: TypeScriptExportReachabilityValue,
  imports: ReadonlyArray<TypeScriptImportBindingFact>,
  localBindings: ReadonlyArray<TypeScriptLocalBindingFact>,
  factoryNames: ReadonlySet<string>,
): boolean =>
  exportCallsImportedFactory(value, imports, localBindings, factoryNames, isConvexRuntimeFactoryModule)

const exportCallsImportedFactory = (
  value: TypeScriptExportReachabilityValue,
  imports: ReadonlyArray<TypeScriptImportBindingFact>,
  localBindings: ReadonlyArray<TypeScriptLocalBindingFact>,
  factoryNames: ReadonlySet<string>,
  acceptsModule: (specifier: string) => boolean,
): boolean =>
  exportCallFacts(value, localBindings).some((call) =>
    isImportedFactoryCall(call, imports, factoryNames, acceptsModule)
  )

const exportCallFacts = (
  value: TypeScriptExportReachabilityValue,
  localBindings: ReadonlyArray<TypeScriptLocalBindingFact>,
): ReadonlyArray<TypeScriptCallExpressionFact> => {
  const calls: Array<TypeScriptCallExpressionFact> = []
  for (const declaration of value.declarations ?? []) {
    if (declaration.initializerCall !== undefined) {
      calls.push(declaration.initializerCall)
    }
    if (declaration.expressionCall !== undefined) {
      calls.push(declaration.expressionCall)
    }
    if (declaration.expressionIdentifier !== undefined) {
      const localCall = localInitializerCall(localBindings, declaration.expressionIdentifier)
      if (localCall !== undefined) calls.push(localCall)
    }
  }

  const localExportName = localNameForExport(value) ?? value.exportName
  const localCall = localInitializerCall(localBindings, localExportName)
  if (localCall !== undefined) calls.push(localCall)
  return calls
}

const localNameForExport = (value: TypeScriptExportReachabilityValue): string | undefined =>
  (value.sourceExportSpecifiers ?? [])
    .find((specifier) =>
      specifier.exportedName === value.exportName &&
      specifier.moduleSpecifier === undefined
    )
    ?.localName

const localInitializerCall = (
  localBindings: ReadonlyArray<TypeScriptLocalBindingFact>,
  localName: string,
): TypeScriptCallExpressionFact | undefined =>
  localBindings.find((binding) => binding.localName === localName)?.initializerCall

const isImportedFactoryCall = (
  call: TypeScriptCallExpressionFact,
  imports: ReadonlyArray<TypeScriptImportBindingFact>,
  factoryNames: ReadonlySet<string>,
  acceptsModule: (specifier: string) => boolean,
): boolean =>
  imports.some((binding) => {
    if (!acceptsModule(binding.moduleSpecifier)) return false
    if (binding.importKind === "named") {
      return factoryNames.has(binding.importedName) && call.calleeName === binding.localName
    }
    if (binding.importKind === "namespace") {
      return [...factoryNames].some((factoryName) =>
        call.calleeText === `${binding.localName}.${factoryName}`
      )
    }
    return false
  })

const isConvexRuntimeFactoryModule = (specifier: string): boolean =>
  specifier === CONVEX_GENERATED_SERVER_MODULE ||
  specifier.endsWith("/_generated/server")

export default convexProjectModule
