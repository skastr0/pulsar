import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsAd01 } from "../signals/ts-ad-01-boundary-violations.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo
type TsAd01Result = Parameters<typeof TsAd01.score>[0]

const NAMING_CONVENTIONS = {
  function: "camelCase",
  class: "PascalCase",
  interface: "PascalCase",
  type: "PascalCase",
  const: "camelCase | UPPER_SNAKE_CASE",
  enum: "PascalCase",
}

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ad-01-")
})

afterEach(async () => {
  await repo.cleanup()
})

const writePackage = async (
  slug: string,
  name: string,
  dependencies: Record<string, string> = {},
): Promise<void> => {
  await repo.writeJson(`packages/${slug}/tsconfig.json`, {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["src/**/*.ts"],
  })
  await repo.writeJson(`packages/${slug}/package.json`, {
    name,
    version: "0.0.0",
    private: true,
    dependencies,
  })
}

const conventions = (
  boundaries: Record<
    string,
    {
      visibility: "public-api" | "internal"
      allowed_imports: ReadonlyArray<string>
      blocked_imports?: ReadonlyArray<string>
    }
  >,
) => ({
  schema_version: 1,
  extracted_at_sha: "HEAD",
  boundaries,
  naming_conventions: NAMING_CONVENTIONS,
  architectural_rules: [],
})

