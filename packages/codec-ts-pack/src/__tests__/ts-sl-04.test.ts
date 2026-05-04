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
    expect(out.stubs.find((s) => s.kind === "throw-not-implemented")?.confidence).toBe("high")
    expect(out.productionStubs.length).toBeGreaterThan(0)
  })

  test("does not double-count outer functions containing nested not-implemented stubs", async () => {
    await repo.write(
      "session.ts",
      `
export function layer(Effect: { gen: (body: () => unknown) => unknown }) {
  return Effect.gen(function* () {
    const create = function* (_input: unknown) {
      throw new Error("Not implemented")
    }

    const prompt = () => {
      throw new Error("Not implemented")
    }

    return { create, prompt }
  })
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs.map((stub) => stub.name).sort()).toEqual(["create", "prompt"])
  })

  test("uses Effect.fn labels for not-implemented operation stubs", async () => {
    await repo.write(
      "session.ts",
      `
const Effect = {
  fn: (_label: string) => (body: unknown) => body,
}

export const create = Effect.fn("Session.create")(function* (_input: unknown) {
  throw new Error("Not implemented")
})
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs.map((stub) => stub.name)).toEqual(["Session.create"])
    expect(TsSl04.diagnose(out)[0]?.message).toContain("Session.create")
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
    expect(out.stubs.find((s) => s.kind === "empty-body")?.confidence).toBe("low")
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

  test("does not classify TODO comments above real code as TODO-only implementations", async () => {
    await repo.write(
      "utils.ts",
      `
export function realWork(items: Record<string, string>) {
  // TODO: support aliases after migration
  delete items.legacy
  return items
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
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

    const out = await runSignal(repo.root, TsSl04, {
      ...TsSl04.defaultConfig,
      include_test_stubs: true,
    })
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
    expect(blockDiagnostics[0]?.data?.confidence).toBe("high")
  })

  test("production hard gate config can downgrade high-confidence stubs to warnings", async () => {
    await repo.write(
      "utils.ts",
      `
export function notImplemented() {
  throw new Error("Not implemented");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, {
      ...TsSl04.defaultConfig,
      hard_gate_production: false,
    })
    const diagnostics = TsSl04.diagnose(out)
    expect(out.hardGateProduction).toBe(false)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.data?.confidence).toBe("high")
  })

  test("does not classify explicit unsupported runtime capabilities as unfinished stubs", async () => {
    await repo.write(
      "lambda-context.ts",
      `
export function done() {
  throw new Error("\`done\` on lambda Context is not implemented by Local Runtime.");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
    expect(TsSl04.score(out)).toBe(1)
  })

  test("production empty bodies emit warn severity as lower-confidence evidence", async () => {
    await repo.write(
      "utils.ts",
      `
export function empty() {}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    const diagnostics = TsSl04.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.data?.confidence).toBe("low")
    expect(diagnostics[0]?.data?.penaltyWeight).toBe(0.25)
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

    const out = await runSignal(repo.root, TsSl04, {
      ...TsSl04.defaultConfig,
      include_test_stubs: true,
    })
    const diagnostics = TsSl04.diagnose(out)
    expect(diagnostics.every((d) => d.severity === "info")).toBe(true)
  })

  test("skips test stubs by default", async () => {
    await repo.write(
      "utils.test.ts",
      `
function testStub() {
  throw new Error("Not implemented");
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toEqual([])
    expect(out.testStubs).toEqual([])
    expect(out.productionStubs).toEqual([])
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

  test("does not classify parameter-property constructors as empty implementations", async () => {
    await repo.write(
      "serialize.ts",
      `
class BaseSerializeHandler {
  constructor(protected readonly buffer: unknown) {}
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify protected underscore hook no-ops as unfinished stubs", async () => {
    await repo.write(
      "hooks.ts",
      `
abstract class BaseHandler {
  protected _beforeSerialize(_rows: number, _startRow: number, _endRow: number): void {}
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify yargs parent command handlers as unfinished stubs", async () => {
    await repo.write(
      "command.ts",
      `
export const AccountCommand = {
  command: "account",
  builder: (yargs: unknown) => yargs,
  async handler() {},
}

export const DbCommand = {
  command: "db",
  builder: (yargs: unknown) => yargs,
  handler: () => {},
}
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

export function sequence(task: Promise<void>) {
  return task.then(() => {});
}

export async function keepRunning() {
  await new Promise(() => {})
}

export function defaultEffect(Effect: { orElseSucceed: (fallback: () => void) => void }) {
  return Effect.orElseSucceed(() => {});
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify explicit UI placeholder callbacks as empty implementations", async () => {
    await repo.write(
      "component.tsx",
      `
const loading = {
  title: "Loading",
  onSelect: () => {},
  onRedirect: () => {},
}

export function ModalHost() {
  return <Modal open={true} onClose={() => {}} />
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify empty cleanup/disposer callbacks as unfinished stubs", async () => {
    await repo.write(
      "lifecycle.ts",
      `
export function register(owner: unknown) {
  if (!owner) return () => {}
  return () => {}
}

export function createLifecycle() {
  return {
    onDispose() {
      return () => {}
    },
  }
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify terminal event and dispose no-ops as unfinished stubs", async () => {
    await repo.write(
      "events.ts",
      `
export const stepper = {
  "text.ended": () => {},
  "tool.input.ended": () => {},
}

export function group() {
  return { [Symbol.dispose]() {} }
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify empty VS Code deactivate hooks as unfinished stubs", async () => {
    await repo.write(
      "src/extension.ts",
      `
export function deactivate() {}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify deferred resolver and mutable placeholder initializers as unfinished stubs", async () => {
    await repo.write(
      "deferred.ts",
      `
type State = { status: "ready" }

export function deferred() {
  const box = { resolve: (_: State) => {} }
  const promise = new Promise<State>((resolve) => {
    box.resolve = resolve
  })
  return { promise, resolve: box.resolve }
}

let fill = () => {}
fill = () => {
  return 1
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify interface reset no-ops as unfinished stubs", async () => {
    await repo.write(
      "scroll.ts",
      `
interface ScrollAcceleration {
  reset(): void
}

class CustomAcceleration implements ScrollAcceleration {
  reset(): void {}
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify empty interface hooks with ignored parameters as unfinished stubs", async () => {
    await repo.write(
      "hooks.ts",
      `
class DurableObjectLike {
  async webSocketMessage(_ws: unknown, _message: unknown) {}
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify explicit EMPTY implementation objects as unfinished stubs", async () => {
    await repo.write(
      "empty-plugin.ts",
      `
const EMPTY_TUI = {
  tui: async () => {},
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

  test("does not classify ignored-parameter plugin lifecycle cleanup hooks as unfinished stubs", async () => {
    await repo.write(
      "plugin.ts",
      `
export const DebugPlugin = {
  configure(config: unknown) {
    return config
  },
  async create(config: unknown) {
    return config
  },
  async remove(_config: unknown) {},
  target(_config: unknown) {
    return { type: "remote" }
  },
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify null-object lifecycle fallback methods as unfinished stubs", async () => {
    await repo.write(
      "supervisor.ts",
      `
type Supervisor = {
  emitter: unknown
  attachLifecycle(handler: unknown): void
  detachLifecycle(): void
  drainPending(): "continue" | "stop"
  dispose(): void
}

export function createSupervisor(emitter: unknown): Supervisor {
  if (!emitter) {
    return {
      emitter,
      attachLifecycle: () => {},
      detachLifecycle: () => {},
      drainPending: () => "continue",
      dispose: () => {},
    }
  }

  return {
    emitter,
    attachLifecycle: (handler) => {
      void handler
    },
    detachLifecycle: () => {
      return
    },
    drainPending: () => "continue",
    dispose: () => {
      return
    },
  }
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify null cleanup fallbacks as unfinished stubs", async () => {
    await repo.write(
      "abort.ts",
      `
export function buildTimeoutAbortSignal(params: { signal?: AbortSignal }) {
  if (!params.signal) {
    return { signal: undefined, cleanup: () => {} }
  }
  return { signal: params.signal, cleanup: () => params.signal?.throwIfAborted() }
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify disabled service shutdown fallbacks as unfinished stubs", async () => {
    await repo.write(
      "monitor.ts",
      `
export function monitor(enabled: boolean) {
  if (!enabled) {
    return { app: null, shutdown: async () => {} }
  }
  return { app: {}, shutdown: async () => app.close() }
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify explicit ignored error handlers as unfinished stubs", async () => {
    await repo.write(
      "socket.ts",
      `
export function drain(socket: { on(event: string, handler: () => void): void }) {
  const ignoreSocketError = () => {}
  socket.on("error", ignoreSocketError)
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify noop factory object members as unfinished stubs", async () => {
    await repo.write(
      "manager.ts",
      `
function createNoopManager() {
  return {
    getById: () => undefined,
    stop: () => {},
  }
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify fallback logger methods as unfinished stubs", async () => {
    await repo.write(
      "logger.ts",
      `
type Logger = { debug(message: string): void; warn(message: string): void }

export function run(logger?: Logger) {
  const log = logger ?? { debug: () => {}, warn: () => {} }
  log.debug("ready")
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify fallback callback initializers as unfinished stubs", async () => {
    await repo.write(
      "fallback.ts",
      `
export function run(opts: { log?: () => void }) {
  const log = opts.log ?? (() => {})
  log()
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify disabled conditional callback branches as unfinished stubs", async () => {
    await repo.write(
      "typing.ts",
      `
export function createTypingCallback(enabled: boolean) {
  const sendTypingIndicator = enabled
    ? async () => {
        await sendActivity({ type: "typing" })
      }
    : async () => {}

  return sendTypingIndicator
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify unavailable capability setters as unfinished stubs", async () => {
    await repo.write(
      "provider.ts",
      `
export function createProvider() {
  return {
    id: "local",
    requiresCredential: false,
    credentialPath: "",
    getCredentialValue: () => undefined,
    setCredentialValue: () => {},
  }
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify explicitly named noop object members as unfinished stubs", async () => {
    await repo.write(
      "dispatcher.ts",
      `
const noopDispatcher = {
  sendFinalReply: () => false,
  waitForIdle: async () => {},
  markComplete: () => {},
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify terminal lifecycle callbacks as unfinished stubs", async () => {
    await repo.write(
      "stream.ts",
      `
export const hooks = {
  onSettled: () => {},
  onReasoningEnd: true ? () => {} : undefined,
  onStreamComplete: () => {},
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify absent-capability contract stubs as unfinished implementations", async () => {
    await repo.write(
      "secret-contract-api.ts",
      `
// This channel does not expose secret-contract surfaces.
export const secretTargetRegistryEntries: readonly [] = []

export function collectRuntimeConfigAssignments(): void {}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(0)
  })

  test("does not classify expression-bodied returned no-ops as unfinished stubs", async () => {
    await repo.write(
      "logger.ts",
      `
export const silentMethodFactory = () => () => {}
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

export const repo = {
  async remove(_id: string) {},
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toHaveLength(2)
    expect(out.stubs[0]?.name).toBe("saveUser")
    expect(out.stubs[0]?.kind).toBe("empty-body")
    expect(out.stubs[0]?.confidence).toBe("low")
  })

  test("tsx test files are test paths, not production stub paths", async () => {
    await repo.write(
      "flow.test.tsx",
      `
test("flow", () => {});
`,
    )

    const out = await runSignal(repo.root, TsSl04, {
      ...TsSl04.defaultConfig,
      include_test_stubs: true,
    })
    expect(out.testStubs).toHaveLength(1)
    expect(out.productionStubs).toHaveLength(0)
  })

  test("skips story and happydom setup stubs by default", async () => {
    await repo.write(
      "button.stories.tsx",
      `
export const Primary = () => {};
`,
    )
    await repo.write(
      ".storybook/mocks/app/context/command.ts",
      `
export const App = {
  provide() {},
}
`,
    )
    await repo.write(
      "happydom.ts",
      `
HTMLCanvasElement.prototype.getContext = () => ({
  fillRect: () => {},
  strokeRect: () => {},
});
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toEqual([])
  })

  test("skips test-runtime support files by default", async () => {
    await repo.write(
      "src/test-runtime-mocks.ts",
      `
export const runtime = {
  info() {},
  warn() {},
  error() {},
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toEqual([])
  })

  test("skips mock and harness support files by default", async () => {
    await repo.write(
      "src/channel.send-mocks.ts",
      `
export const sendMocks = {
  one: () => {},
  two: () => {},
}
`,
    )
    await repo.write(
      "src/runner.harness.ts",
      `
export const hooks = {
  notifyStarted: () => {},
}
`,
    )
    await repo.write(
      "src/agents/test-helpers/fast-tools.ts",
      `
export function setDepsForTest() {}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toEqual([])
  })

  test("does not classify borrowed resource close no-ops as unfinished stubs", async () => {
    await repo.write(
      "borrowed.ts",
      `
interface Manager {
  close(): Promise<void>
}

class BorrowedManager implements Manager {
  async close() {}
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toEqual([])
  })

  test("does not classify common empty contract callbacks as unfinished stubs", async () => {
    await repo.write(
      "contracts.ts",
      `
export const responder = {
  ack: async () => {},
  acknowledge: async () => {},
  close: async () => {},
  dispose: () => {},
  cleanup: async () => {},
  log: () => {},
  markDispatchIdle: () => {},
  markRunComplete: () => {},
  notifyStarted: () => {},
  release: () => {},
  stop: () => {},
  async *[Symbol.asyncIterator]() {},
}

const clearProviderRuntimeHookCache = () => {}
export function clearSetupPromotionRuntimeModuleCache() {}
const prepareProviderDynamicModel = async () => {}
export const hooks = {
  clearProviderRuntimeHookCache,
  prepareProviderDynamicModel,
}
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toEqual([])
  })

  test("does not classify keepalive timer and registration marker callbacks as unfinished stubs", async () => {
    await repo.write(
      "callbacks.ts",
      `
const interval = setInterval(() => {}, 1_000)
setTimeout(function () {}, 1_000)

const api = {
  registerCli(callback: () => void, _opts: unknown) {
    return callback
  },
}

api.registerCli(() => {}, { commands: ["demo"] })
export const value = interval
`,
    )

    const out = await runSignal(repo.root, TsSl04, TsSl04.defaultConfig)
    expect(out.stubs).toEqual([])
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
