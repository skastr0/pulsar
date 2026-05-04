import { Effect } from "effect"
import {
  addSourceCategory,
  defineProcessor,
  defineProjectModule,
  markTypeScriptExportPublicEntrypoint,
  type TypeScriptExportReachabilityValue,
} from "@taste-codec/project-module-sdk"

export const CONVEX_PROJECT_MODULE_ID = "@taste-codec/project-module-convex" as const
export const CONVEX_GENERATED_TAXONOMY_RULE_ID = "convex.generated-artifact.v1" as const
export const CONVEX_PUBLIC_ENTRYPOINT_RULE_ID = "convex.public-entrypoint.v1" as const

export const convexProjectModule = defineProjectModule({
  id: CONVEX_PROJECT_MODULE_ID,
  version: "0.0.0",
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
  const declarationText = (value.declarationTexts ?? []).join("\n")
  const sourceText = value.sourceText ?? declarationText
  if (isConvexSchemaEntrypoint(value.exportFile, value.exportName, sourceText)) return true
  if (!isConvexRuntimeEntrypointPath(value.exportFile)) return false
  if (isConvexHttpEntrypoint(value.exportFile, value.exportName, declarationText, sourceText)) {
    return true
  }
  return /\b(?:query|mutation|action|internalQuery|internalMutation|internalAction|httpAction)\s*\(/u
    .test(declarationText)
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

const isConvexSchemaEntrypoint = (
  filePath: string,
  exportName: string,
  sourceText: string,
): boolean =>
  exportName === "default" &&
  /(?:^|\/)convex\/schema\.[cm]?tsx?$/u.test(filePath.replaceAll("\\", "/")) &&
  /\bdefineSchema\s*\(/u.test(sourceText)

const isConvexHttpEntrypoint = (
  filePath: string,
  exportName: string,
  declarationText: string,
  sourceText: string,
): boolean =>
  exportName === "default" &&
  /(?:^|\/)convex\/http\.[cm]?tsx?$/u.test(filePath.replaceAll("\\", "/")) &&
  (/\bhttpRouter\s*\(/u.test(declarationText) || /\bhttpRouter\s*\(/u.test(sourceText))

export default convexProjectModule
