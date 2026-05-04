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

  test("ignores duplicates in example and playground roots by default", async () => {
    const duplicate = `
export function copied(value: number): number {
  const doubled = value * 2;
  if (doubled > 10) {
    return doubled - 1;
  }
  return doubled + 1;
}
`
    await repo.write("examples/one.ts", duplicate)
    await repo.write("playground/two.ts", duplicate)

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups).toEqual([])
    expect(TsSl01.score(out)).toBe(1)
  })

  test("still detects production duplicates outside excluded roots", async () => {
    const duplicate = `
export function copied(value: number): number {
  const doubled = value * 2;
  if (doubled > 10) {
    return doubled - 1;
  }
  return doubled + 1;
}
`
    await repo.write("src/one.ts", duplicate)
    await repo.write("src/two.ts", duplicate)

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups.length).toBeGreaterThan(0)
    expect(TsSl01.score(out)).toBeLessThan(1)
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

  test("does not flag repeated tiny schema-builder callbacks as exact clones", async () => {
    await repo.write(
      "schemas.ts",
      `
const withStatics = (fn: unknown) => fn;
const zod = (schema: unknown) => schema;
const User = Schema.Struct({ id: Schema.String }).pipe(withStatics((s) => ({ zod: zod(s) })));
const Account = Schema.Struct({ id: Schema.String }).pipe(withStatics((s) => ({ zod: zod(s) })));
`,
    )

    const out = await runSignal(repo.root, TsSl01, {
      ...TsSl01.defaultConfig,
      min_tokens: 8,
    })
    expect(out.groups.some((g) => g.kind === "exact")).toBe(false)
  })

  test("does not flag small Effect.gen service callbacks as structural clones", async () => {
    await repo.write(
      "effects.ts",
      `
const runA = Effect.gen(function* () {
  const service = yield* Plugin.Service
  return yield* service.list()
})

const runB = Effect.gen(function* () {
  const service = yield* User.Service
  return yield* service.list()
})
`,
    )

    const out = await runSignal(repo.root, TsSl01, {
      ...TsSl01.defaultConfig,
      min_tokens: 8,
    })
    expect(out.groups).toEqual([])
  })

  test("does not treat AST predicate union guards as structural clones", async () => {
    await repo.write(
      "guards.ts",
      `
const ts = {
  isFunctionDeclaration: (node: unknown) => Boolean(node),
  isMethodDeclaration: (node: unknown) => Boolean(node),
  isArrowFunction: (node: unknown) => Boolean(node),
  isFunctionExpression: (node: unknown) => Boolean(node),
  isTypeAliasDeclaration: (node: unknown) => Boolean(node),
  isInterfaceDeclaration: (node: unknown) => Boolean(node),
  isClassDeclaration: (node: unknown) => Boolean(node),
}

export const isCompilerFunctionLike = (node: unknown) =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node)

export const isTrackedGenericDeclaration = (node: unknown) =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isTypeAliasDeclaration(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isClassDeclaration(node)
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups.filter((group) => group.kind === "structural")).toEqual([])
  })

  test("does not rank JSX component adapter wrappers as structural clones", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "preserve",
      },
      include: ["**/*.ts", "**/*.tsx"],
    })
    await repo.write(
      "components.tsx",
      `
const splitProps = <T,>(props: T, keys: ReadonlyArray<string>) => [props, props] as const
const Primitive = {
  Header: (props: unknown) => <header {...props} />,
  Trigger: (props: unknown) => <button {...props} />,
  Content: (props: unknown) => <section {...props} />,
}

function Header(props: { class?: string; classList?: Record<string, boolean>; children?: unknown }) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Primitive.Header
      {...rest}
      data-slot="header"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Primitive.Header>
  )
}

function Trigger(props: { class?: string; classList?: Record<string, boolean>; children?: unknown }) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Primitive.Trigger
      {...rest}
      data-slot="trigger"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Primitive.Trigger>
  )
}

