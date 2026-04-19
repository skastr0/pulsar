import { access, readFile, readdir } from "node:fs/promises"
import { constants } from "node:fs"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { SignalContextTag } from "./context.js"
import { type Diagnostic } from "./diagnostic.js"
import { SignalComputeError } from "./errors.js"
import type { AnySignal, Signal } from "./signal.js"

const POLICY_PACKET_SCHEMA_ID = "epistemology-framework/policy-violation/v1" as const

export const EpistemologySignalConfig = Schema.Struct({
  window_days: Schema.Number,
  max_firings: Schema.Number,
})
export type EpistemologySignalConfig = typeof EpistemologySignalConfig.Type

export interface EpistemologySignalOutput {
  readonly ruleId: string
  readonly firingCount: number
  readonly blockingCount: number
  readonly windowDays: number
  readonly latestMessage: string | undefined
  readonly latestPaths: ReadonlyArray<string>
  readonly maxFirings: number
}

interface PolicyViolationPacket {
  readonly timestamp: string
  readonly ruleId: string
  readonly blocking: boolean
  readonly message: string
  readonly paths: ReadonlyArray<string>
}

export const epistemologySignalId = (ruleId: string): string =>
  `EPIST-${ruleId.replace(/[^A-Za-z0-9._-]+/g, "-")}`

export const loadEpistemologySignals = (repoPath: string) =>
  Effect.tryPromise({
    try: async () => {
      const ruleIds = await listEpistemologyRuleIds(repoPath)
      return ruleIds.map((ruleId) => makeEpistemologySignal(ruleId)) satisfies ReadonlyArray<AnySignal>
    },
    catch: () => [] as ReadonlyArray<AnySignal>,
  })

export const listEpistemologyRuleIds = async (
  repoPath: string,
): Promise<ReadonlyArray<string>> => {
  const ids = new Set<string>()
  const policyPath = join(repoPath, ".opencode", "policy.toml")
  if (await fileExists(policyPath)) {
    const content = await readFile(policyPath, "utf8")
    for (const match of content.matchAll(/^\s*id\s*=\s*"([^"]+)"\s*$/gm)) {
      const ruleId = match[1]?.trim()
      if (ruleId) ids.add(ruleId)
    }
  }

  const packets = await readPolicyViolationPackets(repoPath)
  for (const packet of packets) {
    ids.add(packet.ruleId)
  }

  return [...ids].sort((a, b) => a.localeCompare(b))
}

const makeEpistemologySignal = (
  ruleId: string,
): Signal<EpistemologySignalConfig, EpistemologySignalOutput, SignalContextTag> => ({
  id: epistemologySignalId(ruleId),
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  configSchema: EpistemologySignalConfig,
  defaultConfig: {
    window_days: 14,
    max_firings: 3,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: async (): Promise<EpistemologySignalOutput> => {
          const packets = await readPolicyViolationPackets(ctx.worktreePath)
          const cutoff = Date.now() - config.window_days * 24 * 60 * 60 * 1000
          const matching = packets.filter(
            (packet) =>
              packet.ruleId === ruleId && Date.parse(packet.timestamp) >= cutoff,
          )
          const latest = matching.at(-1)

          return {
            ruleId,
            firingCount: matching.length,
            blockingCount: matching.filter((packet) => packet.blocking).length,
            windowDays: config.window_days,
            latestMessage: latest?.message,
            latestPaths: latest?.paths ?? [],
            maxFirings: config.max_firings,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: epistemologySignalId(ruleId),
            message: `Failed to read epistemology packets for ${ruleId}: ${String(cause)}`,
            cause,
          }),
      })
    }),
  score: (output) => {
    if (output.firingCount === 0) return 1
    const weightedFirings = output.blockingCount * 2 + (output.firingCount - output.blockingCount)
    return Math.max(0, 1 - weightedFirings / Math.max(1, output.maxFirings))
  },
  diagnose: (output): ReadonlyArray<Diagnostic> => {
    if (output.firingCount === 0) {
      return [
        {
          severity: "info",
          message: `Epistemology rule ${output.ruleId} did not fire in the last ${output.windowDays} days`,
        },
      ]
    }

    return [
      {
        severity: output.blockingCount > 0 ? "warn" : "info",
        message: `Epistemology rule ${output.ruleId} fired ${output.firingCount} time(s) in the last ${output.windowDays} days`,
        location:
          output.latestPaths[0] === undefined ? undefined : { file: output.latestPaths[0] },
        data: {
          ruleId: output.ruleId,
          firingCount: output.firingCount,
          blockingCount: output.blockingCount,
        },
      },
    ]
  },
})

const readPolicyViolationPackets = async (
  repoPath: string,
): Promise<ReadonlyArray<PolicyViolationPacket>> => {
  const messagesDir = join(repoPath, ".agents", "messages")
  if (!(await fileExists(messagesDir))) return []

  const files = await readdir(messagesDir)
  const packets: Array<PolicyViolationPacket> = []
  for (const fileName of files) {
    if (!fileName.endsWith(".json") || !fileName.includes("epistemology-framework-policy-")) {
      continue
    }
    const filePath = join(messagesDir, fileName)
    try {
      const content = JSON.parse(await readFile(filePath, "utf8")) as {
        readonly content?: { readonly data?: { readonly rule_id?: unknown; readonly message?: unknown; readonly paths?: unknown } }
        readonly metadata?: { readonly timestamp?: unknown; readonly schema_id?: unknown; readonly blocking?: unknown }
      }
      if (content.metadata?.schema_id !== POLICY_PACKET_SCHEMA_ID) continue
      const ruleId =
        typeof content.content?.data?.rule_id === "string"
          ? content.content.data.rule_id
          : undefined
      const timestamp =
        typeof content.metadata?.timestamp === "string"
          ? content.metadata.timestamp
          : undefined
      if (ruleId === undefined || timestamp === undefined) continue
      packets.push({
        ruleId,
        timestamp,
        blocking: content.metadata?.blocking === true,
        message:
          typeof content.content?.data?.message === "string"
            ? content.content.data.message
            : "",
        paths: Array.isArray(content.content?.data?.paths)
          ? content.content?.data?.paths.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : [],
      })
    } catch {
      continue
    }
  }

  return packets.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
