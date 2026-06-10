import { realpath } from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsAd01 } from "../signals/ts-ad-01-boundary-violations.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo
// The compiler realpaths resolved module files (for example macOS tmpdir
// symlinks become /private/var/...). Run the signal against the realpathed
// root so resolved node_modules files share the workspace path prefix,
// matching how real repositories behave.
let repoRoot: string

const NAMING_CONVENTIONS = {
  function: "camelCase",
  class: "PascalCase",
  interface: "PascalCase",
  type: "PascalCase",
  const: "camelCase | UPPER_SNAKE_CASE",
  enum: "PascalCase",
}

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ad-01-regressions-")
  repoRoot = await realpath(repo.root)
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

const writeHoistedDependency = async (name: string): Promise<void> => {
  await repo.writeJson(`node_modules/${name}/package.json`, {
    name,
    version: "1.0.0",
    types: "./index.d.ts",
  })
  await repo.write(
    `node_modules/${name}/index.d.ts`,
    "export declare const hoistedValue: number\n",
  )
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

describe("TS-AD-01 regressions (workspace attribution)", () => {
  test("hoisted root node_modules dependencies are external packages, not boundary violations", async () => {
    await writePackage("app", "@repo/app", {
      "fake-effect": "^1.0.0",
      "@scope/util": "^1.0.0",
    })
    await writeHoistedDependency("fake-effect")
    await writeHoistedDependency("@scope/util")
    await repo.write(
      "node_modules/fake-effect/sub.d.ts",
      "export declare const subValue: number\n",
    )
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { hoistedValue } from 'fake-effect'",
        "import { subValue } from 'fake-effect/sub'",
        "import { hoistedValue as utilValue } from '@scope/util'",
        "export const appValue = hoistedValue + subValue + utilValue",
      ].join("\n"),
    )

    const out = await runSignal(repoRoot, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        ".": {
          visibility: "public-api",
          allowed_imports: [],
        },
        "packages/app": {
          visibility: "internal",
          allowed_imports: ["fake-effect", "@scope/util"],
        },
      }),
    })

    expect(out.referenceDataStatus).toBe("loaded")
    expect(out.violations).toEqual([])
    expect(out.totalImports).toBe(3)
    expect(TsAd01.score(out)).toBe(1)
    expect(TsAd01.diagnose(out)).toEqual([])
  })

  test("keeps flagging genuine relative deep reaches into another workspace package at block severity", async () => {
    await writePackage("core", "@repo/core")
    await repo.write("review/pr-comments.ts", "export const prComments = 1\n")
    await repo.write("src/index.ts", "export const rootEntry = 1\n")
    await repo.write(
      "packages/core/src/index.ts",
      "import { prComments } from '../../../review/pr-comments'\nexport const coreValue = prComments\n",
    )

    const out = await runSignal(repoRoot, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        ".": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
        "packages/core": {
          visibility: "internal",
          allowed_imports: ["temp-workspace"],
        },
      }),
    })

    expect(out.referenceDataStatus).toBe("loaded")
    expect(out.violations).toMatchObject([
      {
        kind: "deep-reach",
        fromPackage: "@repo/core",
        toPackage: "temp-workspace",
        specifier: "../../../review/pr-comments",
      },
    ])

    const diagnostics = TsAd01.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("block")
  })

  test("external dependency attribution does not mask genuine deep reaches", async () => {
    await writePackage("core", "@repo/core", { "fake-effect": "^1.0.0" })
    await writeHoistedDependency("fake-effect")
    await repo.write("review/pr-comments.ts", "export const prComments = 1\n")
    await repo.write(
      "packages/core/src/index.ts",
      [
        "import { hoistedValue } from 'fake-effect'",
        "import { prComments } from '../../../review/pr-comments'",
        "export const coreValue = hoistedValue + prComments",
      ].join("\n"),
    )

    const out = await runSignal(repoRoot, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        ".": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
        "packages/core": {
          visibility: "internal",
          allowed_imports: ["temp-workspace", "fake-effect"],
        },
      }),
    })

    expect(out.violations).toMatchObject([
      {
        kind: "deep-reach",
        specifier: "../../../review/pr-comments",
      },
    ])
    expect(out.totalImports).toBe(2)
    expect(TsAd01.score(out)).toBe(0.5)
  })

  test("downgrades boundary findings to stale_reference when every recorded key is dangling", async () => {
    await writePackage("core", "@repo/core")
    await writePackage("app", "@repo/app")
    await repo.write("review/pr-comments.ts", "export const prComments = 1\n")
    await repo.write(
      "packages/core/src/index.ts",
      "import { prComments } from '../../../review/pr-comments'\nexport const coreValue = prComments\n",
    )
    await repo.write("packages/app/src/index.ts", "export const appValue = 1\n")

    const out = await runSignal(repoRoot, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        // Both keys reference packages that no longer exist: the layout the
        // conventions were extracted against is gone.
        "packages/legacy-core": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
        "@repo/removed": {
          visibility: "internal",
          allowed_imports: [],
        },
      }),
    })

    expect(out.referenceDataStatus).toBe("stale")
    expect(out.violations).toEqual([])
    // All-dangling rules attach to no existing package, so there is nothing
    // to suppress: stale here is a "re-extract your conventions" prompt.
    expect(out.staleSuppressedViolations).toBe(0)
    expect(TsAd01.score(out)).toBe(1)
    expect(TsAd01.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
      stale: true,
    })

    const diagnostics = TsAd01.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.message).toContain("stale")
    expect(diagnostics[0]?.message).toContain("pulsar conventions extract")
    expect(diagnostics.some((diagnostic) => diagnostic.severity === "block")).toBe(false)
  })

  test("root-keyed conventions in a monorepo stay loaded and still catch deep-reaches", async () => {
    await writePackage("core", "@repo/core")
    await writePackage("app", "@repo/app")
    await repo.write("review/pr-comments.ts", "export const prComments = 1\n")
    await repo.write(
      "packages/core/src/index.ts",
      "import { prComments } from '../../../review/pr-comments'\nexport const coreValue = prComments\n",
    )
    await repo.write("packages/app/src/index.ts", "export const appValue = 1\n")

    const out = await runSignal(repoRoot, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        ".": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
      }),
    })

    // Repo-wide "." rules are a permanent anchor: a workspace split must not
    // silence them, or the genuine package-to-repo-root deep-reach (the
    // groundwork true positive) disappears along with the noise.
    expect(out.referenceDataStatus).toBe("loaded")
    expect(out.violations).toMatchObject([
      { kind: "deep-reach", specifier: "../../../review/pr-comments" },
    ])
  })

  test("root-keyed conventions in a single-package workspace stay loaded and enforce rules", async () => {
    await repo.write(
      "src/index.ts",
      "import { chunk } from 'lodash'\nexport const value = chunk([1], 1)\n",
    )

    const out = await runSignal(repoRoot, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        ".": {
          visibility: "internal",
          allowed_imports: ["effect"],
        },
      }),
    })

    expect(out.referenceDataStatus).toBe("loaded")
    expect(out.violations).toMatchObject([
      { kind: "not-in-allowlist", specifier: "lodash" },
    ])
  })

  test("conventions keyed by package name anchor the staleness fingerprint", async () => {
    await writePackage("core", "@repo/core")
    await writePackage("app", "@repo/app", { "@repo/core": "workspace:*" })
    await repo.write("packages/core/src/index.ts", "export * from './internal'\n")
    await repo.write("packages/core/src/internal.ts", "export const internalValue = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      "import { internalValue } from '@repo/core/src/internal'\nexport const appValue = internalValue\n",
    )

    const out = await runSignal(repoRoot, TsAd01, TsAd01.defaultConfig, {
      "schema-conventions": conventions({
        "@repo/core": {
          visibility: "public-api",
          allowed_imports: ["effect"],
        },
      }),
    })

    expect(out.referenceDataStatus).toBe("loaded")
    expect(out.violations).toMatchObject([
      { kind: "deep-reach", specifier: "@repo/core/src/internal" },
    ])
  })
})
