import {
  levenshteinDistance,
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import { ReferenceDataTag } from "@skastr0/pulsar-core/reference-data"
import {
  Option,
  Effect,
  Schema,
} from "effect"
import { collectRustProjectFacts, tokenizeIdentifier } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { isExcluded } from "./shared-globs.js"
import { asUnknownRecord } from "./shared-record-guards.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"

const RsLd06Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsLd06Config = typeof RsLd06Config.Type

type IdentifierClassification =
  | "matches-glossary"
  | "new-unique"
  | "duplicates-canonical"
  | "conflicts-with-canonical"

interface IdentifierGlossaryMatch {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly classification: IdentifierClassification
  readonly suggestedCanonical: string | undefined
}

interface RsLd06Output {
  readonly identifiers: ReadonlyArray<IdentifierGlossaryMatch>
  readonly totalIdentifiers: number
  readonly matchCount: number
  readonly newUniqueCount: number
  readonly duplicateCount: number
  readonly conflictCount: number
  readonly referenceDataStatus: "loaded" | "missing"
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly diagnosticLimit: number
  readonly scoreMode: "weighted-domain-term-drift-share"
  readonly scoreDenominator: "classified-identifiers"
  readonly weightedTermDriftPressure: number
}

interface GlossaryEntry {
  readonly canonical: string
  readonly aliases: ReadonlyArray<string>
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_LD_06_SCORE_MODE = "weighted-domain-term-drift-share" as const
const RS_LD_06_SCORE_DENOMINATOR = "classified-identifiers" as const

const RsLd06FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsLd06: Signal<RsLd06Config, RsLd06Output, RustProjectTag | ReferenceDataTag> = {
  id: "RS-LD-06-domain-term-consistency",
  title: "Domain term consistency",
  aliases: ["RS-LD-06"],
  tier: 2,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "domain-terms-config-reference-data-applicability-diagnostics-v1",
  configSchema: RsLd06Config,
  factorDefinitions: RsLd06FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsLd06Config(config)
      const project = yield* RustProjectTag
      const referenceData = yield* ReferenceDataTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd06Output> => {
          const facts = await collectRustProjectFacts(project)
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          const analyzedSourceFileSet = new Set(analyzedSourceFiles)
          const identifiers = facts.identifiers.filter((identifier) =>
            analyzedSourceFileSet.has(identifier.file) &&
            identifier.tokens.length > 0
          )
          const rawGlossary = await Effect.runPromise(referenceData.get<unknown>("glossary"))
          if (Option.isNone(rawGlossary)) {
            return {
              identifiers: [],
              totalIdentifiers: identifiers.length,
              matchCount: 0,
              newUniqueCount: 0,
              duplicateCount: 0,
              conflictCount: 0,
              referenceDataStatus: "missing",
              sourceFileCount: project.sourceFiles.length,
              analyzedSourceFileCount: analyzedSourceFiles.length,
              diagnosticLimit: normalizedConfig.top_n_diagnostics,
              scoreMode: RS_LD_06_SCORE_MODE,
              scoreDenominator: RS_LD_06_SCORE_DENOMINATOR,
              weightedTermDriftPressure: 0,
            }
          }

          const glossary = normalizeGlossary(rawGlossary.value)
          const classified = identifiers.map((identifier) =>
            classifyIdentifier(identifier.name, glossary, {
              file: identifier.file,
              module: identifier.modulePath,
              line: identifier.line,
            }),
          )
          const conflictCount = classified.filter((item) => item.classification === "conflicts-with-canonical").length
          const duplicateCount = classified.filter((item) => item.classification === "duplicates-canonical").length
          const newUniqueCount = classified.filter((item) => item.classification === "new-unique").length

          return {
            identifiers: classified,
            totalIdentifiers: classified.length,
            matchCount: classified.filter((item) => item.classification === "matches-glossary").length,
            newUniqueCount,
            duplicateCount,
            conflictCount,
            referenceDataStatus: "loaded",
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            scoreMode: RS_LD_06_SCORE_MODE,
            scoreDenominator: RS_LD_06_SCORE_DENOMINATOR,
            weightedTermDriftPressure: weightedTermDriftPressure({
              totalIdentifiers: classified.length,
              conflictCount,
              duplicateCount,
              newUniqueCount,
            }),
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-06-domain-term-consistency", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.referenceDataStatus === "missing" || out.totalIdentifiers === 0) return 1
    return Math.max(0, 1 - out.weightedTermDriftPressure)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.referenceDataStatus === "missing") {
      return [
        {
          severity: "warn",
          message: "RS-LD-06 requires glossary reference data; no glossary was loaded",
          data: {
            sourceFileCount: out.sourceFileCount,
            analyzedSourceFileCount: out.analyzedSourceFileCount,
            totalIdentifiers: out.totalIdentifiers,
            scoreMode: out.scoreMode,
            scoreDenominator: out.scoreDenominator,
          },
        },
      ].slice(0, out.diagnosticLimit)
    }

    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-LD-06 found no Rust source files for domain term analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          totalIdentifiers: out.totalIdentifiers,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
    }

    return out.identifiers
      .filter((identifier) => identifier.classification !== "matches-glossary")
      .slice(0, out.diagnosticLimit)
      .map((identifier) => ({
        severity: identifier.classification === "conflicts-with-canonical" ? ("warn" as const) : ("info" as const),
        message: `Identifier ${identifier.name} classified as ${identifier.classification}${identifier.suggestedCanonical ? ` (suggested: ${identifier.suggestedCanonical})` : ""}`,
        location: { file: identifier.file, line: identifier.line },
        data: {
          ...identifier,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }))
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0 || out.referenceDataStatus === "missing") {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.totalIdentifiers === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsLd06FactorLedger(),
}

type NormalizedRsLd06Config = RsLd06Config

const normalizeRsLd06Config = (config: RsLd06Config): NormalizedRsLd06Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsLd06FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-LD-06-domain-term-consistency",
    RsLd06FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const weightedTermDriftPressure = (counts: {
  readonly totalIdentifiers: number
  readonly conflictCount: number
  readonly duplicateCount: number
  readonly newUniqueCount: number
}): number => {
  if (counts.totalIdentifiers === 0) return 0
  const penalty = counts.conflictCount * 0.8 + counts.duplicateCount * 0.5 + counts.newUniqueCount * 0.2
  return Math.min(1, penalty / counts.totalIdentifiers)
}

const normalizeGlossary = (raw: unknown): ReadonlyArray<GlossaryEntry> => {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => normalizeGlossaryEntry(entry))
  }
  const record = asUnknownRecord(raw)
  if (record === undefined) return []
  if (Array.isArray(record.terms)) {
    return record.terms.flatMap((entry) => normalizeGlossaryEntry(entry))
  }
  if (Array.isArray(record.canonical_terms)) {
    return record.canonical_terms.flatMap((entry) => normalizeGlossaryEntry(entry))
  }
  return Object.entries(record).flatMap(([canonical, aliases]) =>
    normalizeGlossaryEntry({ canonical, aliases }),
  )
}

const normalizeGlossaryEntry = (entry: unknown): ReadonlyArray<GlossaryEntry> => {
  if (typeof entry === "string") {
    return [{ canonical: entry, aliases: [] }]
  }
  const record = asUnknownRecord(entry)
  if (record === undefined || typeof record.canonical !== "string") return []
  return [
    {
      canonical: record.canonical,
      aliases:
        Array.isArray(record.aliases) && record.aliases.every((alias) => typeof alias === "string")
          ? (record.aliases as ReadonlyArray<string>)
          : [],
    },
  ]
}

const classifyIdentifier = (
  name: string,
  glossary: ReadonlyArray<GlossaryEntry>,
  context: { readonly file: string; readonly module: string; readonly line: number },
): IdentifierGlossaryMatch => {
  const tokens = tokenizeIdentifier(name)
  const normalized = tokens.join(" ")
  const knownPhrases = new Set(
    glossary.flatMap((entry) => [entry.canonical, ...entry.aliases]).map((value) => tokenizeIdentifier(value).join(" ")),
  )
  const canonicalBySortedTokens = new Map(
    glossary.map((entry) => [sortTokens(entry.canonical), entry.canonical] as const),
  )
  const knownTokens = new Set(
    glossary.flatMap((entry) => tokenizeIdentifier(entry.canonical)).filter((token) => token.length > 0),
  )
  const unknownTokens = tokens.filter((token) => !knownTokens.has(token))

  let classification: IdentifierClassification = "new-unique"
  let suggestedCanonical: string | undefined

  if (knownPhrases.has(normalized)) {
    classification = "matches-glossary"
  } else {
    const duplicateCanonical = canonicalBySortedTokens.get(sortTokens(name))
    if (duplicateCanonical !== undefined) {
      classification = "duplicates-canonical"
      suggestedCanonical = duplicateCanonical
    } else if (tokens.every((token) => knownTokens.has(token))) {
      classification = "matches-glossary"
    } else {
      const conflicting = glossary.find((entry) =>
        unknownTokens.some((candidate) =>
          tokenizeIdentifier(entry.canonical).some(
            (token) => levenshteinDistance(token, candidate) <= 1,
          ),
        ),
      )
      if (conflicting !== undefined) {
        classification = "conflicts-with-canonical"
        suggestedCanonical = conflicting.canonical
      }
    }
  }

  return {
    file: context.file,
    module: context.module,
    name,
    line: context.line,
    classification,
    suggestedCanonical,
  }
}

const sortTokens = (value: string): string => tokenizeIdentifier(value).slice().sort().join(" ")
