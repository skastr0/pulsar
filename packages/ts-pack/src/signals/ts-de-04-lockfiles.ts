import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { readBunLockFile } from "../lockfiles/bun-lock.js"

export const readResolvedPackageNames = async (
  worktreePath: string,
): Promise<ReadonlySet<string>> => {
  const packageNames = new Set<string>()

  const bunLock = await readOptionalLockfile(
    join(worktreePath, "bun.lock"),
    readBunLockFile,
  )
  if (bunLock !== undefined) {
    const parsed = bunLock
    for (const packageName of parsed.packageNames) {
      packageNames.add(packageName)
    }
  }

  const pnpmLock = await readOptionalLockfile(
    join(worktreePath, "pnpm-lock.yaml"),
    readPnpmLockPackageNames,
  )
  if (pnpmLock !== undefined) {
    const parsed = pnpmLock
    for (const packageName of parsed) {
      packageNames.add(packageName)
    }
  }

  const packageLock = await readOptionalLockfile(
    join(worktreePath, "package-lock.json"),
    readPackageLockPackageNames,
  )
  if (packageLock !== undefined) {
    const parsed = packageLock
    for (const packageName of parsed) {
      packageNames.add(packageName)
    }
  }

  return packageNames
}

const readOptionalLockfile = async <A>(
  filePath: string,
  read: (filePath: string) => Promise<A>,
): Promise<A | undefined> => {
  try {
    return await read(filePath)
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return undefined
    throw error
  }
}

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined

const readPnpmLockPackageNames = async (filePath: string): Promise<ReadonlySet<string>> => {
  const text = await readFile(filePath, "utf8")
  const packageNames = new Set<string>()
  let inPackagesSection = false

  for (const line of text.split("\n")) {
    if (line === "packages:") {
      inPackagesSection = true
      continue
    }
    if (!inPackagesSection) continue
    if (/^\S/.test(line)) break
    const match = /^  (['"]?)(.+)\1:(?:\s.*)?$/.exec(line)
    if (match === null) continue
    const packageName = packageNameFromPnpmLockKey(match[2]!)
    if (packageName !== undefined) {
      packageNames.add(packageName)
    }
  }

  return packageNames
}

const packageNameFromPnpmLockKey = (lockKey: string): string | undefined => {
  const normalized = lockKey.startsWith("/") ? lockKey.slice(1) : lockKey
  if (normalized.startsWith("@")) {
    const scopeSeparator = normalized.indexOf("/")
    if (scopeSeparator === -1) return undefined
    const versionSeparator = normalized.indexOf("@", scopeSeparator + 1)
    return versionSeparator === -1 ? undefined : normalized.slice(0, versionSeparator)
  }

  const versionSeparator = normalized.indexOf("@")
  return versionSeparator <= 0 ? undefined : normalized.slice(0, versionSeparator)
}

const readPackageLockPackageNames = async (
  filePath: string,
): Promise<ReadonlySet<string>> => {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>
  const packageNames = new Set<string>()
  const packages = asRecord(parsed.packages)
  if (packages !== undefined) {
    for (const key of Object.keys(packages)) {
      const packageName = packageNameFromPackageLockPath(key)
      if (packageName !== undefined) {
        packageNames.add(packageName)
      }
    }
  }

  const dependencies = asRecord(parsed.dependencies)
  if (dependencies !== undefined) {
    for (const dependencyName of Object.keys(dependencies)) {
      if (dependencyName.length > 0) {
        packageNames.add(dependencyName)
      }
    }
  }
  return packageNames
}

const packageNameFromPackageLockPath = (lockPath: string): string | undefined => {
  const marker = "node_modules/"
  const index = lockPath.lastIndexOf(marker)
  if (index === -1) return undefined

  const rest = lockPath.slice(index + marker.length)
  if (rest.length === 0) return undefined
  const parts = rest.split("/")
  if (parts[0]?.startsWith("@")) {
    return parts[1] === undefined ? undefined : `${parts[0]}/${parts[1]}`
  }
  return parts[0]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined
