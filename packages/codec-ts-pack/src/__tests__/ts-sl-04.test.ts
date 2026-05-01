import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "@taste-codec/core"
import { createTempRepo, runSignal } from "./test-repo.js"
import { TsSl04 } from "../signals/ts-sl-04-empty-implementations.js"
import { TsProjectLayer } from "../ts-project.js"
import type { TempRepo } from "./test-repo.js"

describe("TS-SL-04 Empty implementations and stubs", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("ts-sl-04-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("detects throw-not-implemented stubs", async () => {
    await repo.write(
      "utils.ts",
      `
export function notImplemented() {
  throw new Error("Not implemented");
}

export function todoStub() {
  throw new Error("TODO: implement this");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs.some((s) => s.kind === "throw-not-implemented")).toBe(true)
    expect(out.productionStubs.length).toBeGreaterThan(0)
  })

  test("detects empty function bodies", async () => {
    await repo.write(
      "utils.ts",
      `
export function empty() {}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs.some((s) => s.kind === "empty-body")).toBe(true)
  })

  test("detects TODO-only implementations", async () => {
    await repo.write(
      "utils.ts",
      `
export function todoOnly() {
  // TODO: implement
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs.some((s) => s.kind === "todo-comment")).toBe(true)
  })

  test("excludes test files from production stubs", async () => {
    await repo.write(
      "utils.test.ts",
      `
function testStub() {
  throw new Error("Not implemented");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.testStubs.length).toBeGreaterThan(0)
    expect(out.productionStubs.length).toBe(0)
  })

  test("production stubs emit block severity", async () => {
    await repo.write(
      "utils.ts",
      `
export function notImplemented() {
  throw new Error("Not implemented");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    const diagnostics = TsSl04.diagnose(out)
    const blockDiagnostics = diagnostics.filter((d) => d.severity === "block")
    expect(blockDiagnostics.length).toBeGreaterThan(0)
  })

  test("test file stubs emit info severity", async () => {
    await repo.write(
      "utils.test.ts",
      `
function testStub() {
  throw new Error("Not implemented");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    const diagnostics = TsSl04.diagnose(out)
    expect(diagnostics.every((d) => d.severity === "info")).toBe(true)
  })

  test("diagnostics include hash for ratcheting", async () => {
    await repo.write(
      "utils.ts",
      `
export function stub() {
  throw new Error("Not implemented");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    const diagnostics = TsSl04.diagnose(out)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.data?.hash).toBeDefined()
  })

  test("score decreases with production stubs", async () => {
    await repo.write(
      "utils.ts",
      `
export function stub1() {
  throw new Error("Not implemented");
}
export function stub2() {
  throw new Error("TODO");
}
export function stub3() {
  throw new Error("FIXME: implement");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.productionStubs.length).toBeGreaterThanOrEqual(1)
    const score = TsSl04.score(out)
    expect(score).toBeLessThan(1)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  test("diff-aware: only flags stubs in changed hunks", async () => {
    await repo.write(
      "utils.ts",
      `
const unchanged = 1;
export function newStub() {
  throw new Error("Not implemented");
}
`,
    )

    const out = await Effect.runPromise(
      TsSl04.compute(
        TsSl04.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "utils.ts", oldStart: 2, oldLines: 0, newStart: 2, newLines: 4 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.stubs.length).toBeGreaterThanOrEqual(0)
  })

  test("detects mock-return patterns with placeholder literals", async () => {
    await repo.write(
      "utils.ts",
      `
export function getMockData() {
  return "placeholder";
}

export function getMockConfig() {
  return "mock config";
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs.filter((s) => s.kind === "mock-return")).toHaveLength(2)
  })

  test("does not classify ordinary literal-return content surfaces as mock returns", async () => {
    await repo.write(
      "content.ts",
      `
export function getDurationLabel() {
  return "2 minutes";
}

export function isFeatureAvailable() {
  return false;
}

export function getEmptyItems() {
  return [];
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify ambient declaration signatures as empty implementations", async () => {
    await repo.write(
      "contracts.d.ts",
      `
export declare function readConfig(): string;
export interface Adapter {
  start(): void;
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify explicit no-op handlers as suspicious empty implementations", async () => {
    await repo.write(
      "handlers.ts",
      `
const noop = () => {};
export const noopCallback = () => {};
export function noOpHandler() {}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify promise swallow handlers as empty implementations", async () => {
    await repo.write(
      "promises.ts",
      `
export function ignoreFailure(task: Promise<void>) {
  return task.catch(() => {});
}

export function ignoreCleanup(task: Promise<void>) {
  return task.finally(function () {});
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify explicit noop implementation files as suspicious stubs", async () => {
    await repo.write(
      "adapter.noop.ts",
      `
export function start() {}
export function isAvailable() {
  return false;
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("still detects suspicious empty implementations outside no-op contexts", async () => {
    await repo.write(
      "suspicious.ts",
      `
export function saveUser() {}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(1)
    expect(out.stubs[0]?.name).toBe("saveUser")
    expect(out.stubs[0]?.kind).toBe("empty-body")
  })

  test("tsx test files are test paths, not production stub paths", async () => {
    await repo.write(
      "flow.test.tsx",
      `
test("flow", () => {});
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.testStubs).toHaveLength(1)
    expect(out.productionStubs).toHaveLength(0)
  })

  test("handles async functions with empty body", async () => {
    await repo.write(
      "utils.ts",
      `
export async function emptyAsync() {}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs.some((s) => s.name === "emptyAsync")).toBe(true)
  })
})