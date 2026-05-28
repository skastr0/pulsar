import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import type { DomainConstructionFinding } from "./domain-construction-model.js"

export const currentSourceHashes = async (
  repoRoot: string,
  sourcePaths: ReadonlyArray<string>,
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {}
  for (const sourcePath of unique(sourcePaths.map(normalizePath))) {
    const absolutePath = safeResolve(repoRoot, sourcePath)
    if (absolutePath === undefined || !existsSync(absolutePath)) continue
    result[sourcePath] = await fileHash(absolutePath)
  }
  return result
}

export const readSource = async (
  repoRoot: string,
  path: string,
): Promise<string | undefined> => {
  const absolutePath = safeResolve(repoRoot, normalizePath(path))
  if (absolutePath === undefined || !existsSync(absolutePath)) return undefined
  return readFile(absolutePath, "utf8")
}

export const normalizeHashRecord = (
  record: Readonly<Record<string, string>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).map(([path, hash]) => [normalizePath(path), hash.toLowerCase()]),
  )

const safeResolve = (repoRoot: string, path: string): string | undefined => {
  const root = resolve(repoRoot)
  const resolved = resolve(root, path)
  const rel = relative(root, resolved)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
    ? resolved
    : undefined
}

const fileHash = async (path: string): Promise<string> =>
  sha256(await readFile(path))

const sha256 = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex")

export const fingerprint = (value: unknown): string =>
  sha256(stableStringify(value))

const stableStringify = (value: unknown): string =>
  JSON.stringify(sortJson(value))

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    )
  }
  return value
}

export const normalizePath = (path: string): string => path.replace(/\\/gu, "/")

export const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)]

export const compareFindings = (
  left: DomainConstructionFinding,
  right: DomainConstructionFinding,
): number => {
  const bySeverity = severityRank(right.severity) - severityRank(left.severity)
  if (bySeverity !== 0) return bySeverity
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.kind.localeCompare(right.kind)
}

const severityRank = (severity: "info" | "warn"): number =>
  severity === "warn" ? 1 : 0
