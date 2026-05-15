import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

export const PULSAR_CONFIG_DIR_NAME = "pulsar" as const

export const resolvePulsarStateRoot = (): string => {
  const explicit = process.env.PULSAR_STATE_HOME
  if (explicit !== undefined && explicit.trim().length > 0) return explicit

  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  const configHome =
    xdgConfigHome !== undefined && xdgConfigHome.trim().length > 0
      ? xdgConfigHome
      : join(homedir(), ".config")
  return join(configHome, PULSAR_CONFIG_DIR_NAME)
}

export const normalizeRepoStatePath = (repoPath: string): string => {
  try {
    return realpathSync.native(repoPath)
  } catch {
    return repoPath
  }
}

export const repoStateId = (repoPath: string): string => {
  const normalized = normalizeRepoStatePath(repoPath)
  const name = basename(normalized).replace(/[^A-Za-z0-9._-]+/g, "-") || "repo"
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12)
  return `${name}-${hash}`
}

export const resolvePulsarRepoStateDir = (repoPath: string): string =>
  join(resolvePulsarStateRoot(), "repos", repoStateId(repoPath))

export const resolvePulsarRepoStatePath = (
  repoPath: string,
  ...segments: ReadonlyArray<string>
): string => join(resolvePulsarRepoStateDir(repoPath), ...segments)
