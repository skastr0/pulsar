import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect, Schema } from "effect"

export class TsAnalysisConfigError extends Schema.TaggedError<TsAnalysisConfigError>()(
  "TsAnalysisConfigError",
  {
    message: Schema.String,
    path: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface DerivedAnalysisConfig {
  readonly originalPath: string
  readonly derivedPath: string
}

export interface AnalysisConfigBundle {
  readonly directory: string
  readonly configs: ReadonlyArray<DerivedAnalysisConfig>
}

const PINNED_COMPILER_OPTIONS = {
  types: [] as const,
  noResolve: true,
  noLib: true,
  noEmit: true,
} as const

export const materializeAnalysisConfigs = Effect.fn("materializeAnalysisConfigs")(function* (
  worktreePath: string,
  originalConfigPaths: ReadonlyArray<string>,
): Effect.fn.Return<AnalysisConfigBundle, TsAnalysisConfigError> {
  if (originalConfigPaths.length === 0) {
    return yield* materializeFallbackConfig(worktreePath)
  }
  const directory = yield* Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "pulsar-ts-analysis-")),
    catch: (cause) =>
      new TsAnalysisConfigError({
        message: "Failed to create analysis config directory",
        cause,
      }),
  })

  const uniqueOriginals = [...new Set(originalConfigPaths.map((path) => resolve(path)))].sort()
  const configs: Array<DerivedAnalysisConfig> = []
  for (const originalPath of uniqueOriginals) {
    const derived = yield* writeDerivedConfig(worktreePath, directory, originalPath)
    configs.push(derived)
  }

  return { directory, configs }
})

const writeDerivedConfig = (
  worktreePath: string,
  directory: string,
  originalPath: string,
): Effect.Effect<DerivedAnalysisConfig, TsAnalysisConfigError> =>
  Effect.gen(function* () {
    const original = yield* readJsonObject(originalPath)
    yield* assertWorktreeOwnedExtends(worktreePath, originalPath, original)
    const derivedPath = derivedConfigPath(directory, worktreePath, originalPath)
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(derivedPath), { recursive: true }),
      catch: (cause) =>
        new TsAnalysisConfigError({
          message: `Failed to create derived config directory for ${originalPath}`,
          path: originalPath,
          cause,
        }),
    })
    const payload = {
      extends: pathToFileURL(originalPath).href,
      compilerOptions: {
        ...PINNED_COMPILER_OPTIONS,
        rootDir: dirname(originalPath).replaceAll("\\", "/"),
        baseUrl: dirname(originalPath).replaceAll("\\", "/"),
      },
      include: rebasePatterns(originalPath, asStringArray(original.include) ?? ["**/*.ts", "**/*.tsx"]),
      ...(asStringArray(original.files) === undefined
        ? {}
        : { files: rebasePatterns(originalPath, asStringArray(original.files) ?? []) }),
      ...(asStringArray(original.exclude) === undefined
        ? {}
        : { exclude: rebasePatterns(originalPath, asStringArray(original.exclude) ?? []) }),
      references: [],
    }
    yield* Effect.tryPromise({
      try: () => writeFile(derivedPath, `${JSON.stringify(payload, null, 2)}\n`),
      catch: (cause) =>
        new TsAnalysisConfigError({
          message: `Failed to write derived analysis config for ${originalPath}`,
          path: originalPath,
          cause,
        }),
    })
    return { originalPath, derivedPath }
  })

const assertWorktreeOwnedExtends = (
  worktreePath: string,
  configPath: string,
  config: Readonly<Record<string, unknown>>,
): Effect.Effect<void, TsAnalysisConfigError> =>
  Effect.gen(function* () {
    const extendsValue = config.extends
    if (extendsValue === undefined) return
    const references = Array.isArray(extendsValue)
      ? extendsValue
      : [extendsValue]
    for (const reference of references) {
      if (typeof reference !== "string") {
        return yield* new TsAnalysisConfigError({
          message: `tsconfig extends must be a string or string array in ${configPath}`,
          path: configPath,
        })
      }
      if (isPackageExtends(reference)) {
        return yield* new TsAnalysisConfigError({
          message:
            `tsconfig ${configPath} extends installed package ${reference}; make that base config repo-owned before scoring`,
          path: configPath,
        })
      }
      const resolved = resolveExtendsPath(configPath, reference)
      if (!isPathInside(worktreePath, resolved)) {
        return yield* new TsAnalysisConfigError({
          message:
            `tsconfig ${configPath} extends ${resolved}, which is outside the scored worktree`,
          path: configPath,
        })
      }
    }
  })

