import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { type RustProject, RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  firstNamedChild,
  modulePathForAncestors,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { rustAnalysisOutputMetadata } from "./shared-applicability.js"
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
  readonly openDomainScrutinee: boolean
}

interface RsLd03Output {
  readonly matchSites: ReadonlyArray<MatchCatchAllSite>
  readonly totalMatches: number
  readonly matchesWithCatchAll: number
  readonly openDomainExemptMatches: number
  readonly totalCatchAllArms: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly diagnosticLimit: number
  readonly scoreMode: "closed-domain-catch-all-match-share"
  readonly scoreDenominator: "analyzed-match-expressions"
  readonly catchAllMatchShare: number
  readonly weightedCatchAllPressure: number
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_LD_03_SCORE_MODE = "closed-domain-catch-all-match-share" as const
const RS_LD_03_SCORE_DENOMINATOR = "analyzed-match-expressions" as const

const RS_LD_03_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.core_logic_globs",
    title: "Config core logic globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsLd03: Signal<RsLd03Config, RsLd03Output, RustProjectTag> = {
  id: "RS-LD-03-match-catch-all",
  title: "Match catch-all usage",
  aliases: ["RS-LD-03"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "match-catch-all-open-domain-guarded-arms-v6-inner-attr-gating",
  configSchema: RsLd03Config,
  factorDefinitions: RS_LD_03_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    core_logic_globs: [],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsLd03Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd03Output> => {
          const facts = await collectRustProjectFacts(project)
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) =>
              !isExcluded(file, normalizedConfig.exclude_globs) &&
              (normalizedConfig.core_logic_globs.length === 0 ||
                matchesAnyGlob(file, normalizedConfig.core_logic_globs)),
          )
          const analyzedSourceFileSet = new Set(analyzedSourceFiles)
          const activeMatchKeys = await collectActiveMatchKeys(project, analyzedSourceFiles)
          const matchSites = facts.matches
            .filter((site) =>
              analyzedSourceFileSet.has(site.file) &&
              activeMatchKeys.has(matchSiteKey(site))
            )
            .map((site) => ({
              file: site.file,
              module: site.modulePath,
              functionName: site.functionName,
              line: site.line,
              armCount: site.armCount,
              catchAllArmCount: site.catchAllArmCount,
              // Literal arms (chars, strings, numbers) mean an open-domain
              // scrutinee where the compiler requires the catch-all; only
              // closed-domain (enum-style) wildcards erode exhaustiveness.
              openDomainScrutinee: site.literalArmCount > 0,
            }))
            .sort((a, b) => b.catchAllArmCount - a.catchAllArmCount || a.file.localeCompare(b.file))
          const scoringSites = matchSites.filter((site) => !site.openDomainScrutinee)
          const matchesWithCatchAll = scoringSites.filter((site) => site.catchAllArmCount > 0).length
          const catchAllMatchShare = ratio(matchesWithCatchAll, matchSites.length)

          return {
            matchSites,
            totalMatches: matchSites.length,
            matchesWithCatchAll,
            openDomainExemptMatches: matchSites.length - scoringSites.length,
            totalCatchAllArms: matchSites.reduce((sum, site) => sum + site.catchAllArmCount, 0),
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            scoreMode: RS_LD_03_SCORE_MODE,
            scoreDenominator: RS_LD_03_SCORE_DENOMINATOR,
            catchAllMatchShare,
            // 1x share: catch-all prevalence is taste-grade evidence; the old
            // 2x multiplier doubled damage on a heuristic measurement.
            weightedCatchAllPressure: Math.min(1, catchAllMatchShare),
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-03-match-catch-all", message: String(cause), cause }),
      })
    }),
  score: (out) => Math.max(0, 1 - out.weightedCatchAllPressure),
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-LD-03 found no Rust source files for match catch-all analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          totalMatches: out.totalMatches,
          matchesWithCatchAll: out.matchesWithCatchAll,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.matchSites
      .filter((site) => site.catchAllArmCount > 0 && !site.openDomainScrutinee)
      .slice(0, out.diagnosticLimit)
      .map((site) => ({
        severity: "warn" as const,
        message: `Match in ${site.functionName} uses ${site.catchAllArmCount} catch-all arm(s)`,
        location: { file: site.file, line: site.line },
        data: {
          ...site,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }))
  },
  outputMetadata: (out) =>
    rustAnalysisOutputMetadata({
      sourceFileCount: out.sourceFileCount,
      analyzedItemCount: out.analyzedSourceFileCount,
      evidenceItemCount: out.totalMatches,
    }),
  factorLedger: () => makeRsLd03FactorLedger(),
}

type NormalizedRsLd03Config = RsLd03Config

const normalizeRsLd03Config = (config: RsLd03Config): NormalizedRsLd03Config => ({
  exclude_globs: config.exclude_globs,
  core_logic_globs: config.core_logic_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsLd03FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-LD-03-match-catch-all", RS_LD_03_FACTOR_DEFINITIONS)

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

const collectActiveMatchKeys = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> => {
  const keys = new Set<string>()
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated || node.type !== "match_expression") return
      const functionNode = [...ancestors].reverse().find((ancestor) => ancestor.type === "function_item")
      const functionName = functionNode === undefined
        ? "<unknown>"
        : firstNamedChild(functionNode, "identifier")?.text ?? "<anonymous>"
      const { modulePath } = modulePathForAncestors(scope, ancestors)
      keys.add(matchSiteKey({
        file,
        modulePath,
        functionName,
        line: node.startPosition.row + 1,
      }))
    })
  }
  return keys
}

const matchSiteKey = (site: {
  readonly file: string
  readonly modulePath: string
  readonly functionName: string
  readonly line: number
}): string => `${site.file}:${site.line}:${site.modulePath}::${site.functionName}`
