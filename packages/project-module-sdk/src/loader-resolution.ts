import { createRequire } from "node:module"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { readFile, realpath } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import type { ProjectModuleDescriptor } from "@skastr0/pulsar-core/calibration"
import {
  ProjectModuleLoadError,
  type ProjectModuleLoadOptions,
} from "./loader-types.js"
import type { ProjectModuleRef } from "./manifest.js"
import { hashProjectModuleSource, materializeProjectModuleImportTarget } from "./loader-materialize.js"
import { collectProjectModuleSourceFiles } from "./loader-source-files.js"
import {
  isFile,
  isPackageName,
  isPathInside,
  isRecord,
  realFileOption,
  realpathOption,
  toSourceRef,
  withSourceFingerprintQuery,
} from "./loader-paths.js"

export interface ResolvedProjectModuleTarget {
  readonly target: string
  readonly source: ProjectModuleDescriptor["source"]
  readonly sourceRef: string
  readonly sourceFingerprint: string
}

interface ProjectModulePackageTarget {
  readonly target: string
  readonly packageRoot: string
}

export const resolveProjectModuleRefTarget = (
  ref: ProjectModuleRef,
  options: ProjectModuleLoadOptions,
): Effect.Effect<ResolvedProjectModuleTarget, ProjectModuleLoadError> => {
  switch (ref.kind) {
    case "repo-local":
      return resolveRepoLocalProjectModuleTarget(ref, options)
    case "workspace":
    case "package":
      return resolvePackageProjectModuleTarget(ref, options.repoRoot)
  }
}

