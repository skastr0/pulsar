import {
  CANONICAL_GLOSSARY_RELATIVE_PATH,
  decodeGlossaryDraftSync,
  decodeGlossarySync,
  type CanonicalGlossaryTerm,
  type GlossaryDraft,
  type GlossaryProvenance,
} from "@taste-codec/core"
import { Effect } from "effect"
import { collectIdentifiers, type IdentifierOccurrence } from "./identifier-analysis.js"
import {
  GLOSSARY_DRAFT_RELATIVE_PATH,
  readReferenceJson,
  removeReferenceFile,
  resolveReferenceDataPath,
  writeReferenceJson,
} from "./reference-data-file.js"
import { resolveRepoRoot, withDetachedWorktreeAtRef } from "./runtime.js"

export interface GlossaryCommandOptions {
  readonly action: "extract" | "confirm"
  readonly repoPath: string
  readonly sha?: string
  readonly includeParameters?: boolean
  readonly autoAcceptAboveFrequency?: number
}

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

export const runGlossaryCommand = (opts: GlossaryCommandOptions) =>
  Effect.gen(function* () {
    if (opts.action === "extract") {
      if (opts.sha === undefined) {
        return yield* Effect.fail(new Error("glossary extract requires --sha <ref>"))
      }
      return yield* runGlossaryExtract(opts.repoPath, opts.sha, opts.includeParameters ?? true)
    }

    return yield* runGlossaryConfirm(opts.repoPath, opts.autoAcceptAboveFrequency)
  })

const runGlossaryExtract = (repoPath: string, sha: string, includeParameters: boolean) =>
  withDetachedWorktreeAtRef(repoPath, sha, ({ repoRoot, resolvedSha, worktreePath }) =>
    Effect.gen(function* () {
      const identifiers = yield* collectIdentifiers(worktreePath, {
        includeParameters,
        includeLocalConstants: false,
      })
      const candidateTerms = buildCandidateTerms(identifiers)
      const candidateSynonyms = buildSynonymCandidates(candidateTerms)
      const draft = decodeGlossaryDraftSync({
        schema_version: 1,
        extracted_at_sha: resolvedSha,
        extracted_at: new Date().toISOString(),
        include_parameter_names: includeParameters,
        candidate_terms: candidateTerms,
        candidate_synonyms: candidateSynonyms,
      })

      const draftPath = yield* writeReferenceJson(repoRoot, GLOSSARY_DRAFT_RELATIVE_PATH, draft)
      console.log("")
      console.log(`  Glossary draft written: ${draftPath}`)
      console.log(`  SHA:                  ${resolvedSha}`)
      console.log(`  Candidate terms:      ${draft.candidate_terms.length}`)
      console.log(`  Synonym candidates:   ${draft.candidate_synonyms.length}`)
      printDraftSummary(draft)
      console.log("")
      return 0
    }),
  )

const runGlossaryConfirm = (repoPath: string, autoAcceptAboveFrequency?: number) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const rawDraft = yield* readReferenceJson(repoRoot, GLOSSARY_DRAFT_RELATIVE_PATH)
    const draft = yield* Effect.try({
      try: () => decodeGlossaryDraftSync(rawDraft),
      catch: (cause) =>
        new Error(
          `Failed to decode glossary draft at ${resolveReferenceDataPath(repoRoot, GLOSSARY_DRAFT_RELATIVE_PATH)}: ${String(cause)}`,
        ),
    })

    const draftForConfirmation =
      autoAcceptAboveFrequency === undefined
        ? draft
        : applyAutoDecisions(draft, autoAcceptAboveFrequency)
    yield* validateGlossaryDraftDecisions(draftForConfirmation)
    const glossary = buildCanonicalGlossary(draftForConfirmation)
    const glossaryPath = yield* writeReferenceJson(repoRoot, CANONICAL_GLOSSARY_RELATIVE_PATH, glossary)
    yield* removeReferenceFile(repoRoot, GLOSSARY_DRAFT_RELATIVE_PATH)

    console.log("")
    console.log(`  Glossary confirmed: ${glossaryPath}`)
    console.log(`  Canonical terms:    ${glossary.terms.length}`)
    console.log(`  Rejected terms:     ${glossary.rejected_terms.length}`)
    if (autoAcceptAboveFrequency !== undefined) {
      console.log(`  Auto decisions:     accepted >= ${autoAcceptAboveFrequency}, rejected below`)
    }
    console.log("")
    return 0
  })

