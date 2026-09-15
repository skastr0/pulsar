import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  forEachCheckerCallEvidenceInChunks,
  TS_CC_01_CHECKER_CALL_CHUNK_SIZE,
  TsCc01,
} from "../signals/ts-cc-01-async-failure-control.js"
import { SOURCE_FILE_LOAD_WINDOW_SIZE } from "../source-file-loader.js"
import type { CallExpression, Node, Project } from "../tsgo-api.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

describe("TS-CC-01 regressions", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-ts-cc-01-regressions-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("chunks checker evidence while preserving call and declaration alignment", async () => {
    const callCount = TS_CC_01_CHECKER_CALL_CHUNK_SIZE * 2 + 1
    const expressions = Array.from({ length: callCount }, (_, index) =>
      ({ testIndex: index }) as unknown as Node)
    const calls = expressions.map((expression, testIndex) =>
      ({ expression, testIndex }) as unknown as CallExpression)
    const typeBatchSizes: Array<number> = []
    const symbolBatchSizes: Array<number> = []
    const project = {
      checker: {
        getTypeAtLocation: async (nodes: ReadonlyArray<Node>) => {
          typeBatchSizes.push(nodes.length)
          return nodes.map((node) => ({
            testIndex: (node as unknown as { readonly testIndex: number }).testIndex,
          }))
        },
        typeToString: async (
          type: { readonly testIndex: number },
          node: Node,
        ) => `type:${type.testIndex}:${(node as unknown as { readonly testIndex: number }).testIndex}`,
        getSymbolAtLocation: async (nodes: ReadonlyArray<Node>) => {
          symbolBatchSizes.push(nodes.length)
          return nodes.map((node) => ({
            declarations: [{ resolve: async () => node }],
          }))
        },
      },
    } as unknown as Project
    const observed: Array<readonly [number, string, number]> = []

    await forEachCheckerCallEvidenceInChunks(
      project,
      calls,
      (call, typeText, declarations, index) => {
        expect(call).toBe(calls[index])
        observed.push([
          index,
          typeText,
          (declarations[0] as unknown as { readonly testIndex: number }).testIndex,
        ])
      },
    )

    expect(typeBatchSizes).toEqual([
      TS_CC_01_CHECKER_CALL_CHUNK_SIZE,
      TS_CC_01_CHECKER_CALL_CHUNK_SIZE,
      1,
    ])
    expect(symbolBatchSizes).toEqual(typeBatchSizes)
    expect(observed).toEqual(Array.from({ length: callCount }, (_, index) => [
      index,
      `type:${index}:${index}`,
      index,
    ]))
  })

  test("preserves exact output across source-file and checker-call windows", async () => {
    for (let index = 0; index < SOURCE_FILE_LOAD_WINDOW_SIZE; index += 1) {
      await repo.write(
        `src/${String(index).padStart(2, "0")}.ts`,
        [
          "export declare function touch(): void",
          "touch()",
          "touch()",
          "touch()",
          "touch()",
        ].join("\n"),
      )
    }
    const boundaryFile = `src/${String(SOURCE_FILE_LOAD_WINDOW_SIZE).padStart(2, "0")}.ts`
    await repo.write(
      boundaryFile,
      "export declare function persist(): Promise<void>\npersist()",
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)
    const repeated = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.analyzedFiles).toBe(SOURCE_FILE_LOAD_WINDOW_SIZE + 1)
    expect(out.findings.map((finding) => [
      finding.file.slice(repo.root.length + 1),
      finding.kind,
      finding.expression,
    ])).toEqual([[boundaryFile, "floating-promise", "persist"]])
    expect(repeated).toEqual(out)
  })

  test("project batches preserve file offsets, exclusions, and checker ownership", async () => {
    for (const name of ["a", "b"]) {
      await repo.writeJson(`packages/${name}/tsconfig.json`, {
        compilerOptions: { strict: true },
        include: ["src/**/*.ts"],
      })
      await repo.write(`packages/${name}/src/empty.ts`, "export const value = 1")
      await repo.write(`packages/${name}/src/sync.ts`,
        "export function send(): void {}\nsend()\nsend()")
      await repo.write(`packages/${name}/src/async.ts`,
        "export async function send() {}\nsend()")
      await repo.write(`packages/${name}/src/ignored.test.ts`,
        "export async function send() {}\nsend()")
    }

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)
    const repeated = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.analyzedFiles).toBe(6)
    expect(out.findings.map((finding) => [finding.file.slice(repo.root.length + 1), finding.kind])).toEqual([
      ["packages/a/src/async.ts", "floating-promise"],
      ["packages/b/src/async.ts", "floating-promise"],
    ])
    expect(repeated).toEqual(out)
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

  test("uses the production analysis substrate for floating and empty-catch findings", async () => {
    await repo.write(
      "src/perf.ts",
      [
        "declare function send(): Promise<void>",
        "export function run() {",
        "  send()",
        "  void send()",
        "  Promise.resolve().then(() => {})",
        "  try { throw new Error('x') } catch {}",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc01, TsCc01.defaultConfig)

    expect(out.analyzedFiles).toBeGreaterThan(0)
    expect(out.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["floating-promise", "fire-and-forget", "empty-catch"]),
    )
  })
})
