import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createConsumer } from "../agent-smoke"

test("external service repair passes its own tests without altering repository policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-consumer-test-"))
  try {
    const { repo, run, fix } = await createConsumer(root)
    const vectorPath = join(repo, ".pulsar/vector.json")
    const before = await readFile(vectorPath, "utf8")
    const broken = await run([process.execPath, "test"])
    expect(broken.code).not.toBe(0)
    expect(broken.stderr).toContain("Not implemented")
    await fix()
    const repaired = await run([process.execPath, "test"])
    expect(repaired.code).toBe(0)
    expect(repaired.stderr).toContain("3 pass")
    expect(await readFile(vectorPath, "utf8")).toBe(before)
    expect(JSON.parse(before).signal_overrides["TS-SL-04"].weight).toBe(1.8)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