const printDraftSummary = (draft: GlossaryDraft): void => {
  const topTerms = draft.candidate_terms.slice(0, 10)
  if (topTerms.length > 0) {
    console.log("")
    console.log("  Top candidate terms:")
    for (const term of topTerms) {
      const examples = term.provenance
        .slice(0, 2)
        .map((entry) => entry.identifier)
        .join(", ")
      console.log(`    ${term.term} (${term.frequency})${examples === "" ? "" : ` - ${examples}`}`)
    }
  }

  const topSynonyms = draft.candidate_synonyms.slice(0, 5)
  if (topSynonyms.length > 0) {
    console.log("")
    console.log("  Top synonym candidates:")
    for (const synonym of topSynonyms) {
      console.log(
        `    ${synonym.terms.join(" <-> ")} (score ${synonym.score}, context: ${synonym.shared_context_terms.slice(0, 4).join(", ")})`,
      )
    }
  }
}

const buildCandidateTerms = (identifiers: ReadonlyArray<IdentifierOccurrence>) => {
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

const buildSynonymCandidates = (candidateTerms: GlossaryDraft["candidate_terms"]) => {
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

const buildCanonicalGlossary = (draft: GlossaryDraft) => {
  const canonicalTerms = new Map<string, WorkingCanonicalTerm>()
  const rejectedTerms = new Set<string>()

  for (const candidate of draft.candidate_terms) {
    const decision = candidate.decision
    if (decision === undefined) {
      throw new Error(
        [
          `Glossary draft still has undecided terms; first missing decision: '${candidate.term}'.`,
          `Edit ${GLOSSARY_DRAFT_RELATIVE_PATH} and set decision.action to accept, reject, or merge.`,
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

const validateGlossaryDraftDecisions = (draft: GlossaryDraft) =>
  Effect.gen(function* () {
    for (const candidate of draft.candidate_terms) {
      const decision = candidate.decision
      if (decision === undefined) {
        return yield* Effect.fail(
          new Error(
            [
              `Glossary draft still has undecided terms; first missing decision: '${candidate.term}'.`,
              `Edit ${GLOSSARY_DRAFT_RELATIVE_PATH} and set decision.action to accept, reject, or merge.`,
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
            `Candidate term '${candidate.term}' must set decision.merge_into. Edit ${GLOSSARY_DRAFT_RELATIVE_PATH} or rerun confirm with --auto-accept-above-frequency <n>.`,
          ),
        )
      }
      if (target === candidate.term) {
        return yield* Effect.fail(
          new Error(
            `Candidate term '${candidate.term}' cannot merge into itself. Choose a different merge_into target in ${GLOSSARY_DRAFT_RELATIVE_PATH}.`,
          ),
        )
      }
    }
  })

const applyAutoDecisions = (draft: GlossaryDraft, autoAcceptAboveFrequency: number): GlossaryDraft =>
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
    const key = `${entry.package}:${entry.file}:${entry.line ?? -1}:${entry.identifier_kind}:${entry.identifier}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
  }

  return deduped.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    if ((a.line ?? -1) !== (b.line ?? -1)) return (a.line ?? -1) - (b.line ?? -1)
    if (a.identifier !== b.identifier) return a.identifier.localeCompare(b.identifier)
    return a.identifier_kind.localeCompare(b.identifier_kind)
  })
}
