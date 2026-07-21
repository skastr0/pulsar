import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const PREVIOUS_LARGE_SCORE_BYTES = 1_040_852
const REGRESSION_PAYLOAD_BYTES = 1_100_000
const binPath = resolve(import.meta.dir, "../bin.ts")

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const runGit = (repoPath: string, args: ReadonlyArray<string>): void => {
  const result = spawnSync("git", args as Array<string>, {
    cwd: repoPath,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
}

test("large JSON drains through a backpressured stdout pipe", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "pulsar-cli-output-"))
  try {
    const producerPath = join(fixtureDir, "producer.ts")
    const consumerPath = join(fixtureDir, "consumer.ts")
    const outputModuleUrl = pathToFileURL(
      resolve(import.meta.dir, "../cli-output.ts"),
    ).href

    await writeFile(
      producerPath,
      [
        `import { writeJsonToStdout } from ${JSON.stringify(outputModuleUrl)}`,
        `console.error("stderr-only")`,
        `await writeJsonToStdout({ complete: true, payload: "x".repeat(${REGRESSION_PAYLOAD_BYTES}) })`,
      ].join("\n"),
      "utf8",
    )
    await writeFile(
      consumerPath,
      [
        `const decoder = new TextDecoder()`,
        `let text = ""`,
        `for await (const chunk of Bun.stdin.stream()) {`,
        `  text += decoder.decode(chunk, { stream: true })`,
        `  await Bun.sleep(1)`,
        `}`,
        `text += decoder.decode()`,
        `const parsed = JSON.parse(text)`,
        `console.log(JSON.stringify({`,
        `  bytes: new TextEncoder().encode(text).byteLength,`,
        `  complete: parsed.complete,`,
        `  payloadBytes: parsed.payload.length,`,
        `}))`,
      ].join("\n"),
      "utf8",
    )

    const result = spawnSync(
      "bash",
      [
        "-o",
        "pipefail",
        "-c",
        `bun ${shellQuote(producerPath)} | bun ${shellQuote(consumerPath)}`,
      ],
      {
        encoding: "utf8",
        maxBuffer: REGRESSION_PAYLOAD_BYTES * 2,
      },
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("stderr-only\n")
    expect(JSON.parse(result.stdout)).toEqual({
      bytes: expect.any(Number),
      complete: true,
      payloadBytes: REGRESSION_PAYLOAD_BYTES,
    })
    expect((JSON.parse(result.stdout) as { bytes: number }).bytes).toBeGreaterThan(
      PREVIOUS_LARGE_SCORE_BYTES,
    )
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}, 30_000)

test("real score CLI drains profile JSON larger than the prior regression", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "pulsar-cli-score-output-"))
  try {
    const consumerPath = join(fixtureDir, "consumer.ts")
    const repoPath = join(fixtureDir, "repo")
    const vectorPath = join(fixtureDir, "vector.json")
    const statePath = join(fixtureDir, "state")

    await mkdir(join(repoPath, "src"), { recursive: true })
    await writeFile(
      join(repoPath, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
        },
        include: ["src/**/*.ts"],
      }),
      "utf8",
    )
    await writeFile(
      join(repoPath, "src/index.ts"),
      "export const answer: number = 42\n",
      "utf8",
    )
    runGit(repoPath, ["init", "-q", "-b", "main"])
    runGit(repoPath, ["config", "user.email", "test@test.test"])
    runGit(repoPath, ["config", "user.name", "test"])
    runGit(repoPath, ["config", "commit.gpgsign", "false"])
    runGit(repoPath, ["add", "."])
    runGit(repoPath, ["commit", "-q", "-m", "fixture"])

    await writeFile(
      vectorPath,
      JSON.stringify({
        id: `large-output-${"x".repeat(REGRESSION_PAYLOAD_BYTES)}`,
        domain: "typescript",
        signal_overrides: {},
      }),
      "utf8",
    )
    await writeFile(
      consumerPath,
      [
        `const decoder = new TextDecoder()`,
        `let text = ""`,
        `for await (const chunk of Bun.stdin.stream()) {`,
        `  text += decoder.decode(chunk, { stream: true })`,
        `  await Bun.sleep(1)`,
        `}`,
        `text += decoder.decode()`,
        `const parsed = JSON.parse(text)`,
        `if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {`,
        `  throw new Error("score output must be a JSON object")`,
        `}`,
        `console.log(JSON.stringify({`,
        `  bytes: new TextEncoder().encode(text).byteLength,`,
        `  object: true,`,
        `}))`,
      ].join("\n"),
      "utf8",
    )

    const command = [
      `PULSAR_STATE_HOME=${shellQuote(statePath)}`,
      "bun",
      shellQuote(binPath),
      "score",
      "--json",
      "--profile",
      "--vector",
      shellQuote(vectorPath),
      shellQuote(repoPath),
      "|",
      "bun",
      shellQuote(consumerPath),
    ].join(" ")
    const result = spawnSync(
      "bash",
      ["-o", "pipefail", "-c", command],
      {
        cwd: repoPath,
        encoding: "utf8",
        maxBuffer: REGRESSION_PAYLOAD_BYTES * 2,
      },
    )

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    const summary = JSON.parse(result.stdout) as { bytes: number; object: boolean }
    expect(summary.object).toBe(true)
    expect(summary.bytes).toBeGreaterThan(PREVIOUS_LARGE_SCORE_BYTES)
  } finally {
    await rm(fixtureDir, { recursive: true, force: true })
  }
}, 120_000)
