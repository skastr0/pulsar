import { Effect } from "effect"
import {
  defineProcessor,
  defineProjectModule,
  hashCalibrationValue,
  markTypeScriptExportFrameworkConsumed,
  type TypeScriptExportReachabilityValue,
} from "@skastr0/pulsar-project-module-sdk"

export const NEXTJS_PROJECT_MODULE_ID = "@skastr0/pulsar-project-module-nextjs" as const
export const NEXTJS_APP_ROUTER_FRAMEWORK_ID = "nextjs-app-router" as const
export const NEXTJS_APP_ROUTER_EXPORT_RULE_ID = "nextjs.app-router.export-contract.v1" as const
const NEXTJS_APP_ROUTER_PROCESSOR_FINGERPRINT = "nextjs-app-router-export-contracts-v2"

const NEXTJS_APP_ROUTER_FRAMEWORK_NAME = "Next App Router"

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
  | typeof METADATA_IMAGE_FILE_NAMES[number]
  | "sitemap"
  | typeof METADATA_ROUTE_FILE_NAMES[number]
  | typeof COMPONENT_CONVENTION_FILE_NAMES[number]

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

  if (isMetadataImageConvention(convention) && METADATA_IMAGE_EXPORTS.has(exportName)) {
    return nextContract(
      exportName,
      routeSegmentConfigExports.has(exportName) ? "route-segment-config" : "metadata-image",
      convention,
    )
  }

  if (convention === "sitemap" && SITEMAP_EXPORTS.has(exportName)) {
    return nextContract(
      exportName,
      routeSegmentConfigExports.has(exportName) ? "route-segment-config" : "metadata-route",
      convention,
    )
  }

  if (isMetadataRouteConvention(convention) && METADATA_ROUTE_EXPORTS.has(exportName)) {
    return nextContract(
      exportName,
      routeSegmentConfigExports.has(exportName) ? "route-segment-config" : "metadata-route",
      convention,
    )
  }

  if (isComponentConvention(convention) && exportName === "default") {
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

const SITEMAP_EXPORTS = new Set([
  "default",
  "generateSitemaps",
  ...routeSegmentConfigExports,
])

const METADATA_ROUTE_EXPORTS = new Set(["default", ...routeSegmentConfigExports])

const METADATA_IMAGE_FILE_NAMES = [
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
] as const
const METADATA_IMAGE_FILES = new Set<string>(METADATA_IMAGE_FILE_NAMES)

const METADATA_ROUTE_FILE_NAMES = ["robots", "manifest"] as const
const METADATA_ROUTE_FILES = new Set<string>(METADATA_ROUTE_FILE_NAMES)

const COMPONENT_CONVENTION_FILE_NAMES = [
  "default",
  "error",
  "forbidden",
  "global-error",
  "loading",
  "not-found",
  "template",
  "unauthorized",
] as const
const COMPONENT_CONVENTION_FILES = new Set<string>(COMPONENT_CONVENTION_FILE_NAMES)

const APP_ROUTER_SCRIPT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const
const ROUTE_HANDLER_EXTENSIONS = new Set([".ts", ".js"])
const METADATA_ROUTE_EXTENSIONS = new Set([".ts", ".js"])

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
  if (METADATA_IMAGE_FILES.has(baseName)) {
    return baseName as typeof METADATA_IMAGE_FILE_NAMES[number]
  }
  if (baseName === "sitemap" && METADATA_ROUTE_EXTENSIONS.has(extension)) return "sitemap"
  if (METADATA_ROUTE_FILES.has(baseName) && METADATA_ROUTE_EXTENSIONS.has(extension)) {
    return baseName as typeof METADATA_ROUTE_FILE_NAMES[number]
  }
  if (COMPONENT_CONVENTION_FILES.has(baseName)) {
    return baseName as typeof COMPONENT_CONVENTION_FILE_NAMES[number]
  }
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

const isMetadataImageConvention = (
  convention: AppRouterFileConvention,
): convention is typeof METADATA_IMAGE_FILE_NAMES[number] =>
  METADATA_IMAGE_FILES.has(convention)

const isMetadataRouteConvention = (
  convention: AppRouterFileConvention,
): convention is typeof METADATA_ROUTE_FILE_NAMES[number] =>
  METADATA_ROUTE_FILES.has(convention)

const isComponentConvention = (
  convention: AppRouterFileConvention,
): convention is typeof COMPONENT_CONVENTION_FILE_NAMES[number] =>
  COMPONENT_CONVENTION_FILES.has(convention)

const nextAppRouterContractSourceFingerprint = (): string =>
  hashCalibrationValue({
    frameworkId: NEXTJS_APP_ROUTER_FRAMEWORK_ID,
    ruleId: NEXTJS_APP_ROUTER_EXPORT_RULE_ID,
    processorFingerprint: NEXTJS_APP_ROUTER_PROCESSOR_FINGERPRINT,
    pageLayoutExports: [...PAGE_LAYOUT_EXPORTS].sort(),
    routeExports: [...ROUTE_EXPORTS].sort(),
    metadataImageFiles: [...METADATA_IMAGE_FILE_NAMES],
    metadataImageExports: [...METADATA_IMAGE_EXPORTS].sort(),
    sitemapExports: [...SITEMAP_EXPORTS].sort(),
    metadataRouteFiles: [...METADATA_ROUTE_FILE_NAMES],
    metadataRouteExports: [...METADATA_ROUTE_EXPORTS].sort(),
    componentConventionFiles: [...COMPONENT_CONVENTION_FILE_NAMES],
    appRouterScriptExtensions: [...APP_ROUTER_SCRIPT_EXTENSIONS],
    routeHandlerExtensions: [...ROUTE_HANDLER_EXTENSIONS].sort(),
    metadataRouteExtensions: [...METADATA_ROUTE_EXTENSIONS].sort(),
  })

export const nextjsProjectModule = defineProjectModule({
  id: NEXTJS_PROJECT_MODULE_ID,
  version: "0.1.1",
  scope: "framework",
  source: "package",
  sourceFingerprint: nextAppRouterContractSourceFingerprint(),
  processors: [
    defineProcessor({
      id: "nextjs-app-router-export-contracts",
      slot: "typescript.export-reachability",
      role: "resolver",
      priority: 20,
      fingerprint: NEXTJS_APP_ROUTER_PROCESSOR_FINGERPRINT,
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

export default nextjsProjectModule
