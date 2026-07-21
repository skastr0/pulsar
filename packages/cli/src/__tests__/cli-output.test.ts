import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const PREVIOUS_LARGE_SCORE_BYTES = 1_040_852
const REGRESSION_PAYLOAD_BYTES = 1_100_000

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

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