const readJsonObject = (
  path: string,
): Effect.Effect<Readonly<Record<string, unknown>>, TsAnalysisConfigError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) =>
        new TsAnalysisConfigError({
          message: `Failed to read ${path}`,
          path,
          cause,
        }),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(stripJsonc(raw)) as unknown,
      catch: (cause) =>
        new TsAnalysisConfigError({
          message: `Failed to parse ${path}`,
          path,
          cause,
        }),
    })
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return yield* new TsAnalysisConfigError({
        message: `${path} is not a JSON object`,
        path,
      })
    }
    return parsed as Readonly<Record<string, unknown>>
  })

const derivedConfigPath = (
  directory: string,
  worktreePath: string,
  originalPath: string,
): string => {
  const relativeOriginal = relative(worktreePath, originalPath)
  const safeRelative = relativeOriginal === ""
    ? "tsconfig.json"
    : relativeOriginal.split(sep).join("/")
  return join(directory, safeRelative)
}

const isPackageExtends = (reference: string): boolean =>
  !reference.startsWith(".") && !isAbsolute(reference) && !reference.startsWith("file:")

const resolveExtendsPath = (configPath: string, reference: string): string => {
  if (reference.startsWith("file:")) return fileURLToPath(reference)
  const resolved = resolve(dirname(configPath), reference)
  return resolved.endsWith(".json") ? resolved : `${resolved}.json`
}

const isPathInside = (root: string, candidate: string): boolean => {
  const relativePath = relative(resolve(root), resolve(candidate))
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

const stripJsonc = (raw: string): string => {
  let result = ""
  let index = 0
  while (index < raw.length) {
    const char = raw[index]
    const next = raw[index + 1]
    if (char === "\"") {
      result += char
      index += 1
      while (index < raw.length) {
        const current = raw[index]
        result += current
        if (current === "\\" && index + 1 < raw.length) {
          result += raw[index + 1]
          index += 2
          continue
        }
        index += 1
        if (current === "\"") break
      }
      continue
    }
    if (char === "/" && next === "/") {
      index += 2
      while (index < raw.length && raw[index] !== "\n") index += 1
      continue
    }
    if (char === "/" && next === "*") {
      index += 2
      while (index + 1 < raw.length && !(raw[index] === "*" && raw[index + 1] === "/")) index += 1
      index = Math.min(index + 2, raw.length)
      result += " "
      continue
    }
    result += char
    index += 1
  }
  return result
}

const materializeFallbackConfig = (
  worktreePath: string,
): Effect.Effect<AnalysisConfigBundle, TsAnalysisConfigError> =>
  Effect.gen(function* () {
    const directory = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "pulsar-ts-analysis-")),
      catch: (cause) =>
        new TsAnalysisConfigError({
          message: "Failed to create analysis config directory",
          cause,
        }),
    })
    const derivedPath = join(directory, "tsconfig.json")
    const payload = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        ...PINNED_COMPILER_OPTIONS,
      },
      include: [
        `${worktreePath.replaceAll("\\", "/")}/**/*.ts`,
        `${worktreePath.replaceAll("\\", "/")}/**/*.tsx`,
      ],
    }
    yield* Effect.tryPromise({
      try: () => writeFile(derivedPath, `${JSON.stringify(payload, null, 2)}\n`),
      catch: (cause) =>
        new TsAnalysisConfigError({
          message: "Failed to write fallback analysis config",
          cause,
        }),
    })
    return {
      directory,
      configs: [{ originalPath: `${canonicalWorktree(worktreePath)}/tsconfig.json`, derivedPath }],
    }
  })

const canonicalWorktree = (worktreePath: string): string =>
  resolve(worktreePath).replaceAll("\\", "/")

const asStringArray = (value: unknown): ReadonlyArray<string> | undefined => {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === "string")
  return items.length === value.length ? items : undefined
}

const rebasePatterns = (
  originalPath: string,
  patterns: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  patterns.map((pattern) => {
    if (pattern.startsWith("file:") || isAbsolute(pattern)) return pattern
    const negated = pattern.startsWith("!")
    const body = negated ? pattern.slice(1) : pattern
    const resolved = resolve(dirname(originalPath), body).replaceAll("\\", "/")
    return negated ? `!${resolved}` : resolved
  })
export const removeAnalysisConfigBundle = (
  bundle: AnalysisConfigBundle | undefined,
): Effect.Effect<void> =>
  bundle === undefined
    ? Effect.void
    : Effect.promise(() => rm(bundle.directory, { recursive: true, force: true }))
