import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsCc01 } from "../signals/ts-cc-01-async-failure-control.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

describe("TS-CC-01 regressions", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-ts-cc-01-regressions-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("does not flag synchronous write calls when lib types do not resolve", async () => {
    await repo.write(
      "scripts/build.ts",
      [
        "import { writeFileSync } from 'node:fs'",
        "import type { Socket } from 'node:net'",
        "declare const socket: Socket",
        "export function emitArtifacts(outDir: string, manifest: string, payload: string) {",
        "  writeFileSync(`${outDir}/manifest.json`, manifest)",
        "  socket.write(payload)",
        "  process.stdout.write(payload)",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.state).toBe("zero")
    expect(out.findings).toHaveLength(0)
    expect(TsCc01.score(out)).toBe(1)
  })

  test("treats a terminal .catch(handler) expression statement as handled", async () => {
    await repo.write(
      "src/transport.ts",
      [
        "declare function teardown(): void",
        "declare function reportFailure(error: unknown): void",
        "declare function releaseLock(): void",
        "declare function refreshCache(): Promise<void>",
        "export class Channel {",
        "  private write(payload: string): Promise<void> {",
        "    return Promise.resolve()",
        "  }",
        "  send(payload: string, reject: (error: unknown) => void) {",
        "    this.write(payload).catch((error) => {",
        "      teardown()",
        "      reject(error)",
        "    })",
        "  }",
        "}",
        "export function refresh() {",
        "  refreshCache().catch(reportFailure).finally(releaseLock)",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.findings).toHaveLength(0)
    expect(TsCc01.score(out)).toBe(1)
  })

  test("metamorphic pair: identical empty catches classify identically regardless of comment wording", async () => {
    await repo.write(
      "src/state.ts",
      [
        "export function readState(raw: string): unknown {",
        "  try { return JSON.parse(raw) } catch {",
        "    /* ignore malformed state snapshots */",
        "  }",
        "  return undefined",
        "}",
        "export function readBackup(raw: string): unknown {",
        "  try { return JSON.parse(raw) } catch {",
        "    /* the snapshot may predate the current format */",
        "  }",
        "  return undefined",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.findings.filter((finding) => finding.kind === "empty-catch")).toHaveLength(0)
    expect(out.findings).toHaveLength(0)
    expect(TsCc01.score(out)).toBe(1)
  })

  test("classifies console-handled rejections as info-grade log-only handlers", async () => {
    await repo.write(
      "src/purchases.ts",
      [
        "declare function initializePurchases(): Promise<void>",
        "export function bootstrap() {",
        "  void initializePurchases().catch(console.warn)",
        "}",
        "export function bootstrapVerbose() {",
        "  void initializePurchases().catch((error) => console.warn('purchases unavailable', error))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)
    const diagnostics = TsCc01.diagnose(out)

    expect(out.findings.every((finding) => finding.kind === "log-only-handler")).toBe(true)
    expect(out.findings.some((finding) => finding.kind === "swallowed-rejection")).toBe(false)
    expect(TsCc01.score(out)).toBe(1)
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "info")).toBe(true)
    expect(diagnostics[0]?.message).toBe(
      "log-only-handler handles the async failure explicitly by logging and continuing",
    )
  })

  test("keeps firing on bare calls whose return type resolves to Promise", async () => {
    await repo.write(
      "src/shutdown.ts",
      [
        "declare function flushTelemetry(): Promise<void>",
        "const persistSession = async () => {}",
        "export function shutdown() {",
        "  flushTelemetry()",
        "  persistSession()",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings.map((finding) => finding.kind)).toEqual([
      "floating-promise",
      "floating-promise",
    ])
    expect(out.findings.map((finding) => finding.expression)).toEqual([
      "flushTelemetry",
      "persistSession",
    ])
    expect(TsCc01.score(out)).toBeLessThan(1)
  })

  test("keeps firing on .then chains without a rejection handler even when types do not resolve", async () => {
    await repo.write(
      "src/runner.ts",
      [
        "import { Effect } from 'effect'",
        "declare const program: unknown",
        "declare function report(exit: unknown): void",
        "export function run() {",
        "  Effect.runPromise(program).then((exit) => report(exit))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]?.kind).toBe("floating-promise")
    expect(out.findings[0]?.expression).toContain(".then")
    expect(TsCc01.score(out)).toBeLessThan(1)
  })

  test("keeps firing on a genuinely undocumented empty catch", async () => {
    await repo.write(
      "src/config.ts",
      [
        "export function parseConfig(raw: string): unknown {",
        "  try { return JSON.parse(raw) } catch {}",
        "  return undefined",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]?.kind).toBe("empty-catch")
    expect(TsCc01.score(out)).toBeLessThan(1)
    expect(TsCc01.diagnose(out)[0]?.severity).toBe("warn")
  })
})