const resolveRepoLocalProjectModuleTarget = (
  ref: ProjectModuleRef & { readonly kind: "repo-local" },
  options: ProjectModuleLoadOptions,
): Effect.Effect<ResolvedProjectModuleTarget, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    if (isAbsolute(ref.path)) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target: ref.path,
        message: `Repo-local project module ${ref.id} must use a relative path`,
      })
    }

    const repoRoot = yield* Effect.tryPromise({
      try: () => realpath(options.repoRoot),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: options.repoRoot,
          message: `Failed to resolve repository root for project module ${ref.id}`,
          cause,
        }),
    })
    const targetPath = resolve(repoRoot, ref.path)
    const target = yield* realpathOrLoadError(ref, targetPath, "repo-local project module")

    if (!isPathInside(repoRoot, target)) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Repo-local project module ${ref.id} resolves outside the repository root`,
      })
    }

    const files = yield* collectProjectModuleSourceFiles(
      ref,
      target,
      repoRoot,
      (path) => toSourceRef(relative(repoRoot, path)),
    )
    const sourceFingerprint = yield* hashProjectModuleSource(ref, target, files)
    const importTarget = yield* materializeProjectModuleImportTarget(
      ref,
      target,
      repoRoot,
      repoRoot,
      options.dependencyRoot ?? repoRoot,
      sourceFingerprint,
      files,
      ["repo"],
    )
    return {
      target: withSourceFingerprintQuery(pathToFileURL(importTarget).href, sourceFingerprint),
      source: "repo-local",
      sourceRef: ref.path,
      sourceFingerprint,
    }
  })

const resolvePackageProjectModuleTarget = (
  ref: ProjectModuleRef & { readonly kind: "workspace" | "package" },
  repoRoot: string,
): Effect.Effect<ResolvedProjectModuleTarget, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageName = ref.packageName
    if (!isPackageName(packageName)) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target: packageName,
        message: `Project module package ref ${packageName} is not a valid package name`,
      })
    }

    const resolvedRepoRoot = yield* realpathOrLoadError(ref, repoRoot, "repository root")
    const packagePath = yield* Effect.try({
      try: () =>
        createRequire(resolve(resolvedRepoRoot, "package.json")).resolve(packageName),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: packageName,
          message: `Failed to resolve project module package ${packageName} from repository root`,
          cause,
        }),
    })

    const target = yield* realpathOrLoadError(ref, packagePath, "project module package artifact")
    const packageTarget = yield* resolveOwnedProjectModulePackageTarget(
      ref,
      target,
      resolvedRepoRoot,
    )
    const files = yield* collectProjectModuleSourceFiles(
      ref,
      packageTarget.target,
      packageTarget.packageRoot,
      (path) => toSourceRef(`${packageName}/${relative(packageTarget.packageRoot, path)}`),
    )
    const sourceFingerprint = yield* hashProjectModuleSource(ref, packageTarget.target, files)
    const importTarget = yield* materializeProjectModuleImportTarget(
      ref,
      packageTarget.target,
      packageTarget.packageRoot,
      resolvedRepoRoot,
      packageTarget.packageRoot,
      sourceFingerprint,
      files,
      ["node_modules", ...packageName.split("/")],
    )
    return {
      target: withSourceFingerprintQuery(
        pathToFileURL(importTarget).href,
        sourceFingerprint,
      ),
      source: ref.kind,
      sourceRef: packageName,
      sourceFingerprint,
    }
  })

const resolveOwnedProjectModulePackageTarget = (
  ref: ProjectModuleRef & { readonly kind: "workspace" | "package" },
  target: string,
  repoRoot: string,
): Effect.Effect<ProjectModulePackageTarget, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageRoot = yield* findProjectModulePackageRoot(ref, target)
    yield* verifyProjectModulePackageName(ref, target, packageRoot)

    if (ref.kind === "workspace") {
      if (!isPathInside(repoRoot, packageRoot)) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Workspace project module ${ref.packageName} must resolve inside the repository root`,
        })
      }
    } else {
      const packageIsInRepo = isPathInside(repoRoot, packageRoot)
      const packageIsRepoInstall = yield* isRepoOwnedInstalledPackage(
        ref,
        repoRoot,
        packageRoot,
      )
      if (!packageIsInRepo && !packageIsRepoInstall) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Package project module ${ref.packageName} must resolve from the repository package graph`,
        })
      }
    }

    return {
      target,
      packageRoot,
    }
  })

const findProjectModulePackageRoot = (
  ref: ProjectModuleRef & { readonly kind: "workspace" | "package" },
  target: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    let cursor = dirname(target)
    while (true) {
      if (yield* isFile(resolve(cursor, "package.json"))) {
        return yield* realpathOrLoadError(ref, cursor, "project module package root")
      }
      const parent = dirname(cursor)
      if (parent === cursor) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to locate package.json for project module package ${ref.packageName}`,
        })
      }
      cursor = parent
    }
  })

const verifyProjectModulePackageName = (
  ref: ProjectModuleRef & { readonly kind: "workspace" | "package" },
  target: string,
  packageRoot: string,
): Effect.Effect<void, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageJsonPath = resolve(packageRoot, "package.json")
    const packageJson = yield* readTextOrLoadError(ref, target, packageJsonPath, "manifest")
    const parsed = yield* Effect.try({
      try: () => JSON.parse(packageJson) as unknown,
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to parse project module package manifest ${ref.packageName}`,
          cause,
        }),
    })
    const name = isRecord(parsed) ? parsed.name : undefined
    if (name !== ref.packageName) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Project module package ${ref.packageName} resolved to package manifest for ${String(name)}`,
      })
    }
  })

const isRepoOwnedInstalledPackage = (
  ref: ProjectModuleRef & { readonly kind: "package" },
  repoRoot: string,
  packageRoot: string,
): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    const installedPackageRoot = resolve(repoRoot, "node_modules", ref.packageName)
    const installedPackageRealpath = yield* realpathOption(installedPackageRoot)
    return installedPackageRealpath === packageRoot
  })

const realpathOrLoadError = (
  ref: ProjectModuleRef,
  path: string,
  label: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => realpath(path),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target: path,
        message: `Failed to resolve ${label} for project module ${ref.id}`,
        cause,
      }),
  })

const readTextOrLoadError = (
  ref: ProjectModuleRef,
  target: string,
  path: string,
  label: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Failed to read project module package ${label} ${ref.id}`,
        cause,
      }),
  })
