import { access } from "node:fs/promises"
import { join } from "node:path"
import { readBunLockFile, type BunResolvedPackage } from "../lockfiles/bun-lock.js"
import { readNpmLockFile, type NpmResolvedPackage } from "../lockfiles/npm-lock.js"
import { readPnpmLockFile, type PnpmResolvedPackage } from "../lockfiles/pnpm-lock.js"

export type ResolvedLockPackage = BunResolvedPackage | NpmResolvedPackage | PnpmResolvedPackage

export interface LockWorkspace {
  readonly path: string
  readonly name: string | undefined
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly optionalDependencies: Readonly<Record<string, string>>
}

type TsDe05Lockfile =
  | {
    readonly kind: "bun" | "npm" | "pnpm"
    readonly path: string
    readonly packages: ReadonlyArray<ResolvedLockPackage>
    readonly workspaces: ReadonlyArray<LockWorkspace>
  }
  | { readonly kind: "unsupported"; readonly files: ReadonlyArray<string> }
  | { readonly kind: "missing"; readonly files: ReadonlyArray<string> }

const UNSUPPORTED_LOCKFILES = ["yarn.lock"] as const

export const readTsDe05Lockfile = async (worktreePath: string): Promise<TsDe05Lockfile> => {
  const lockfile = await resolveLockfile(worktreePath)
  if (lockfile.kind === "missing" || lockfile.kind === "unsupported") {
    return lockfile
  }

  const parsed = lockfile.kind === "bun"
    ? await readBunLockFile(lockfile.path)
    : lockfile.kind === "npm"
      ? await readNpmLockFile(lockfile.path)
      : await readPnpmLockFile(lockfile.path)

  return {
    kind: lockfile.kind,
    path: lockfile.path,
    packages: parsed.packages,
    workspaces: parsed.workspaces,
  }
}

const resolveLockfile = async (
  worktreePath: string,
): Promise<
  | { readonly kind: "bun"; readonly path: string }
  | { readonly kind: "npm"; readonly path: string }
  | { readonly kind: "pnpm"; readonly path: string }
  | { readonly kind: "unsupported"; readonly files: ReadonlyArray<string> }
  | { readonly kind: "missing"; readonly files: ReadonlyArray<string> }
> => {
  const bunLockPath = join(worktreePath, "bun.lock")
  if (await exists(bunLockPath)) {
    return { kind: "bun", path: bunLockPath }
  }

  const npmLockPath = join(worktreePath, "package-lock.json")
  if (await exists(npmLockPath)) {
    return { kind: "npm", path: npmLockPath }
  }

  const pnpmLockPath = join(worktreePath, "pnpm-lock.yaml")
  if (await exists(pnpmLockPath)) {
    return { kind: "pnpm", path: pnpmLockPath }
  }

  const unsupported: Array<string> = []
  for (const filename of UNSUPPORTED_LOCKFILES) {
    if (await exists(join(worktreePath, filename))) {
      unsupported.push(filename)
    }
  }

  if (unsupported.length > 0) {
    return { kind: "unsupported", files: unsupported }
  }

  return { kind: "missing", files: [] }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
