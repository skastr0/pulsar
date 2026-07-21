import { readFile, readdir } from "node:fs/promises"
import { extname, join, relative } from "node:path"
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

interface DependencyEvidencePath {
  readonly path: string
  readonly dependency: string
}

interface RouteEvidencePath {
  readonly path: string
  readonly convention: string
}

interface ConfigModuleEvidencePath {
  readonly path: string
  readonly moduleSpecifier: string
}

interface SourceToken {
  readonly kind: "punctuation" | "string" | "word"
  readonly value: string
}

interface FrameworkDetectionFacts {
  readonly nextDependencyPaths: ReadonlyArray<DependencyEvidencePath>
  readonly nextConfigPaths: ReadonlyArray<string>
  readonly nextRouteFiles: ReadonlyArray<RouteEvidencePath>
  readonly solidStartDependencyPaths: ReadonlyArray<DependencyEvidencePath>
  readonly solidStartConfigPaths: ReadonlyArray<ConfigModuleEvidencePath>
  readonly solidStartRouteFiles: ReadonlyArray<RouteEvidencePath>
}

const NEXTJS_APP_ROUTER_FRAMEWORK_NAME = "Next App Router"
export const SOLIDJS_START_FRAMEWORK_ID = "solidjs-start"
const SOLIDJS_START_FRAMEWORK_NAME = "SolidStart"
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

const SOLID_START_CONFIG_FILES = new Set([
  "app.config.js",
  "app.config.cjs",
  "app.config.mjs",
  "app.config.ts",
  "app.config.cts",
  "app.config.mts",
  "vite.config.js",
  "vite.config.cjs",
  "vite.config.mjs",
  "vite.config.ts",
  "vite.config.cts",
  "vite.config.mts",
])

const SOLID_START_DEPENDENCIES = ["@solidjs/start", "solid-start"] as const
const SOLID_START_CONFIG_MODULES = ["@solidjs/start/config", "solid-start/vite"] as const

const FRAMEWORK_ROUTE_FILE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const
const ROUTE_HANDLER_FILE_EXTENSIONS = new Set([".ts", ".js"])
const METADATA_ROUTE_FILE_EXTENSIONS = new Set([".ts", ".js"])

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

export const detectRuntimeFrameworks = (
  repoRoot: string,
): Effect.Effect<ReadonlyArray<DetectedRuntimeFramework>, never, never> =>
  Effect.gen(function* () {
    const facts = yield* collectFrameworkDetectionFacts(repoRoot)
    const detected = [
      detectNextAppRouterFromFacts(facts),
      detectSolidStartFromFacts(facts),
    ].filter((framework): framework is DetectedRuntimeFramework => framework !== undefined)
    return detected.sort((left, right) => compareText(left.id, right.id))
  })

const detectNextAppRouterFromFacts = (
  facts: FrameworkDetectionFacts,
): DetectedRuntimeFramework | undefined => {
  if (facts.nextDependencyPaths.length === 0) return undefined
  const confidence: CalibrationConfidence =
    facts.nextRouteFiles.length > 0
      ? "high"
      : facts.nextConfigPaths.length > 0
        ? "medium"
        : "low"
  return frameworkDetection(
    NEXTJS_APP_ROUTER_FRAMEWORK_ID,
    NEXTJS_APP_ROUTER_FRAMEWORK_NAME,
    confidence,
    nextEvidence(facts),
  )
}

const detectSolidStartFromFacts = (
  facts: FrameworkDetectionFacts,
): DetectedRuntimeFramework | undefined => {
  const hasDependency = facts.solidStartDependencyPaths.length > 0
  const hasConfigImport = facts.solidStartConfigPaths.length > 0
  const hasRouteConvention = facts.solidStartRouteFiles.length > 0

  if (
    (hasDependency && (hasConfigImport || hasRouteConvention)) ||
    (hasConfigImport && hasRouteConvention)
  ) {
    return frameworkDetection(
      SOLIDJS_START_FRAMEWORK_ID,
      SOLIDJS_START_FRAMEWORK_NAME,
      "high",
      solidStartEvidence(facts),
    )
  }
  if (hasDependency || hasConfigImport) {
    return frameworkDetection(
      SOLIDJS_START_FRAMEWORK_ID,
      SOLIDJS_START_FRAMEWORK_NAME,
      "medium",
      solidStartEvidence(facts),
    )
  }
  return undefined
}

const frameworkDetection = (
  id: string,
  name: string,
  confidence: CalibrationConfidence,
  evidence: ReadonlyArray<CalibrationEvidenceRef>,
): DetectedRuntimeFramework => ({ id, name, confidence, evidence })

