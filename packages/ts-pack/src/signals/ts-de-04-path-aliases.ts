import { readFile, readdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { PackageInfo } from "../discovery.js"

export type TsconfigPathAlias = {
  readonly pattern: string
  readonly replacements: ReadonlyArray<string>
  readonly baseDir: string
}

type TsconfigAliasConfig = {
  readonly aliases: ReadonlyArray<TsconfigPathAlias>
  readonly baseDir: string
}

export const readPathAliasesByPackage = async (
  packages: ReadonlyArray<PackageInfo>,
): Promise<ReadonlyMap<string, ReadonlyArray<TsconfigPathAlias>>> => {
  const entries = await Promise.all(
    packages.map(async (pkg): Promise<[string, ReadonlyArray<TsconfigPathAlias>]> => [
      pkg.path,
      await readPathAliases(pkg.tsconfigPath),
    ]),
  )
  return new Map(entries)
}

export const isLocalPathAliasUsage = (
  moduleSpecifier: string,
  packageName: string,
  owningPackage: PackageInfo,
  aliases: ReadonlyArray<TsconfigPathAlias> | undefined,
  worktreePath: string,
): boolean => {
  if (aliases === undefined || aliases.length === 0) return false

  return aliases.some((alias) =>
    resolvePathAliasTargets(alias, moduleSpecifier).some(
      (target) =>
        !target.includes("/node_modules/") &&
        (target === owningPackage.path ||
          target.startsWith(`${owningPackage.path}/`) ||
          target.startsWith(`${worktreePath}/`)),
    ),
  )
}

const readPathAliases = async (
  tsconfigPath: string,
): Promise<ReadonlyArray<TsconfigPathAlias>> => {
  const config = await readPathAliasConfig(tsconfigPath, new Set<string>())
  return config.aliases
}

const readPathAliasConfig = async (
  tsconfigPath: string,
  visited: Set<string>,
): Promise<TsconfigAliasConfig> => {
  const loaded = await readTsconfig(tsconfigPath)
  if (loaded === undefined) return { aliases: [], baseDir: dirname(tsconfigPath) }

  const normalizedPath = resolve(loaded.path)
  if (visited.has(normalizedPath)) return { aliases: [], baseDir: dirname(normalizedPath) }
  visited.add(normalizedPath)

  const inherited = await readInheritedAliasConfig(loaded.config, normalizedPath, visited)
  const compilerOptions = asRecord(loaded.config.compilerOptions)
  const baseUrl = asString(compilerOptions?.baseUrl)
  const baseDir = baseUrl === undefined ? inherited.baseDir : resolve(dirname(normalizedPath), baseUrl)
  const paths = asRecord(compilerOptions?.paths)
  const baseUrlAliases = baseUrl === undefined ? [] : await implicitBaseUrlAliases(baseDir)

  if (paths === undefined) return { aliases: [...inherited.aliases, ...baseUrlAliases], baseDir }

  return {
    aliases: [...pathAliasesFromCompilerOptions(paths, baseDir), ...baseUrlAliases],
    baseDir,
  }
}

const readInheritedAliasConfig = async (
  config: Record<string, unknown>,
  tsconfigPath: string,
  visited: Set<string>,
): Promise<TsconfigAliasConfig> => {
  const extendedConfigs = asStringArray(config.extends)
  let inherited: TsconfigAliasConfig = { aliases: [], baseDir: dirname(tsconfigPath) }

  for (const extendedConfig of extendedConfigs) {
    const extendedPath = resolveTsconfigExtendsPath(extendedConfig, tsconfigPath)
    inherited = await readPathAliasConfig(extendedPath, visited)
  }

  return inherited
}

const readTsconfig = async (
  tsconfigPath: string,
): Promise<{ readonly path: string; readonly config: Record<string, unknown> } | undefined> => {
  for (const candidate of tsconfigCandidates(tsconfigPath)) {
    try {
      const parsed = asRecord(parseJsonc(await readFile(candidate, "utf8")))
      if (parsed !== undefined) return { path: candidate, config: parsed }
    } catch {
      continue
    }
  }
  return undefined
}

const implicitBaseUrlAliases = async (
  baseDir: string,
): Promise<ReadonlyArray<TsconfigPathAlias>> => {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true })
    return entries.flatMap((entry): ReadonlyArray<TsconfigPathAlias> => {
      if (entry.name.startsWith(".")) return []
      if (entry.isDirectory()) {
        return [
          { pattern: entry.name, replacements: [entry.name], baseDir },
          { pattern: `${entry.name}/*`, replacements: [`${entry.name}/*`], baseDir },
        ]
      }
      if (!entry.isFile()) return []
      const stem = entry.name.replace(/\.(?:c|m)?(?:t|j)sx?$/, "")
      return stem === entry.name || stem.length === 0
        ? []
        : [{ pattern: stem, replacements: [entry.name], baseDir }]
    })
  } catch {
    return []
  }
}

