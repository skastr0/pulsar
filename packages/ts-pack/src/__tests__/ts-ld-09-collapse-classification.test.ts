import { describe, expect, test } from "bun:test"
import { TsLd09 } from "../signals/ts-ld-09-error-channel-opacity.js"
import type { TsLd09Output } from "../signals/ts-ld-09-types.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

const run = (repo: TempRepo): Promise<TsLd09Output> =>
  runSignal(repo.root, TsLd09, TsLd09.defaultConfig)

describe("TS-LD-09 collapse/fallback classification", () => {
  test("typed-error catch mappers with keyword-bearing identifiers are not fallback collapses", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-collapse-")
    try {
      await repo.write(
        "src/artifact-store.ts",
        [
          "import { Data, Effect } from 'effect'",
          "const DEFAULT_ARTIFACT_DIR = '.librarian/artifacts'",
          "class ArtifactError extends Data.TaggedError('ArtifactError')<{ readonly message: string }> {}",
          "declare function writeArtifact(): Promise<string>",
          "export const storeArtifact = Effect.tryPromise({",
          "  try: () => writeArtifact(),",
          "  catch: () => new ArtifactError({ message: `failed to write artifacts under ${DEFAULT_ARTIFACT_DIR}` }),",
          "})",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("tagged-error lineage and _tag object mappers are surfaced, not fallback", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-collapse-")
    try {
      await repo.write(
        "src/registry-check.ts",
        [
          "import { Data, Effect } from 'effect'",
          "const DEFAULT_REGISTRY_URL = 'https://registry.local'",
          "class RegistryUnavailable extends Data.TaggedError('RegistryUnavailable')<{ readonly message: string }> {}",
          "declare function pingRegistry(): Promise<string>",
          "export const checkRegistry = Effect.tryPromise({",
          "  try: () => pingRegistry(),",
          "  catch: () => new RegistryUnavailable({ message: `no response from ${DEFAULT_REGISTRY_URL}` }),",
          "})",
          "export const checkRegistryTagged = Effect.tryPromise({",
          "  try: () => pingRegistry(),",
          "  catch: (cause) => ({ _tag: 'RegistryUnavailable' as const, cause }),",
          "})",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("catch clauses returning constructed domain errors are not fallback collapses", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-collapse-")
    try {
      await repo.write(
        "src/registry-resolve.ts",
        [
          "const DEFAULT_REGISTRY = 'https://registry.local'",
          "class ResolveRegistryError extends Error {}",
          "declare function readRegistry(): string",
          "export function resolveRegistry(): string | ResolveRegistryError {",
          "  try {",
          "    return readRegistry()",
          "  } catch (error) {",
          "    return new ResolveRegistryError(`lookup failed for ${DEFAULT_REGISTRY}: ${String(error)}`)",
          "  }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("fallback keywords inside string literal arguments do not classify the return", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-collapse-")
    try {
      await repo.write(
        "src/profile.ts",
        [
          "declare function readProfile(): string",
          "declare function buildProfile(name: string): string",
          "declare function recordWarning(error: unknown): void",
          "export function resolveProfile(): string {",
          "  try {",
          "    return readProfile()",
          "  } catch (error) {",
          "    recordWarning(error)",
          "    return buildProfile('default-shell')",
          "  }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("catches that report the error and terminate the process are surfaced, not hidden", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-collapse-")
    try {
      await repo.write(
        "src/install.ts",
        [
          "declare function runInstall(): void",
          "export function install(): void {",
          "  try {",
          "    runInstall()",
          "  } catch (error) {",
          "    console.error(error)",
          "    process.exit(1)",
          "  }",
          "}",
          "export function installOrAbort(): void {",
          "  try {",
          "    runInstall()",
          "  } catch (error) {",
          "    console.error(error)",
          "    process.abort()",
          "  }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("catch returns that serialize or carry the error binding are surfaced, not hidden", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-collapse-")
    try {
      await repo.write(
        "src/health.ts",
        [
          "declare function checkDaemon(): void",
          "export function probeHealth(): { readonly healthy: boolean; readonly error?: string } {",
          "  try {",
          "    checkDaemon()",
          "    return { healthy: true }",
          "  } catch (error) {",
          "    return { healthy: false, error: String(error) }",
          "  }",
          "}",
          "export function probeDirect(): { readonly ok: boolean; readonly cause?: unknown } {",
          "  try {",
          "    checkDaemon()",
          "    return { ok: true }",
          "  } catch (cause) {",
          "    return { ok: false, cause }",
          "  }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      expect(out.findings).toEqual([])
      expect(TsLd09.score(out)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("Promise.catch handlers that surface the rejection are not collapses while constant fallbacks still fire", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-collapse-")
    try {
      await repo.write(
        "src/user-watch.ts",
        [
          "const DEFAULT_USER = 'anonymous'",
          "declare function fetchCurrentUser(): Promise<string>",
          "export function watchUser(): Promise<{ readonly ok: boolean; readonly error?: string }> {",
          "  return fetchCurrentUser()",
          "    .then((user) => ({ ok: true, error: undefined }))",
          "    .catch((error) => ({ ok: false, error: String(error) }))",
          "}",
          "export function fallbackUser(): Promise<string> {",
          "  return fetchCurrentUser().catch(() => DEFAULT_USER)",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      const promiseCollapses = out.findings.filter(
        (finding) => finding.kind === "promise-catch-collapse",
      )

      expect(promiseCollapses).toHaveLength(1)
      expect(promiseCollapses[0]).toMatchObject({
        symbol: "fallbackUser",
        collapseMode: "fallback",
      })
      expect(out.findings.map((finding) => finding.symbol)).not.toContain("watchUser")
    } finally {
      await repo.cleanup()
    }
  })

  test("true silent fallbacks keep firing: keyword identifier returns and unused error bindings", async () => {
    const repo = await createTempRepo("pulsar-ts-ld-09-collapse-")
    try {
      await repo.write(
        "src/state.ts",
        [
          "declare function readState(): string",
          "declare function computeCount(): number",
          "const defaultState = 'idle'",
          "export function loadState(): string {",
          "  try {",
          "    return readState()",
          "  } catch {",
          "    return defaultState",
          "  }",
          "}",
          "export function loadCount(): number {",
          "  try {",
          "    return computeCount()",
          "  } catch (error) {",
          "    return 0",
          "  }",
          "}",
        ].join("\n"),
      )

      const out = await run(repo)
      const catchCollapses = out.findings.filter(
        (finding) => finding.kind === "catch-without-narrowing",
      )

      expect(catchCollapses).toHaveLength(2)
      expect(catchCollapses.map((finding) => finding.symbol).sort()).toEqual([
        "loadCount",
        "loadState",
      ])
      expect(catchCollapses.every((finding) => finding.collapseMode === "fallback")).toBe(true)
    } finally {
      await repo.cleanup()
    }
  })
})
