import { createRequire } from "node:module"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"
import { TSGO_ANALYSIS_TYPESCRIPT_VERSION } from "./ts-analysis-version.js"

export class TsgoRuntimeError extends Schema.TaggedError<TsgoRuntimeError>()("TsgoRuntimeError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

const PLATFORM_PACKAGE_BY_TARGET: Readonly<Record<string, string>> = {
  "darwin-arm64": "@typescript/typescript-darwin-arm64",
  "darwin-x64": "@typescript/typescript-darwin-x64",
  "linux-arm64": "@typescript/typescript-linux-arm64",
  "linux-x64": "@typescript/typescript-linux-x64",
}

const ANALYSIS_REQUIRE_BASES: ReadonlyArray<string> = [
  fileURLToPath(new URL(".", import.meta.url)),
  process.cwd(),
]

export const analysisPlatformTarget = (
  platform: string = process.platform,
  arch: string = process.arch,
): string => `${platform}-${arch}`

export const analysisPlatformPackageName = (
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined => PLATFORM_PACKAGE_BY_TARGET[analysisPlatformTarget(platform, arch)]

export const resolveTsgoExecutablePath = Effect.fn("resolveTsgoExecutablePath")(function* (
  platform: string = process.platform,
  arch: string = process.arch,
): Effect.fn.Return<string, TsgoRuntimeError> {
  const packageName = analysisPlatformPackageName(platform, arch)
  if (packageName === undefined) {
    return yield* new TsgoRuntimeError({
      message: `Pulsar has no pinned tsgo native payload for ${analysisPlatformTarget(platform, arch)}`,
    })
  }

  const embedded = yield* resolveEmbeddedTsgoExecutable(platform, arch)
  if (embedded !== undefined) return embedded

  const resolved = yield* Effect.try({
    try: () => resolvePlatformPackage(packageName),
    catch: (cause) =>
      new TsgoRuntimeError({
        message: `Failed to resolve ${packageName}@${TSGO_ANALYSIS_TYPESCRIPT_VERSION}`,
        cause,
      }),
  })

  if (resolved.version !== TSGO_ANALYSIS_TYPESCRIPT_VERSION) {
    return yield* new TsgoRuntimeError({
      message:
        `Resolved ${packageName}@${resolved.version}, expected ${TSGO_ANALYSIS_TYPESCRIPT_VERSION}`,
    })
  }

  const executablePath = join(dirname(resolved.manifestPath), "lib", "tsc")
  const executable = Bun.file(executablePath)
  if (!(yield* Effect.promise(() => executable.exists()))) {
    return yield* new TsgoRuntimeError({
      message: `Native tsgo executable is missing at ${executablePath}`,
    })
  }

  return executablePath
})

interface ResolvedPlatformPackage {
  readonly manifestPath: string
  readonly version: string
}

const resolvePlatformPackage = (packageName: string): ResolvedPlatformPackage => {
  let lastError: unknown
  for (const base of ANALYSIS_REQUIRE_BASES) {
    try {
      const require = createRequire(join(base, "package.json"))
      const manifestPath = require.resolve(`${packageName}/package.json`)
      const manifest = require(manifestPath) as { readonly version?: unknown }
      if (typeof manifest.version !== "string") {
        throw new Error(`${packageName} package.json is missing a version`)
      }
      return { manifestPath, version: manifest.version }
    } catch (cause) {
      lastError = cause
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

declare const __PULSAR_ARTIFACT_KIND__: "native" | undefined

let registeredEmbeddedTsgoPath: string | undefined
let extractedTsgoPath: string | undefined

export const registerEmbeddedTsgoPath = (path: string): void => {
  registeredEmbeddedTsgoPath = path.length === 0 ? undefined : path
  extractedTsgoPath = undefined
}

const resolveEmbeddedTsgoExecutable = (
  platform: string,
  arch: string,
): Effect.Effect<string | undefined, TsgoRuntimeError> =>
  Effect.gen(function* () {
    const embeddedPath = registeredEmbeddedTsgoPath
    if (embeddedPath === undefined || embeddedPath.length === 0) {
      if (typeof __PULSAR_ARTIFACT_KIND__ !== "undefined" && __PULSAR_ARTIFACT_KIND__ === "native") {
        return yield* new TsgoRuntimeError({
          message: `Native Pulsar CLI is missing the embedded tsgo payload for ${analysisPlatformTarget(platform, arch)}`,
        })
      }
      return undefined
    }

    const source = Bun.file(embeddedPath)
    if (!(yield* Effect.promise(() => source.exists()))) {
      return yield* new TsgoRuntimeError({
        message: `Embedded native tsgo payload is missing at ${embeddedPath}`,
      })
    }

    if (extractedTsgoPath !== undefined) return extractedTsgoPath

    const bytes = yield* Effect.tryPromise({
      try: () => source.arrayBuffer(),
      catch: (cause) =>
        new TsgoRuntimeError({
          message: "Failed to read embedded native tsgo payload",
          cause,
        }),
    })

    yield* Effect.try({
      try: () => {
        const destinationDirectory = mkdtempSync(
          join(tmpdir(), `pulsar-tsgo-${analysisPlatformTarget(platform, arch)}-`),
        )
        chmodSync(destinationDirectory, 0o700)
        extractTsgoLibArchive(new Uint8Array(bytes), destinationDirectory)
        const destinationPath = join(destinationDirectory, "tsc")
        const libDefinitions = join(destinationDirectory, "lib.d.ts")
        if (!existsSync(destinationPath) || !existsSync(libDefinitions)) {
          throw new Error("extracted tsgo payload is missing tsc or lib.d.ts")
        }
        chmodSync(destinationPath, 0o755)
        extractedTsgoPath = destinationPath
      },
      catch: (cause) =>
        new TsgoRuntimeError({
          message: "Failed to extract embedded native tsgo payload",
          cause,
        }),
    })
    if (extractedTsgoPath === undefined) {
      return yield* new TsgoRuntimeError({
        message: "Failed to extract embedded native tsgo payload",
      })
    }
    return extractedTsgoPath
  })

const USTAR_BLOCK = 512

const extractTsgoLibArchive = (archive: Uint8Array, destination: string): void => {
  const root = resolve(destination)
  let offset = 0
  while (offset + USTAR_BLOCK <= archive.byteLength) {
    const header = archive.subarray(offset, offset + USTAR_BLOCK)
    offset += USTAR_BLOCK
    if (header.every((byte) => byte === 0)) break

    const name = readUstarString(header.subarray(0, 100))
    const prefix = readUstarString(header.subarray(345, 500))
    const relativePath = (prefix.length === 0 ? name : `${prefix}/${name}`).replace(/^\.\//, "")
    const size = Number.parseInt(readUstarString(header.subarray(124, 136)), 8)
    const mode = Number.parseInt(readUstarString(header.subarray(100, 108)), 8)
    const typeFlag = header[156] ?? 0
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`invalid ustar size for ${relativePath || "<unnamed>"}`)
    }
    const contentEnd = offset + size
    const content = archive.subarray(offset, contentEnd)
    offset += Math.ceil(size / USTAR_BLOCK) * USTAR_BLOCK

    if (relativePath.length === 0 || relativePath === "." || typeFlag === 103 || typeFlag === 120) {
      continue
    }
    const filePath = resolve(root, relativePath)
    if (filePath !== root && !filePath.startsWith(`${root}/`)) {
      throw new Error(`refusing to extract ${relativePath} outside ${root}`)
    }
    if (typeFlag === 53) {
      mkdirSync(filePath, { recursive: true })
      continue
    }
    if (typeFlag !== 0 && typeFlag !== 48) continue
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
    if (Number.isFinite(mode) && mode !== 0) chmodSync(filePath, mode & 0o777)
  }
}

const readUstarString = (bytes: Uint8Array): string => {
  const end = bytes.indexOf(0)
  return Buffer.from(bytes.subarray(0, end === -1 ? bytes.length : end)).toString("utf8").replace(/\0+$/g, "").trim()
}
