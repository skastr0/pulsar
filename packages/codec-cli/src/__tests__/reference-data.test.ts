import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  decodeGlossaryDraftSync,
  decodeGlossarySync,
  decodeSchemaConventionsSync,
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
} from "@taste-codec/core"
import { Effect } from "effect"

const binPath = resolve(import.meta.dir, "../../src/bin.ts")
const createdRepos: Array<string> = []

afterEach(async () => {
  for (const repoPath of createdRepos.splice(0)) {
    await rm(repoPath, { recursive: true, force: true })
  }
})

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

const initReferenceRepo = async (): Promise<string> => {
  const repoPath = await mkdtemp(join(tmpdir(), "taste-reference-data-"))
  createdRepos.push(repoPath)

  sh("git", ["init", "-q", "-b", "main"], repoPath)
  sh("git", ["config", "user.email", "test@test.test"], repoPath)
  sh("git", ["config", "user.name", "test"], repoPath)
  sh("git", ["config", "commit.gpgsign", "false"], repoPath)

  await writeRepoFile(
    repoPath,
    "package.json",
    JSON.stringify(
      {
        name: "reference-fixture",
        private: true,
        workspaces: ["packages/*"],
      },
      null,
      2,
    ),
  )
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
        include: ["packages/**/*.ts"],
      },
      null,
      2,
    ),
  )

  const packageTsconfig = JSON.stringify(
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
  )

  await writeRepoFile(
    repoPath,
    "packages/api/package.json",
    JSON.stringify(
      {
        name: "@acme/api",
        private: true,
        exports: {
          ".": "./dist/index.js",
        },
        dependencies: {
          effect: "^3.0.0",
        },
      },
      null,
      2,
    ),
  )
  await writeRepoFile(repoPath, "packages/api/tsconfig.json", packageTsconfig)
  await writeRepoFile(
    repoPath,
    "packages/api/src/index.ts",
    "export * from './user-service'\n",
  )
  await writeRepoFile(
    repoPath,
    "packages/api/src/user-service.ts",
    [
      "export interface UserProfile { id: string }",
      "export interface MemberProfile { id: string }",
      "export class UserController {}",
      "export type SessionToken = string",
      "export enum StatusCode { Ok = 'ok' }",
      "export const MAX_RETRIES = 3",
      "export const retryBudget = 2",
      "export const createUserService = (requestPayload: UserProfile): SessionToken => 'user-token'",
      "export const createMemberService = (requestPayload: MemberProfile): SessionToken => 'member-token'",
      "export const mapUserAccount = (userProfile: UserProfile) => userProfile",
      "export const mapMemberAccount = (memberProfile: MemberProfile) => memberProfile",
      "",
    ].join("\n"),
  )

  await writeRepoFile(
    repoPath,
    "packages/shared/package.json",
    JSON.stringify(
      {
        name: "@acme/shared",
        private: true,
        dependencies: {
          "simple-git": "^3.25.0",
        },
      },
      null,
      2,
    ),
  )
  await writeRepoFile(repoPath, "packages/shared/tsconfig.json", packageTsconfig)
  await writeRepoFile(
    repoPath,
    "packages/shared/src/index.ts",
    "export const sharedValue = 1\n",
  )

  await writeRepoFile(
    repoPath,
    "packages/internal/package.json",
    JSON.stringify(
      {
        name: "@acme/internal",
        private: true,
        dependencies: {
          "@acme/api": "workspace:*",
        },
      },
      null,
      2,
    ),
  )
  await writeRepoFile(repoPath, "packages/internal/tsconfig.json", packageTsconfig)
  await writeRepoFile(
    repoPath,
    "packages/internal/src/internal-tool.ts",
    "export const internalThing = 1\n",
  )

  sh("git", ["add", "."], repoPath)
  sh("git", ["commit", "-q", "-m", "initial"], repoPath)
  return repoPath
}

const runCli = (cwd: string, args: ReadonlyArray<string>): ReturnType<typeof spawnSync> =>
  spawnSync("bun", [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  })

