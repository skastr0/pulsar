import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { Effect } from "effect"
import { ProjectModuleLoadError } from "./loader-types.js"
import type { ProjectModuleRef } from "./manifest.js"
import type { ProjectModuleSourceFile } from "./loader-source-files.js"
import {
  isFile,
  isPackageName,
  isPathInside,
  isRecord,
  nearestNodeModulesRoot,
  safeSourceFingerprintPath,
} from "./loader-paths.js"

export const materializeProjectModuleImportTarget = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  repoRoot: string,
  dependencyRoot: string,
  sourceFingerprint: string,
  files: ReadonlyArray<ProjectModuleSourceFile>,
  shadowRootSegments: ReadonlyArray<string>,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const shadowSourceRoot = resolve(
      repoRoot,
      ".pulsar",
      "cache",
      "project-modules",
      safeSourceFingerprintPath(sourceFingerprint),
      ...shadowRootSegments,
    )
    for (const file of files) {
      const relativePath = relative(sourceRoot, file.path)
      if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
        return yield* escapedSourceRootError(ref, target)
      }
      const destination = resolve(shadowSourceRoot, relativePath)
      if (!isPathInside(shadowSourceRoot, destination)) {
        return yield* escapedMaterializedRootError(ref, target)
      }
      const content = yield* readFileBytes(ref, target, file)
      yield* mkdirForMaterializedFile(ref, dirname(destination))
      yield* writeMaterializedFile(ref, file, destination, content)
    }

    yield* linkMaterializedPackageDependencies(ref, dependencyRoot, shadowSourceRoot)

    return resolve(shadowSourceRoot, relative(sourceRoot, target))
  })

export const hashProjectModuleSource = (
  ref: ProjectModuleRef,
  target: string,
  files: ReadonlyArray<ProjectModuleSourceFile>,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const hash = createHash("sha256")
    for (const file of [...files].sort((left, right) =>
      left.sourceRef.localeCompare(right.sourceRef),
    )) {
      const content = yield* readFileBytes(ref, target, file)
      hash.update(file.sourceRef)
      hash.update("\0")
      hash.update(content)
      hash.update("\0")
    }
    return `sha256:${hash.digest("hex")}`
  })

const linkMaterializedPackageDependencies = (
  ref: ProjectModuleRef,
  sourceRoot: string,
  shadowSourceRoot: string,
): Effect.Effect<void, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageJsonPath = resolve(sourceRoot, "package.json")
    if (!(yield* isFile(packageJsonPath))) return
    const raw = yield* readTextFile(
      ref,
      packageJsonPath,
      `Failed to read project module package manifest while linking dependencies`,
    )
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: packageJsonPath,
          message: `Failed to parse project module package manifest while linking dependencies`,
          cause,
        }),
    })
    const dependencies = dependencyNamesOfPackageJson(parsed)
    if (dependencies.length === 0) return

    const nodeModulesRoot = nearestNodeModulesRoot(shadowSourceRoot) ?? resolve(shadowSourceRoot, "node_modules")
    const sourceRequire = createRequire(packageJsonPath)
    for (const dependency of dependencies) {
      if (dependency === ref.id) continue
      const dependencyRoot = yield* resolveDependencyRoot(ref, sourceRoot, sourceRequire, dependency)
      if (dependencyRoot === undefined) continue
      const destination = resolve(nodeModulesRoot, ...dependency.split("/"))
      if (yield* isFile(resolve(destination, "package.json"))) continue
      yield* mkdirForMaterializedFile(ref, dirname(destination))
      yield* symlinkDependency(ref, dependency, dependencyRoot, destination)
    }
  })

const dependencyNamesOfPackageJson = (value: unknown): ReadonlyArray<string> => {
  if (!isRecord(value)) return []
  const names = new Set<string>()
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = value[field]
    if (!isRecord(dependencies)) continue
    for (const name of Object.keys(dependencies)) {
      if (isPackageName(name)) names.add(name)
    }
  }
  return [...names].sort()
}

const readFileBytes = (
  ref: ProjectModuleRef,
  target: string,
  file: ProjectModuleSourceFile,
): Effect.Effect<Buffer, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => readFile(file.path),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Failed to read project module source ${file.sourceRef}`,
        cause,
      }),
  })

const resolveDependencyRoot = (
  ref: ProjectModuleRef,
  sourceRoot: string,
  sourceRequire: NodeRequire,
  dependency: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const installedRoot = resolve(sourceRoot, "node_modules", ...dependency.split("/"))
    if (yield* isFile(resolve(installedRoot, "package.json"))) {
      return yield* realpathDependency(ref, dependency, installedRoot)
    }

    let entrypoint: string | undefined
    try {
      entrypoint = sourceRequire.resolve(dependency)
    } catch {
      entrypoint = undefined
    }
    if (entrypoint === undefined) return undefined

    return yield* findDependencyPackageRoot(ref, dependency, entrypoint)
  })

const findDependencyPackageRoot = (
  ref: ProjectModuleRef,
  dependency: string,
  entrypoint: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    let cursor = dirname(entrypoint)
    while (true) {
      if (yield* isFile(resolve(cursor, "package.json"))) {
        return yield* realpathDependency(ref, dependency, cursor)
      }
      const parent = dirname(cursor)
      if (parent === cursor) return undefined
      cursor = parent
    }
  })

const readTextFile = (
  ref: ProjectModuleRef,
  target: string,
  message: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => readFile(target, "utf8"),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message,
        cause,
      }),
  })

const mkdirForMaterializedFile = (
  ref: ProjectModuleRef,
  target: string,
): Effect.Effect<void, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => mkdir(target, { recursive: true }),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Failed to create materialized project module directory`,
        cause,
      }),
  })

const writeMaterializedFile = (
  ref: ProjectModuleRef,
  file: ProjectModuleSourceFile,
  destination: string,
  content: Buffer,
): Effect.Effect<void, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => writeFile(destination, content),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target: destination,
        message: `Failed to write materialized project module source ${file.sourceRef}`,
        cause,
      }),
  })

const realpathDependency = (
  ref: ProjectModuleRef,
  dependency: string,
  target: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => realpath(target),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target: dependency,
        message: `Failed to resolve project module dependency ${dependency}`,
        cause,
      }),
  })

const symlinkDependency = (
  ref: ProjectModuleRef,
  dependency: string,
  dependencyRoot: string,
  destination: string,
): Effect.Effect<void, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: () => symlink(dependencyRoot, destination, "dir"),
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target: destination,
        message: `Failed to link project module dependency ${dependency} into materialized module cache`,
        cause,
      }),
  })

const escapedSourceRootError = (
  ref: ProjectModuleRef,
  target: string,
): ProjectModuleLoadError =>
  new ProjectModuleLoadError({
    refId: ref.id,
    target,
    message: `Project module ${ref.id} source file escaped its owned source root while materializing`,
  })

const escapedMaterializedRootError = (
  ref: ProjectModuleRef,
  target: string,
): ProjectModuleLoadError =>
  new ProjectModuleLoadError({
    refId: ref.id,
    target,
    message: `Project module ${ref.id} source file escaped its materialized source root`,
  })
