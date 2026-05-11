import { createRequire } from "node:module"
import { dirname, extname, resolve } from "node:path"
import { Effect } from "effect"
import { preProcessFile } from "typescript"
import { ProjectModuleLoadError } from "./loader-types.js"
import type { ProjectModuleRef } from "./manifest.js"
import {
  isPathInside,
  isRecord,
  realFileOption,
  toSourceRef,
} from "./loader-paths.js"

export interface ProjectModuleSourceFile {
  readonly sourceRef: string
  readonly path: string
}

const ProjectModuleSourceExtensions = [
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json",
] as const

export const collectProjectModuleSourceFiles = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  sourceRefForPath: (path: string) => string,
): Effect.Effect<ReadonlyArray<ProjectModuleSourceFile>, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const files: Array<ProjectModuleSourceFile> = []
    const seen = new Set<string>()
    const sourcePackageName = yield* readProjectModulePackageNameOption(
      ref,
      target,
      sourceRoot,
    )
    const addFile = (path: string): void => {
      if (seen.has(path)) return
      seen.add(path)
      files.push({
        sourceRef: sourceRefForPath(path),
        path,
      })
    }
    const visit = (path: string): Effect.Effect<void, ProjectModuleLoadError> =>
      Effect.gen(function* () {
        const resolvedPath = yield* realpathOrSourceError(ref, target, path)
        if (!isPathInside(sourceRoot, resolvedPath)) {
          return yield* new ProjectModuleLoadError({
            refId: ref.id,
            target,
            message: `Project module ${ref.id} imports source outside its owned source root`,
          })
        }
        if (seen.has(resolvedPath)) return
        addFile(resolvedPath)

        if (!isJavaScriptLikeProjectModuleSource(resolvedPath)) return
        const content = yield* readSourceFile(ref, target, resolvedPath)
        for (const specifier of projectModuleSourceSpecifiers(content)) {
          const importedPath = yield* resolveOwnedProjectModuleSourceSpecifier(
            ref,
            target,
            sourceRoot,
            resolvedPath,
            specifier,
            sourcePackageName,
          )
          if (importedPath !== undefined) {
            yield* visit(importedPath)
          }
        }
      })

    yield* visit(target)
    const packageJsonPath = yield* realFileOption(resolve(sourceRoot, "package.json"))
    if (packageJsonPath !== undefined && isPathInside(sourceRoot, packageJsonPath)) {
      addFile(packageJsonPath)
    }
    return files
  })

const projectModuleSourceSpecifiers = (content: string): ReadonlyArray<string> => {
  const info = preProcessFile(content, true, true)
  return [
    ...new Set(
      [...info.importedFiles, ...info.referencedFiles].map((file) => file.fileName),
    ),
  ].sort()
}

const resolveOwnedProjectModuleSourceSpecifier = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromFile: string,
  specifier: string,
  sourcePackageName: string | undefined,
): Effect.Effect<string | undefined, ProjectModuleLoadError> => {
  if (isRelativeModuleSpecifier(specifier)) {
    return resolveLocalProjectModuleSourceFile(
      ref,
      target,
      sourceRoot,
      dirname(fromFile),
      specifier,
    )
  }

  if (!isOwnedPackageModuleSpecifier(specifier, sourcePackageName)) {
    return Effect.succeed(undefined)
  }

  return resolvePackageLocalProjectModuleSourceFile(
    ref,
    target,
    sourceRoot,
    fromFile,
    specifier,
  )
}

const resolveLocalProjectModuleSourceFile = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromDirectory: string,
  specifier: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const requestedPath = resolve(fromDirectory, specifier)
    if (!isPathInside(sourceRoot, requestedPath)) {
      return yield* outsideOwnedSourceError(ref, target)
    }

    for (const candidate of localProjectModuleSourceCandidates(requestedPath)) {
      const file = yield* realFileOption(candidate)
      if (file === undefined) continue
      if (!isPathInside(sourceRoot, file)) {
        return yield* outsideOwnedSourceError(ref, target)
      }
      return file
    }

    return undefined
  })

const resolvePackageLocalProjectModuleSourceFile = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromFile: string,
  specifier: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.sync(() => {
      try {
        return createRequire(fromFile).resolve(specifier)
      } catch {
        return undefined
      }
    })
    if (resolved === undefined) return undefined
    const file = yield* realFileOption(resolved)
    if (file === undefined) return undefined
    if (!isPathInside(sourceRoot, file)) return undefined
    return file
  })

const readProjectModulePackageNameOption = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageJsonPath = yield* realFileOption(resolve(sourceRoot, "package.json"))
    if (packageJsonPath === undefined) return undefined
    const packageJson = yield* readSourceFile(ref, target, packageJsonPath)
    const parsed = yield* Effect.try({
      try: () => JSON.parse(packageJson) as unknown,
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to parse project module package scope manifest`,
          cause,
        }),
    })
    const name = isRecord(parsed) ? parsed.name : undefined
    return typeof name === "string" ? name : undefined
  })

const localProjectModuleSourceCandidates = (requestedPath: string): ReadonlyArray<string> => {
  const candidates = new Set<string>([requestedPath])
  for (const extension of ProjectModuleSourceExtensions) {
    candidates.add(`${requestedPath}${extension}`)
    candidates.add(resolve(requestedPath, `index${extension}`))
  }
  return [...candidates]
}

const isJavaScriptLikeProjectModuleSource = (path: string): boolean =>
  new Set(ProjectModuleSourceExtensions).has(
    extname(path) as (typeof ProjectModuleSourceExtensions)[number],
  ) && extname(path) !== ".json"

const isRelativeModuleSpecifier = (specifier: string): boolean =>
  specifier.startsWith("./") || specifier.startsWith("../")

const isOwnedPackageModuleSpecifier = (
  specifier: string,
  sourcePackageName: string | undefined,
): boolean =>
  specifier.startsWith("#") ||
  (sourcePackageName !== undefined &&
    (specifier === sourcePackageName || specifier.startsWith(`${sourcePackageName}/`)))

const realpathOrSourceError = (
  ref: ProjectModuleRef,
  target: string,
  path: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: async () => {
      const { realpath } = await import("node:fs/promises")
      return realpath(path)
    },
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Failed to resolve project module source file ${path}`,
        cause,
      }),
  })

const readSourceFile = (
  ref: ProjectModuleRef,
  target: string,
  path: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: async () => {
      const { readFile } = await import("node:fs/promises")
      return readFile(path, "utf8")
    },
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Failed to read project module source file ${path}`,
        cause,
      }),
  })

const outsideOwnedSourceError = (
  ref: ProjectModuleRef,
  target: string,
): ProjectModuleLoadError =>
  new ProjectModuleLoadError({
    refId: ref.id,
    target,
    message: `Project module ${ref.id} imports local source outside its owned source root`,
  })
