#!/usr/bin/env bun

const mode = process.argv[2] ?? "ok"

const writePartialScore = (): void => {
  process.stdout.write('{"partial":true}\n')
}

if (mode === "ok") {
  process.stdout.write('{"ok":true}\n')
  process.stderr.write("child ok\n")
  process.exit(0)
}

if (mode === "fail") {
  writePartialScore()
  process.stderr.write("child fail\n")
  process.exit(1)
}

if (mode === "sleep") {
  writePartialScore()
  process.stderr.write("child sleep\n")
  await Bun.sleep(30_000)
  process.exit(0)
}

if (mode === "hold") {
  const nested = Bun.spawn(["sleep", "30"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  writePartialScore()
  process.stderr.write(`nested=${nested.pid}\n`)
  await Bun.sleep(30_000)
  process.exit(0)
}

if (mode === "preload") {
  const preload =
    (globalThis as { __PULSAR_RESOURCE_BENCH_PRELOAD__?: boolean }).__PULSAR_RESOURCE_BENCH_PRELOAD__ ===
    true
  process.stdout.write(`${JSON.stringify({ preload })}\n`)
  process.exit(0)
}

throw new Error(`unknown fixture mode: ${mode}`)
