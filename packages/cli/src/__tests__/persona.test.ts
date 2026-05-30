import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  loadPulsarVectorPresets,
  loadQuizItems,
} from "@skastr0/pulsar-core/elicitation"
import {
  type PulsarVectorPresetProfileKind,
  validateVectorAgainstRegistry,
} from "@skastr0/pulsar-core/vector"
import { Effect } from "effect"
import { buildPulsarRegistry } from "../runtime.js"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")
const TS_SL_01_SIGNAL_ID = "TS-SL-01-duplication"
const TS_AD_02_SIGNAL_ID = "TS-AD-02-circular-dependencies"

type ScoreDiffJson = {
  readonly vector: {
    readonly id: string
    readonly source: string
  }
  readonly changed_only_diagnostics: ReadonlyArray<{
    readonly signal_id: string
    readonly diagnostic: {
      readonly message: string
    }
  }>
  readonly gate_decision: {
    readonly status: string
  }
}

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): void => {
  const result = spawnSync(cmd, args as Array<string>, { cwd, encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

const writeRepoFile = async (repoPath: string, relPath: string, content: string): Promise<void> => {
  const full = join(repoPath, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content, "utf8")
}

const initRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "pulsar-persona-cli-"))
  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  await writeRepoFile(
    repoPath,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  )
  await writeRepoFile(repoPath, "src/index.ts", "export const ready = true\n")
  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return repoPath
}

const runCli = (
  cwd: string,
  args: ReadonlyArray<string>,
  env?: NodeJS.ProcessEnv,
) =>
  spawnSync("bun", [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })

const runChangedOnlyDiffJson = (repoPath: string): ScoreDiffJson => {
  const out = runCli(repoPath, [
    "score",
    "--diff",
    "HEAD..WORKTREE",
    "--changed-only",
    "--agent-view",
    "--json",
    ".",
  ])
  expect(out.status).toBe(0)
  return JSON.parse(String(out.stdout)) as ScoreDiffJson
}

const changedDuplicationDiagnostics = (
  json: ScoreDiffJson,
): ReadonlyArray<ScoreDiffJson["changed_only_diagnostics"][number]> =>
  json.changed_only_diagnostics.filter(
    (diagnostic) => diagnostic.signal_id === TS_SL_01_SIGNAL_ID,
  )

