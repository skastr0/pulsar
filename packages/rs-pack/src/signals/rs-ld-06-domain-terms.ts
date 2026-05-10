import {
  Option,
  Effect,
  Schema,
} from "effect"
import {
  type Diagnostic,
  levenshteinDistance,
  ReferenceDataTag,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { collectRustProjectFacts, tokenizeIdentifier } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { isExcluded } from "./shared-globs.js"

export const RsLd06Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type RsLd06Config = typeof RsLd06Config.Type

type IdentifierClassification =
  | "matches-glossary"
  | "new-unique"
  | "duplicates-canonical"
  | "conflicts-with-canonical"

export interface IdentifierGlossaryMatch {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly classification: IdentifierClassification
  readonly suggestedCanonical: string | undefined
}

export interface RsLd06Output {
  readonly identifiers: ReadonlyArray<IdentifierGlossaryMatch>
  readonly matchCount: number
  readonly newUniqueCount: number
  readonly duplicateCount: number
  readonly conflictCount: number
  readonly referenceDataStatus: "loaded" | "missing"
}

interface GlossaryEntry {
  readonly canonical: string
  readonly aliases: ReadonlyArray<string>
}

export const RsLd06: Signal<RsLd06Config, RsLd06Output, RustProjectTag | ReferenceDataTag> = {
  id: "RS-LD-06-domain-term-consistency",
  title: "Domain term consistency",
  aliases: ["RS-LD-06"],
  tier: 2,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: RsLd06Config,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      const referenceData = yield* ReferenceDataTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd06Output> => {
          const facts = await collectRustProjectFacts(project)
          const identifiers = facts.identifiers.filter((identifier) => !isExcluded(identifier.file, config.exclude_globs))
          const rawGlossary = await Effect.runPromise(referenceData.get<unknown>("glossary"))
          if (Option.isNone(rawGlossary)) {
            return {
              identifiers: [],
              matchCount: 0,
              newUniqueCount: 0,
              duplicateCount: 0,
              conflictCount: 0,
              referenceDataStatus: "missing",
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

          return {
            identifiers: classified,
            matchCount: classified.filter((item) => item.classification === "matches-glossary").length,
            newUniqueCount: classified.filter((item) => item.classification === "new-unique").length,
            duplicateCount: classified.filter((item) => item.classification === "duplicates-canonical").length,
            conflictCount: classified.filter((item) => item.classification === "conflicts-with-canonical").length,
            referenceDataStatus: "loaded",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-06-domain-term-consistency", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const total = out.identifiers.length
    if (total === 0) return 1
    const penalty = out.conflictCount * 0.8 + out.duplicateCount * 0.5 + out.newUniqueCount * 0.2
    return Math.max(0, 1 - penalty / total)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.referenceDataStatus === "missing") {
      return [
        {
          severity: "warn",
          message: "RS-LD-06 requires glossary reference data; no glossary was loaded",
        },
      ]
    }

    return out.identifiers
      .filter((identifier) => identifier.classification !== "matches-glossary")
      .slice(0, 10)
      .map((identifier) => ({
        severity: identifier.classification === "conflicts-with-canonical" ? ("warn" as const) : ("info" as const),
        message: `Identifier ${identifier.name} classified as ${identifier.classification}${identifier.suggestedCanonical ? ` (suggested: ${identifier.suggestedCanonical})` : ""}`,
        location: { file: identifier.file, line: identifier.line },
        data: { ...identifier },
      }))
  },
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const normalizeGlossary = (raw: unknown): ReadonlyArray<GlossaryEntry> => {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => normalizeGlossaryEntry(entry))
  }
  const record = asRecord(raw)
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
  const record = asRecord(entry)
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
