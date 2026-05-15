import { isAbsolute, relative, sep } from "node:path"
import { stat, realpath } from "node:fs/promises"
import { Effect } from "effect"

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object"

export const isPathInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

export const isPackageName = (value: string): boolean =>
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)

export const nearestNodeModulesRoot = (path: string): string | undefined => {
  const parts = path.split(sep)
  const index = parts.lastIndexOf("node_modules")
  if (index < 0) return undefined
  return parts.slice(0, index + 1).join(sep) || sep
}

export const safeSourceFingerprintPath = (sourceFingerprint: string): string =>
  sourceFingerprint.replace(/[^a-zA-Z0-9._-]/g, "-")

export const isFile = (path: string): Effect.Effect<boolean, never> =>
  Effect.promise(async () => {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  })

export const isDirectory = (path: string): Effect.Effect<boolean, never> =>
  Effect.promise(async () => {
    try {
      return (await stat(path)).isDirectory()
    } catch {
      return false
    }
  })

export const realFileOption = (path: string): Effect.Effect<string | undefined, never> =>
  Effect.promise(async () => {
    try {
      const fileStat = await stat(path)
      if (!fileStat.isFile()) return undefined
      return await realpath(path)
    } catch {
      return undefined
    }
  })

export const realpathOption = (path: string): Effect.Effect<string | undefined, never> =>
  Effect.promise(async () => {
    try {
      return await realpath(path)
    } catch {
      return undefined
    }
  })

export const toSourceRef = (path: string): string => path.split(sep).join("/")

export const withSourceFingerprintQuery = (
  url: string,
  sourceFingerprint: string,
): string => {
  const parsed = new URL(url)
  parsed.searchParams.set("tasteModuleSource", sourceFingerprint)
  return parsed.href
}
