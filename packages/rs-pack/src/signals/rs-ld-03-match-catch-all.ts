import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"

const RsLd03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  core_logic_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsLd03Config = typeof RsLd03Config.Type

interface MatchCatchAllSite {
  readonly file: string
  readonly module: string
  readonly functionName: string
  readonly line: number
  readonly armCount: number
  readonly catchAllArmCount: number
}

interface RsLd03Output {
  readonly matchSites: ReadonlyArray<MatchCatchAllSite>
  readonly totalMatches: number
  readonly matchesWithCatchAll: number
  readonly totalCatchAllArms: number
}

export const RsLd03: Signal<RsLd03Config, RsLd03Output, RustProjectTag> = {
  id: "RS-LD-03-match-catch-all",
  title: "Match catch-all usage",
  aliases: ["RS-LD-03"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: RsLd03Config,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    core_logic_globs: [],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd03Output> => {
          const facts = await collectRustProjectFacts(project)
          const matchSites = facts.matches
            .filter((site) => !isExcluded(site.file, config.exclude_globs))
            .filter(
              (site) =>
                config.core_logic_globs.length === 0 ||
                matchesAnyGlob(site.file, config.core_logic_globs),
            )
            .map((site) => ({
              file: site.file,
              module: site.modulePath,
              functionName: site.functionName,
              line: site.line,
              armCount: site.armCount,
              catchAllArmCount: site.catchAllArmCount,
            }))
            .sort((a, b) => b.catchAllArmCount - a.catchAllArmCount || a.file.localeCompare(b.file))

          return {
            matchSites,
            totalMatches: matchSites.length,
            matchesWithCatchAll: matchSites.filter((site) => site.catchAllArmCount > 0).length,
            totalCatchAllArms: matchSites.reduce((sum, site) => sum + site.catchAllArmCount, 0),
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-03-match-catch-all", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalMatches === 0) return 1
    return Math.max(0, 1 - (out.matchesWithCatchAll / out.totalMatches) * 2)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.matchSites
      .filter((site) => site.catchAllArmCount > 0)
      .slice(0, 10)
      .map((site) => ({
        severity: "warn" as const,
        message: `Match in ${site.functionName} uses ${site.catchAllArmCount} catch-all arm(s)`,
        location: { file: site.file, line: site.line },
        data: { ...site },
      })),
}