const collectFrameworkDetectionFacts = (
  repoRoot: string,
): Effect.Effect<FrameworkDetectionFacts, never, never> =>
  Effect.gen(function* () {
    const nextDependencyPaths = new Map<string, DependencyEvidencePath>()
    const nextConfigPaths = new Set<string>()
    const nextRouteFiles = new Map<string, string>()
    const solidStartDependencyPaths = new Map<string, DependencyEvidencePath>()
    const solidStartConfigPaths = new Map<string, ConfigModuleEvidencePath>()
    const solidStartRouteFiles = new Map<string, string>()

    const visit = (dir: string): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const entries = yield* Effect.either(Effect.tryPromise({
          try: () => readdir(dir, { withFileTypes: true }),
          catch: (cause) => new Error(`Failed to scan ${dir}: ${String(cause)}`),
        }))
        if (entries._tag === "Left") return

        for (const entry of entries.right.sort((left, right) =>
          compareText(left.name, right.name)
        )) {
          const fullPath = join(dir, entry.name)
          const relPath = relative(repoRoot, fullPath).replaceAll("\\", "/")
          if (entry.isDirectory()) {
            if (!shouldSkipDirectory(entry.name)) yield* visit(fullPath)
            continue
          }
          if (!entry.isFile()) continue

          if (entry.name === "package.json") {
            const dependencies = yield* packageJsonDependencyNames(fullPath)
            if (dependencies.has("next")) {
              nextDependencyPaths.set(`${relPath}:next`, {
                path: relPath,
                dependency: "next",
              })
            }
            for (const dependency of SOLID_START_DEPENDENCIES) {
              if (dependencies.has(dependency)) {
                solidStartDependencyPaths.set(`${relPath}:${dependency}`, {
                  path: relPath,
                  dependency,
                })
              }
            }
          }

          if (NEXT_CONFIG_FILES.has(entry.name)) nextConfigPaths.add(relPath)
          if (SOLID_START_CONFIG_FILES.has(entry.name)) {
            const moduleSpecifier = yield* solidStartConfigModuleSpecifier(fullPath)
            if (moduleSpecifier !== undefined) {
              solidStartConfigPaths.set(`${relPath}:${moduleSpecifier}`, {
                path: relPath,
                moduleSpecifier,
              })
            }
          }

          const nextConvention = appRouterRouteFileConvention(relPath)
          if (nextConvention !== undefined) nextRouteFiles.set(relPath, nextConvention)

          const solidStartConvention = solidStartRouteFileConvention(relPath)
          if (solidStartConvention !== undefined) {
            solidStartRouteFiles.set(relPath, solidStartConvention)
          }
        }
      })

    yield* visit(repoRoot)

    return {
      nextDependencyPaths: sortedMapValues(nextDependencyPaths, dependencyEvidenceKey),
      nextConfigPaths: [...nextConfigPaths].sort(compareText),
      nextRouteFiles: sortedRouteEvidence(nextRouteFiles),
      solidStartDependencyPaths: sortedMapValues(
        solidStartDependencyPaths,
        dependencyEvidenceKey,
      ),
      solidStartConfigPaths: sortedMapValues(
        solidStartConfigPaths,
        (config) => `${config.path}:${config.moduleSpecifier}`,
      ),
      solidStartRouteFiles: sortedRouteEvidence(solidStartRouteFiles),
    }
  })

const packageJsonDependencyNames = (
  path: string,
): Effect.Effect<ReadonlySet<string>, never, never> =>
  Effect.gen(function* () {
    const raw = yield* Effect.either(Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => new Error(`Failed to read ${path}: ${String(cause)}`),
    }))
    if (raw._tag === "Left") return new Set<string>()

    const parsed = yield* Effect.either(Effect.try({
      try: () => JSON.parse(raw.right) as Record<string, unknown>,
      catch: (cause) => new Error(`Failed to parse ${path}: ${String(cause)}`),
    }))
    if (parsed._tag === "Left") return new Set<string>()

    return collectDependencyNames(parsed.right)
  })

const solidStartConfigModuleSpecifier = (
  path: string,
): Effect.Effect<string | undefined, never, never> =>
  Effect.gen(function* () {
    const source = yield* Effect.either(Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => new Error(`Failed to read ${path}: ${String(cause)}`),
    }))
    if (source._tag === "Left") return undefined
    return SOLID_START_CONFIG_MODULES.find((moduleSpecifier) =>
      sourceImportsModule(source.right, moduleSpecifier)
    )
  })

const sourceImportsModule = (source: string, moduleSpecifier: string): boolean => {
  const tokens = tokenizeJavaScriptSource(source)
  return tokens.some((_, index) => tokenImportsModule(tokens, index, moduleSpecifier))
}

