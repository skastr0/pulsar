import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import { SignalContextTag } from "@taste-codec/core"
import { createTempRepo, runSignal } from "./test-repo.js"
import { TsSl03 } from "../signals/ts-sl-03-suppressions.js"
import { TsProjectLayer } from "../ts-project.js"
import type { TempRepo } from "./test-repo.js"

describe("TS-SL-03 Suppression growth", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("ts-sl-03-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("detects @ts-ignore without justification", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-ignore
const x: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.kind).toBe("ts-ignore")
    expect(out.suppressions[0]?.justification).toBe("missing")
    expect(out.missingJustificationCount).toBe(1)
    expect(out.analyzedFileCount).toBe(1)
  })

  test("detects @ts-expect-error without justification", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-expect-error
const y: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.some((s) => s.kind === "ts-expect-error")).toBe(true)
  })

  test("detects eslint-disable without justification", async () => {
    await repo.write(
      "utils.ts",
      `
// eslint-disable-next-line no-console
console.log("test");
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.some((s) => s.kind === "eslint-disable")).toBe(true)
  })

  test("accepts justified suppressions", async () => {
    await repo.write(
      "utils.ts",
      `
// taste-allow BUG-123 until:2026-12-01 temporary type mismatch during migration
// @ts-ignore
const z: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.missingJustificationCount).toBe(0)
  })

  test("accepts inline TypeScript directive explanations as justification", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-expect-error upstream package does not publish this internal API type
import InternalConfig from "untyped-package/internal";
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.suppressions[0]?.justificationSource).toBe("inline")
    expect(out.missingJustificationCount).toBe(0)
    expect(TsSl03.diagnose(out)[0]?.message).toBe("ts-expect-error has inline justification")
  })

  test("accepts eslint disable comments with inline reason markers", async () => {
    await repo.write(
      "utils.ts",
      `
// eslint-disable-next-line no-console -- CLI command intentionally writes progress output
console.log("building");
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.suppressions[0]?.justificationSource).toBe("inline")
    expect(out.missingJustificationCount).toBe(0)
  })

  test("accepts trailing comments after block eslint disables as inline justification", async () => {
    await repo.write(
      "utils.ts",
      `
/* eslint-disable no-console */ // Default logger intentionally writes to the developer console.
console.log("ready");
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.rule).toBe("no-console")
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.suppressions[0]?.justificationSource).toBe("inline")
    expect(out.missingJustificationCount).toBe(0)
  })

  test("accepts adjacent explanatory comments as contextual justification", async () => {
    await repo.write(
      "utils.ts",
      `
// Upstream generated type requires any at this adapter boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const value: any = input;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.suppressions[0]?.justificationSource).toBe("contextual")
    expect(out.suppressions[0]?.rule).toBe("@typescript-eslint/no-explicit-any")
    expect(out.missingJustificationCount).toBe(0)
    expect(TsSl03.diagnose(out)[0]?.message).toBe(
      "eslint-disable (@typescript-eslint/no-explicit-any) has contextual justification",
    )
  })

  test("accepts nearby comments separated by expression scaffolding as contextual justification", async () => {
    await repo.write(
      "component.ts",
      `
export function validate(args: { readonly type: string; readonly name: string; readonly opts: { readonly parent?: { readonly __name: string } } }) {
  // Ensure child logical names are prefixed with the parent name.
  if (
    args.type !== "root" &&
    // @ts-expect-error
    !args.name.startsWith(args.opts.parent!.__name)
  ) {
    throw new Error("invalid")
  }
}
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toHaveLength(1)
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.suppressions[0]?.justificationSource).toBe("contextual")
    expect(out.missingJustificationCount).toBe(0)
  })

  test("does not use distant ordinary comments to justify unrelated suppressions", async () => {
    await repo.write(
      "component.ts",
      `
export function readSecret(Resource: Record<string, unknown>) {
  // Resolve the deployment resource bag.
  const key = "AUTH_PRIVATE_KEY"
  // @ts-expect-error
  return Resource[key].value
}
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toHaveLength(1)
    expect(out.suppressions[0]?.justification).toBe("missing")
    expect(out.missingJustificationCount).toBe(1)
  })

  test("inherits nearby same-rule justification for repeated warning blocks", async () => {
    await repo.write(
      "logger.ts",
      `
export function warnCrossFilesystem() {
  // logMessage would create a circular dependency here, so write directly.
  // eslint-disable-next-line no-console
  console.warn("first line")
  // eslint-disable-next-line no-console
  console.warn("second line")
  // eslint-disable-next-line no-console
  console.warn("third line")
}
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toHaveLength(3)
    expect(out.suppressions.every((suppression) => suppression.justification === "active")).toBe(true)
    expect(out.missingJustificationCount).toBe(0)
  })

  test("accepts trace-gated console suppressions as contextual justification", async () => {
    await repo.write(
      "trace.ts",
      `
export function record(traceEvents: boolean) {
  if (traceEvents) {
    // eslint-disable-next-line no-console
    console.log("Invalidating due to directory children mismatch")
  }
}
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toHaveLength(1)
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.suppressions[0]?.justificationSource).toBe("contextual")
    expect(out.missingJustificationCount).toBe(0)
  })

  test("accepts adjacent JSDoc as contextual justification", async () => {
    await repo.write(
      "utils.ts",
      `
/** Third-party package lacks declarations for this nested import. */
// @ts-expect-error
import InternalConfig from "untyped-package/internal";
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.justification).toBe("active")
    expect(out.suppressions[0]?.justificationSource).toBe("contextual")
    expect(out.missingJustificationCount).toBe(0)
  })

  test("accepts Pulumi runtime metadata assignments as contextual justification", async () => {
    await repo.write(
      "component.ts",
      `
export class Bucket {}

const __pulumiType = "sst:aws:Bucket";
// @ts-expect-error
Bucket.__pulumiType = __pulumiType;

const pulumiType = "sst:aws:Queue";
// @ts-expect-error
Queue.__pulumiType = pulumiType;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(2)
    expect(out.suppressions.every((suppression) => suppression.justification === "active")).toBe(true)
    expect(out.suppressions.every((suppression) => suppression.justificationSource === "contextual")).toBe(true)
    expect(out.missingJustificationCount).toBe(0)
  })

  test("accepts Pulumi runtime metadata reads as contextual justification", async () => {
    await repo.write(
      "component.ts",
      `
export function register(resource: { readonly __pulumiType: string }) {
  // @ts-expect-error
  const type = resource.__pulumiType
  return type
}

export class Linkable {
  static wrappedResources = new Set<string>()

  static wrap(cls: { readonly __pulumiType: string }) {
    // @ts-expect-error
    this.wrappedResources.add(cls.__pulumiType)
  }
}
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toHaveLength(2)
    expect(out.suppressions.every((suppression) => suppression.justification === "active")).toBe(true)
    expect(out.suppressions.every((suppression) => suppression.justificationSource === "contextual")).toBe(true)
    expect(out.missingJustificationCount).toBe(0)
  })

  test("does not treat non-explanatory adjacent comments as justification", async () => {
    await repo.write(
      "utils.ts",
      `
// TODO
// @ts-ignore
const x: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions.length).toBe(1)
    expect(out.suppressions[0]?.justification).toBe("missing")
    expect(out.missingJustificationCount).toBe(1)
  })

  test("flags expired justifications", async () => {
    await repo.write(
      "utils.ts",
      `
// taste-allow BUG-123 until:2020-01-01 expired
// @ts-ignore
const w: string = 123;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions[0]?.justification).toBe("expired")
    expect(out.expiredCount).toBe(1)
  })

  test("score decreases when unjustified suppressions exist", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-ignore
const x = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(TsSl03.score(out)).toBeLessThan(1)
    expect(TsSl03.score(out)).toBeGreaterThan(0)
  })

  test("whole-tree suppression score is density-aware for large repos", () => {
    const suppressions = Array.from({ length: 20 }, (_, index) => ({
      file: `src/file-${index}.ts`,
      line: 1,
      kind: "ts-ignore" as const,
      rule: undefined,
      justification: "missing" as const,
      justificationSource: undefined,
      bypassTicket: undefined,
    }))
    const smallRepoScore = TsSl03.score({
      suppressions,
      unjustifiedCount: 20,
      expiredCount: 0,
      missingJustificationCount: 20,
      diagnosticLimit: 20,
      scopeMode: "whole-tree",
      analyzedFileCount: 20,
    })
    const largeRepoScore = TsSl03.score({
      suppressions,
      unjustifiedCount: 20,
      expiredCount: 0,
      missingJustificationCount: 20,
      diagnosticLimit: 20,
      scopeMode: "whole-tree",
      analyzedFileCount: 1_000,
    })

    expect(largeRepoScore).toBeGreaterThan(smallRepoScore)
    expect(largeRepoScore).toBeGreaterThan(0.9)
  })

  test("whole-tree suppression score keeps debt informative instead of collapsing to zero", () => {
    const suppressions = Array.from({ length: 200 }, (_, index) => ({
      file: `src/file-${index}.ts`,
      line: 1,
      kind: "eslint-disable" as const,
      rule: "no-explicit-any",
      justification: "missing" as const,
      justificationSource: undefined,
      bypassTicket: undefined,
    }))

    expect(TsSl03.score({
      suppressions,
      unjustifiedCount: 200,
      expiredCount: 0,
      missingJustificationCount: 200,
      diagnosticLimit: 20,
      scopeMode: "whole-tree",
      analyzedFileCount: 200,
    })).toBeGreaterThanOrEqual(0.35)
  })

  test("changed-hunk suppression scoring stays strict", () => {
    const suppressions = [
      {
        file: "src/changed.ts",
        line: 1,
        kind: "ts-ignore" as const,
        rule: undefined,
        justification: "missing" as const,
        justificationSource: undefined,
        bypassTicket: undefined,
      },
    ]

    expect(TsSl03.score({
      suppressions,
      unjustifiedCount: 1,
      expiredCount: 0,
      missingJustificationCount: 1,
      diagnosticLimit: 20,
      scopeMode: "changed-hunks",
      analyzedFileCount: 1_000,
    })).toBeLessThan(0.98)
  })

  test("score is 1 when no suppressions", async () => {
    await repo.write(
      "utils.ts",
      `
const x = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(TsSl03.score(out)).toBe(1)
  })

  test("ignores generated env declarations and runtime test setup suppressions", async () => {
    await repo.write(
      "src/sst-env.d.ts",
      `
/* eslint-disable */
import "sst";
`,
    )
    await repo.write(
      "happydom.ts",
      `
// @ts-expect-error simplified canvas mock
HTMLCanvasElement.prototype.getContext = () => ({});
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toEqual([])
    expect(TsSl03.score(out)).toBe(1)
  })

  test("ignores underscore-named test helper files by default", async () => {
    await repo.write(
      "src/browser/sync/client_node_test_helpers.ts",
      `
export function send(debug = false) {
  // eslint-disable-next-line no-console
  if (debug) console.debug("client sent event")
}
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toEqual([])
    expect(TsSl03.score(out)).toBe(1)
  })

  test("ignores dtslint and tst type-test suppressions by default", async () => {
    await repo.write(
      "packages/effect/dtslint/Data.tst.ts",
      `
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { pipe } from "../src/Function"
`,
    )
    await repo.write(
      "src/types/tuple.tst.ts",
      `
// @ts-expect-error negative type assertion
const value: string = 123
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toEqual([])
    expect(TsSl03.score(out)).toBe(1)
  })

  test("ignores generated and example suppressions by default", async () => {
    await repo.write(
      "packages/api/src/Generated.ts",
      `
// @ts-expect-error
const generated: string = 1;
`,
    )
    await repo.write(
      "examples/demo/src/page.tsx",
      `
// @ts-expect-error
const demo: string = 1;
`,
    )
    await repo.write(
      "sdk-samples/live_client_content.ts",
      `
// eslint-disable-next-line no-constant-condition
while (true) {}
`,
    )
    await repo.write(
      "private-demos/snippets/tour.ts",
      `
// @ts-ignore
const snippet: string = 1;
`,
    )
    await repo.write(
      "apps/docs/src/page.tsx",
      `
// @ts-expect-error
const docsOnly: string = 1;
`,
    )
    await repo.write(
      "src/ambient.d.ts",
      `
/* eslint-disable import/no-default-export */
export default interface Ambient {}
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toEqual([])
    expect(TsSl03.score(out)).toBe(1)
  })

  test("still detects production suppressions outside excluded roots", async () => {
    await repo.write(
      "src/index.ts",
      `
// @ts-expect-error
const production: string = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    expect(out.suppressions).toHaveLength(1)
    expect(out.missingJustificationCount).toBe(1)
  })

  test("does not double-count ban-ts-comment bridge suppressions before TypeScript directives", async () => {
    await repo.write(
      "src/index.ts",
      `
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const production: string = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)

    expect(out.suppressions).toHaveLength(1)
    expect(out.suppressions[0]?.kind).toBe("ts-ignore")
    expect(out.missingJustificationCount).toBe(1)
  })

  test("diagnostics include hash for ratcheting", async () => {
    await repo.write(
      "utils.ts",
      `
// @ts-ignore
const x = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, TsSl03.defaultConfig)
    const diagnostics = TsSl03.diagnose(out)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.data?.hash).toBeDefined()
    expect(typeof diagnostics[0]?.data?.hash).toBe("string")
  })

  test("diagnostics use precise suppression wording and respect diagnostic limit", async () => {
    await repo.write(
      "utils.ts",
      `// @ts-ignore
const a: string = 1;
// taste-allow BUG-123 until:2020-01-01 expired suppression
// @ts-expect-error
const b: string = 2;
// taste-allow BUG-456 until:2026-12-01 temporary upstream mismatch
// eslint-disable-next-line no-console
console.log(a, b);
`,
    )

    const out = await runSignal(repo.root, TsSl03, {
      ...TsSl03.defaultConfig,
      top_n_diagnostics: 2,
    })
    const diagnostics = TsSl03.diagnose(out)

    expect(out.suppressions.length).toBe(3)
    expect(diagnostics.length).toBe(2)
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "ts-ignore is missing justification",
      "ts-expect-error justification expired",
    ])

    const activeDiagnostics = TsSl03.diagnose({ ...out, diagnosticLimit: 3 })
    expect(activeDiagnostics[2]?.message).toBe("eslint-disable (no-console) has active bypass BUG-456")
  })

  test("diagnostics prioritize missing justifications over justified suppressions", async () => {
    await repo.write(
      "a-inline.ts",
      `
// @ts-expect-error upstream package does not publish this internal API type
import InternalConfig from "untyped-package/internal";
`,
    )
    await repo.write(
      "z-missing.ts",
      `
// @ts-ignore
const x: string = 1;
`,
    )

    const out = await runSignal(repo.root, TsSl03, {
      ...TsSl03.defaultConfig,
      top_n_diagnostics: 1,
    })
    const diagnostics = TsSl03.diagnose(out)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toBe("ts-ignore is missing justification")
  })

  test("diff-aware: only flags suppressions in changed hunks", async () => {
    await repo.write(
      "utils.ts",
      `
const unchanged = 1;
// @ts-ignore
const changed = 2;
`,
    )

    const out = await Effect.runPromise(
      TsSl03.compute(
        TsSl03.defaultConfig,
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
})
