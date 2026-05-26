import { Effect } from "effect"
import {
  defineProcessor,
  defineProjectModule,
  markTypeScriptExportFrameworkConsumed,
  type TypeScriptExportReachabilityValue,
} from "@skastr0/pulsar-project-module-sdk"

export const NEXTJS_PROJECT_MODULE_ID = "@skastr0/pulsar-project-module-nextjs" as const
export const NEXTJS_APP_ROUTER_FRAMEWORK_ID = "nextjs-app-router" as const
export const NEXTJS_APP_ROUTER_EXPORT_RULE_ID = "nextjs.app-router.export-contract.v1" as const

const NEXTJS_APP_ROUTER_FRAMEWORK_NAME = "Next App Router"

export const nextjsProjectModule = defineProjectModule({
  id: NEXTJS_PROJECT_MODULE_ID,
  version: "0.1.1",
  scope: "framework",
  source: "package",
  processors: [
    defineProcessor({
      id: "nextjs-app-router-export-contracts",
      slot: "typescript.export-reachability",
      role: "resolver",
      priority: 20,
      fingerprint: "nextjs-app-router-export-contracts-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          const contract = nextAppRouterExportContract(current.value)
          if (contract === undefined) return current

          return markTypeScriptExportFrameworkConsumed(current, runtime, {
            frameworkId: NEXTJS_APP_ROUTER_FRAMEWORK_ID,
            frameworkName: NEXTJS_APP_ROUTER_FRAMEWORK_NAME,
            contractId: contract.id,
            ruleId: NEXTJS_APP_ROUTER_EXPORT_RULE_ID,
            reason: `Consumed by Next App Router ${contract.description}`,
            evidence: [
              { kind: "path", value: current.value.exportFile },
              { kind: "symbol", value: current.value.exportName },
              { kind: "next-app-router-contract", value: contract.id },
            ],
            metadata: {
              contractKind: contract.kind,
              fileConvention: contract.fileConvention,
            },
          })
        }),
    }),
  ],
})

export interface NextAppRouterExportContract {
  readonly id: string
  readonly kind:
    | "route-component"
    | "route-handler"
    | "route-segment-config"
    | "metadata-image"
    | "metadata-route"
    | "file-convention"
  readonly fileConvention: string
  readonly description: string
}

export const nextAppRouterExportContract = (
  value: TypeScriptExportReachabilityValue,
): NextAppRouterExportContract | undefined => {
  const convention = appRouterFileConvention(value.exportFile)
  if (convention === undefined) return undefined
  return contractForConvention(convention, value.exportName)
}

type AppRouterFileConvention =
  | "page"
  | "layout"
  | "route"
  | "metadata-image"
  | "sitemap"
  | "metadata-route"
  | "component-convention"

const contractForConvention = (
  convention: AppRouterFileConvention,
  exportName: string,
): NextAppRouterExportContract | undefined => {
  if (
    (convention === "page" || convention === "layout") &&
    PAGE_LAYOUT_EXPORTS.has(exportName)
  ) {
    return nextContract(
      exportName,
      routeSegmentConfigExports.has(exportName) ? "route-segment-config" : "route-component",
      convention,
    )
  }

  if (convention === "route" && ROUTE_EXPORTS.has(exportName)) {
    return nextContract(
      exportName,
      routeSegmentConfigExports.has(exportName) ? "route-segment-config" : "route-handler",
      convention,
    )
  }

  if (convention === "metadata-image" && METADATA_IMAGE_EXPORTS.has(exportName)) {
    return nextContract(
      exportName,
      routeSegmentConfigExports.has(exportName) ? "route-segment-config" : "metadata-image",
      convention,
    )
  }

  if (convention === "sitemap" && SITEMAP_EXPORTS.has(exportName)) {
    return nextContract(exportName, "metadata-route", convention)
  }

  if (convention === "metadata-route" && exportName === "default") {
    return nextContract(exportName, "metadata-route", convention)
  }

  if (convention === "component-convention" && exportName === "default") {
    return nextContract(exportName, "file-convention", convention)
  }

  return undefined
}

const nextContract = (
  exportName: string,
  kind: NextAppRouterExportContract["kind"],
  fileConvention: string,
): NextAppRouterExportContract => ({
  id: `${NEXTJS_APP_ROUTER_FRAMEWORK_ID}.${fileConvention}.${exportName}`,
  kind,
  fileConvention,
  description: `${fileConvention} export contract`,
})

const routeSegmentConfigExports = new Set([
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
])

const PAGE_LAYOUT_EXPORTS = new Set([
  "default",
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "generateStaticParams",
  ...routeSegmentConfigExports,
])

const ROUTE_EXPORTS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "generateStaticParams",
  ...routeSegmentConfigExports,
])

const METADATA_IMAGE_EXPORTS = new Set([
  "default",
  "alt",
  "size",
  "contentType",
  "generateImageMetadata",
  ...routeSegmentConfigExports,
])

const SITEMAP_EXPORTS = new Set(["default", "generateSitemaps"])

const METADATA_IMAGE_FILES = new Set([
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
])

const METADATA_ROUTE_FILES = new Set(["robots", "manifest"])

const COMPONENT_CONVENTION_FILES = new Set([
  "default",
  "error",
  "forbidden",
  "global-error",
  "loading",
  "not-found",
  "template",
  "unauthorized",
])

const APP_ROUTER_SCRIPT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const
const ROUTE_HANDLER_EXTENSIONS = new Set([".ts", ".js"])

const appRouterFileConvention = (filePath: string): AppRouterFileConvention | undefined => {
  const normalized = filePath.replaceAll("\\", "/")
  const segments = normalized.split("/").filter(Boolean)
  const appIndex = segments.lastIndexOf("app")
  if (appIndex < 0 || appIndex >= segments.length - 1) return undefined

  const fileName = segments[segments.length - 1]
  if (fileName === undefined) return undefined
  const parsed = stripAppRouterScriptExtension(fileName)
  if (parsed === undefined) return undefined
  const { baseName, extension } = parsed

  if (baseName === "page") return "page"
  if (baseName === "layout") return "layout"
  if (baseName === "route" && ROUTE_HANDLER_EXTENSIONS.has(extension)) return "route"
  if (METADATA_IMAGE_FILES.has(baseName)) return "metadata-image"
  if (baseName === "sitemap") return "sitemap"
  if (METADATA_ROUTE_FILES.has(baseName)) return "metadata-route"
  if (COMPONENT_CONVENTION_FILES.has(baseName)) return "component-convention"
  return undefined
}

const stripAppRouterScriptExtension = (
  fileName: string,
): { readonly baseName: string; readonly extension: string } | undefined => {
  for (const extension of APP_ROUTER_SCRIPT_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return {
        baseName: fileName.slice(0, -extension.length),
        extension,
      }
    }
  }
  return undefined
}

export default nextjsProjectModule