describe("reference data commands", () => {
  test("glossary extract writes a draft and confirm promotes reviewed canonical terms", async () => {
    const repoPath = await initReferenceRepo()

    const extract = runCli(repoPath, ["glossary", "extract", "--sha", "HEAD", "."])
    expect(extract.status).toBe(0)
    expect(extract.stdout).toContain("Top candidate terms:")
    expect(extract.stdout).toContain("user")
    expect(extract.stdout).toContain("Top synonym candidates:")
    expect(extract.stdout).toContain(" <-> ")
    expect(extract.stdout).toContain("score ")

    const draftPath = join(repoPath, ".taste-codec", "glossary.draft.json")
    const draft = decodeGlossaryDraftSync(JSON.parse(await readFile(draftPath, "utf8")))

    const userTerm = draft.candidate_terms.find((term) => term.term === "user")
    expect(userTerm?.frequency).toBeGreaterThan(0)
    expect(userTerm?.provenance.some((entry) => entry.file.endsWith("user-service.ts"))).toBe(true)
    expect(draft.candidate_synonyms.length).toBeGreaterThan(0)

    const reviewedDraft = {
      ...draft,
      candidate_terms: draft.candidate_terms.map((term) => ({
        ...term,
        decision:
          term.term === "user"
            ? { action: "accept" as const }
            : term.term === "member"
              ? { action: "merge" as const, merge_into: "user" }
              : { action: "reject" as const },
      })),
    }
    await writeFile(draftPath, `${JSON.stringify(reviewedDraft, null, 2)}\n`, "utf8")

    const confirm = runCli(repoPath, ["glossary", "confirm", "."])
    expect(confirm.status).toBe(0)

    const glossaryPath = join(repoPath, ".taste-codec", "glossary.json")
    const glossary = decodeGlossarySync(JSON.parse(await readFile(glossaryPath, "utf8")))
    const canonicalUser = glossary.terms.find((term) => term.canonical === "user")
    expect(canonicalUser?.aliases).toContain("member")
    expect(glossary.rejected_terms.length).toBeGreaterThan(0)
  }, 120_000)

  test("glossary confirm can bulk-accept frequent undecided terms", async () => {
    const repoPath = await initReferenceRepo()

    const extract = runCli(repoPath, ["glossary", "extract", "--sha", "HEAD", "."])
    expect(extract.status).toBe(0)

    const confirm = runCli(repoPath, [
      "glossary",
      "confirm",
      "--auto-accept-above-frequency",
      "4",
      ".",
    ])
    expect(confirm.status).toBe(0)
    expect(confirm.stdout).toContain("Auto decisions:     accepted >= 4, rejected below")

    const glossaryPath = join(repoPath, ".taste-codec", "glossary.json")
    const glossary = decodeGlossarySync(JSON.parse(await readFile(glossaryPath, "utf8")))
    expect(glossary.terms.some((term) => term.canonical === "user")).toBe(true)
    expect(glossary.terms.every((term) => term.frequency >= 4)).toBe(true)
    expect(glossary.rejected_terms.length).toBeGreaterThan(0)
  }, 120_000)

  test("glossary confirm reports undecided drafts with recovery guidance", async () => {
    const repoPath = await initReferenceRepo()

    const extract = runCli(repoPath, ["glossary", "extract", "--sha", "HEAD", "."])
    expect(extract.status).toBe(0)

    const confirm = runCli(repoPath, ["glossary", "confirm", "."])
    expect(confirm.status).toBe(1)
    expect(confirm.stderr).toContain("Glossary draft still has undecided terms")
    expect(confirm.stderr).toContain(".taste-codec/glossary.draft.json")
    expect(confirm.stderr).toContain("--auto-accept-above-frequency <n>")
    expect(confirm.stderr).not.toContain("FiberFailure")
  }, 120_000)

  test("glossary extract can exclude parameter names", async () => {
    const repoPath = await initReferenceRepo()

    const extract = runCli(repoPath, ["glossary", "extract", "--sha", "HEAD", "--no-parameters", "."])
    expect(extract.status).toBe(0)

    const draftPath = join(repoPath, ".taste-codec", "glossary.draft.json")
    const draft = decodeGlossaryDraftSync(JSON.parse(await readFile(draftPath, "utf8")))
    expect(draft.candidate_terms.some((term) => term.term === "payload")).toBe(false)
    expect(draft.include_parameter_names).toBe(false)
  }, 120_000)

  test("conventions extract infers defaults and confirm loads canonical reference data", async () => {
    const repoPath = await initReferenceRepo()
    await writeRepoFile(
      repoPath,
      "packages/api/src/contextual-consts.ts",
      [
        "export const UserSchema = { id: 'string' } as const",
        "export const AccountSchema = Schema.Struct({ id: Schema.String })",
        "export function buildContextualUser() {",
        "  const localSessionToken = 'user-token'",
        "  if (localSessionToken.length > 0) {",
        "    const BLOCK_SCOPED_LIMIT = 3",
        "    return String(BLOCK_SCOPED_LIMIT)",
        "  }",
        "  return localSessionToken",
        "}",
        "",
      ].join("\n"),
    )
    sh("git", ["add", "."], repoPath)
    sh("git", ["commit", "-q", "-m", "contextual consts"], repoPath)

    const extract = runCli(repoPath, ["conventions", "extract", "--sha", "HEAD", "."])
    expect(extract.status).toBe(0)

    const draftPath = join(repoPath, ".taste-codec", "conventions.draft.json")
    const draft = decodeSchemaConventionsSync(JSON.parse(await readFile(draftPath, "utf8")))
    expect(draft.naming_conventions.function).toBe("camelCase")
    expect(draft.naming_conventions.class).toBe("PascalCase")
    expect(draft.naming_conventions.const).toBe("camelCase | PascalCase | UPPER_SNAKE_CASE")
    expect(draft.naming_conventions.const).toContain("PascalCase")
    expect(draft.boundaries["packages/api"]?.visibility).toBe("public-api")
    expect(draft.boundaries["packages/api"]?.allowed_imports).toEqual(["effect"])
    expect(draft.boundaries["packages/shared"]?.visibility).toBe("public-api")
    expect(draft.boundaries["packages/internal"]?.visibility).toBe("internal")
    expect(draft.architectural_rules).toEqual([])

    const confirm = runCli(repoPath, ["conventions", "confirm", "."])
    expect(confirm.status).toBe(0)

    const entries = await Effect.runPromise(loadCanonicalReferenceDataEntries(repoPath))
    const referenceData = makeReferenceData(entries)
    const loaded = await Effect.runPromise(
      referenceData.require("TS-AD-01", "schema-conventions"),
    )

    expect((loaded as typeof draft).naming_conventions.function).toBe("camelCase")
  }, 120_000)
})
