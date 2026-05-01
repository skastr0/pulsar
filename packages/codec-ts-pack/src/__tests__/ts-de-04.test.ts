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
  })

  test("flags declared-but-unused dependencies", async () => {
    await writePackage("app", "@repo/app", {
      dependencies: {
        axios: "^1.0.0",
      },
    })
    await repo.write("packages/app/src/index.ts", "export const value = 1\n")

    const out = await runSignal(repo.root, TsDe04, TsDe04.defaultConfig)
    expect(out.packages[0]?.declaredButUnused).toEqual([{ dependencyName: "axios" }])
    expect(TsDe04.score(out)).toBe(0)
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
})
