import { describe, expect, test } from "bun:test"
import { agentDetailArgv, agentHelp, parseAgentArguments } from "../agent-args.js"
import { AgentCommandError } from "../agent-contract.js"

describe("agent arguments", () => {
  test("defaults to scoped help and a noninteractive catalog", () => {
    expect(parseAgentArguments([]).help).toBe(true)
    expect(parseAgentArguments(["catalog"])).toMatchObject({ operation: "catalog", repoPath: ".", help: false })
    expect(agentHelp("config")).toContain("Validate and explain repository policy")
    expect(agentHelp("config")).not.toContain("pulsar agent catalog [repo]")
  })

  test("accepts explicit candidates and preserves shell-free detail replay", () => {
    const parsed = parseAgentArguments([
      "score", "--vector", "candidate policy.json", "--modules", "modules.json",
      "--module-dependency-root", "/some clone", "--trust-project-code",
      "--expect-policy", "fingerprint", "--signal", "TS-LD-02", "--limit", "2", "--", "-repo",
    ])
    expect(parsed).toMatchObject({ repoPath: "-repo", vectorPath: "candidate policy.json", limit: 2, trustProjectCode: true })
    const replay = agentDetailArgv(parsed, "TS-LD-02-function-size-distribution")
    expect(replay).toContain("candidate policy.json")
    expect(replay).toContain("--trust-project-code")
    expect(replay).not.toContain("--limit")
    expect(parseAgentArguments(replay.slice(2))).toMatchObject({ full: true, repoPath: "-repo", expectPolicy: "fingerprint" })
  })

  test("judge is an explicit source-egress operation with a zero-call preview", () => {
    expect(parseAgentArguments(["judge", "repo", "--dry-run", "--expect-policy", "fingerprint"]))
      .toMatchObject({ operation: "judge", repoPath: "repo", dryRun: true, expectPolicy: "fingerprint" })
    expect(parseAgentArguments(["judge"])).toMatchObject({ dryRun: false })
    expect(agentHelp("judge")).toContain("Sends configured source and context to TypeSafe")
    expect(agentHelp("judge")).toContain("without network calls or writes")
    expect(agentHelp("judge")).toContain("TYPESAFE_API_KEY")
    expect(agentHelp("score")).toContain("Only judge sends code")
  })

  test("discovery scope is explicit and never adopts a policy", () => {
    expect(parseAgentArguments(["discover", "--include", "packages/core/**", "--exclude", "**/*.test.ts"]))
      .toMatchObject({ operation: "discover", include: "packages/core/**", exclude: "**/*.test.ts" })
    expect(agentHelp("discover")).toContain("does not adopt policy or call a model")
    expect(agentHelp("discover")).toContain("not a shared-rule verdict")
  })

  test("rejects unsupported, incomplete, repeated, conflicting and cross-operation flags", () => {
    for (const args of [
      ["unknown"], ["score", "--json"], ["score", "--vector"], ["score", "--vector=x"],
      ["score", "--vector", "--full"], ["score", "a", "b"], ["score", "--limit", "0"],
      ["score", "--limit", "NaN"], ["score", "--limit", "1.5"], ["score", "--limit", "101"],
      ["score", "--full", "--limit", "2"], ["score", "--full", "--full"],
      ["score", "--vector", "a", "--vector", "b"], ["config", "--full"],
      ["catalog", "--trust-project-code"], ["catalog", "--vector", "a"],
      ["catalog", "--signal", "x", "--slot", "y"], ["score", "--slot", "x"],
      ["score", "--dry-run"], ["judge", "--full"], ["judge", "--limit", "2"],
      ["judge", "--signal", "TS-SL-07"], ["judge", "--dry-run", "--dry-run"],
      ["score", "--include", "src/**"], ["judge", "--exclude", "src/**"],
      ["discover", "--include"], ["discover", "--dry-run"],
    ]) {
      expect(() => parseAgentArguments(args)).toThrow(AgentCommandError)
    }
  })
})