const pathAliasesFromCompilerOptions = (
  paths: Record<string, unknown>,
  baseDir: string,
): ReadonlyArray<TsconfigPathAlias> =>
  Object.entries(paths).flatMap(([pattern, rawReplacements]) => {
    const replacements = asStringArray(rawReplacements)
    return replacements.length > 0 ? [{ pattern, replacements, baseDir }] : []
  })

const resolvePathAliasTargets = (
  alias: TsconfigPathAlias,
  moduleSpecifier: string,
): ReadonlyArray<string> => {
  const starIndex = alias.pattern.indexOf("*")
  if (starIndex === -1) {
    if (moduleSpecifier !== alias.pattern) return []
    return alias.replacements.map((replacement) => resolve(alias.baseDir, replacement))
  }

  const prefix = alias.pattern.slice(0, starIndex)
  const suffix = alias.pattern.slice(starIndex + 1)
  if (!moduleSpecifier.startsWith(prefix) || !moduleSpecifier.endsWith(suffix)) return []

  const matched = moduleSpecifier.slice(prefix.length, moduleSpecifier.length - suffix.length)
  return alias.replacements.map((replacement) =>
    resolve(alias.baseDir, replacement.replace("*", matched)),
  )
}

const tsconfigCandidates = (tsconfigPath: string): ReadonlyArray<string> => {
  if (tsconfigPath.endsWith(".json")) return [tsconfigPath]
  return [tsconfigPath, `${tsconfigPath}.json`, resolve(tsconfigPath, "tsconfig.json")]
}

const resolveTsconfigExtendsPath = (extendedConfig: string, tsconfigPath: string): string =>
  extendedConfig.startsWith(".") || extendedConfig.startsWith("/")
    ? resolve(dirname(tsconfigPath), extendedConfig)
    : resolve(dirname(tsconfigPath), extendedConfig)

const parseJsonc = (text: string): unknown => JSON.parse(stripTrailingCommas(stripJsonComments(text)))

const stripJsonComments = (text: string): string => {
  let result = ""
  let inString = false
  let quote: "\"" | "'" | undefined
  let escaped = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    const next = text[index + 1]
    if (inString) {
      result += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === quote) {
        inString = false
        quote = undefined
      }
      continue
    }
    if (char === "\"" || char === "'") {
      inString = true
      quote = char
      result += char
      continue
    }
    if (char === "/" && next === "/") {
      index += 2
      while (index < text.length && text[index] !== "\n") index++
      result += "\n"
      continue
    }
    if (char === "/" && next === "*") {
      index += 2
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        result += text[index] === "\n" ? "\n" : " "
        index++
      }
      index++
      continue
    }
    result += char
  }

  return result
}

const stripTrailingCommas = (text: string): string => text.replace(/,\s*([}\]])/g, "$1")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const asStringArray = (value: unknown): ReadonlyArray<string> =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : []
