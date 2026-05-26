import { readFile, readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import type {
  CalibrationConfidence,
  CalibrationEvidenceRef,
} from "@skastr0/pulsar-core/calibration"
import { NEXTJS_APP_ROUTER_FRAMEWORK_ID } from "@skastr0/pulsar-project-module-nextjs"
import { Effect } from "effect"

export interface DetectedRuntimeFramework {
  readonly id: string
  readonly name: string
  readonly confidence: CalibrationConfidence
  readonly evidence: ReadonlyArray<CalibrationEvidenceRef>
}

interface NextDetectionFacts {
  readonly dependencyPaths: ReadonlyArray<string>
  readonly configPaths: ReadonlyArray<string>
  readonly routeFiles: ReadonlyArray<{
    readonly path: string
    readonly convention: string
  }>
}

const NEXTJS_APP_ROUTER_FRAMEWORK_NAME = "Next App Router"
const EVIDENCE_PATH_LIMIT = 8

const FRAMEWORK_DETECTION_SKIP_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".pulsar",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "gen",
  "generated",
  "node_modules",
  "out",
  "target",
  "vendor",
])

const NEXT_CONFIG_FILES = new Set([
  "next.config.js",
  "next.config.cjs",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cts",
  "next.config.mts",
])

const APP_ROUTER_FILE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const
const ROUTE_HANDLER_FILE_EXTENSIONS = new Set([".ts", ".js"])

const PAGE_LAYOUT_FILES = new Set(["page", "layout"])
const METADATA_IMAGE_FILES = new Set([
  "opengraph-image",
  "twitter-image",
  "icon",
  "apple-icon",
])
const METADATA_ROUTE_FILES = new Set(["robots", "manifest", "sitemap"])
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

export const detectNextAppRouterFramework = (
  repoRoot: string,
): Effect.Effect<DetectedRuntimeFramework | undefined, Error, never> =>
  Effect.gen(function* () {
    const facts = yield* collectNextDetectionFacts(repoRoot)
    if (facts.dependencyPaths.length > 0 && facts.routeFiles.length > 0) {
      return nextDetection("high", facts)
    }
    if (facts.dependencyPaths.length > 0 && facts.configPaths.length > 0) {
      return nextDetection("medium", facts)
    }
    if (facts.routeFiles.length > 0) {
      return nextDetection("low", facts)
    }
    return undefined
  })

const nextDetection = (
  confidence: CalibrationConfidence,
  facts: NextDetectionFacts,
): DetectedRuntimeFramework => ({
  id: NEXTJS_APP_ROUTER_FRAMEWORK_ID,
  name: NEXTJS_APP_ROUTER_FRAMEWORK_NAME,
  confidence,
  evidence: nextEvidence(facts),
})

const collectNextDetectionFacts = (
  repoRoot: string,
): Effect.Effect<NextDetectionFacts, Error, never> =>
  Effect.gen(function* () {
    const dependencyPaths = new Set<string>()
    const configPaths = new Set<string>()
    const routeFiles = new Map<string, string>()

    const visit = (dir: string): Effect.Effect<void, Error, never> =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: () => readdir(dir, { withFileTypes: true }),
          catch: (cause) => new Error(`Failed to scan ${dir}: ${String(cause)}`),
        })

        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          const fullPath = join(dir, entry.name)
          const relPath = relative(repoRoot, fullPath).replaceAll("\\", "/")
          if (entry.isDirectory()) {
            if (!shouldSkipDirectory(entry.name)) yield* visit(fullPath)
            continue
          }
          if (!entry.isFile()) continue

          if (entry.name === "package.json") {
            const declaresNext = yield* packageJsonDeclaresNext(fullPath)
            if (declaresNext) dependencyPaths.add(relPath)
          }
          if (NEXT_CONFIG_FILES.has(entry.name)) configPaths.add(relPath)

          const convention = appRouterRouteFileConvention(relPath)
          if (convention !== undefined) routeFiles.set(relPath, convention)
        }
      })

    yield* visit(repoRoot)

    return {
      dependencyPaths: [...dependencyPaths].sort((left, right) => left.localeCompare(right)),
      configPaths: [...configPaths].sort((left, right) => left.localeCompare(right)),
      routeFiles: [...routeFiles]
        .map(([path, convention]) => ({ path, convention }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }
  })

const packageJsonDeclaresNext = (path: string): Effect.Effect<boolean, Error, never> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => new Error(`Failed to read ${path}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as Record<string, unknown>,
      catch: (cause) => new Error(`Failed to parse ${path}: ${String(cause)}`),
    })
    return collectDependencyNames(parsed).has("next")
  })

const collectDependencyNames = (packageJson: Record<string, unknown>): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const blockName of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const block = packageJson[blockName]
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue
    for (const name of Object.keys(block).sort()) names.add(name)
  }
  return names
}

const shouldSkipDirectory = (name: string): boolean =>
  FRAMEWORK_DETECTION_SKIP_DIRECTORIES.has(name)

const appRouterRouteFileConvention = (relPath: string): string | undefined => {
  const normalized = relPath.replaceAll("\\", "/")
  const segments = normalized.split("/").filter(Boolean)
  const appIndex = segments.lastIndexOf("app")
  if (appIndex < 0 || appIndex >= segments.length - 1) return undefined

  const fileName = segments[segments.length - 1]
  if (fileName === undefined) return undefined
  const parsed = parseAppRouterFileName(fileName)
  if (parsed === undefined) return undefined

  if (PAGE_LAYOUT_FILES.has(parsed.baseName)) return parsed.baseName
  if (parsed.baseName === "route" && ROUTE_HANDLER_FILE_EXTENSIONS.has(parsed.extension)) {
    return "route"
  }
  if (METADATA_IMAGE_FILES.has(parsed.baseName)) return parsed.baseName
  if (METADATA_ROUTE_FILES.has(parsed.baseName)) return parsed.baseName
  if (COMPONENT_CONVENTION_FILES.has(parsed.baseName)) return parsed.baseName
  return undefined
}

const parseAppRouterFileName = (
  fileName: string,
): { readonly baseName: string; readonly extension: typeof APP_ROUTER_FILE_EXTENSIONS[number] } | undefined => {
  for (const extension of APP_ROUTER_FILE_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return {
        baseName: fileName.slice(0, -extension.length),
        extension,
      }
    }
  }
  return undefined
}

const nextEvidence = (facts: NextDetectionFacts): ReadonlyArray<CalibrationEvidenceRef> => [
  ...facts.dependencyPaths.slice(0, EVIDENCE_PATH_LIMIT).map((path) => ({
    kind: "package-json",
    value: path,
    metadata: {
      dependency: "next",
      totalMatches: facts.dependencyPaths.length,
    },
  })),
  ...facts.routeFiles.slice(0, EVIDENCE_PATH_LIMIT).map((route) => ({
    kind: "path",
    value: route.path,
    metadata: {
      convention: route.convention,
      totalMatches: facts.routeFiles.length,
    },
  })),
  ...facts.configPaths.slice(0, EVIDENCE_PATH_LIMIT).map((path) => ({
    kind: "path",
    value: path,
    metadata: {
      convention: "next.config",
      totalMatches: facts.configPaths.length,
    },
  })),
]