function Content(props: { class?: string; classList?: Record<string, boolean>; children?: unknown }) {
  const [local, rest] = splitProps(props, ["class", "classList", "children"])
  return (
    <Primitive.Content
      {...rest}
      data-slot="content"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      {local.children}
    </Primitive.Content>
  )
}
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups.filter((group) => group.kind === "structural")).toEqual([])
  })

  test("does not flag small JSX render callbacks as exact clones", async () => {
    await repo.writeJson("tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "preserve",
      },
      include: ["**/*.ts", "**/*.tsx"],
    })
    await repo.write(
      "render-callbacks.tsx",
      `
const Show = (props: { children: (value: () => string) => unknown }) => props.children(() => "error")
const localizeError = (value: string) => value

export function First() {
  return <Show>{(err) => <div data-slot="form-error">{localizeError(err())}</div>}</Show>
}

export function Second() {
  return <Show>{(err) => <div data-slot="form-error">{localizeError(err())}</div>}</Show>
}

export function Third() {
  return <Show>{(err) => <div data-slot="form-error">{localizeError(err())}</div>}</Show>
}
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    expect(out.groups.filter((group) => group.kind === "exact")).toEqual([])
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

  test("excludes generated and story files", async () => {
    await repo.write(
      "src/v2/gen/sdk.gen.ts",
      `
export function readUser(input: string) {
  const params = { input };
  return client.get("/user", params);
}
export function readOrder(input: string) {
  const params = { input };
  return client.get("/order", params);
}
`,
    )
    await repo.write(
      "components/button.stories.tsx",
      `
export const Primary = () => ({ kind: "primary" });
export const Secondary = () => ({ kind: "secondary" });
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
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

  test("diff-aware: compares changed functions against unchanged whole-tree counterparts", async () => {
    await repo.write(
      "existing.ts",
      `
export function existingHandler(value: number): number {
  const doubled = value * 2;
  if (doubled > 10) {
    return doubled - 1;
  }
  return doubled + 1;
}
`,
    )
    await repo.write(
      "changed.ts",
      `
export function copiedHandler(value: number): number {
  const doubled = value * 2;
  if (doubled > 10) {
    return doubled - 1;
  }
  return doubled + 1;
}
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
                { file: "changed.ts", oldStart: 2, oldLines: 0, newStart: 2, newLines: 7 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.scopeMode).toBe("changed-hunks")
    expect(out.totalFunctionsAnalyzed).toBe(1)
    expect(out.groups).toHaveLength(1)
    expect(out.groups[0]?.members.map((member) => member.file).sort()).toEqual([
      `${repo.root}/changed.ts`,
      `${repo.root}/existing.ts`,
    ])
    expect(TsSl01.score(out)).toBeLessThan(1)
  })

  test("diff-aware: default scoring ignores helper-scale exact clones", async () => {
    const helperBody = `
  const next = value + 1;
  return next;
`
    await repo.write(
      "existing.ts",
      `export function existingTiny(value: number): number {${helperBody}}\n`,
    )
    await repo.write(
      "changed.ts",
      `export function copiedTiny(value: number): number {${helperBody}}\n`,
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
                { file: "changed.ts", oldStart: 2, oldLines: 0, newStart: 2, newLines: 4 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.scopeMode).toBe("changed-hunks")
    expect(out.groups).toHaveLength(1)
    expect(TsSl01.score(out)).toBe(1)
    expect(TsSl01.diagnose(out)).toEqual([])
  })

  test("diff-aware: ai-assisted vector sensitivity still reports helper-scale exact clones", async () => {
    const helperBody = `
  const next = value + 1;
  return next;
`
    await repo.write(
      "existing.ts",
      `export function existingTiny(value: number): number {${helperBody}}\n`,
    )
    await repo.write(
      "changed.ts",
      `export function copiedTiny(value: number): number {${helperBody}}\n`,
    )

    const out = await Effect.runPromise(
      TsSl01.compute(
        {
          ...TsSl01.defaultConfig,
          min_tokens: 8,
        },
        new Map(),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(SignalContextTag, {
              gitSha: "TEST",
              worktreePath: repo.root,
              changedHunks: [
                { file: "changed.ts", oldStart: 2, oldLines: 0, newStart: 2, newLines: 4 },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.scopeMode).toBe("changed-hunks")
    expect(TsSl01.score(out)).toBeLessThan(1)
    expect(TsSl01.diagnose(out)[0]?.message).toContain("copiedTiny")
  })

  test("diff-aware: skips duplicates outside changed files", async () => {
    await repo.write(
      "unchanged.ts",
      `
function dup1(x: number): number { return x * 2; }
function dup2(x: number): number { return x * 2; }
`,
    )
    await repo.write(
      "changed.ts",
      `
function unique(x: number): number { return x + 1; }
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
                {
                  file: `${repo.root}/changed.ts`,
                  oldStart: 2,
                  oldLines: 0,
                  newStart: 2,
                  newLines: 1,
                },
              ],
            }),
          ),
        ),
      ),
    )

    expect(out.scopeMode).toBe("changed-hunks")
    expect(out.groups).toEqual([])
    expect(out.totalFunctionsAnalyzed).toBe(0)
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

  test("small exact helper swarms score sublinearly while larger implementation clones stay strong", () => {
    const smallHelperGroup = {
      groupId: "small-helper-swarm",
      kind: "exact" as const,
      tokenCount: 31,
      structuralHash: "small",
      members: Array.from({ length: 12 }, (_, index) => ({
        file: `helper-${index}.ts`,
        name: `asRecord${index}`,
        startLine: 1,
        endLine: 5,
      })),
    }
    const largerImplementationGroup = {
      groupId: "larger-implementation",
      kind: "exact" as const,
      tokenCount: 176,
      structuralHash: "large",
      members: [
        { file: "real-device.ts", name: "findNewestFileInDirectory", startLine: 1, endLine: 30 },
        { file: "simulator.ts", name: "findNewestFileInDirectory", startLine: 1, endLine: 30 },
      ],
    }

    const smallOnlyScore = TsSl01.score({
      groups: [smallHelperGroup],
      totalFunctionsAnalyzed: 12,
      scoreBudgetFunctions: 12,
      scopeMode: "whole-tree",
    })
    const largerOnlyScore = TsSl01.score({
      groups: [largerImplementationGroup],
      totalFunctionsAnalyzed: 2,
      scoreBudgetFunctions: 2,
      scopeMode: "whole-tree",
    })

    expect(smallOnlyScore).toBeLessThan(1)
    expect(smallOnlyScore).toBeGreaterThan(largerOnlyScore)
  })

  test("helper-scale exact clones are informational in whole-tree diagnostics", () => {
    const diagnostics = TsSl01.diagnose({
      groups: [
        {
          groupId: "tiny-helper",
          kind: "exact",
          tokenCount: 24,
          structuralHash: "tiny",
          members: [
            { file: "a.ts", name: "uniqueSorted", startLine: 1, endLine: 3 },
            { file: "b.ts", name: "uniqueSorted", startLine: 1, endLine: 3 },
          ],
        },
        {
          groupId: "larger-helper",
          kind: "exact",
          tokenCount: 40,
          structuralHash: "larger",
          members: [
            { file: "c.ts", name: "copyA", startLine: 1, endLine: 8 },
            { file: "d.ts", name: "copyB", startLine: 1, endLine: 8 },
          ],
        },
      ],
      totalFunctionsAnalyzed: 4,
      scoreBudgetFunctions: 4,
      scopeMode: "whole-tree",
    })

    expect(diagnostics.find((diagnostic) => diagnostic.data?.groupId === "tiny-helper")?.severity).toBe("info")
    expect(diagnostics.find((diagnostic) => diagnostic.data?.groupId === "larger-helper")?.severity).toBe("warn")
  })

  test("lowering min_tokens cannot improve score through denominator inflation", () => {
    const duplicatedGroup = {
      groupId: "exact-0",
      kind: "exact" as const,
      tokenCount: 80,
      structuralHash: "hash",
      members: [
        { file: "a.ts", name: "duplicateA", startLine: 1, endLine: 8 },
        { file: "b.ts", name: "duplicateB", startLine: 1, endLine: 8 },
      ],
    }

    const baselineScore = TsSl01.score({
      groups: [duplicatedGroup],
      totalFunctionsAnalyzed: 20,
      scoreBudgetFunctions: 20,
      scopeMode: "whole-tree",
    })
    const stricterDetectionScore = TsSl01.score({
      groups: [duplicatedGroup],
      totalFunctionsAnalyzed: 800,
      scoreBudgetFunctions: 20,
      scopeMode: "whole-tree",
    })

    expect(stricterDetectionScore).toBe(baselineScore)
  })

  test("diagnostics include clone counterpart locations", async () => {
    await repo.write(
      "helpers.ts",
      `
export function duplicateOne(value: number): number {
  const doubled = value * 2;
  if (doubled > 10) {
    return doubled - 1;
  }
  return doubled + 1;
}

export function duplicateTwo(value: number): number {
  const doubled = value * 2;
  if (doubled > 10) {
    return doubled - 1;
  }
  return doubled + 1;
}
`,
    )

    const out = await runSignal(repo.root, TsSl01, TsSl01.defaultConfig)
    const diagnostic = TsSl01.diagnose(out)[0]

    expect(diagnostic?.message).toContain("duplicateOne")
    expect(diagnostic?.message).toContain("duplicateTwo")
    expect(diagnostic?.message).toContain(`${repo.root}/helpers.ts`)
  })

  test("diagnostics honor configured top_n_diagnostics", () => {
    const groups = Array.from({ length: 3 }, (_, index) => ({
      groupId: `exact-${index}`,
      kind: "exact" as const,
      tokenCount: 80,
      structuralHash: `hash-${index}`,
      members: [
        { file: `a-${index}.ts`, name: `duplicateA${index}`, startLine: 1, endLine: 8 },
        { file: `b-${index}.ts`, name: `duplicateB${index}`, startLine: 1, endLine: 8 },
      ],
    }))

    const diagnostics = TsSl01.diagnose({
      groups,
      totalFunctionsAnalyzed: 6,
      scoreBudgetFunctions: 6,
      scopeMode: "whole-tree",
      diagnosticLimit: 2,
    })

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map((diagnostic) => diagnostic.data?.groupId)).toEqual(["exact-0", "exact-1"])
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