const tokenImportsModule = (
  tokens: ReadonlyArray<SourceToken>,
  index: number,
  moduleSpecifier: string,
): boolean =>
  importTokenReferencesModule(tokens, index, moduleSpecifier) ||
  requireTokenReferencesModule(tokens, index, moduleSpecifier)

const importTokenReferencesModule = (
  tokens: ReadonlyArray<SourceToken>,
  index: number,
  moduleSpecifier: string,
): boolean => {
  const token = tokens[index]
  if (
    token?.kind !== "word" ||
    token.value !== "import" ||
    tokens[index - 1]?.value === "." ||
    tokens[index + 1]?.value === "."
  ) {
    return false
  }

  return (
    tokenHasStringValue(tokens[index + 1], moduleSpecifier) ||
    (
      tokens[index + 1]?.value === "(" &&
      tokenHasStringValue(tokens[index + 2], moduleSpecifier)
    ) ||
    staticImportModuleSpecifier(tokens, index) === moduleSpecifier
  )
}

const requireTokenReferencesModule = (
  tokens: ReadonlyArray<SourceToken>,
  index: number,
  moduleSpecifier: string,
): boolean =>
  tokens[index]?.kind === "word" &&
  tokens[index]?.value === "require" &&
  tokens[index - 1]?.value !== "." &&
  tokens[index + 1]?.value === "(" &&
  tokenHasStringValue(tokens[index + 2], moduleSpecifier)

const staticImportModuleSpecifier = (
  tokens: ReadonlyArray<SourceToken>,
  importIndex: number,
): string | undefined => {
  const limit = Math.min(tokens.length, importIndex + 128)
  for (let index = importIndex + 1; index < limit; index += 1) {
    const token = tokens[index]
    if (token?.value === ";") return undefined
    if (token?.kind !== "word" || token.value !== "from") continue
    const specifier = tokens[index + 1]
    return specifier?.kind === "string" ? specifier.value : undefined
  }
  return undefined
}

const tokenHasStringValue = (
  token: SourceToken | undefined,
  value: string,
): boolean => token?.kind === "string" && token.value === value

const tokenizeJavaScriptSource = (source: string): ReadonlyArray<SourceToken> => {
  const tokens: Array<SourceToken> = []
  let index = 0

  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (current === undefined) break

    if (/\s/.test(current)) {
      index += 1
      continue
    }
    if (current === "/" && next === "/") {
      index = skipLineComment(source, index + 2)
      continue
    }
    if (current === "/" && next === "*") {
      index = skipBlockComment(source, index + 2)
      continue
    }
    if (current === '"' || current === "'") {
      const stringToken = readQuotedStringToken(source, index, current)
      tokens.push(stringToken.token)
      index = stringToken.nextIndex
      continue
    }
    if (current === "`") {
      index = skipTemplateLiteral(source, index + 1)
      continue
    }
    if (isIdentifierStart(current)) {
      let end = index + 1
      while (end < source.length && isIdentifierPart(source[end])) end += 1
      tokens.push({ kind: "word", value: source.slice(index, end) })
      index = end
      continue
    }

    tokens.push({ kind: "punctuation", value: current })
    index += 1
  }

  return tokens
}

const skipLineComment = (source: string, start: number): number =>
  skipDelimitedSource(source, start, "\n", 1)

const skipBlockComment = (source: string, start: number): number =>
  skipDelimitedSource(source, start, "*/", 2)

const skipDelimitedSource = (
  source: string,
  start: number,
  delimiter: string,
  delimiterLength: number,
): number => {
  const close = source.indexOf(delimiter, start)
  return close < 0 ? source.length : close + delimiterLength
}

const readQuotedStringToken = (
  source: string,
  quoteIndex: number,
  quote: string,
): { readonly token: SourceToken; readonly nextIndex: number } => {
  let value = ""
  let index = quoteIndex + 1
  while (index < source.length) {
    const current = source[index]
    if (current === "\\") {
      const escaped = source[index + 1]
      if (escaped === undefined) {
        return { token: { kind: "string", value }, nextIndex: source.length }
      }
      value += `\\${escaped}`
      index += 2
      continue
    }
    if (current === quote) {
      return { token: { kind: "string", value }, nextIndex: index + 1 }
    }
    if (current !== undefined) value += current
    index += 1
  }
  return { token: { kind: "string", value }, nextIndex: source.length }
}

const skipTemplateLiteral = (source: string, start: number): number => {
  let index = start
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2
      continue
    }
    if (source[index] === "`") return index + 1
    index += 1
  }
  return source.length
}

const isIdentifierStart = (value: string): boolean => /[A-Za-z_$]/.test(value)

