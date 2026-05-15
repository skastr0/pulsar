import {
  type CanonicalGlossaryTerm,
  decodeGlossaryDraftSync,
  decodeGlossarySync,
  type GlossaryDraft,
  type GlossaryProvenance,
} from "@skastr0/pulsar-core/reference-data"
import { Effect } from "effect"
import type { IdentifierOccurrence } from "./identifier-analysis.js"
import { GLOSSARY_DRAFT_STATE_PATH } from "./reference-data-file.js"
import { compareSourceLocationThenFields } from "./source-location-field-order.js"
import { sourceLineNumber } from "./source-location-order.js"

interface WorkingTerm {
  readonly term: string
  readonly normalized: string
  frequency: number
  readonly provenance: Array<GlossaryProvenance>
  readonly coOccursWith: Set<string>
}

interface WorkingCanonicalTerm {
  readonly canonical: string
  frequency: number
  readonly aliases: Set<string>
  readonly provenance: Array<GlossaryProvenance>
}

export const buildCandidateTerms = (
  identifiers: ReadonlyArray<IdentifierOccurrence>,
): GlossaryDraft["candidate_terms"] => {
  const termMap = new Map<string, WorkingTerm>()

  for (const identifier of identifiers) {
    if (identifier.tokens.length === 0) continue
    const uniqueTokens = [...new Set(identifier.tokens)]

    for (const token of uniqueTokens) {
      const occurrenceCount = identifier.tokens.filter((candidate) => candidate === token).length
      const entry = getOrCreateTerm(termMap, token)
      entry.frequency += occurrenceCount
      entry.provenance.push({
        package: identifier.package,
        file: identifier.file,
        ...(identifier.line !== undefined ? { line: identifier.line } : {}),
        identifier: identifier.name,
        identifier_kind: identifier.kind,
      })
      for (const peer of uniqueTokens) {
        if (peer !== token) entry.coOccursWith.add(peer)
      }
    }
  }

  return [...termMap.values()]
    .map((entry) => ({
      term: entry.term,
      normalized: entry.normalized,
      frequency: entry.frequency,
      provenance: sortAndDedupeProvenance(entry.provenance),
      co_occurs_with: [...entry.coOccursWith].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.frequency - a.frequency || a.term.localeCompare(b.term))
}

export const buildSynonymCandidates = (
  candidateTerms: GlossaryDraft["candidate_terms"],
): GlossaryDraft["candidate_synonyms"] => {
  const pairs: Array<GlossaryDraft["candidate_synonyms"][number]> = []

  for (let index = 0; index < candidateTerms.length; index += 1) {
    const left = candidateTerms[index]
    if (left === undefined || left.frequency < 2 || left.co_occurs_with.length === 0) continue
    const leftPeers = new Set(left.co_occurs_with)

    for (let otherIndex = index + 1; otherIndex < candidateTerms.length; otherIndex += 1) {
      const right = candidateTerms[otherIndex]
      if (right === undefined || right.frequency < 2 || right.co_occurs_with.length === 0) continue

      const rightPeers = new Set(right.co_occurs_with)
      const sharedContext = [...leftPeers].filter((peer) => rightPeers.has(peer)).sort()
      if (sharedContext.length === 0) continue

      const unionSize = new Set([...left.co_occurs_with, ...right.co_occurs_with]).size
      const score = sharedContext.length / unionSize
      const frequencyRatio =
        Math.min(left.frequency, right.frequency) / Math.max(left.frequency, right.frequency)
      if (score < 0.75 || frequencyRatio < 0.5) continue

      pairs.push({
        terms: [left.term, right.term],
        score: Number(score.toFixed(3)),
        shared_context_terms: sharedContext,
      })
    }
  }

  return pairs.sort(
    (a, b) => b.score - a.score || a.terms.join("|").localeCompare(b.terms.join("|")),
  )
}

export const buildCanonicalGlossary = (draft: GlossaryDraft): ReturnType<typeof decodeGlossarySync> => {
  const canonicalTerms = new Map<string, WorkingCanonicalTerm>()
  const rejectedTerms = new Set<string>()

  for (const candidate of draft.candidate_terms) {
    const decision = candidate.decision
    if (decision === undefined) {
      throw new Error(
        [
          `Glossary draft still has undecided terms; first missing decision: '${candidate.term}'.`,
          `Edit the Pulsar state draft ${GLOSSARY_DRAFT_STATE_PATH} and set decision.action to accept, reject, or merge.`,
          "For deterministic bulk confirmation, rerun with --auto-accept-above-frequency <n>.",
        ].join(" "),
      )
    }

    if (decision.action === "accept") {
      const entry = getOrCreateCanonicalTerm(canonicalTerms, candidate.term)
      entry.frequency += candidate.frequency
      entry.provenance.push(...candidate.provenance)
      continue
    }

    if (decision.action === "reject") {
      rejectedTerms.add(candidate.term)
      continue
    }

    const target = decision.merge_into?.trim()
    if (target === undefined || target.length === 0) {
      throw new Error(`Candidate term '${candidate.term}' must set decision.merge_into.`)
    }
    if (target === candidate.term) {
      throw new Error(`Candidate term '${candidate.term}' cannot merge into itself.`)
    }

    const entry = getOrCreateCanonicalTerm(canonicalTerms, target)
    entry.frequency += candidate.frequency
    entry.aliases.add(candidate.term)
    entry.provenance.push(...candidate.provenance)
  }

  return decodeGlossarySync({
    schema_version: 1,
    extracted_at_sha: draft.extracted_at_sha,
    confirmed_at: new Date().toISOString(),
    terms: [...canonicalTerms.values()]
      .map((entry): CanonicalGlossaryTerm => ({
        canonical: entry.canonical,
        aliases: [...entry.aliases].sort((a, b) => a.localeCompare(b)),
        frequency: entry.frequency,
        provenance: sortAndDedupeProvenance(entry.provenance),
      }))
      .sort((a, b) => a.canonical.localeCompare(b.canonical)),
    rejected_terms: [...rejectedTerms].sort((a, b) => a.localeCompare(b)),
  })
}

export const validateGlossaryDraftDecisions = (
  draft: GlossaryDraft,
): Effect.Effect<void, Error, never> =>
  Effect.gen(function* () {
    for (const candidate of draft.candidate_terms) {
      const decision = candidate.decision
      if (decision === undefined) {
        return yield* Effect.fail(
          new Error(
            [
              `Glossary draft still has undecided terms; first missing decision: '${candidate.term}'.`,
              `Edit the Pulsar state draft ${GLOSSARY_DRAFT_STATE_PATH} and set decision.action to accept, reject, or merge.`,
              "For deterministic bulk confirmation, rerun with --auto-accept-above-frequency <n>.",
            ].join(" "),
          ),
        )
      }

      if (decision.action !== "merge") continue
      const target = decision.merge_into?.trim()
      if (target === undefined || target.length === 0) {
        return yield* Effect.fail(
          new Error(
            `Candidate term '${candidate.term}' must set decision.merge_into. Edit the Pulsar state draft ${GLOSSARY_DRAFT_STATE_PATH} or rerun confirm with --auto-accept-above-frequency <n>.`,
          ),
        )
      }
      if (target === candidate.term) {
        return yield* Effect.fail(
          new Error(
            `Candidate term '${candidate.term}' cannot merge into itself. Choose a different merge_into target in the Pulsar state draft ${GLOSSARY_DRAFT_STATE_PATH}.`,
          ),
        )
      }
    }
  })

export const applyAutoDecisions = (draft: GlossaryDraft, autoAcceptAboveFrequency: number): GlossaryDraft =>
  decodeGlossaryDraftSync({
    ...draft,
    candidate_terms: draft.candidate_terms.map((candidate) => ({
      ...candidate,
      decision:
        candidate.decision ??
        (candidate.frequency >= autoAcceptAboveFrequency
          ? { action: "accept" as const }
          : { action: "reject" as const }),
    })),
  })

const getOrCreateTerm = (termMap: Map<string, WorkingTerm>, term: string): WorkingTerm => {
  const existing = termMap.get(term)
  if (existing !== undefined) return existing

  const created: WorkingTerm = {
    term,
    normalized: term,
    frequency: 0,
    provenance: [],
    coOccursWith: new Set<string>(),
  }
  termMap.set(term, created)
  return created
}

const getOrCreateCanonicalTerm = (
  canonicalTerms: Map<string, WorkingCanonicalTerm>,
  canonical: string,
): WorkingCanonicalTerm => {
  const existing = canonicalTerms.get(canonical)
  if (existing !== undefined) return existing

  const created: WorkingCanonicalTerm = {
    canonical,
    frequency: 0,
    aliases: new Set<string>(),
    provenance: [],
  }
  canonicalTerms.set(canonical, created)
  return created
}

const sortAndDedupeProvenance = (
  provenance: ReadonlyArray<GlossaryProvenance>,
): Array<GlossaryProvenance> => {
  const seen = new Set<string>()
  const deduped: Array<GlossaryProvenance> = []

  for (const entry of provenance) {
    const key = `${entry.package}:${entry.file}:${sourceLineNumber(entry)}:${entry.identifier_kind}:${entry.identifier}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }

  return deduped.sort((a, b) =>
    compareSourceLocationThenFields(a, b, [
      (entry) => entry.identifier,
      (entry) => entry.identifier_kind,
    ]),
  )
}
