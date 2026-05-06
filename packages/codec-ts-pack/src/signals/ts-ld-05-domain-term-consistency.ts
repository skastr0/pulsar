import {
  type Diagnostic,
  type Glossary,
  levenshteinDistance,
  ReferenceDataTag,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Option, Schema } from "effect"
import { splitIdentifierTokens } from "../casing.js"
import { TsProjectTag } from "../ts-project.js"
import {
  collectIdentifierDeclarations,
  type IdentifierDeclarationKind,
} from "./shared-identifiers.js"

export const TsLd05Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsLd05Config = typeof TsLd05Config.Type

export type IdentifierClassification =
  | "matches-glossary"
  | "new-unique"
  | "duplicates-canonical"
  | "conflicts-with-canonical"

export interface IdentifierGlossaryMatch {
  readonly file: string
  readonly line: number
  readonly kind: IdentifierDeclarationKind
  readonly name: string
  readonly classification: IdentifierClassification
  readonly suggestedCanonical: string | undefined
}

export interface TsLd05Output {
  readonly identifiers: ReadonlyArray<IdentifierGlossaryMatch>
  readonly totalIdentifiers: number
  readonly matchCount: number
  readonly newUniqueCount: number
  readonly duplicateCount: number
  readonly conflictCount: number
  readonly referenceDataStatus: "loaded" | "missing"
  readonly diagnosticLimit: number
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

export const TsLd05: Signal<TsLd05Config, TsLd05Output, TsProjectTag | ReferenceDataTag> = {
  id: "TS-LD-05",
  tier: 2,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "reference-data-applicability-v1",
  configSchema: TsLd05Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const referenceData = yield* ReferenceDataTag

      return yield* Effect.try({
        try: (): TsLd05Output => {
          const identifiers = collectIdentifierDeclarations(project, config.exclude_globs)
          const rawGlossary = Effect.runSync(referenceData.get<Glossary>("glossary"))

          if (Option.isNone(rawGlossary)) {
            return {
              identifiers: [],
              totalIdentifiers: identifiers.length,
              matchCount: 0,
              newUniqueCount: 0,
              duplicateCount: 0,
              conflictCount: 0,
              referenceDataStatus: "missing",
              diagnosticLimit: config.top_n_diagnostics,
            }
          }

          const glossaryLookup = buildGlossaryLookup(rawGlossary.value)
          const classified = identifiers.map((identifier) =>
            classifyIdentifier(identifier, glossaryLookup),
          )

          return {
            identifiers: classified,
            totalIdentifiers: identifiers.length,
            matchCount: classified.filter((item) => item.classification === "matches-glossary").length,
            newUniqueCount: classified.filter((item) => item.classification === "new-unique").length,
            duplicateCount: classified.filter(
              (item) => item.classification === "duplicates-canonical",
            ).length,
            conflictCount: classified.filter(
              (item) => item.classification === "conflicts-with-canonical",
            ).length,
            referenceDataStatus: "loaded",
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-05",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.referenceDataStatus === "missing" || out.totalIdentifiers === 0) return 1

    const penalty = out.conflictCount * 0.9 + out.duplicateCount * 0.5 + out.newUniqueCount * 0.15
    return Math.max(0, 1 - penalty / out.totalIdentifiers)
  },
  outputMetadata: (out) =>
    out.referenceDataStatus === "missing"
      ? { applicability: "insufficient_evidence" as const }
      : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.referenceDataStatus === "missing") {
      return [{ severity: "info", message: "no glossary configured" }]
    }

    return out.identifiers
      .filter((identifier) => identifier.classification !== "matches-glossary")
      .slice(0, out.diagnosticLimit)
      .map((identifier) => ({
        severity:
          identifier.classification === "conflicts-with-canonical"
            ? ("warn" as const)
            : ("info" as const),
        message:
          `Identifier \`${identifier.name}\` classified as ${identifier.classification}` +
          (identifier.suggestedCanonical === undefined
            ? ""
            : ` (suggested canonical: ${identifier.suggestedCanonical})`),
        location: { file: identifier.file, line: identifier.line },
        data: { ...identifier },
      }))
  },
}

const buildGlossaryLookup = (glossary: Glossary): GlossaryLookup => {
  const knownPhrases = new Set<string>()
  const knownTokens = new Set<string>()
  const canonicalBySortedTokens = new Map<string, string>()
  const variants: Array<GlossaryVariant> = []

  for (const entry of glossary.terms) {
    const canonicalTokens = splitIdentifierTokens(entry.canonical)
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
      const aliasTokens = splitIdentifierTokens(alias)
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
  identifier: ReturnType<typeof collectIdentifierDeclarations>[number],
  glossaryLookup: GlossaryLookup,
): IdentifierGlossaryMatch => {
  const normalized = identifier.tokens.join(" ")
  let classification: IdentifierClassification = "new-unique"
  let suggestedCanonical: string | undefined

  if (normalized.length > 0 && glossaryLookup.knownPhrases.has(normalized)) {
    classification = "matches-glossary"
  } else {
    const duplicateCanonical = glossaryLookup.canonicalBySortedTokens.get(sortTokens(identifier.name))
    if (duplicateCanonical !== undefined) {
      classification = "duplicates-canonical"
      suggestedCanonical = duplicateCanonical
    } else if (
      identifier.tokens.length > 0 &&
      identifier.tokens.every((token) => glossaryLookup.knownTokens.has(token))
    ) {
      classification = "matches-glossary"
    } else {
      const conflict = findConflictCandidate(identifier.tokens, glossaryLookup.variants)
      if (conflict !== undefined) {
        classification = "conflicts-with-canonical"
        suggestedCanonical = conflict.canonical
      }
    }
  }

  return {
    file: identifier.file,
    line: identifier.line,
    kind: identifier.kind,
    name: identifier.name,
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

const sortTokens = (value: string): string => splitIdentifierTokens(value).slice().sort().join(" ")