const isIdentifierPart = (value: string | undefined): boolean =>
  value !== undefined && /[A-Za-z0-9_$]/.test(value)

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
    for (const name of Object.keys(block).sort(compareText)) names.add(name)
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
  const parsed = frameworkRouteFileParts(fileName)
  if (parsed === undefined) return undefined

  if (PAGE_LAYOUT_FILES.has(parsed.baseName)) return parsed.baseName
  if (parsed.baseName === "route" && ROUTE_HANDLER_FILE_EXTENSIONS.has(parsed.extension)) {
    return "route"
  }
  if (METADATA_IMAGE_FILES.has(parsed.baseName)) return parsed.baseName
  if (
    METADATA_ROUTE_FILES.has(parsed.baseName) &&
    METADATA_ROUTE_FILE_EXTENSIONS.has(parsed.extension)
  ) {
    return parsed.baseName
  }
  if (COMPONENT_CONVENTION_FILES.has(parsed.baseName)) return parsed.baseName
  return undefined
}

const solidStartRouteFileConvention = (relPath: string): string | undefined => {
  const segments = relPath.replaceAll("\\", "/").split("/").filter(Boolean)
  const fileName = segments[segments.length - 1]
  if (fileName === undefined || frameworkRouteFileParts(fileName) === undefined) {
    return undefined
  }

  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index] === "src" && segments[index + 1] === "routes") {
      return "solid-start-file-route"
    }
  }
  return undefined
}

const frameworkRouteFileParts = (
  fileName: string,
): {
  readonly baseName: string
  readonly extension: typeof FRAMEWORK_ROUTE_FILE_EXTENSIONS[number]
} | undefined => {
  const extension = extname(fileName)
  if (!isFrameworkRouteFileExtension(extension)) return undefined
  return {
    baseName: fileName.slice(0, -extension.length),
    extension,
  }
}

const isFrameworkRouteFileExtension = (
  extension: string,
): extension is typeof FRAMEWORK_ROUTE_FILE_EXTENSIONS[number] =>
  FRAMEWORK_ROUTE_FILE_EXTENSIONS.some((candidate) => candidate === extension)

const nextEvidence = (
  facts: FrameworkDetectionFacts,
): ReadonlyArray<CalibrationEvidenceRef> => [
  ...dependencyEvidence(facts.nextDependencyPaths),
  ...facts.nextRouteFiles.slice(0, EVIDENCE_PATH_LIMIT).map((route) => ({
    kind: "path",
    value: route.path,
    metadata: {
      convention: route.convention,
      totalMatches: facts.nextRouteFiles.length,
    },
  })),
  ...facts.nextConfigPaths.slice(0, EVIDENCE_PATH_LIMIT).map((path) => ({
    kind: "path",
    value: path,
    metadata: {
      convention: "next.config",
      totalMatches: facts.nextConfigPaths.length,
    },
  })),
]

const solidStartEvidence = (
  facts: FrameworkDetectionFacts,
): ReadonlyArray<CalibrationEvidenceRef> => [
  ...dependencyEvidence(facts.solidStartDependencyPaths),
  ...facts.solidStartRouteFiles.slice(0, EVIDENCE_PATH_LIMIT).map((route) => ({
    kind: "path",
    value: route.path,
    metadata: {
      convention: route.convention,
      totalMatches: facts.solidStartRouteFiles.length,
    },
  })),
  ...facts.solidStartConfigPaths.slice(0, EVIDENCE_PATH_LIMIT).map((config) => ({
    kind: "path",
    value: config.path,
    metadata: {
      convention: "solid-start-config-import",
      moduleSpecifier: config.moduleSpecifier,
      totalMatches: facts.solidStartConfigPaths.length,
    },
  })),
]

const dependencyEvidence = (
  paths: ReadonlyArray<DependencyEvidencePath>,
): ReadonlyArray<CalibrationEvidenceRef> =>
  paths.slice(0, EVIDENCE_PATH_LIMIT).map((entry) => ({
    kind: "package-json",
    value: entry.path,
    metadata: {
      dependency: entry.dependency,
      totalMatches: paths.length,
    },
  }))

const sortedRouteEvidence = (
  routes: ReadonlyMap<string, string>,
): ReadonlyArray<RouteEvidencePath> =>
  [...routes]
    .map(([path, convention]) => ({ path, convention }))
    .sort((left, right) => compareText(left.path, right.path))

const sortedMapValues = <Value>(
  values: ReadonlyMap<string, Value>,
  key: (value: Value) => string,
): ReadonlyArray<Value> =>
  [...values.values()].sort((left, right) => compareText(key(left), key(right)))

const dependencyEvidenceKey = (entry: DependencyEvidencePath): string =>
  `${entry.path}:${entry.dependency}`

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0
