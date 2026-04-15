import { describe, expect, test } from "bun:test"
import {
  shouldDenyToolInvocation,
  type ToolInvocation,
} from "../src/shared/policy"

describe("tool policy", () => {
  test("denies .env file access for file tools", () => {
    const invocation: ToolInvocation = {
      tool: "read",
      filePath: "apps/web/.env.local",
    }

    expect(shouldDenyToolInvocation(invocation, true)).toMatchObject({
      _tag: "Deny",
      tool: "read",
      filePath: "apps/web/.env.local",
    })
  })

  test("allows .env file access when disabled by options", () => {
    const invocation: ToolInvocation = {
      tool: "read",
      filePath: ".env",
    }

    expect(shouldDenyToolInvocation(invocation, false)).toEqual({
      _tag: "Allow",
    })
  })

  test("allows non-file tools", () => {
    const invocation: ToolInvocation = {
      tool: "bash",
      filePath: ".env",
    }

    expect(shouldDenyToolInvocation(invocation, true)).toEqual({
      _tag: "Allow",
    })
  })
})
