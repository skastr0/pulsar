import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const binPath = resolve(import.meta.dir, "../bin.ts")
const repos: string[] = []

afterEach(async () => {
  await Promise.all(repos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })))
})

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const sh = (cmd: string, args: ReadonlyArray<string>, cwd: string): string => {
  const result = spawnSync(cmd, args as string[], { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

const makeRepo = async (): Promise<string> => {
  const repo = await mkdtemp(join(tmpdir(), "pulsar-onboard-cli-"))
  repos.push(repo)
  await mkdir(join(repo, "src"), { recursive: true })
  await writeFile(join(repo, "package.json"), '{"name":"onboard-cli-fixture","private":true}\n')
  await writeFile(join(repo, "tsconfig.json"), '{"compilerOptions":{"strict":true},"include":["src"]}\n')
  await writeFile(
    join(repo, "src/index.ts"),
    `export function classify(n: number): number {\n${Array.from({ length: 24 }, (_, index) => `  if (n === ${index}) return ${index}`).join("\n")}\n  return -1\n}\n`,
  )
  sh("git", ["init", "-q", "-b", "main"], repo)
  sh("git", ["config", "user.email", "pulsar@example.test"], repo)
  sh("git", ["config", "user.name", "Pulsar Test"], repo)
  sh("git", ["add", "."], repo)
  sh("git", ["commit", "-qm", "fixture"], repo)
  return repo
}

test("spawned headless onboarding drains one complete JSON document and returns its status", async () => {
  const repo = await makeRepo()
  const answersPath = join(repo, "answers.json")
  const consumerPath = join(repo, "consumer.ts")
  await writeFile(
    answersPath,
    `${JSON.stringify(
      {
        choices: [
          {
            signalId: "TS-LD-01",
            optionIndex: 1,
            action: { kind: "vector-config", key: "max_complexity", value: 100 },
          },
        ],
        enabledPacks: [],
        baseline: "reject",
        seed: { shape: "app" },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    consumerPath,
    [
      "const decoder = new TextDecoder()",
      'let text = ""',
      "for await (const chunk of Bun.stdin.stream()) {",
      "  text += decoder.decode(chunk, { stream: true })",
      "  await Bun.sleep(1)",
      "}",
      "text += decoder.decode()",
      "const parsed = JSON.parse(text)",
      "console.log(JSON.stringify({ complete: true, parsed }))",
    ].join("\n"),
  )

  const command = [
    "bun",
    shellQuote(binPath),
    "onboard",
    "--json",
    "--answers",
    shellQuote(answersPath),
    shellQuote(repo),
    "|",
    "bun",
    shellQuote(consumerPath),
  ].join(" ")
  const result = spawnSync("bash", ["-o", "pipefail", "-c", command], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })

  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  const output = JSON.parse(result.stdout) as {
    complete: boolean
    parsed: {
      before: { score: number }
      after: { score: number }
      baseline: string
      choices: ReadonlyArray<{ signalId: string; action: { kind: string } }>
      receipts: ReadonlyArray<{ status: string }>
    }
  }
  expect(output).toMatchObject({
    complete: true,
    parsed: {
      baseline: "reject",
      choices: [{ signalId: "TS-LD-01", action: { kind: "vector-config" } }],
      receipts: [{ status: "applied" }],
    },
  })
  expect(output.parsed.after.score).toBeGreaterThanOrEqual(output.parsed.before.score)
  const vector = JSON.parse(await readFile(join(repo, ".pulsar/vector.json"), "utf8")) as {
    signal_overrides: Record<string, unknown>
  }
  expect(vector.signal_overrides).toEqual({ "TS-LD-01": { config: { max_complexity: 100 } } })
}, 120_000)

test("invalid headless answers return non-zero without a partial vector", async () => {
  const repo = await makeRepo()
  const answersPath = join(repo, "answers.json")
  await writeFile(
    answersPath,
    JSON.stringify({
      choices: [
        {
          signalId: "TS-LD-01",
          optionIndex: 1,
          action: { kind: "vector-config", key: "max_complexity", value: "not-a-number" },
        },
      ],
      enabledPacks: [],
      baseline: "reject",
    }),
  )

  const result = spawnSync("bun", [binPath, "onboard", "--json", "--answers", answersPath, repo], {
    cwd: repo,
    encoding: "utf8",
  })

  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain("TS-LD-01.config.max_complexity")
  await expect(readFile(join(repo, ".pulsar/vector.json"), "utf8")).rejects.toThrow()
}, 120_000)

test("bare and equals-form --answers fail before scan or write", async () => {
  for (const args of [["--answers"], ["--answers=answers.json"]]) {
    const repo = await makeRepo()
    const result = spawnSync("bun", [binPath, "onboard", "--json", ...args], {
      cwd: repo,
      encoding: "utf8",
    })

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(
      args[0]!.includes("=") ? "--answers=path is not supported" : "--answers requires a file path",
    )
    await expect(readFile(join(repo, ".pulsar/vector.json"), "utf8")).rejects.toThrow()
  }
}, 30_000)

test("headless onboarding without --answers is preview-only and writes no repo artifacts", async () => {
  const repo = await makeRepo()
  const result = spawnSync("bun", [binPath, "onboard", "--json", repo], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })

  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(JSON.parse(result.stdout)).toMatchObject({
    mode: "preview-only",
    choices: [],
    enabledPacks: [],
    baseline: "not-provided",
    written: [],
  })
  await expect(readFile(join(repo, ".pulsar/vector.json"), "utf8")).rejects.toThrow()
  await expect(readFile(join(repo, ".pulsar/pulsar-baseline.json"), "utf8")).rejects.toThrow()
  await expect(readFile(join(repo, ".pulsar/project-modules.json"), "utf8")).rejects.toThrow()
}, 120_000)
