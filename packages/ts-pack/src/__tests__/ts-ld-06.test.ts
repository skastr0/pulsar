import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import {
  TsLd06,
  type TsLd06Output,
} from "../signals/ts-ld-06-annotation-coverage.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsLd06.defaultConfig): Promise<TsLd06Output> => {
  const program = TsLd06.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsLd06Output, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-ts-ld-06-"))
  await writeFile(
    join(repo, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "preserve",
      },
      include: ["**/*.ts", "**/*.tsx"],
    }),
  )
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe("TS-LD-06 (type annotation coverage)", () => {
  test("fully annotated boundary functions score 1", async () => {
    await writeTs(
      "src/api.ts",
      [
        "export function annotated(value: string): number {",
        "  return value.length",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.totalParams).toBe(1)
    expect(out.boundaryCoverage.annotatedParams).toBe(1)
    expect(out.boundaryCoverage.annotatedReturns).toBe(1)
    expect(out.boundaryCoverage.coverage).toBe(1)
    expect(out.uncoveredBoundary).toEqual([])
    expect(TsLd06.score(out)).toBe(1)
  })

  test("fully inferred boundary functions are flagged as missing both", async () => {
    const file = await writeTs(
      "src/inferred.ts",
      [
        "export function inferred(value) {",
        "  return value",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.coverage).toBe(0)
    expect(out.uncoveredBoundary).toEqual([
      {
        file,
        name: "inferred",
        line: 1,
        missingKind: "both",
      },
    ])
  })

  test("boundary coverage excludes internal functions from the score", async () => {
    await writeTs(
      "src/mixed.ts",
      [
        "export const boundary = (value: string) => value.length",
        "const internal = (value) => value",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.totalParams).toBe(1)
    expect(out.boundaryCoverage.annotatedParams).toBe(1)
    expect(out.boundaryCoverage.annotatedReturns).toBe(0)
    expect(out.boundaryCoverage.coverage).toBe(0.5)
    expect(out.internalCoverage.coverage).toBe(0)
    expect(TsLd06.score(out)).toBe(0.8)
    expect(TsLd06.diagnose(out)[0]?.severity).toBe("info")
  })

  test("typed exported function variables count as annotated boundary contracts", async () => {
    await writeTs(
      "src/contextual.ts",
      [
        "type Handler = (value: string) => number",
        "export const boundary: Handler = (value) => value.length",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.totalParams).toBe(1)
    expect(out.boundaryCoverage.annotatedParams).toBe(1)
    expect(out.boundaryCoverage.annotatedReturns).toBe(1)
    expect(out.boundaryCoverage.coverage).toBe(1)
    expect(out.uncoveredBoundary).toEqual([])
  })

  test("default-initialized boundary parameters count as typed", async () => {
    await writeTs(
      "src/defaults.ts",
      [
        "export function clamp(value: number, min = 0, max = 100) {",
        "  return Math.max(min, Math.min(max, value))",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.totalParams).toBe(3)
    expect(out.boundaryCoverage.annotatedParams).toBe(3)
    expect(out.uncoveredBoundary).toEqual([
      {
        file: join(repo, "src/defaults.ts"),
        name: "clamp",
        line: 1,
        missingKind: "return",
      },
    ])
    expect(TsLd06.score(out)).toBeCloseTo(12 / 13)
    expect(TsLd06.diagnose(out)).toEqual([
      {
        severity: "info",
        message: "Boundary function `clamp` is missing explicit return annotations",
        location: { file: join(repo, "src/defaults.ts"), line: 1 },
        data: {
          file: join(repo, "src/defaults.ts"),
          name: "clamp",
          line: 1,
          missingKind: "return",
        },
      },
    ])
  })

  test("missing boundary parameter annotations stay warning-level baseline signal", async () => {
    await writeTs(
      "src/params.ts",
      [
        "export function parse(value): string {",
        "  return String(value)",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.coverage).toBe(0.5)
    expect(TsLd06.score(out)).toBe(0.2)
    expect(TsLd06.diagnose(out)[0]?.severity).toBe("warn")
  })

  test("diagnostics honor sanitized top_n_diagnostics", async () => {
    await writeTs(
      "src/many.ts",
      [
        "export function first(value) { return value }",
        "export function second(value) { return value }",
        "",
      ].join("\n"),
    )

    const fractional = await runCompute({ ...TsLd06.defaultConfig, top_n_diagnostics: 1.8 })
    const negative = await runCompute({ ...TsLd06.defaultConfig, top_n_diagnostics: -1 })
    const nan = await runCompute({ ...TsLd06.defaultConfig, top_n_diagnostics: Number.NaN })
    const infinite = await runCompute({
      ...TsLd06.defaultConfig,
      top_n_diagnostics: Number.POSITIVE_INFINITY,
    })

    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsLd06.diagnose(fractional)).toHaveLength(1)
    expect(negative.diagnosticLimit).toBe(0)
    expect(nan.diagnosticLimit).toBe(0)
    expect(infinite.diagnosticLimit).toBe(0)
    expect(TsLd06.diagnose(negative)).toEqual([])
    expect(TsLd06.diagnose(nan)).toEqual([])
    expect(TsLd06.diagnose(infinite)).toEqual([])
  })

  test("component-typed exported functions do not require duplicate return annotations", async () => {
    await writeTs(
      "src/component.ts",
      [
        "type Component<Props> = (props: Props) => unknown",
        "type Props = { readonly label: string }",
        "export const Panel: Component<Props> = (props) => props.label",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.coverage).toBe(1)
    expect(out.uncoveredBoundary).toEqual([])
  })

  test("tsx component functions with typed props do not require duplicate return annotations", async () => {
    await writeTs(
      "src/panel.tsx",
      [
        "export function Panel(props: { readonly label: string }) {",
        "  return <div>{props.label}</div>",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.totalParams).toBe(1)
    expect(out.boundaryCoverage.annotatedParams).toBe(1)
    expect(out.boundaryCoverage.annotatedReturns).toBe(1)
    expect(out.uncoveredBoundary).toEqual([])
  })

  test("tsx component functions with untyped props still flag missing params", async () => {
    const file = await writeTs(
      "src/panel.tsx",
      [
        "export function Panel(props) {",
        "  return <div>{props.label}</div>",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.annotatedReturns).toBe(1)
    expect(out.uncoveredBoundary).toEqual([
      {
        file,
        name: "Panel",
        line: 1,
        missingKind: "params",
      },
    ])
  })

  test("named exports count as boundaries and callback arrows are excluded", async () => {
    const file = await writeTs(
      "src/named.ts",
      [
        "const publicFn = (value) => value",
        "export { publicFn }",
        "const values = [1].map((value) => value + 1)",
        "export const total = values.length",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.uncoveredBoundary.map((fn) => fn.name)).toEqual(["publicFn"])
    const fileCoverage = out.byFile.get(file)
    expect(fileCoverage?.boundary.totalParams).toBe(1)
    expect(fileCoverage?.internal.totalParams ?? 0).toBe(0)
  })

  test("exported class public methods count as boundary functions", async () => {
    await writeTs(
      "src/service.ts",
      [
        "export class Service {",
        "  run(value): number {",
        "    return value",
        "  }",
        "",
        "  private hidden(value) {",
        "    return value",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.uncoveredBoundary.map((fn) => fn.name)).toContain("Service.run")
    expect(out.uncoveredBoundary.map((fn) => fn.name)).not.toContain("Service.hidden")
  })

  test("framework-owned method contracts count as contextually typed", async () => {
    await writeTs(
      "src/sync-server.ts",
      [
        "type Env = {}",
        "declare class DurableObject<TEnv> {}",
        "export class SyncServer extends DurableObject<Env> {",
        "  async webSocketMessage(_ws, _message) {}",
        "  async webSocketClose(ws, code, _reason, _wasClean) {",
        "    ws.close(code)",
        "  }",
        "  run(value) {",
        "    return value",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.uncoveredBoundary.map((fn) => fn.name)).toEqual(["SyncServer.run"])
  })

  test("object literal methods inside exported classes are not boundary methods", async () => {
    await writeTs(
      "src/stream.ts",
      [
        "export class StreamFactory {",
        "  create(): unknown {",
        "    return {",
        "      start(controller) {",
        "        return controller",
        "      },",
        "      transform(chunk, controller) {",
        "        return [chunk, controller]",
        "      },",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.uncoveredBoundary.map((fn) => fn.name)).toEqual([])
    expect(out.internalCoverage.totalParams).toBe(3)
    expect(out.internalCoverage.annotatedParams).toBe(0)
  })

  test("test helper exports are ignored by default", async () => {
    await writeTs(
      "src/api.ts",
      [
        "export function publicApi(value) {",
        "  return value",
        "}",
        "",
      ].join("\n"),
    )
    await writeTs(
      "src/monitor.webhook.test-helpers.ts",
      [
        "export function makeWebhookPayload(value) {",
        "  return { value }",
        "}",
        "",
      ].join("\n"),
    )
    await writeTs(
      "src/test-support/build-fixture.ts",
      [
        "export const buildFixture = (value) => ({ value })",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.uncoveredBoundary.map((fn) => fn.name)).toEqual(["publicApi"])
  })

  test("hidden extension directory exports are ignored by default", async () => {
    await writeTs(
      "src/api.ts",
      [
        "export function publicApi(value) {",
        "  return value",
        "}",
        "",
      ].join("\n"),
    )
    await writeTs(
      ".pi/extensions/diff.ts",
      [
        "export default function (pi) {",
        "  return pi",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.uncoveredBoundary.map((fn) => fn.name)).toEqual(["publicApi"])
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsLd06.configSchema)(TsLd06.defaultConfig)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
  })
})
