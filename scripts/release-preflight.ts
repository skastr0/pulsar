#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

interface RootManifest {
  readonly version: unknown
  readonly workspaces: unknown
}

interface WorkspacePackageManifest {
  readonly name: unknown
  readonly version: unknown
}

export interface WorkspaceReleaseIdentity {
  readonly path: string
  readonly name: string
  readonly version: string
}

export interface ReleaseIdentity {
  readonly releaseTag: string
  readonly rootVersion: string
  readonly headCommit: string
  readonly tagCommit: string
  readonly workspaces: ReadonlyArray<WorkspaceReleaseIdentity>
}

export interface ReleasePreflightResult {
  readonly releaseTag: string
  readonly version: string
  readonly commit: string
  readonly workspaceCount: number
}

const releaseVersion = (releaseTag: string): string => {
  if (RELEASE_TAG_PATTERN.exec(releaseTag) === null) {
    throw new Error(`Release tag ${JSON.stringify(releaseTag)} must match vX.Y.Z exactly`)
  }
  return releaseTag.slice(1)
}

const assertTagMatchesRootVersion = (releaseTag: string, rootVersion: string): void => {
  if (releaseVersion(releaseTag) !== rootVersion) {
    throw new Error(`Release tag ${releaseTag} does not match root version ${rootVersion}`)
  }
}

const readJson = async <A>(path: string): Promise<A> =>
  JSON.parse(await readFile(path, "utf8")) as A

const git = async (repoRoot: string, args: ReadonlyArray<string>): Promise<string> => {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with exit ${exitCode}: ${(stderr || stdout).trim()}`,
    )
  }
  return stdout.trim()
}

const workspaceManifestPaths = async (
  repoRoot: string,
  workspaces: unknown,
): Promise<ReadonlyArray<string>> => {
  if (!Array.isArray(workspaces) || !workspaces.every((entry) => typeof entry === "string")) {
    throw new Error("Root package.json workspaces must be an array of package path patterns")
  }

  const paths = new Set<string>()
  for (const workspace of workspaces) {
    const glob = new Bun.Glob(`${workspace.replace(/\/+$/, "")}/package.json`)
    for await (const path of glob.scan({ cwd: repoRoot, onlyFiles: true })) paths.add(path)
  }
  return [...paths].sort((left, right) => left.localeCompare(right))
}

export const assertReleaseIdentity = (identity: ReleaseIdentity): ReleasePreflightResult => {
  assertTagMatchesRootVersion(identity.releaseTag, identity.rootVersion)

  if (identity.tagCommit !== identity.headCommit) {
    throw new Error(
      `Release tag ${identity.releaseTag} resolves to ${identity.tagCommit}, ` +
        `not checked-out HEAD ${identity.headCommit}`,
    )
  }

  const drifted = identity.workspaces
    .filter(({ version }) => version !== identity.rootVersion)
    .sort((left, right) => left.path.localeCompare(right.path))
  if (drifted.length > 0) {
    throw new Error(
      `Workspace version drift from ${identity.rootVersion}:\n${drifted
        .map(({ name, path, version }) => `- ${name}@${version} (${path})`)
        .join("\n")}`,
    )
  }

  return {
    releaseTag: identity.releaseTag,
    version: identity.rootVersion,
    commit: identity.headCommit,
    workspaceCount: identity.workspaces.length,
  }
}

export const runReleasePreflight = async (
  repoRoot: string,
  releaseTag: string,
): Promise<ReleasePreflightResult> => {
  const absoluteRoot = resolve(repoRoot)
  const rootManifest = await readJson<RootManifest>(join(absoluteRoot, "package.json"))
  if (typeof rootManifest.version !== "string") {
    throw new Error("Root package.json must declare a string version")
  }
  assertTagMatchesRootVersion(releaseTag, rootManifest.version)

  const paths = await workspaceManifestPaths(absoluteRoot, rootManifest.workspaces)
  if (paths.length === 0) throw new Error("Root package.json workspaces matched no packages")
  const workspaces: Array<WorkspaceReleaseIdentity> = []
  for (const path of paths) {
    const manifest = await readJson<WorkspacePackageManifest>(join(absoluteRoot, path))
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new Error(`${path} must declare string name and version fields`)
    }
    workspaces.push({ path, name: manifest.name, version: manifest.version })
  }

  const [headCommit, tagCommit] = await Promise.all([
    git(absoluteRoot, ["rev-parse", "--verify", "HEAD^{commit}"]),
    git(absoluteRoot, [
      "rev-parse",
      "--verify",
      `refs/tags/${releaseTag}^{commit}`,
    ]),
  ])

  return assertReleaseIdentity({
    releaseTag,
    rootVersion: rootManifest.version,
    headCommit,
    tagCommit,
    workspaces,
  })
}

if (import.meta.main) {
  const releaseTag = process.argv[2]
  if (releaseTag === undefined || process.argv.length !== 3) {
    console.error("Usage: bun run release:preflight <vX.Y.Z>")
    process.exitCode = 1
  } else {
    try {
      const result = await runReleasePreflight(resolve(import.meta.dir, ".."), releaseTag)
      console.log(
        `Release preflight passed: ${result.releaseTag} -> ${result.commit}; ` +
          `${result.workspaceCount} workspace packages at ${result.version}`,
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.error(`Release preflight failed: ${message}`)
      process.exitCode = 1
    }
  }
}