describe("TS-AD-01 (module boundary violations)", () => {
  test("allows root-entry workspace imports that match the allowlist", async () => {
    await writePackage("core", "@repo/core")
    await writePackage("app", "@repo/app", { "@repo/core": "workspace:*" })
    await repo.write("packages/core/src/index.ts", "export const coreValue = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      "import { coreValue } from '@repo/core'\nexport const appValue = coreValue\n",
    )

    const out = await runSignal(repo.root, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        "packages/core": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
        "packages/app": {
          visibility: "internal",
          allowed_imports: ["@repo/core", "effect"],
        },
      }),
    })

    expect(out.violations).toEqual([])
    expect(out.totalImports).toBe(1)
    expect(TsAd01.score(out)).toBe(1)
  })

  test("flags package-name deep reaches into public-api packages", async () => {
    await writePackage("core", "@repo/core")
    await writePackage("app", "@repo/app", { "@repo/core": "workspace:*" })
    await repo.write("packages/core/src/index.ts", "export * from './internal'\n")
    await repo.write("packages/core/src/internal.ts", "export const internalValue = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      "import { internalValue } from '@repo/core/src/internal'\nexport const appValue = internalValue\n",
    )

    const out = await runSignal(repo.root, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        "packages/core": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
        "packages/app": {
          visibility: "internal",
          allowed_imports: ["@repo/core"],
        },
      }),
    })

    expect(out.violations[0]?.kind).toBe("deep-reach")
    expect(TsAd01.diagnose(out)[0]?.severity).toBe("block")
    expect(typeof TsAd01.diagnose(out)[0]?.data?.hash).toBe("string")
  })

  test("allows package-name imports to manifest export subpaths", async () => {
    await writePackage("core", "@repo/core")
    await repo.writeJson("packages/core/package.json", {
      name: "@repo/core",
      version: "0.0.0",
      private: true,
      exports: {
        ".": "./dist/index.js",
        "./backpressure": "./dist/backpressure.js",
        "./signals/*": "./dist/signals/*.js",
      },
    })
    await writePackage("app", "@repo/app", { "@repo/core": "workspace:*" })
    await repo.write("packages/core/src/index.ts", "export const coreValue = 1\n")
    await repo.write("packages/core/src/backpressure.ts", "export const backpressure = 1\n")
    await repo.write("packages/core/src/signals/public.ts", "export const signal = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { backpressure } from '@repo/core/backpressure'",
        "import { signal } from '@repo/core/signals/public'",
        "export const appValue = backpressure + signal",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        "packages/core": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
        "packages/app": {
          visibility: "internal",
          allowed_imports: ["@repo/core"],
        },
      }),
    })

    expect(out.violations).toEqual([])
    expect(out.totalImports).toBe(2)
  })

  test("flags package-name imports to unexported subpaths", async () => {
    await writePackage("core", "@repo/core")
    await repo.writeJson("packages/core/package.json", {
      name: "@repo/core",
      version: "0.0.0",
      private: true,
      exports: {
        ".": "./dist/index.js",
        "./backpressure": "./dist/backpressure.js",
      },
    })
    await writePackage("app", "@repo/app", { "@repo/core": "workspace:*" })
    await repo.write("packages/core/src/index.ts", "export const coreValue = 1\n")
    await repo.write("packages/core/src/internal.ts", "export const internalValue = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      "import { internalValue } from '@repo/core/internal'\nexport const appValue = internalValue\n",
    )

    const out = await runSignal(repo.root, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        "packages/core": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
        "packages/app": {
          visibility: "internal",
          allowed_imports: ["@repo/core"],
        },
      }),
    })

    expect(out.violations).toMatchObject([
      {
        kind: "deep-reach",
        specifier: "@repo/core/internal",
      },
    ])
  })

  test("flags blocked targets explicitly", async () => {
    await writePackage("app", "@repo/app")
    await repo.write(
      "packages/app/src/index.ts",
      "import { Project } from 'ts-morph'\nexport const appValue = Project\n",
    )

    const out = await runSignal(repo.root, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        "packages/app": {
          visibility: "internal",
          allowed_imports: [],
          blocked_imports: ["ts-morph"],
        },
      }),
    })

    expect(out.violations[0]?.kind).toBe("blocked-target")
  })

  test("flags imports that are not in a non-empty allowlist", async () => {
    await writePackage("app", "@repo/app")
    await repo.write(
      "packages/app/src/index.ts",
      "import { chunk } from 'lodash'\nexport const appValue = chunk([1, 2], 1)\n",
    )

    const out = await runSignal(repo.root, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        "packages/app": {
          visibility: "internal",
          allowed_imports: ["effect"],
        },
      }),
    })

    expect(out.violations[0]?.kind).toBe("not-in-allowlist")
  })

  test("flags workspace-internal cross-package relative reaches", async () => {
    await writePackage("core", "@repo/core")
    await writePackage("app", "@repo/app", { "@repo/core": "workspace:*" })
    await repo.write("packages/core/src/index.ts", "export * from './internal'\n")
    await repo.write("packages/core/src/internal.ts", "export const internalValue = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      "import { internalValue } from '../../core/src/internal'\nexport const appValue = internalValue\n",
    )

    const out = await runSignal(repo.root, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        "packages/core": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
        "packages/app": {
          visibility: "internal",
          allowed_imports: ["@repo/core"],
        },
      }),
    })

    expect(out.violations[0]?.kind).toBe("deep-reach")
    expect(out.violationsByPackage.get("@repo/app")).toBe(1)
  })

  test("diagnostics honor top_n_diagnostics as a sanitized total cap", async () => {
    await writePackage("app", "@repo/app")
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { chunk } from 'lodash'",
        "import { pipe } from 'remeda'",
        "import { v4 } from 'uuid'",
        "export const appValue = pipe(chunk([v4()], 1))",
      ].join("\n"),
    )

    const referenceData = {
      "schema-conventions": conventions({
        "packages/app": {
          visibility: "internal",
          allowed_imports: ["effect"],
        },
      }),
    }

    const capped = await runSignal(
      repo.root,
      TsAd01,
      { ...TsAd01.defaultConfig, top_n_diagnostics: 1.8 },
      referenceData,
    )
    const negative = await runSignal(
      repo.root,
      TsAd01,
      { ...TsAd01.defaultConfig, top_n_diagnostics: -1 },
      referenceData,
    )
    const nan = await runSignal(
      repo.root,
      TsAd01,
      { ...TsAd01.defaultConfig, top_n_diagnostics: Number.NaN },
      referenceData,
    )
    const infinity = await runSignal(
      repo.root,
      TsAd01,
      { ...TsAd01.defaultConfig, top_n_diagnostics: Number.POSITIVE_INFINITY },
      referenceData,
    )

    expect(capped.violations).toHaveLength(3)
    expect(capped.diagnosticLimit).toBe(1)
    expect(TsAd01.diagnose(capped)).toHaveLength(1)
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsAd01.diagnose(negative)).toHaveLength(0)
    expect(nan.diagnosticLimit).toBe(0)
    expect(TsAd01.diagnose(nan)).toHaveLength(0)
    expect(infinity.diagnosticLimit).toBe(0)
    expect(TsAd01.diagnose(infinity)).toHaveLength(0)
  })

  test("gracefully degrades when no conventions are configured", async () => {
    await writePackage("app", "@repo/app")
    await repo.write(
      "packages/app/src/index.ts",
      "import { chunk } from 'lodash'\nexport const appValue = chunk([1, 2], 1)\n",
    )

    const out = await runSignal(repo.root, TsAd01, TsAd01.defaultConfig)

    expect(out.referenceDataStatus).toBe("missing")
    expect(TsAd01.score(out)).toBe(1)
    expect(TsAd01.diagnose(out)).toEqual([{ severity: "warn", message: "no conventions configured" }])
  })

  test("scores violations as 1 - violations / totalImports", () => {
    const output: TsAd01Result = {
      violations: Array.from({ length: 5 }, (_, index) => ({
        fromFile: `src/file-${index}.ts`,
        fromPackage: "@repo/app",
        toPackage: "@repo/core",
        specifier: "@repo/core/src/internal",
        kind: "deep-reach" as const,
        line: index + 1,
      })),
      totalImports: 100,
      violationsByPackage: new Map([["@repo/app", 5]]),
      referenceDataStatus: "loaded",
      diagnosticLimit: 10,
    }

    expect(TsAd01.score(output)).toBeCloseTo(0.95)
  })
})