describe("pulsar persona", () => {
  test("shipped presets and quiz items reference known registry signals", async () => {
    const registry = await Effect.runPromise(buildPulsarRegistry())
    const presets = await Effect.runPromise(loadPulsarVectorPresets())
    const expectedProfileKinds = new Map<string, PulsarVectorPresetProfileKind>([
      ["ai-slop-defense", "workflow-risk"],
      ["domain-purist", "architecture-taste"],
      ["refactor-friendly", "workflow-risk"],
      ["security-paranoid", "workflow-risk"],
      ["strict-type-safety", "technology-practice"],
      ["velocity-first", "workflow-risk"],
    ])
    for (const preset of presets) {
      await Effect.runPromise(validateVectorAgainstRegistry(preset, registry))
      expect(preset.preset_profile?.kind).toBe(expectedProfileKinds.get(preset.id))
      expect(preset.preset_profile?.activation).toBe("explicit-apply-only")
      expect(preset.preset_profile?.summary).toContain("inactive until applied")
      expect(preset.description).toContain("Opt-in")
    }

    const items = await Effect.runPromise(loadQuizItems("typescript"))
    for (const item of items) {
      for (const signalId of [...Object.keys(item.a_signals), ...Object.keys(item.b_signals)]) {
        expect(registry.has(signalId)).toBe(true)
      }
    }
  })

  test("list, show, apply, and diff commands work end-to-end", async () => {
    const repoPath = await initRepo()
    try {
      const list = runCli(repoPath, ["persona", "list"])
      expect(list.status).toBe(0)
      expect(list.stdout).toContain("Available vector profile templates (opt-in; inactive until applied):")
      expect(list.stdout).toContain("strict-type-safety")
      expect(list.stdout).toContain("ai-slop-defense")
      expect(list.stdout).toContain("[technology practice]")
      expect(list.stdout).not.toContain("Available persona presets")

      const show = runCli(repoPath, ["persona", "show", "security-paranoid"])
      expect(show.status).toBe(0)
      expect(show.stdout).toContain("security-paranoid")
      expect(show.stdout).toContain("Preset profile kind: workflow/risk")
      expect(show.stdout).toContain("Activation:          explicit apply only")
      expect(show.stdout).toContain("Status:             inactive until applied to a repo-owned vector")
      expect(show.stdout).toContain("sensitive environments")

      const apply = runCli(repoPath, [
        "persona",
        "apply",
        "strict-type-safety",
        "--to",
        ".pulsar/vector.json",
      ])
      expect(apply.status).toBe(0)
      expect(apply.stdout).toContain("Applied profile template: strict-type-safety")
      expect(apply.stdout).toContain("Wrote repo vector:")

      const written = JSON.parse(await readFile(join(repoPath, ".pulsar/vector.json"), "utf8"))
      expect(written.id).toBe("strict-type-safety")
      expect(written.preset_profile.kind).toBe("technology-practice")
      expect(written.preset_profile.activation).toBe("explicit-apply-only")
      expect(written.provenance[0].source).toBe("preset")
      expect(written.provenance[0].summary).toBe("Applied profile template strict-type-safety")
      expect(written.provenance[0].evidence[0].metadata.preset_profile_kind).toBe(
        "technology-practice",
      )

      const score = runCli(repoPath, ["score", "."])
      expect(score.status).toBe(0)
      expect(score.stdout).toContain("Vector: strict-type-safety")

      const diff = runCli(repoPath, ["persona", "diff", "ai-slop-defense", repoPath])
      expect(diff.status).toBe(0)
      expect(diff.stdout).toContain("Current vector source: repo-local .pulsar/vector.json")
      expect(diff.stdout).toContain("Profile template:      ai-slop-defense")
      expect(diff.stdout).toContain("Template kind:         workflow/risk")
      expect(diff.stdout).toContain("Weight deltas:")
      expect(diff.stdout).toContain("Mode deltas:")
      expect(diff.stdout).toContain("ai_assisted false -> true")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("diff labels organization fallback vector provenance", async () => {
    const repoPath = await initRepo()
    const homePath = await mkdtemp(join(tmpdir(), "pulsar-persona-home-"))
    try {
      await writeRepoFile(
        homePath,
        ".config/pulsar/vector.json",
        JSON.stringify(
          {
            id: "organization-default",
            domain: "typescript",
            signal_overrides: { "TS-LD-01": { weight: 0.5 } },
          },
          null,
          2,
        ),
      )

      const diff = runCli(repoPath, ["persona", "diff", "ai-slop-defense", repoPath], {
        HOME: homePath,
      })
      expect(diff.status).toBe(0)
      expect(diff.stdout).toContain("Current vector:        organization-default")
      expect(diff.stdout).toContain(
        "Current vector source: organization fallback ~/.config/pulsar/vector.json",
      )
    } finally {
      await rm(repoPath, { recursive: true, force: true })
      await rm(homePath, { recursive: true, force: true })
    }
  }, 120_000)

  test("applied ai-slop-defense vector tightens small diff clone signal after baseline", async () => {
    const repoPath = await initRepo()
    const smallDuplicateBody = `
  const out = value + 1
  return out
`
    try {
      await writeRepoFile(
        repoPath,
        "src/existing.ts",
        `export function existingTiny(value: number): number {${smallDuplicateBody}}\n`,
      )
      await writeRepoFile(
        repoPath,
        "src/existing-two.ts",
        `export function existingTinyTwo(value: number): number {${smallDuplicateBody}}\n`,
      )
      sh("git", ["add", "src/existing.ts", "src/existing-two.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed tiny helpers"], repoPath)

      await writeRepoFile(
        repoPath,
        "src/changed.ts",
        `export function copiedTiny(value: number): number {${smallDuplicateBody}}\n`,
      )

      const baseline = runCli(repoPath, ["score", "--category", "generated-slop", "."])
      expect(baseline.status).toBe(0)
      expect(baseline.stdout).toContain("Vector:   all-defaults")
      expect(baseline.stdout).not.toContain("existingTiny")
      expect(baseline.stdout).not.toContain("copiedTiny")

      const apply = runCli(repoPath, [
        "persona",
        "apply",
        "ai-slop-defense",
        "--to",
        ".pulsar/vector.json",
      ])
      expect(apply.status).toBe(0)

      const written = JSON.parse(await readFile(join(repoPath, ".pulsar/vector.json"), "utf8"))
      expect(written.id).toBe("ai-slop-defense")
      expect(written.modes.ai_assisted).toBe(true)
      expect(written.signal_overrides["SHARED-03"].weight).toBeGreaterThan(1)
      expect(written.provenance[0].source).toBe("preset")

      const vectorScore = runChangedOnlyDiffJson(repoPath)
      const duplicationDiagnostics = changedDuplicationDiagnostics(vectorScore)
      const diagnosticsText = JSON.stringify(duplicationDiagnostics)
      expect(vectorScore.vector.id).toBe("ai-slop-defense")
      expect(vectorScore.vector.source).toBe("worktree")
      expect(duplicationDiagnostics.length).toBeGreaterThan(0)
      expect(diagnosticsText).toContain("existingTiny")
      expect(diagnosticsText).toContain("copiedTiny")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("applied ai-slop-defense vector separates dirty copied diffs from clean alternatives", async () => {
    const seedRepo = async (): Promise<string> => {
      const repoPath = await initRepo()
      const smallDuplicateBody = `
  const out = value + 1
  return out
`
      await writeRepoFile(
        repoPath,
        "src/existing.ts",
        `export function existingTiny(value: number): number {${smallDuplicateBody}}\n`,
      )
      await writeRepoFile(
        repoPath,
        "src/existing-two.ts",
        `export function existingTinyTwo(value: number): number {${smallDuplicateBody}}\n`,
      )
      sh("git", ["add", "src/existing.ts", "src/existing-two.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed tiny helpers"], repoPath)
      return repoPath
    }

    const dirtyRepoPath = await seedRepo()
    const cleanRepoPath = await seedRepo()
    try {
      const copiedBody = `
  const out = value + 1
  return out
`
      await writeRepoFile(
        dirtyRepoPath,
        "src/changed.ts",
        `export function copiedTiny(value: number): number {${copiedBody}}\n`,
      )

      const defaultDirty = runChangedOnlyDiffJson(dirtyRepoPath)
      expect(changedDuplicationDiagnostics(defaultDirty)).toHaveLength(0)

      for (const repoPath of [dirtyRepoPath, cleanRepoPath]) {
        const apply = runCli(repoPath, [
          "persona",
          "apply",
          "ai-slop-defense",
          "--to",
          ".pulsar/vector.json",
        ])
        expect(apply.status).toBe(0)
        sh("git", ["add", ".pulsar/vector.json"], repoPath)
        sh("git", ["commit", "-q", "-m", "apply ai slop defense vector"], repoPath)
      }

      await writeRepoFile(
        cleanRepoPath,
        "src/changed.ts",
        `
export function formattedTiny(value: number): number {
  const incremented = value + 1
  return Number.isFinite(incremented) ? incremented : value
}
`,
      )

      const dirtyVector = runChangedOnlyDiffJson(dirtyRepoPath)
      const cleanVector = runChangedOnlyDiffJson(cleanRepoPath)
      const dirtyDiagnostics = changedDuplicationDiagnostics(dirtyVector)
      const cleanDiagnostics = changedDuplicationDiagnostics(cleanVector)

      expect(dirtyDiagnostics.length).toBeGreaterThan(0)
      expect(JSON.stringify(dirtyDiagnostics)).toContain("copiedTiny")
      expect(cleanDiagnostics).toHaveLength(0)
      expect(dirtyVector.gate_decision.status).toBe("route")
    } finally {
      await rm(dirtyRepoPath, { recursive: true, force: true })
      await rm(cleanRepoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("created ai-slop-defense vector changes generated-slop scoring", async () => {
    const repoPath = await initRepo()
    const smallDuplicateBody = `
  const out = value + 1
  return out
`
    try {
      await writeRepoFile(
        repoPath,
        "src/existing.ts",
        `export function existingTiny(value: number): number {${smallDuplicateBody}}\n`,
      )
      await writeRepoFile(
        repoPath,
        "src/existing-two.ts",
        `export function existingTinyTwo(value: number): number {${smallDuplicateBody}}\n`,
      )
      sh("git", ["add", "src/existing.ts", "src/existing-two.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed tiny helpers"], repoPath)
      await writeRepoFile(
        repoPath,
        "src/changed.ts",
        `export function copiedTiny(value: number): number {${smallDuplicateBody}}\n`,
      )

      const baseline = runChangedOnlyDiffJson(repoPath)
      expect(changedDuplicationDiagnostics(baseline)).toHaveLength(0)

      const apply = runCli(repoPath, [
        "persona",
        "apply",
        "ai-slop-defense",
        "--to",
        ".pulsar/vector.json",
      ])
      expect(apply.status).toBe(0)

      const vectorScore = runChangedOnlyDiffJson(repoPath)
      const vectorDiagnostics = changedDuplicationDiagnostics(vectorScore)
      expect(vectorDiagnostics.length).toBeGreaterThan(0)
      expect(JSON.stringify(vectorDiagnostics)).toContain("copiedTiny")

      const human = runCli(repoPath, [
        "score",
        "--diff",
        "HEAD..WORKTREE",
        "--changed-only",
        "--agent-view",
        ".",
      ])
      expect(human.status).toBe(0)
      expect(human.stdout).toContain("TS-SL-01")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("applied refactor-friendly vector applies architecture weighting after baseline", async () => {
    const repoPath = await initRepo()
    try {
      await writeRepoFile(repoPath, "src/a.ts", "import { b } from './b'\nexport const a = b + 1\n")
      await writeRepoFile(repoPath, "src/b.ts", "import { c } from './c'\nexport const b = c + 1\n")
      await writeRepoFile(repoPath, "src/c.ts", "import { d } from './d'\nexport const c = d + 1\n")
      await writeRepoFile(repoPath, "src/d.ts", "import { a } from './a'\nexport const d = a + 1\n")
      sh("git", ["add", "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed runtime cycle"], repoPath)

      const baseline = runCli(repoPath, ["score", "--json", "."])
      expect(baseline.status).toBe(0)
      const baselineArchitecture = JSON.parse(baseline.stdout).categories["architectural-drift"]
      expect(baselineArchitecture.aggregation.weights[TS_AD_02_SIGNAL_ID]).toBe(1)
      expect(baselineArchitecture.signals[TS_AD_02_SIGNAL_ID]).toBeLessThan(1)

      const apply = runCli(repoPath, [
        "persona",
        "apply",
        "refactor-friendly",
        "--to",
        ".pulsar/vector.json",
      ])
      expect(apply.status).toBe(0)

      const written = JSON.parse(await readFile(join(repoPath, ".pulsar/vector.json"), "utf8"))
      expect(written.id).toBe("refactor-friendly")
      expect(written.signal_overrides["TS-AD-02"].weight).toBeGreaterThan(1)
      expect(written.signal_overrides["SHARED-02"].weight).toBeGreaterThan(1)
      expect(written.signal_overrides["SHARED-03"].weight).toBeGreaterThan(1)
      expect(written.provenance[0].source).toBe("preset")

      const vectorScore = runCli(repoPath, ["score", "--json", "."])
      expect(vectorScore.status).toBe(0)
      const vectorArchitecture = JSON.parse(vectorScore.stdout).categories["architectural-drift"]
      expect(vectorArchitecture.aggregation.weights[TS_AD_02_SIGNAL_ID]).toBeGreaterThan(1)
      expect(vectorArchitecture.signals[TS_AD_02_SIGNAL_ID]).toBe(
        baselineArchitecture.signals[TS_AD_02_SIGNAL_ID],
      )
      expect(vectorArchitecture.aggregation.rawScore).not.toBe(
        baselineArchitecture.aggregation.rawScore,
      )
      expect(vectorArchitecture.aggregation.pressure.finalPressure).not.toBe(
        baselineArchitecture.aggregation.pressure.finalPressure,
      )
      expect(vectorArchitecture.score).toBeLessThan(baselineArchitecture.score)

      const human = runCli(repoPath, ["score", "--category", "architectural-drift", "."])
      expect(human.status).toBe(0)
      expect(human.stdout).toContain("Vector:   refactor-friendly")
      expect(human.stdout).toContain("TS-AD-02")
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  }, 120_000)

  test("applied refactor-friendly vector separates circular diffs from clean dependency direction", async () => {
    const seedRepo = async (): Promise<string> => {
      const repoPath = await initRepo()
      await writeRepoFile(
        repoPath,
        "src/domain.ts",
        "export type DomainRecord = { readonly id: string }\nexport const makeRecord = (id: string): DomainRecord => ({ id })\n",
      )
      await writeRepoFile(
        repoPath,
        "src/service.ts",
        "import { makeRecord } from './domain'\nexport const loadRecord = (id: string) => makeRecord(id)\n",
      )
      sh("git", ["add", "src/domain.ts", "src/service.ts"], repoPath)
      sh("git", ["commit", "-q", "-m", "seed clean dependency direction"], repoPath)
      return repoPath
    }

    const dirtyRepoPath = await seedRepo()
    const cleanRepoPath = await seedRepo()
    try {
      await writeRepoFile(
        dirtyRepoPath,
        "src/domain.ts",
        "import { loadRecord } from './service'\nexport type DomainRecord = { readonly id: string }\nexport const makeRecord = (id: string): DomainRecord => ({ id })\nexport const hydrateRecord = (id: string) => loadRecord(id)\n",
      )

      const defaultDirty = runCli(dirtyRepoPath, ["score", "--json", "."])
      expect(defaultDirty.status).toBe(0)
      const defaultArchitecture = JSON.parse(defaultDirty.stdout).categories["architectural-drift"]
      expect(defaultArchitecture.signals[TS_AD_02_SIGNAL_ID]).toBeLessThan(1)

      for (const repoPath of [dirtyRepoPath, cleanRepoPath]) {
        const apply = runCli(repoPath, [
          "persona",
          "apply",
          "refactor-friendly",
          "--to",
          ".pulsar/vector.json",
        ])
        expect(apply.status).toBe(0)
        sh("git", ["add", ".pulsar/vector.json"], repoPath)
        sh("git", ["commit", "-q", "-m", "apply refactor vector"], repoPath)
      }

      await writeRepoFile(
        cleanRepoPath,
        "src/use-case.ts",
        "import { loadRecord } from './service'\nexport const runUseCase = (id: string) => loadRecord(id)\n",
      )

      const dirtyVector = runCli(dirtyRepoPath, ["score", "--json", "."])
      const cleanVector = runCli(cleanRepoPath, ["score", "--json", "."])
      expect(dirtyVector.status).toBe(0)
      expect(cleanVector.status).toBe(0)

      const dirtyArchitecture = JSON.parse(dirtyVector.stdout).categories["architectural-drift"]
      const cleanArchitecture = JSON.parse(cleanVector.stdout).categories["architectural-drift"]

      expect(dirtyArchitecture.aggregation.weights[TS_AD_02_SIGNAL_ID]).toBeGreaterThan(1)
      expect(dirtyArchitecture.aggregation.rawScore).not.toBe(
        defaultArchitecture.aggregation.rawScore,
      )
      expect(dirtyArchitecture.aggregation.pressure.finalPressure).not.toBe(
        defaultArchitecture.aggregation.pressure.finalPressure,
      )
      expect(dirtyArchitecture.score).toBeLessThan(defaultArchitecture.score)
      expect(dirtyArchitecture.signals[TS_AD_02_SIGNAL_ID]).toBeLessThan(1)
      expect(cleanArchitecture.signals[TS_AD_02_SIGNAL_ID]).toBe(1)
      expect(dirtyArchitecture.score).toBeLessThan(cleanArchitecture.score)
    } finally {
      await rm(dirtyRepoPath, { recursive: true, force: true })
      await rm(cleanRepoPath, { recursive: true, force: true })
    }
  }, 120_000)
})
