import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { pluginConfigLayer } from "../src/shared/options"
import { ToolPolicy, toolPolicyLive } from "../src/shared/policy"

const evaluatePolicy = (
  blockEnvFiles: boolean,
  tool: string,
  args: unknown,
) => {
  const policyLayer = toolPolicyLive.pipe(
    Layer.provide(
      pluginConfigLayer({
        blockEnvFiles,
        chatTemperature: 0.2,
        idleLogLevel: "info",
        statusMessage: "Effect runtime active",
      }),
    ),
  )

  return Effect.runPromise(
    Effect.gen(function* () {
      const policy = yield* ToolPolicy
      return yield* policy.evaluate(tool, args)
    }).pipe(Effect.provide(policyLayer)),
  )
}

describe("tool policy", () => {
  test("denies .env file access for file tools", async () => {
    await expect(
      evaluatePolicy(true, "read", { filePath: "apps/web/.env.local" }),
    ).resolves.toMatchObject({
      _tag: "Deny",
      tool: "read",
      filePath: "apps/web/.env.local",
    })
  })

  test("allows .env file access when disabled by options", async () => {
    await expect(
      evaluatePolicy(false, "read", { filePath: ".env" }),
    ).resolves.toEqual({
      _tag: "Allow",
    })
  })

  test("allows non-file tools", async () => {
    await expect(
      evaluatePolicy(true, "bash", { filePath: ".env" }),
    ).resolves.toEqual({
      _tag: "Allow",
    })
  })
})
