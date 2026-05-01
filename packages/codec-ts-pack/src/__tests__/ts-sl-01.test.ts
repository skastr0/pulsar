import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "@taste-codec/core"
import { createTempRepo, runSignal } from "./test-repo.js"
import { TsSl01 } from "../signals/ts-sl-01-duplication.js"
import { TsProjectLayer } from "../ts-project.js"
import type { TempRepo } from "./test-repo.js"

describe("TS-SL-01 Duplication on new code", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("ts-sl-01-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("detects exact duplicate functions", async () => {
    await repo.write(
      "utils.ts",
      `
export function helper1(x: number): number {
  if (x > 0) { return x * 2; }
  return 0;
}

export function helper2(x: number): number {
  if (x > 0) { return x * 2; }
  return 0;
}
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups.length).toBeGreaterThan(0)
    expect(out.groups.some((g) => g.kind === "exact")).toBe(true)
    expect(out.scopeMode).toBe("whole-tree")
  })

  test("detects structural near-duplicates", async () => {
    await repo.write(
      "handlers.ts",
      `
export function handleUser(userId: string) {
  const user = fetchUser(userId);
  if (!user) throw new Error("User not found");
  return transformUser(user);
}

export function handleOrder(orderId: string) {
  const order = fetchOrder(orderId);
  if (!order) throw new Error("Order not found");
  return transformOrder(order);
}
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    const structuralGroups = out.groups.filter((g) => g.kind === "structural")
    expect(structuralGroups.length).toBeGreaterThan(0)
  })

  test("does not collapse service request wrappers distinguished by object-literal anchors", async () => {
    await repo.write(
      "client.ts",
      `
const PROTOCOL_VERSION = 1;
const buildOptions = (onEvent?: unknown) => ({ onEvent });
const sendUserCreate = (options: unknown, request: unknown) => ({ result: request });
const sendOrderCancel = (options: unknown, request: unknown) => ({ result: request });
const randomUUID = () => "id";

export const client = {
  createUser: ({ userId, email, onEvent }: { userId: string; email: string; onEvent?: unknown }) => {
    const options = buildOptions(onEvent);
    const response = sendUserCreate(options, {
      kind: "request",
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "user.create",
      params: {
        userId,
        email,
      },
    });

    return response.result;
  },
  cancelOrder: ({ orderId, reason, onEvent }: { orderId: string; reason: string; onEvent?: unknown }) => {
    const options = buildOptions(onEvent);
    const response = sendOrderCancel(options, {
      kind: "request",
      protocolVersion: PROTOCOL_VERSION,
      requestId: randomUUID(),
      method: "order.cancel",
      params: {
        orderId,
        reason,
      },
    });

    return response.result;
  },
};
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    const structuralGroups = out.groups.filter((g) => g.kind === "structural")
    expect(structuralGroups).toHaveLength(0)
  })

  test("does not collapse repeated error object adapters with distinct literal codes", async () => {
    await repo.write(
      "errors.ts",
      `
class EnvironmentError extends Error {
  constructor(readonly options: { code: string; reason: string; nextStep: string; details: ReadonlyArray<string> }) {
    super(options.reason);
  }
}

export const start = (error: unknown) =>
  new EnvironmentError({
    code: "server-start",
    reason: error instanceof Error ? error.message : String(error),
    nextStep: "Check socket permissions and retry serving.",
    details: [],
  });

export const stop = (error: unknown) =>
  new EnvironmentError({
    code: "server-stop",
    reason: error instanceof Error ? error.message : String(error),
    nextStep: "Inspect daemon output and retry shutdown.",
    details: [],
  });
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    const structuralGroups = out.groups.filter((g) => g.kind === "structural")
    expect(structuralGroups).toHaveLength(0)
  })

  test("still detects duplicated imperative branches that only rename domain identifiers", async () => {
    await repo.write(
      "processors.ts",
      `
export function processUser(userId: string) {
  const user = loadUser(userId);
  if (!user.ready) {
    auditUser(userId);
    return retryUser(userId);
  }
  return finishUser(user);
}

export function processOrder(orderId: string) {
  const order = loadOrder(orderId);
  if (!order.ready) {
    auditOrder(orderId);
    return retryOrder(orderId);
  }
  return finishOrder(order);
}
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups.some((g) => g.kind === "structural")).toBe(true)
  })

  test("excludes test files", async () => {
    await repo.write(
      "utils.test.ts",
      `
function testHelper(x: number): number {
  if (x > 0) { return x * 2; }
  return 0;
}

function testHelper2(x: number): number {
  if (x > 0) { return x * 2; }
  return 0;
}
`,
    )

    const config = { ...TsSl01.defaultConfig }
    const out = await runSignal(repo.root, TsSl01, config)
    expect(out.totalFunctionsAnalyzed).toBe(0)
  })

  test("diff-aware: only flags duplicates in changed hunks", async () => {
    await repo.write(
      "utils.ts",
      `
function unchanged(x: number): number { return x; }
function dup1(x: number): number { return x * 2; }
function dup2(x: number): number { return x * 2; }
`,
    )

    const out = await Effect.runPromise(
      TsSl01.compute(
        TsSl01.defaultConfig,
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "utils.ts", oldStart: 3, oldLines: 0, newStart: 3, newLines: 2 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.scopeMode).toBe("changed-hunks")
  })

  test("score is 1 when no duplicates", async () => {
    await repo.write(
      "utils.ts",
      `
export function unique1(x: number): number { return x; }
export function unique2(x: string): string { return x.toUpperCase(); }
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups.length).toBe(0)
    expect(TsSl01.score(out)).toBe(1)
  })

  test("score decreases with more duplicates", async () => {
    await repo.write(
      "utils.ts",
      `
export function dup1(x: number): number {
  const result = x * 2;
  if (result > 0) {
    return result + 1;
  }
  return result;
}

export function dup2(x: number): number {
  const result = x * 2;
  if (result > 0) {
    return result + 1;
  }
  return result;
}

export function dup3(x: number): number {
  const result = x * 2;
  if (result > 0) {
    return result + 1;
  }
  return result;
}

export function dup4(x: number): number {
  const result = x * 2;
  if (result > 0) {
    return result + 1;
  }
  return result;
}
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    const score = TsSl01.score(out)
    expect(score).toBeLessThan(1)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  test("normalizes string literals in ternary branches instead of treating them as object anchors", async () => {
    await repo.write(
      "ternary.ts",
      `
export function describeUser(enabled: boolean, userId: string) {
  const label = enabled ? "active user" : "inactive user";
  const status = enabled ? "green" : "gray";
  return formatUser(label, status, userId);
}

export function describeOrder(enabled: boolean, orderId: string) {
  const label = enabled ? "active order" : "inactive order";
  const status = enabled ? "ready" : "blocked";
  return formatOrder(label, status, orderId);
}
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups.some((g) => g.kind === "structural")).toBe(true)
  })
})