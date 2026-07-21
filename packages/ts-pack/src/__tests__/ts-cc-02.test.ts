import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsCc02 } from "../signals/ts-cc-02-unbounded-concurrency.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

describe("TS-CC-02 symbolic concurrency bounds", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-ts-cc-02-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("resolves six Vellum-shaped finite fanout forms", async () => {
    await repo.write(
      "src/vellum-fanout.ts",
      [
        "declare function work(input: string): Promise<void>",
        "declare function pLimit(size: number): <A>(fn: () => Promise<A>) => Promise<A>",
        "declare const paths: string[]",
        "declare const records: string[]",
        "const HOSTS = ['api', 'cdn', 'worker'] as const",
        "const DIRECTORY_CAP = 400",
        "const HYDRATION_BATCH_SIZE = 4",
        "const MAX_CONCURRENCY = 6",
        "export async function scan(index: number) {",
        "  const sessions = ['one', 'two']",
        "  await Promise.all(['a', 'b', 'c'].map(work))",
        "  await Promise.all(sessions.map((session) => work(session)))",
        "  await Promise.allSettled(HOSTS.map((host) => work(host)))",
        "  await Promise.all(paths.slice(0, DIRECTORY_CAP).map((path) => work(path)))",
        "  await Promise.all(records.slice(index, index + HYDRATION_BATCH_SIZE).map((record) => work(record)))",
        "  const limit = pLimit(MAX_CONCURRENCY)",
        "  await Promise.all(paths.map((path) => limit(() => work(path))))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc02, TsCc02.defaultConfig)

    expect(out.state).toBe("zero")
    expect(out.fanoutsObserved).toBe(6)
    expect(out.findings).toEqual([])
    expect(out.boundedFanouts.map((fanout) => ({
      iterable: fanout.iterable,
      boundExpression: fanout.boundExpression,
      resolvedUpperBound: fanout.resolvedUpperBound,
      boundReason: fanout.boundReason,
    }))).toEqual([
      {
        iterable: "['a', 'b', 'c']",
        boundExpression: "['a', 'b', 'c']",
        resolvedUpperBound: 3,
        boundReason: "literal-array",
      },
      {
        iterable: "sessions",
        boundExpression: "sessions",
        resolvedUpperBound: 2,
        boundReason: "local-const-array",
      },
      {
        iterable: "HOSTS",
        boundExpression: "HOSTS",
        resolvedUpperBound: 3,
        boundReason: "tuple-like-collection",
      },
      {
        iterable: "paths.slice(0, DIRECTORY_CAP)",
        boundExpression: "DIRECTORY_CAP",
        resolvedUpperBound: 400,
        boundReason: "slice-cap",
      },
      {
        iterable: "records.slice(index, index + HYDRATION_BATCH_SIZE)",
        boundExpression: "HYDRATION_BATCH_SIZE",
        resolvedUpperBound: 4,
        boundReason: "slice-window",
      },
      {
        iterable: "paths",
        boundExpression: "MAX_CONCURRENCY",
        resolvedUpperBound: 6,
        boundReason: "limiter-constant",
      },
    ])
  })

  test("keeps unknown collections, caps, and limiter sizes unbounded", async () => {
    await repo.write(
      "src/unknown-fanout.ts",
      [
        "declare function work(input: string): Promise<void>",
        "declare function pLimit(size: number): <A>(fn: () => Promise<A>) => Promise<A>",
        "export async function run(items: string[], cap: number, limiterSize: number) {",
        "  await Promise.all(items.map((item) => work(item)))",
        "  await Promise.all(items.slice(0, cap).map((item) => work(item)))",
        "  const limit = pLimit(limiterSize)",
        "  await Promise.all(items.map((item) => limit(() => work(item))))",
        "  let hosts = ['api', 'cdn']",
        "  await Promise.allSettled(hosts.map((host) => work(host)))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc02, TsCc02.defaultConfig)

    expect(out.state).toBe("present")
    expect(out.fanoutsObserved).toBe(4)
    expect(out.boundedFanouts).toEqual([])
    expect(out.findings.map((finding) => finding.inferenceStoppedReason)).toEqual([
      "No finite local bound was found for items",
      "Slice cap cap is not a finite local constant",
      "Limiter limit has no finite local constant bound",
      "Iterable hosts is not an immutable local array or tuple",
    ])
  })

  test("reports exact unresolved-bound evidence in diagnostics", async () => {
    await repo.write(
      "src/fanout.ts",
      [
        "declare function work(input: string): Promise<void>",
        "export async function run(items: string[]) {",
        "  await Promise.all(items.map((item) => work(item)))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc02, TsCc02.defaultConfig)
    const diagnostic = TsCc02.diagnose(out)[0]

    expect(out.findings[0]).toMatchObject({
      boundExpression: "items",
      resolvedUpperBound: null,
      inferenceStoppedReason: "No finite local bound was found for items",
    })
    expect(diagnostic).toMatchObject({
      severity: "warn",
      message:
        "Promise.all fans out over items; upper bound unresolved: No finite local bound was found for items",
      data: {
        kind: "promise-all-map",
        iterable: "items",
        boundExpression: "items",
        resolvedUpperBound: null,
        inferenceStoppedReason: "No finite local bound was found for items",
      },
      fixHints: [expect.objectContaining({ kind: "add-concurrency-limiter" })],
    })
    expect(diagnostic?.data?.hash).toEqual(expect.any(String))
  })

  test("mutation pairs revoke bounds when local proof becomes dynamic", async () => {
    await repo.write(
      "src/mutations.ts",
      [
        "declare function work(input: string): Promise<void>",
        "declare function pLimit(size: number): <A>(fn: () => Promise<A>) => Promise<A>",
        "declare const items: string[]",
        "export async function compare(cap: number, end: number, size: number, index: number) {",
        "  const fixed = ['one', 'two']",
        "  await Promise.all(fixed.map((item) => work(item)))",
        "  let mutable = ['one', 'two']",
        "  await Promise.all(mutable.map((item) => work(item)))",
        "  const CAP = 8",
        "  await Promise.all(items.slice(0, CAP).map((item) => work(item)))",
        "  await Promise.all(items.slice(0, cap).map((item) => work(item)))",
        "  const WINDOW = 4",
        "  await Promise.all(items.slice(index, index + WINDOW).map((item) => work(item)))",
        "  await Promise.all(items.slice(index, end).map((item) => work(item)))",
        "  const LIMIT = 3",
        "  const fixedLimit = pLimit(LIMIT)",
        "  await Promise.all(items.map((item) => fixedLimit(() => work(item))))",
        "  const dynamicLimit = pLimit(size)",
        "  await Promise.all(items.map((item) => dynamicLimit(() => work(item))))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc02, TsCc02.defaultConfig)

    expect(out.boundedFanouts.map((fanout) => fanout.resolvedUpperBound)).toEqual([2, 8, 4, 3])
    expect(out.findings).toHaveLength(4)
    expect(out.findings.map((finding) => finding.iterable)).toEqual([
      "mutable",
      "items.slice(0, cap)",
      "items.slice(index, end)",
      "items",
    ])
  })

  test("rejects cardinality-changing writes through const arrays and direct aliases", async () => {
    await repo.write(
      "src/mutated-const-arrays.ts",
      [
        "declare function work(input: string): Promise<void>",
        "declare const dynamic: string[]",
        "export async function pushCase() { const items = ['a']; items.push(...dynamic); await Promise.all(items.map(work)) }",
        "export async function popCase() { const items = ['a']; items.pop(); await Promise.all(items.map(work)) }",
        "export async function spliceCase() { const items = ['a']; items.splice(0, 0, ...dynamic); await Promise.all(items.map(work)) }",
        "export async function unshiftCase() { const items = ['a']; items.unshift(...dynamic); await Promise.all(items.map(work)) }",
        "export async function shiftCase() { const items = ['a']; items.shift(); await Promise.all(items.map(work)) }",
        "export async function elementCase() { const items = ['a']; items[10] = 'b'; await Promise.all(items.map(work)) }",
        "export async function lengthCase() { const items = ['a']; items.length = 20; await Promise.all(items.map(work)) }",
        "export async function aliasCase() { const items = ['a']; const alias = items; alias.push(...dynamic); await Promise.all(items.map(work)) }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc02, TsCc02.defaultConfig)

    expect(out.boundedFanouts).toEqual([])
    expect(out.findings).toHaveLength(8)
    expect(out.findings.every((finding) =>
      finding.inferenceStoppedReason.includes("cardinality") ||
      finding.inferenceStoppedReason.includes("upper bound")
    )).toBe(true)
  })

  test("does not accept limiter calls hidden inside uninvoked nested functions", async () => {
    await repo.write(
      "src/nested-limiter.ts",
      [
        "declare function work(input: string): Promise<void>",
        "declare function pLimit(size: number): <A>(fn: () => Promise<A>) => Promise<A>",
        "export async function run(items: string[]) {",
        "  const limit = pLimit(2)",
        "  await Promise.all(items.map((item) => {",
        "    const neverInvoked = () => limit(() => work(item))",
        "    void neverInvoked",
        "    return work(item)",
        "  }))",
        "  await Promise.all(items.map((item) => {",
        "    void limit(() => work(item))",
        "    return work(item)",
        "  }))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc02, TsCc02.defaultConfig)

    expect(out.boundedFanouts).toEqual([])
    expect(out.findings).toHaveLength(2)
    expect(out.findings.every((finding) =>
      finding.inferenceStoppedReason === "No finite local bound was found for items"
    )).toBe(true)
  })

  test("resolves bounded async forEach collections without claiming dynamic input is bounded", async () => {
    await repo.write(
      "src/foreach.ts",
      [
        "declare function work(input: string): Promise<void>",
        "export function run(items: string[]) {",
        "  const HOSTS = ['api', 'cdn'] as const",
        "  HOSTS.forEach(async (host) => work(host))",
        "  items.forEach(async (item) => work(item))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsCc02, TsCc02.defaultConfig)

    expect(out.boundedFanouts).toHaveLength(1)
    expect(out.boundedFanouts[0]).toMatchObject({
      kind: "async-foreach",
      resolvedUpperBound: 2,
      boundReason: "tuple-like-collection",
    })
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({
      kind: "async-foreach",
      iterable: "items",
      resolvedUpperBound: null,
    })
  })
})
