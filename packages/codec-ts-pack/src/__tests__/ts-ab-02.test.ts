import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsAb02 } from "../signals/ts-ab-02-unused-exports-reachability.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("taste-codec-ts-ab-02-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-AB-02 (unused exports reachability)", () => {
  test("classifies unused, internal-only, cross-module, and cross-package exports", async () => {
    await repo.writeJson("packages/a/tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("packages/a/package.json", { name: "@repo/a", version: "0.0.0" })
    await repo.writeJson("packages/b/tsconfig.json", {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler" },
      include: ["src/**/*.ts"],
    })
    await repo.writeJson("packages/b/package.json", { name: "@repo/b", version: "0.0.0" })
    await repo.write(
      "packages/a/src/api.ts",
      [
        "export const unused = 1",
        "export const internalOnly = 2",
        "export const crossModule = 3",
        "export const crossPackage = 4",
        "const local = internalOnly + 1",
        "export const localUse = local",
      ].join("\n"),
    )
    await repo.write(
      "packages/a/src/consumer.ts",
      "import { crossModule } from './api'\nexport const value = crossModule\n",
    )
    await repo.write(
      "packages/b/src/consumer.ts",
      "import { crossPackage } from '../../a/src/api'\nexport const value = crossPackage\n",
    )

    const out = await runSignal(repo.root, TsAb02, TsAb02.defaultConfig)
    const byName = new Map(out.exports.map((entry) => [entry.exportName, entry]))

    expect(byName.get("unused")?.classification).toBe("unused")
    expect(byName.get("internalOnly")?.classification).toBe("internal-only")
    expect(byName.get("crossModule")?.classification).toBe("cross-module")
    expect(byName.get("crossPackage")?.classification).toBe("cross-package")
  })

  test("boundary rules escalate same-boundary exports to a blocking diagnostic", async () => {
    await repo.write(
      "src/domain/api.ts",
      "export const domainOnly = 1\n",
    )
    await repo.write(
      "src/domain/use.ts",
      "import { domainOnly } from './api'\nexport const value = domainOnly\n",
    )
    await repo.write(
      "src/app/main.ts",
      "export const app = 1\n",
    )

    const out = await runSignal(repo.root, TsAb02, {
      ...TsAb02.defaultConfig,
      boundary_rules: [
        { name: "domain", globs: ["**/src/domain/**"] },
        { name: "app", globs: ["**/src/app/**"] },
      ],
    })

    expect(out.boundaryConfined.some((entry) => entry.exportName === "domainOnly")).toBe(true)
    expect(TsAb02.diagnose(out)[0]?.severity).toBe("block")
  })
})
