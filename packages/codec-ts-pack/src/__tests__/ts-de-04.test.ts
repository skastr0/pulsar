import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsDe04 } from "../signals/ts-de-04-package-dependency-health.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("taste-codec-ts-de-04-")
})

afterEach(async () => {
  await repo.cleanup()
})

const writePackage = async (
  slug: string,
  name: string,
  manifest: Record<string, unknown>,
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
    ...manifest,
  })
}

describe("TS-DE-04 (package dependency health)", () => {
  test("flags imported-but-not-declared dependencies", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.ts",
      "import { uniq } from 'lodash'\nexport const value = uniq([1, 1, 2])\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([
      { dependencyName: "lodash", files: [`${repo.root}/packages/app/src/index.ts`] },
    ])
    expect(TsDe04.score(out)).toBe(0)
    expect(TsDe04.diagnose(out)[0]?.severity).toBe("block")
  })

  test("private package missing dependencies warn without hard-gating", async () => {
    await writePackage("app", "@repo/app", {
      private: true,
    })
    await repo.write(
      "packages/app/src/index.ts",
      "import { uniq } from 'lodash'\nexport const value = uniq([1, 1, 2])\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([
      { dependencyName: "lodash", files: [`${repo.root}/packages/app/src/index.ts`] },
    ])
    const diagnostic = TsDe04.diagnose(out)[0]
    expect(diagnostic?.severity).toBe("warn")
    expect(diagnostic?.data?.severityReason).toBe("private-runtime-missing-dependency")
    expect(TsDe04.score(out)).toBeGreaterThan(0.35)
    expect(TsDe04.score(out)).toBeLessThan(0.6)
  })

  test("nonstandard private manifest markers still avoid published-runtime severity", async () => {
    await writePackage("app", "@repo/app", {
      private: "true",
    })
    await writePackage("tool", "@repo/tool", {
      public: false,
    })
    await repo.write(
      "packages/app/src/index.ts",
      "import { uniq } from 'lodash'\nexport const value = uniq([1, 1, 2])\n",
    )
    await repo.write(
      "packages/tool/src/index.ts",
      "import { uniq } from 'lodash'\nexport const value = uniq([1, 1, 2])\n",
    )

    const diagnostics = TsDe04.diagnose(await runSignal(repo.root, TsDe04, TsDe04.defaultConfig))

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "warn")).toBe(true)
    expect(diagnostics.every((diagnostic) => diagnostic.data?.severityReason === "private-runtime-missing-dependency")).toBe(true)
  })

  test("does not flag package imports that are bundled by explicit tsup config", async () => {
    await writePackage("plugin", "@repo/plugin", {
      scripts: {
        build: "tsup",
      },
      devDependencies: {
        "inline-runtime": "^1.0.0",
        "external-runtime": "^1.0.0",
        tsup: "^8.0.0",
      },
    })
    await repo.write(
      "packages/plugin/tsup.config.ts",
      [
        "import { defineConfig } from 'tsup'",
        "export default defineConfig({",
        "  entry: ['./src/index.ts'],",
        "  bundle: true,",
        "  external: ['external-runtime'],",
        "})",
      ].join("\n"),
    )
    await repo.write(
      "packages/plugin/src/index.ts",
      [
        "import { inline } from 'inline-runtime'",
        "import { external } from 'external-runtime'",
        "export const value = [inline, external]",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.devInProd).toEqual([
      {
        dependencyName: "external-runtime",
        files: [`${repo.root}/packages/plugin/src/index.ts`],
      },
    ])
  })

  test("does not flag workspace package names resolved through tsconfig path aliases", async () => {
    await writePackage("app", "@repo/app", {})
    await writePackage("shared", "shared", {
      private: true,
    })
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "shared/*": ["../shared/src/*"],
        },
      },
      include: ["src/**/*.ts"],
    })
    await repo.write("packages/shared/src/value.ts", "export const shared = 1\n")
    await repo.write(
      "packages/app/src/index.ts",
      "import { shared } from 'shared/value'\nexport const value = shared\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const appHealth = out.packages.find((pkg) => pkg.packageName === "@repo/app")

    expect(appHealth?.importedButNotDeclared).toEqual([])
  })

  test("reads tsconfig path aliases from JSONC files with comments and trailing commas", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/tsconfig.json",
      [
        "{",
        "  // Local aliases are common in hand-written tsconfig files.",
        '  "compilerOptions": {',
        '    "target": "ES2022",',
        '    "module": "ESNext",',
        '    "moduleResolution": "Bundler",',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@/*": ["./src/*"],',
        "    },",
        "  },",
        '  "include": ["src/**/*.ts"],',
        "}",
      ].join("\n"),
    )
    await repo.write(
      "packages/app/src/index.ts",
      "import { value } from '@/value'\nexport const result = value\n",
    )
    await repo.write("packages/app/src/value.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const appHealth = out.packages.find((pkg) => pkg.packageName === "@repo/app")

    expect(appHealth?.importedButNotDeclared).toEqual([])
  })

  test("package-local release scripts with missing dependencies warn", async () => {
    await writePackage("plugin", "@repo/plugin", {
      exports: {
        ".": "./src/index.ts",
      },
    })
    await repo.writeJson("packages/plugin/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts", "script/**/*.ts"],
    })
    await repo.write("packages/plugin/src/index.ts", "export const value = 1\n")
    await repo.write(
      "packages/plugin/script/publish.ts",
      "import { release } from '@repo/release-script'\nexport const run = release\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([
      {
        dependencyName: "@repo/release-script",
        files: [`${repo.root}/packages/plugin/script/publish.ts`],
      },
    ])
    const diagnostic = TsDe04.diagnose(out)[0]
    expect(diagnostic?.severity).toBe("warn")
    expect(diagnostic?.data?.severityReason).toBe("tooling-only-missing-dependency")
    expect(TsDe04.score(out)).toBeGreaterThan(0.65)
  })

  test("package-local tooling imports may be satisfied by root workspace tooling dependencies", async () => {
    await repo.writeJson("package.json", {
      private: true,
      dependencies: {
        "@repo/release-script": "workspace:*",
      },
      workspaces: ["packages/*"],
    })
    await writePackage("plugin", "@repo/plugin", {
      exports: {
        ".": "./src/index.ts",
      },
    })
    await repo.writeJson("packages/plugin/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts", "script/**/*.ts"],
    })
    await repo.write("packages/plugin/src/index.ts", "export const value = 1\n")
    await repo.write(
      "packages/plugin/script/publish.ts",
      "import { release } from '@repo/release-script'\nexport const run = release\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(TsDe04.score(out)).toBe(1)
  })

  test("package-local tooling imports from devDependencies are not production imports", async () => {
    await writePackage("plugin", "@repo/plugin", {
      devDependencies: {
        "@repo/release-script": "workspace:*",
      },
      exports: {
        ".": "./src/index.ts",
      },
    })
    await repo.writeJson("packages/plugin/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts", "script/**/*.ts"],
    })
    await repo.write("packages/plugin/src/index.ts", "export const value = 1\n")
    await repo.write(
      "packages/plugin/script/publish.ts",
      "import { release } from '@repo/release-script'\nexport const run = release\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(TsDe04.score(out)).toBe(1)
  })

  test("package-root config missing dependencies warn without collapsing the score", async () => {
    await writePackage("plugin", "@repo/plugin", {
      exports: {
        ".": "./src/index.ts",
      },
    })
    await repo.writeJson("packages/plugin/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts", "*.config.ts"],
    })
    await repo.write("packages/plugin/src/index.ts", "export const value = 1\n")
    await repo.write(
      "packages/plugin/vitest.config.ts",
      "import { defineConfig } from 'vitest/config'\nexport default defineConfig({})\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([
      {
        dependencyName: "vitest",
        files: [`${repo.root}/packages/plugin/vitest.config.ts`],
      },
    ])
    const diagnostic = TsDe04.diagnose(out)[0]
    expect(diagnostic?.severity).toBe("warn")
    expect(diagnostic?.data?.severityReason).toBe("tooling-only-missing-dependency")
    expect(TsDe04.score(out)).toBeGreaterThan(0.65)
  })

  test("type-only dependency usage does not count as production runtime usage", async () => {
    await writePackage("app", "@repo/app", {
      devDependencies: {
        "@types/external": "^1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import type { ExternalShape } from '@types/external'",
        "export type LocalShape = ExternalShape & { readonly id: string }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
    expect(TsDe04.score(out)).toBe(1)
  })

  test("type-only host imports may be satisfied by declared DefinitelyTyped packages", async () => {
    await writePackage("app", "@repo/app", {
      devDependencies: {
        "@types/aws-lambda": "^8.10.0",
        "@types/foo__bar": "^1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import type { Handler } from 'aws-lambda'",
        "import type { Widget } from '@foo/bar'",
        "export type App = Handler & Widget",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
    expect(TsDe04.score(out)).toBe(1)
  })

  test("value imports used only in type positions do not count as production runtime usage", async () => {
    await writePackage("app", "@repo/app", {
      devDependencies: {
        "external-types": "^1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { components } from 'external-types'",
        "export type LocalShape = components['schemas']['release']",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
    expect(TsDe04.score(out)).toBe(1)
  })

  test("mixed value and type imports still count as production runtime usage", async () => {
    await writePackage("app", "@repo/app", {
      devDependencies: {
        "external-tool": "^1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { createTool, ToolShape } from 'external-tool'",
        "export type LocalShape = ToolShape & { readonly id: string }",
        "export const tool = createTool()",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.devInProd).toEqual([
      {
        dependencyName: "external-tool",
        files: [`${repo.root}/packages/app/src/index.ts`],
      },
    ])
    expect(TsDe04.score(out)).toBeLessThan(1)
  })

  test("type-only missing dependencies warn without hard-gating", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import type { ExternalShape } from 'external-types'",
        "export type LocalShape = ExternalShape & { readonly id: string }",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const diagnostic = TsDe04.diagnose(out)[0]

    expect(out.packages[0]?.importedButNotDeclared).toEqual([
      {
        dependencyName: "external-types",
        files: [`${repo.root}/packages/app/src/index.ts`],
        usageKind: "type-only",
      },
    ])
    expect(diagnostic?.severity).toBe("warn")
    expect(diagnostic?.data?.severityReason).toBe("type-only-missing-dependency")
    expect(diagnostic?.data?.usageKind).toBe("type-only")
    expect(TsDe04.score(out)).toBeGreaterThan(0.65)
  })

  test("private runtime missing dependencies sort before package-local tooling warnings", async () => {
    await writePackage("plugin", "@repo/a-plugin", {
      exports: {
        ".": "./src/index.ts",
      },
    })
    await repo.writeJson("packages/plugin/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts", "script/**/*.ts"],
    })
    await repo.write("packages/plugin/src/index.ts", "export const value = 1\n")
    await repo.write(
      "packages/plugin/script/publish.ts",
      "import { release } from '@repo/release-script'\nexport const run = release\n",
    )
    await writePackage("app", "@repo/z-app", {
      private: true,
    })
    await repo.write(
      "packages/app/src/index.ts",
      "import { uniq } from 'lodash'\nexport const value = uniq([1, 1, 2])\n",
    )

    const diagnostics = TsDe04.diagnose(await runSignal(repo.root, TsDe04, TsDe04.defaultConfig))

    expect(diagnostics[0]?.message).toContain("Missing dependency in @repo/z-app: lodash")
    expect(diagnostics[0]?.data?.severityReason).toBe("private-runtime-missing-dependency")
    expect(diagnostics[1]?.message).toContain("Missing dependency in @repo/a-plugin")
    expect(diagnostics[1]?.data?.severityReason).toBe("tooling-only-missing-dependency")
  })

  test("missing dependency warnings are listed before unused dependency clusters", async () => {
    await writePackage("app", "@repo/app", {
      private: true,
      dependencies: {
        unused: "^1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      "import { uniq } from 'lodash'\nexport const value = uniq([1, 1, 2])\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const diagnostics = TsDe04.diagnose(out)
    expect(diagnostics[0]?.message).toContain("Missing dependency")
    expect(diagnostics[1]?.message).toContain("Unused declared dependencies")
  })

  test("diagnostics compact long file lists but keep full file data", async () => {
    await writePackage("app", "@repo/app", {})
    for (const file of ["one", "two", "three", "four"]) {
      await repo.write(
        `packages/app/src/${file}.ts`,
        "import { uniq } from 'lodash'\nexport const value = uniq([1, 1, 2])\n",
      )
    }

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const diagnostic = TsDe04.diagnose(out)[0]

    expect(diagnostic?.message).toContain("src/four.ts")
    expect(diagnostic?.message).toContain("(+1 more)")
    expect(diagnostic?.message).not.toContain(repo.root)
    expect(diagnostic?.data).toMatchObject({
      dependencyName: "lodash",
      fileCount: 4,
    })
    expect((diagnostic?.data as { files?: ReadonlyArray<string> } | undefined)?.files?.length).toBe(4)
  })

  test("flags declared-but-unused dependencies", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        axios: "^1.0.0",
        lodash: "^4.0.0",
      },
    })
    await repo.write("packages/app/src/index.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.declaredButUnused).toEqual([
      { dependencyName: "axios" },
      { dependencyName: "lodash" },
    ])
    expect(TsDe04.score(out)).toBeLessThan(1)
    expect(TsDe04.score(out)).toBeGreaterThan(0)
    const diagnostic = TsDe04.diagnose(out)[0]
    expect(diagnostic?.severity).toBe("warn")
    expect(diagnostic?.message).toBe("Unused declared dependencies in @repo/app: axios, lodash")
    expect(diagnostic?.data).toMatchObject({
      dependencyNames: ["axios", "lodash"],
      dependencyCount: 2,
    })
  })

  test("normalizes package subpath imports to declared dependencies", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        "@org/package": "^1.0.0",
        "plain-package": "^2.0.0",
      },
    })
    await repo.write("node_modules/@org/package/subpath.d.ts", "export declare const shallow: string\n")
    await repo.write("node_modules/@org/package/deep/nested.d.ts", "export declare const deep: string\n")
    await repo.write("node_modules/plain-package/subpath.d.ts", "export declare const plain: string\n")
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { shallow } from '@org/package/subpath'",
        "import { deep } from '@org/package/deep/nested'",
        "import { plain } from 'plain-package/subpath'",
        "export const value = [shallow, deep, plain]",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
  })

  test("allows vectors to map host package imports to declared facade packages", async () => {
    await writePackage("plugin", "@repo/plugin", {
      devDependencies: {
        "@host/plugin-sdk": "workspace:*",
      },
    })
    await repo.write(
      "packages/plugin/src/index.ts",
      [
        "import { definePlugin } from 'host/plugin-sdk/core'",
        "export const plugin = definePlugin({ name: 'demo' })",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, {
      ...TsDe04.defaultConfig,
      dependency_aliases: {
        host: "@host/plugin-sdk",
      },
      allow_dev_dependency_in_prod: ["@host/plugin-sdk"],
    })

    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
  })

  test("infers host plugin-sdk facade imports from a declared scoped SDK package", async () => {
    await writePackage("plugin", "@repo/plugin", {
      devDependencies: {
        "@host/plugin-sdk": "workspace:*",
      },
    })
    await repo.write(
      "packages/plugin/src/index.ts",
      [
        "import { definePlugin } from 'host/plugin-sdk/core'",
        "export const plugin = definePlugin({ name: 'demo' })",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
    expect(out.packages[0]?.devInProd).toEqual([])
  })

  test("treats VS Code extension host API imports as provided by @types/vscode", async () => {
    await writePackage("extension", "demo-vscode-extension", {
      devDependencies: {
        "@types/vscode": "^1.94.0",
      },
      engines: {
        vscode: "^1.94.0",
      },
    })
    await repo.write(
      "packages/extension/src/index.ts",
      [
        "import * as vscode from 'vscode'",
        "export function activate(context: vscode.ExtensionContext) {",
        "  context.subscriptions.push(vscode.commands.registerCommand('demo.open', () => undefined))",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
  })

  test("does not infer host SDK facade aliases for non-SDK host subpaths", async () => {
    await writePackage("plugin", "@repo/plugin", {
      devDependencies: {
        "@host/plugin-sdk": "workspace:*",
      },
    })
    await repo.write(
      "packages/plugin/src/index.ts",
      [
        "import { runtime } from 'host/runtime'",
        "export const plugin = runtime",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.importedButNotDeclared).toEqual([
      { dependencyName: "host", files: [`${repo.root}/packages/plugin/src/index.ts`] },
    ])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
  })

  test("counts createRequire resolve calls as dependency usage", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        "tree-sitter-rust": "^0.24.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      [
        'import { createRequire } from "node:module"',
        "const require = createRequire(import.meta.url)",
        'export const wasmPath = require.resolve("tree-sitter-rust/tree-sitter-rust.wasm")',
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
  })

  test("counts createRequire aliases as dependency usage", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        "asset-package": "^1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      [
        'import { createRequire } from "node:module"',
        "const runtimeRequire = createRequire(import.meta.url)",
        'export const assetPath = runtimeRequire.resolve("asset-package/assets/file.wasm")',
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
  })

  test("counts dynamic imports as dependency usage", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        "lazy-package": "^1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      [
        "export async function loadLazy() {",
        "  return import('lazy-package/feature')",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
  })

  test("missing dependencies reached only by dynamic import are warning-level leads", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.ts",
      [
        "export async function loadOptional() {",
        "  return import('optional-host-plugin')",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const diagnostic = TsDe04.diagnose(out)[0]

    expect(out.packages[0]?.importedButNotDeclared).toEqual([
      {
        dependencyName: "optional-host-plugin",
        files: [`${repo.root}/packages/app/src/index.ts`],
        usageKind: "dynamic",
      },
    ])
    expect(diagnostic?.severity).toBe("warn")
    expect(diagnostic?.data?.severityReason).toBe("dynamic-missing-dependency")
  })

  test("ignores bare generated virtual module imports", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.ts",
      [
        "// @ts-expect-error - generated by the package build step",
        "export const embedded = import('embedded-assets.gen.ts')",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(TsDe04.diagnose(out)).toEqual([])
  })

  test("counts package-root Vite helper files outside tsconfig includes", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        "runtime-plugin": "^1.0.0",
      },
      devDependencies: {
        "vite-plugin-runtime": "^1.0.0",
      },
    })
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        allowJs: true,
      },
      include: ["src/**/*.ts"],
    })
    await repo.write("packages/app/src/index.ts", "export const value = 1\n")
    await repo.write(
      "packages/app/vite.js",
      [
        "import runtimePlugin from 'runtime-plugin'",
        "import vitePluginRuntime from 'vite-plugin-runtime'",
        "export default [runtimePlugin(), vitePluginRuntime()]",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
    expect(out.packages[0]?.devInProd).toEqual([])
  })

  test("reports transitive direct usage separately from missing deps", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        wrapper: "1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      "import { chunk } from 'lodash'\nexport const value = chunk([1, 2, 3], 2)\n",
    )
    await repo.write(
      "bun.lock",
      [
        "{",
        '  "lockfileVersion": 1,',
        '  "workspaces": { "packages/app": { "name": "@repo/app", "dependencies": { "wrapper": "1.0.0" } } },',
        '  "packages": {',
        '    "wrapper": ["wrapper@1.0.0", "", { "dependencies": { "lodash": "4.17.21" } }, "hash"],',
        '    "lodash": ["lodash@4.17.21", "", {}, "hash"]',
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.transitiveUsedDirectly).toEqual([
      { dependencyName: "lodash", files: [`${repo.root}/packages/app/src/index.ts`] },
    ])
  })

  test("uses pnpm lockfiles to separate transitive usage from missing deps", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.ts",
      "import { Type } from '@sinclair/typebox'\nexport const value = Type.String()\n",
    )
    await repo.write(
      "pnpm-lock.yaml",
      [
        "lockfileVersion: '9.0'",
        "",
        "packages:",
        "",
        "  '@sinclair/typebox@0.34.49': {}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.transitiveUsedDirectly).toEqual([
      { dependencyName: "@sinclair/typebox", files: [`${repo.root}/packages/app/src/index.ts`] },
    ])
  })

  test("uses npm package-lock files to separate transitive usage from missing deps", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.ts",
      "import ansiEscapes from 'ansi-escapes'\nexport const value = ansiEscapes.cursorHide\n",
    )
    await repo.writeJson("package-lock.json", {
      lockfileVersion: 3,
      packages: {
        "": {
          workspaces: ["packages/app"],
        },
        "node_modules/ansi-escapes": {
          version: "7.1.0",
        },
      },
    })

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.transitiveUsedDirectly).toEqual([
      { dependencyName: "ansi-escapes", files: [`${repo.root}/packages/app/src/index.ts`] },
    ])
  })

  test("flags dev dependencies imported from production files", async () => {
    await writePackage("app", "@repo/app", {
      devDependencies: {
        chalk: "5.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.ts",
      "import chalk from 'chalk'\nexport const value = chalk.blue('hi')\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.devInProd).toEqual([
      { dependencyName: "chalk", files: [`${repo.root}/packages/app/src/index.ts`] },
    ])
  })

  test("allows dev dependencies from private bundled app source files", async () => {
    await writePackage("app", "@repo/app", {
      private: true,
      scripts: {
        build: "vite build",
      },
      devDependencies: {
        "solid-js": "^1.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.tsx",
      "import { createSignal } from 'solid-js'\nexport const value = createSignal\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
  })

  test("allows package dev dependencies from config files", async () => {
    await writePackage("app", "@repo/app", {
      devDependencies: {
        vite: "^7.0.0",
      },
    })
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts", "*.config.ts"],
    })
    await repo.write(
      "packages/app/vite.config.ts",
      "import { defineConfig } from 'vite'\nexport default defineConfig({})\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
  })

  test("allows package dev dependencies from package script entrypoints", async () => {
    await writePackage("docs", "docs", {
      scripts: {
        generate: "bun ./generate.ts",
      },
      devDependencies: {
        typedoc: "^0.25.0",
      },
    })
    await repo.writeJson("packages/docs/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts", "generate.ts"],
    })
    await repo.write("packages/docs/src/index.ts", "export const value = 1\n")
    await repo.write(
      "packages/docs/generate.ts",
      "import * as TypeDoc from 'typedoc'\nexport const generate = TypeDoc.Application\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
    expect(out.packages[0]?.declaredButUnused).toEqual([])
  })

  test("allows dev dependencies from bundled CLI source folders", async () => {
    await writePackage("cli", "published-cli", {
      bin: {
        "published-cli": "bin/main.js",
      },
      scripts: {
        build: "node scripts/build.cjs",
        prepack: "npm run build",
      },
      devDependencies: {
        "@commander-js/extra-typings": "^11.0.0",
        esbuild: "^0.25.0",
      },
    })
    await repo.writeJson("packages/cli/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts"],
    })
    await repo.write(
      "packages/cli/src/cli/index.ts",
      [
        "import { Command } from '@commander-js/extra-typings'",
        "export const program = new Command()",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
  })

  test("allows root dev dependencies from package tests", async () => {
    await repo.writeJson("package.json", {
      name: "temp-workspace",
      private: true,
      devDependencies: {
        vitest: "^4.0.0",
      },
    })
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.test.ts",
      "import { test } from 'vitest'\ntest('works', () => {})\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
  })

  test("allows root dev dependencies from package test support files", async () => {
    await repo.writeJson("package.json", {
      name: "temp-workspace",
      private: true,
      devDependencies: {
        vitest: "^4.0.0",
      },
    })
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/test-harness.ts",
      "import { vi } from 'vitest'\nexport const mock = vi.fn()\n",
    )
    await repo.write(
      "packages/app/src/webhook.test-helpers.ts",
      "import { expect } from 'vitest'\nexport const assert = expect\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.devInProd).toEqual([])
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
  })

  test("warns when root dev dependencies are used from production files", async () => {
    await repo.writeJson("package.json", {
      name: "temp-workspace",
      private: true,
      devDependencies: {
        vitest: "^4.0.0",
      },
    })
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.ts",
      "import { test } from 'vitest'\nexport const value = test\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.devInProd).toEqual([
      { dependencyName: "vitest", files: [`${repo.root}/packages/app/src/index.ts`] },
    ])
  })

  test("devDependency production diagnostics list only production files", async () => {
    await writePackage("app", "@repo/app", {
      devDependencies: {
        vitest: "^4.0.0",
      },
    })
    await repo.write(
      "packages/app/src/index.test.ts",
      "import { test } from 'vitest'\ntest('works', () => {})\n",
    )
    await repo.write(
      "packages/app/src/runtime.ts",
      "import { test } from 'vitest'\nexport const value = test\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)

    expect(out.packages[0]?.devInProd).toEqual([
      { dependencyName: "vitest", files: [`${repo.root}/packages/app/src/runtime.ts`] },
    ])
  })

  test("treats node:test as a built-in module", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.test.ts",
      "import test from 'node:test'\ntest('works', () => {})\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
  })

  test("ignores framework virtual modules and common local app aliases", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write(
      "packages/app/src/index.ts",
      [
        'import "cloudflare:workers"',
        'import "astro:content"',
        'import "virtual:generated-module"',
        'import { local } from "@/local"',
        'import sqlite from "node:sqlite"',
        "export const value = [local, sqlite]",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.importedButNotDeclared).toEqual([])
  })

  test("ignores SvelteKit virtual modules only in SvelteKit apps", async () => {
    await writePackage("svelte-app", "svelte-app", {
      devDependencies: {
        "@sveltejs/kit": "^2.0.0",
      },
    })
    await repo.write(
      "packages/svelte-app/src/routes/+page.ts",
      [
        'import { dev } from "$app/environment"',
        'import { env } from "$env/dynamic/private"',
        'import { local } from "$lib/local"',
        'import "$service-worker"',
        "export const value = [dev, env, local]",
      ].join("\n"),
    )

    await writePackage("plain-app", "plain-app", {})
    await repo.write(
      "packages/plain-app/src/index.ts",
      'import { dev } from "$app/environment"\nexport const value = dev\n',
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const svelteHealth = out.packages.find((pkg) => pkg.packageName === "svelte-app")
    const plainHealth = out.packages.find((pkg) => pkg.packageName === "plain-app")

    expect(svelteHealth?.importedButNotDeclared).toEqual([])
    expect(plainHealth?.importedButNotDeclared).toEqual([
      { dependencyName: "$app", files: [`${repo.root}/packages/plain-app/src/index.ts`] },
    ])
  })

  test("workspace internal dependencies declared with workspace:* do not false-positive", async () => {
    await writePackage("a", "@repo/a", {
      dependencies: {
        "@repo/b": "workspace:*",
      },
    })
    await writePackage("b", "@repo/b", {})
    await repo.write(
      "packages/a/src/index.ts",
      "import { value } from '@repo/b'\nexport const result = value\n",
    )
    await repo.write("packages/b/src/index.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const appHealth = out.packages.find((pkg) => pkg.packageName === "@repo/a")
    expect(appHealth?.importedButNotDeclared).toEqual([])
    expect(appHealth?.declaredButUnused).toEqual([])
  })

  test("workspace subpath packages may import their root facade package", async () => {
    await writePackage("solid", "solid-js", {})
    await writePackage("solid/h", "solid-js/h", {})
    await repo.write("packages/solid/src/web.ts", "export const createComponent = () => null\n")
    await repo.write(
      "packages/solid/h/src/index.ts",
      "import { createComponent } from 'solid-js/web'\nexport const h = createComponent\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const subpathHealth = out.packages.find((pkg) => pkg.packageName === "solid-js/h")
    expect(subpathHealth?.importedButNotDeclared).toEqual([])
  })

  test("nested package manifest without tsconfig owns dependency health for included source", async () => {
    await repo.writeJson("packages/tui/package.json", {
      name: "hermes-tui",
      private: true,
      dependencies: {},
    })
    await repo.writeJson("packages/tui/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts", "packages/**/*.ts"],
    })
    await repo.writeJson("packages/tui/packages/ink/package.json", {
      name: "@hermes/ink",
      private: true,
      dependencies: {
        "ansi-tokenize": "^1.0.0",
      },
    })
    await repo.write(
      "packages/tui/packages/ink/src/output.ts",
      "import { tokenize } from 'ansi-tokenize'\nexport const output = tokenize\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const parentHealth = out.packages.find((pkg) => pkg.packageName === "hermes-tui")
    const nestedHealth = out.packages.find((pkg) => pkg.packageName === "@hermes/ink")
    expect(parentHealth?.importedButNotDeclared).toEqual([])
    expect(nestedHealth?.importedButNotDeclared).toEqual([])
    expect(nestedHealth?.declaredButUnused).toEqual([])
  })

  test("ignores direct tsconfig path aliases that resolve to local source", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: {
          "@/*": ["./src/*"],
        },
      },
      include: ["src/**/*.ts"],
    })
    await repo.write(
      "packages/app/src/index.ts",
      "import { Button } from '@/components/Button'\nexport const value = Button\n",
    )
    await repo.write("packages/app/src/components/Button.ts", "export const Button = 'button'\n")

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const appHealth = out.packages.find((pkg) => pkg.packageName === "@repo/app")
    expect(appHealth?.importedButNotDeclared).toEqual([])
  })

  test("ignores bare imports resolved through tsconfig baseUrl local source", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: "src",
      },
      include: ["src/**/*.ts"],
    })
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { client } from 'api/client'",
        "import { useThing } from 'hooks/useThing'",
        "import { Generated } from 'generatedApi'",
        "export const value = [client, useThing, Generated]",
        "",
      ].join("\n"),
    )
    await repo.write("packages/app/src/api/client.ts", "export const client = 'client'\n")
    await repo.write("packages/app/src/hooks/useThing.ts", "export const useThing = 'hook'\n")
    await repo.write("packages/app/src/generatedApi.ts", "export const Generated = 'generated'\n")

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const appHealth = out.packages.find((pkg) => pkg.packageName === "@repo/app")
    expect(appHealth?.importedButNotDeclared).toEqual([])
  })

  test("ignores tsconfig path aliases inherited through extends", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.writeJson("tsconfig.base.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "@/*": ["packages/app/src/*"],
        },
      },
    })
    await repo.writeJson("packages/app/tsconfig.json", {
      extends: "../../tsconfig.base.json",
      include: ["src/**/*.ts"],
    })
    await repo.write(
      "packages/app/src/index.ts",
      "import { Button } from '@/components/Button'\nexport const value = Button\n",
    )
    await repo.write("packages/app/src/components/Button.ts", "export const Button = 'button'\n")

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const appHealth = out.packages.find((pkg) => pkg.packageName === "@repo/app")
    expect(appHealth?.importedButNotDeclared).toEqual([])
  })

  test("separates local path aliases from real workspace package imports", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        "@repo/lib": "workspace:*",
      },
    })
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: {
          "@/*": ["./src/*"],
          "@repo/lib": ["../lib/src/index.ts"],
        },
      },
      include: ["src/**/*.ts"],
    })
    await writePackage("lib", "@repo/lib", {})
    await repo.write(
      "packages/app/src/index.ts",
      [
        "import { Button } from '@/components/Button'",
        "import { value } from '@repo/lib'",
        "export const result = [Button, value]",
      ].join("\n"),
    )
    await repo.write("packages/app/src/components/Button.ts", "export const Button = 'button'\n")
    await repo.write("packages/lib/src/index.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const appHealth = out.packages.find((pkg) => pkg.packageName === "@repo/app")
    expect(appHealth?.importedButNotDeclared).toEqual([])
    expect(appHealth?.declaredButUnused).toEqual([])
  })

  test("ignores generated env declarations and treats vite.js as config", async () => {
    await repo.writeJson("packages/app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        allowJs: true,
      },
      include: ["src/**/*.ts", "vite.js"],
    })
    await repo.writeJson("packages/app/package.json", {
      name: "@repo/app",
      version: "0.0.0",
      dependencies: {},
      devDependencies: {
        sst: "^3.0.0",
        "vite-plugin-solid": "^2.0.0",
      },
    })
    await repo.write("packages/app/src/sst-env.d.ts", '/* eslint-disable */\nimport "sst"\n')
    await repo.write("packages/app/vite.js", 'import solidPlugin from "vite-plugin-solid"\nexport default [solidPlugin()]\n')

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const appHealth = out.packages.find((pkg) => pkg.packageName === "@repo/app")
    expect(appHealth?.devInProd).toEqual([])
    expect(appHealth?.declaredButUnused).toEqual([])
  })

  test("does not analyze manifests from excluded package paths", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write("packages/app/src/index.ts", "export const value = 1\n")
    await repo.writeJson("vendor/copied/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("vendor/copied/package.json", {
      name: "@vendor/copied",
      version: "0.0.0",
      dependencies: {
        lodash: "^4.0.0",
      },
    })

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages.some((pkg) => pkg.packageName === "@vendor/copied")).toBe(false)
    expect(out.unusedCount).toBe(0)
  })

  test("ignores Docusaurus virtual module imports while preserving real missing dependencies", async () => {
    await writePackage("docs", "docs", {
      private: true,
      scripts: {
        build: "docusaurus build",
      },
      dependencies: {
        "@docusaurus/core": "^3.0.0",
      },
    })
    await repo.write(
      "packages/docs/src/page.tsx",
      [
        "import Link from '@docusaurus/Link'",
        "import Layout from '@theme/Layout'",
        "import { uniq } from 'lodash'",
        "export const Page = () => Link && Layout && uniq([1])",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    const docsHealth = out.packages.find((pkg) => pkg.packageName === "docs")

    expect(docsHealth?.importedButNotDeclared).toEqual([
      { dependencyName: "lodash", files: [`${repo.root}/packages/docs/src/page.tsx`] },
    ])
  })

  test("does not hard-gate dependencies in example package paths by default", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write("packages/app/src/index.ts", "export const value = 1\n")
    await repo.writeJson("examples/internal/benchmark/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("examples/internal/benchmark/package.json", {
      name: "benchmark",
      version: "0.0.0",
      dependencies: {},
    })
    await repo.write(
      "examples/internal/benchmark/src/index.ts",
      "import { shell } from 'sst'\nexport const run = shell\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages.some((pkg) => pkg.packageName === "benchmark")).toBe(false)
    expect(TsDe04.diagnose(out).some((diagnostic) =>
      diagnostic.message.includes("benchmark"),
    )).toBe(false)
  })

  test("does not hard-gate dependencies in SDK sample package paths by default", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write("packages/app/src/index.ts", "export const value = 1\n")
    await repo.writeJson("google_samples/angular/package.json", {
      name: "angular-sample",
      version: "0.0.0",
      dependencies: {},
    })
    await repo.writeJson("google_samples/angular/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["**/*.ts"],
    })
    await repo.write(
      "google_samples/angular/generate_content.ts",
      "import { Component } from '@angular/core'\nexport const C = Component\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages.some((pkg) => pkg.packageName === "angular-sample")).toBe(false)
    expect(TsDe04.diagnose(out).some((diagnostic) =>
      diagnostic.message.includes("@angular/core"),
    )).toBe(false)
  })

  test("does not hard-gate dependencies in demo package paths by default", async () => {
    await writePackage("app", "@repo/app", {})
    await repo.write("packages/app/src/index.ts", "export const value = 1\n")
    await repo.writeJson("private-demos/snippets/package.json", {
      name: "demo-snippets",
      version: "0.0.0",
      dependencies: {},
    })
    await repo.writeJson("private-demos/snippets/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["**/*.ts"],
    })
    await repo.write(
      "private-demos/snippets/tour.ts",
      "import { mutation } from 'convex/server'\nexport const like = mutation\n",
    )

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages.some((pkg) => pkg.packageName === "demo-snippets")).toBe(false)
    expect(TsDe04.diagnose(out).some((diagnostic) =>
      diagnostic.message.includes("convex/server"),
    )).toBe(false)
  })
})
