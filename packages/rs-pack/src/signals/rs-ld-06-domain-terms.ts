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
import { type RustProject, RustProjectTag } from "../project.js"
import { itemKind, itemName } from "../rust-analysis-syntax.js"
import { parseRustFile, type RustSyntaxNode } from "../syn-walker.js"
import { isExcluded } from "./shared-globs.js"
import { asUnknownRecord } from "./shared-record-guards.js"
import {
  allNamedChildren,
  DEFAULT_RUST_EXCLUDE_GLOBS,
  firstNamedChild,
  modulePathForAncestors,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"

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
  readonly kind: "item" | "function" | "parameter"
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
  readonly referenceDataStatus: "loaded" | "missing" | "empty"
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

interface GlossaryVariant {
  readonly canonical: string
  readonly tokens: ReadonlyArray<string>
  readonly tokenSet: ReadonlySet<string>
}

interface GlossaryLookup {
  readonly knownPhrases: ReadonlySet<string>
  readonly knownTokens: ReadonlySet<string>
  readonly canonicalBySortedTokens: ReadonlyMap<string, string>
  readonly variants: ReadonlyArray<GlossaryVariant>
}

interface ConflictCandidate {
  readonly canonical: string
  readonly overlapCount: number
  readonly distance: number
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
  cacheVersion: "domain-terms-config-reference-data-applicability-diagnostics-cfg-test-aliases-v4",
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
          const activeIdentifierKeys = await collectActiveIdentifierKeys(project, analyzedSourceFiles)
          const identifiers = facts.identifiers.filter((identifier) =>
            activeIdentifierKeys.has(identifierKey(identifier)) &&
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
          if (glossary.length === 0) {
            return {
              identifiers: [],
              totalIdentifiers: identifiers.length,
              matchCount: 0,
              newUniqueCount: 0,
              duplicateCount: 0,
              conflictCount: 0,
              referenceDataStatus: "empty",
              sourceFileCount: project.sourceFiles.length,
              analyzedSourceFileCount: analyzedSourceFiles.length,
              diagnosticLimit: normalizedConfig.top_n_diagnostics,
              scoreMode: RS_LD_06_SCORE_MODE,
              scoreDenominator: RS_LD_06_SCORE_DENOMINATOR,
              weightedTermDriftPressure: 0,
            }
          }

          const glossaryLookup = buildGlossaryLookup(glossary)
          const classified = identifiers.map((identifier) =>
            classifyIdentifier(identifier.name, identifier.tokens, glossaryLookup, {
              file: identifier.file,
              module: identifier.modulePath,
              kind: identifier.kind,
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
    if (out.referenceDataStatus !== "loaded" || out.totalIdentifiers === 0) return 1
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

    if (out.referenceDataStatus === "empty") {
      return [
        {
          severity: "warn",
          message: "RS-LD-06 requires non-empty glossary reference data; loaded glossary has no terms",
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

    return [...out.identifiers]
      .filter((identifier) => identifier.classification !== "matches-glossary")
      .sort(compareIdentifierDiagnostics)
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
    if (out.sourceFileCount === 0 || out.referenceDataStatus !== "loaded") {
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

const collectActiveIdentifierKeys = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> => {
  const keys = new Set<string>()

  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated) return
      const kind = itemKind(node)
      const name = kind === undefined ? undefined : itemName(node)
      if (kind === undefined || name === undefined) return

      const { modulePath } = modulePathForAncestors(scope, ancestors)
      const line = node.startPosition.row + 1
      keys.add(identifierKey({
        file,
        modulePath,
        line,
        kind: kind === "fn" ? "function" : "item",
        name,
      }))

      if (kind !== "fn") return
      for (const parameterName of collectParameterIdentifiers(node)) {
        keys.add(identifierKey({
          file,
          modulePath,
          line,
          kind: "parameter",
          name: parameterName,
        }))
      }
    })
  }

  return keys
}

const collectParameterIdentifiers = (node: RustSyntaxNode): ReadonlyArray<string> =>
  allNamedChildren(firstNamedChild(node, "parameters") ?? node, "parameter")
    .map((parameter) => firstNamedChild(parameter, "identifier")?.text)
    .filter((name): name is string => name !== undefined)

const identifierKey = (identifier: {
  readonly file: string
  readonly modulePath: string
  readonly line: number
  readonly kind: string
  readonly name: string
}): string => `${identifier.file}:${identifier.line}:${identifier.modulePath}:${identifier.kind}:${identifier.name}`

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

const buildGlossaryLookup = (glossary: ReadonlyArray<GlossaryEntry>): GlossaryLookup => {
  const knownPhrases = new Set<string>()
  const knownTokens = new Set<string>()
  const canonicalBySortedTokens = new Map<string, string>()
  const variants: Array<GlossaryVariant> = []

  for (const entry of glossary) {
    const canonicalTokens = tokenizeIdentifier(entry.canonical)
    if (canonicalTokens.length > 0) {
      knownPhrases.add(canonicalTokens.join(" "))
      canonicalBySortedTokens.set(sortTokens(entry.canonical), entry.canonical)
      canonicalTokens.forEach((token) => knownTokens.add(token))
      variants.push({
        canonical: entry.canonical,
        tokens: canonicalTokens,
        tokenSet: new Set(canonicalTokens),
      })
    }

    for (const alias of entry.aliases) {
      const aliasTokens = tokenizeIdentifier(alias)
      if (aliasTokens.length === 0) continue
      knownPhrases.add(aliasTokens.join(" "))
      aliasTokens.forEach((token) => knownTokens.add(token))
      variants.push({
        canonical: entry.canonical,
        tokens: aliasTokens,
        tokenSet: new Set(aliasTokens),
      })
    }
  }

  return { knownPhrases, knownTokens, canonicalBySortedTokens, variants }
}

const classifyIdentifier = (
  name: string,
  tokens: ReadonlyArray<string>,
  glossaryLookup: GlossaryLookup,
  context: {
    readonly file: string
    readonly module: string
    readonly kind: "item" | "function" | "parameter"
    readonly line: number
  },
): IdentifierGlossaryMatch => {
  const normalized = tokens.join(" ")

  let classification: IdentifierClassification = "new-unique"
  let suggestedCanonical: string | undefined

  if (normalized.length > 0 && glossaryLookup.knownPhrases.has(normalized)) {
    classification = "matches-glossary"
  } else {
    const duplicateCanonical = glossaryLookup.canonicalBySortedTokens.get(sortTokens(name))
    if (duplicateCanonical !== undefined) {
      classification = "duplicates-canonical"
      suggestedCanonical = duplicateCanonical
    } else if (
      tokens.length > 0 &&
      tokens.every((token) => glossaryLookup.knownTokens.has(token))
    ) {
      classification = "matches-glossary"
    } else {
      const conflicting = findConflictCandidate(tokens, glossaryLookup.variants)
      if (conflicting !== undefined) {
        classification = "conflicts-with-canonical"
        suggestedCanonical = conflicting.canonical
      }
    }
  }

  return {
    file: context.file,
    module: context.module,
    kind: context.kind,
    name,
    line: context.line,
    classification,
    suggestedCanonical,
  }
}

const findConflictCandidate = (
  identifierTokens: ReadonlyArray<string>,
  variants: ReadonlyArray<GlossaryVariant>,
): ConflictCandidate | undefined => {
  let best: ConflictCandidate | undefined

  for (const variant of variants) {
    if (identifierTokens.length === 0 || variant.tokens.length === 0) continue

    const overlapCount = identifierTokens.filter((token) => variant.tokenSet.has(token)).length
    const nonOverlappingTokens = identifierTokens.filter((token) => !variant.tokenSet.has(token))
    const distance = minimumTokenDistance(
      nonOverlappingTokens.length > 0 ? nonOverlappingTokens : identifierTokens,
      variant.tokens,
    )
    const singleTokenNearMiss =
      identifierTokens.length === 1 && variant.tokens.length === 1 && distance <= 1
    const overlapNearMiss = overlapCount > 0 && nonOverlappingTokens.length > 0 && distance <= 1

    if (!singleTokenNearMiss && !overlapNearMiss) continue

    const candidate: ConflictCandidate = {
      canonical: variant.canonical,
      overlapCount,
      distance,
    }

    if (best === undefined || compareConflictCandidates(candidate, best) < 0) {
      best = candidate
    }
  }

  return best
}

const compareConflictCandidates = (
  left: ConflictCandidate,
  right: ConflictCandidate,
): number => {
  if (left.overlapCount !== right.overlapCount) {
    return right.overlapCount - left.overlapCount
  }
  if (left.distance !== right.distance) {
    return left.distance - right.distance
  }
  return left.canonical.localeCompare(right.canonical)
}

const compareIdentifierDiagnostics = (
  left: IdentifierGlossaryMatch,
  right: IdentifierGlossaryMatch,
): number => {
  const leftPressure = classificationPressure(left.classification)
  const rightPressure = classificationPressure(right.classification)
  if (leftPressure !== rightPressure) return rightPressure - leftPressure
  return left.file.localeCompare(right.file) || left.line - right.line || left.name.localeCompare(right.name)
}

const classificationPressure = (classification: IdentifierClassification): number => {
  switch (classification) {
    case "conflicts-with-canonical":
      return 3
    case "duplicates-canonical":
      return 2
    case "new-unique":
      return 1
    case "matches-glossary":
      return 0
  }
}

const minimumTokenDistance = (
  leftTokens: ReadonlyArray<string>,
  rightTokens: ReadonlyArray<string>,
): number => {
  let best = Number.POSITIVE_INFINITY

  for (const left of leftTokens) {
    for (const right of rightTokens) {
      best = Math.min(best, levenshteinDistance(left, right))
    }
  }

  return best
}

const sortTokens = (value: string): string => tokenizeIdentifier(value).slice().sort().join(" ")
