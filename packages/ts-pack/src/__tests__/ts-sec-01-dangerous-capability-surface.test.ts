import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsSec01 } from "../signals/ts-sec-01-dangerous-capability-surface.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

describe("TS-SEC-01 binding-aware capability resolution and bounded inventory score", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-ts-sec-01-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("ignores local helpers named exec/spawn and unresolved name matches", async () => {
    await repo.write(
      "src/ffmpeg/layer.ts",
      [
        "export const exec = (command: string) => command",
        "export const spawn = (command: string) => command",
      ].join("\n"),
    )
    await repo.write(
      "src/runtime.ts",
      [
        "import { exec, spawn } from './ffmpeg/layer.js'",
        "export function transcode(input: string) {",
        "  exec(input)",
        "  spawn(input)",
        "  exec(input)",
        "  return exec(input)",
        "}",
      ].join("\n"),
    )
    await repo.write(
      "src/local.ts",
      [
        "function execSync(command: string) { return command }",
        "export function run(input: string) { return execSync(input) }",
      ].join("\n"),
    )
    await repo.write(
      "src/dangling.ts",
      "export const run = () => fork('worker.js')\n",
    )

    const out = await runSignal(repo.root, TsSec01, TsSec01.defaultConfig)

    expect(out.state).toBe("zero")
    expect(out.findings).toEqual([])
    expect(TsSec01.score(out)).toBe(1)
  })

  test("flags child_process bindings across named, namespace, default, and require styles", async () => {
    await repo.write(
      "src/named.ts",
      [
        "import { spawn } from 'node:child_process'",
        "export function run(command: string) { return spawn(command) }",
      ].join("\n"),
    )
    await repo.write(
      "src/namespace.ts",
      [
        "import * as cp from 'child_process'",
        "export function run(command: string) { return cp.exec(command) }",
      ].join("\n"),
    )
    await repo.write(
      "src/defaulted.ts",
      [
        "import child_process from 'node:child_process'",
        "export function run(command: string) { return child_process.execFile(command) }",
      ].join("\n"),
    )
    await repo.write(
      "src/required.ts",
      [
        "declare const require: (specifier: string) => any",
        "const { execSync } = require('node:child_process')",
        "export function run(command: string) { return execSync(command) }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSec01, TsSec01.defaultConfig)
    const callSinks = out.findings
      .filter((finding) => finding.kind === "shell-process" && finding.weight > 0)
      .map((finding) => finding.sink)

    expect(out.state).toBe("present")
    expect(callSinks).toEqual(
      expect.arrayContaining(["spawn", "cp.exec", "child_process.execFile", "execSync"]),
    )
    expect(TsSec01.score(out)).toBeLessThan(1)
  })

  test("flags Bun and Deno dangerous globals including Bun.spawn and Bun.$", async () => {
    await repo.write(
      "src/bun-runtime.ts",
      [
        "export async function runBun(input: string) {",
        "  Bun.spawn(['ls'])",
        "  Bun.spawnSync([input])",
        "  return Bun.$`rm -rf ${input}`",
        "}",
      ].join("\n"),
    )
    await repo.write(
      "src/deno-runtime.ts",
      [
        "export function runDeno(input: string) {",
        "  Deno.run({ cmd: [input] })",
        "  return new Deno.Command('ls')",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSec01, TsSec01.defaultConfig)
    const sinks = out.findings.map((finding) => finding.sink)

    expect(out.state).toBe("present")
    expect(sinks).toEqual(
      expect.arrayContaining([
        "Bun.spawn",
        "Bun.spawnSync",
        "Bun.$",
        "Deno.run",
        "new Deno.Command",
      ]),
    )
    expect(out.findings.find((finding) => finding.sink === "Bun.spawn")?.weight).toBe(0)
    expect(out.findings.find((finding) => finding.sink === "Bun.$")?.weight).toBe(0.75)
    expect(out.findings.every((finding) => finding.kind === "shell-process")).toBe(true)
    expect(TsSec01.score(out)).toBeLessThan(1)
    expect(TsSec01.score(out)).toBeGreaterThanOrEqual(0.5)
  })

  test("does not flag member calls on locally shadowed Bun/Deno globals", async () => {
    await repo.write(
      "src/shadow.ts",
      [
        "const Bun = { spawn: (command: ReadonlyArray<string>) => command }",
        "export const run = (input: string) => Bun.spawn([input])",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSec01, TsSec01.defaultConfig)

    expect(out.state).toBe("zero")
    expect(out.findings).toEqual([])
    expect(TsSec01.score(out)).toBe(1)
  })

  test("keeps inventory-only repositories at or above the ~0.5 score floor", async () => {
    const queryFile = (table: string): string =>
      [
        "declare const db: { query(text: string): Promise<unknown> }",
        `export async function list(id: string) {`,
        `  await db.query(\`select a from ${table} where id = \${id}\`)`,
        `  await db.query(\`select b from ${table} where id = \${id}\`)`,
        `  await db.query(\`select c from ${table} where id = \${id}\`)`,
        `  await db.query(\`select d from ${table} where id = \${id}\`)`,
        "}",
      ].join("\n")
    await repo.write("src/users.ts", queryFile("users"))
    await repo.write("src/orders.ts", queryFile("orders"))
    await repo.write("src/events.ts", queryFile("events"))

    const out = await runSignal(repo.root, TsSec01, TsSec01.defaultConfig)
    const diagnostics = TsSec01.diagnose(out)

    expect(out.state).toBe("present")
    expect(out.findings).toHaveLength(12)
    expect(out.findings.every((finding) => finding.kind === "raw-sql")).toBe(true)
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "info")).toBe(true)
    expect(TsSec01.score(out)).toBeGreaterThanOrEqual(0.5)
    expect(TsSec01.score(out)).toBeLessThan(1)
  })

  test("score floor holds even when inventory concentrates in one file", async () => {
    const lines = [
      "declare const db: { query(text: string): Promise<unknown> }",
      "export async function report(id: string) {",
    ]
    for (let index = 0; index < 12; index += 1) {
      lines.push(`  await db.query(\`select c${index} from t${index} where id = \${id}\`)`)
    }
    lines.push("}")
    await repo.write("src/report.ts", lines.join("\n"))

    const out = await runSignal(repo.root, TsSec01, TsSec01.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.findings).toHaveLength(12)
    expect(TsSec01.score(out)).toBeGreaterThanOrEqual(0.5)
  })

  test("eval keeps warn-class pressure that can push the score below the inventory floor", async () => {
    await repo.write(
      "src/runtime.ts",
      [
        "import { exec } from 'node:child_process'",
        "export function run(input: string) {",
        "  eval(input)",
        "  return exec(input)",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsSec01, TsSec01.defaultConfig)
    const diagnostics = TsSec01.diagnose(out)
    const evalDiagnostic = diagnostics.find((diagnostic) =>
      (diagnostic.data as { kind?: string }).kind === "eval",
    )

    expect(out.findings.map((finding) => finding.kind)).toEqual(
      expect.arrayContaining(["eval", "shell-process"]),
    )
    expect(evalDiagnostic?.severity).toBe("warn")
    expect(TsSec01.score(out)).toBeLessThan(0.5)
  })
})
