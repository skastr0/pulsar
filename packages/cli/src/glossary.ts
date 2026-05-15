import {
  CANONICAL_GLOSSARY_RELATIVE_PATH,
  decodeGlossaryDraftSync,
  type GlossaryDraft,
} from "@skastr0/pulsar-core/reference-data"
import { Effect } from "effect"
import {
  applyAutoDecisions,
  buildCandidateTerms,
  buildCanonicalGlossary,
  buildSynonymCandidates,
  validateGlossaryDraftDecisions,
} from "./glossary-model.js"
import { collectIdentifiers } from "./identifier-analysis.js"
import {
  GLOSSARY_DRAFT_STATE_PATH,
  readReferenceStateJson,
  removeReferenceStateFile,
  resolveReferenceStatePath,
  writeReferenceJson,
  writeReferenceStateJson,
} from "./reference-data-file.js"
import { resolveRepoRoot, withDetachedWorktreeAtRef } from "./runtime.js"

interface GlossaryCommandOptions {
  readonly action: "extract" | "confirm"
  readonly repoPath: string
  readonly sha?: string
  readonly includeParameters?: boolean
  readonly autoAcceptAboveFrequency?: number
}

export const runGlossaryCommand = (
  opts: GlossaryCommandOptions,
): Effect.Effect<number, Error, never> =>
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

      const draftPath = yield* writeReferenceStateJson(repoRoot, GLOSSARY_DRAFT_STATE_PATH, draft)
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
    const rawDraft = yield* readReferenceStateJson(repoRoot, GLOSSARY_DRAFT_STATE_PATH)
    const draft = yield* Effect.try({
      try: () => decodeGlossaryDraftSync(rawDraft),
      catch: (cause) =>
        new Error(
          `Failed to decode glossary draft at ${resolveReferenceStatePath(repoRoot, GLOSSARY_DRAFT_STATE_PATH)}: ${String(cause)}`,
        ),
    })

    const draftForConfirmation =
      autoAcceptAboveFrequency === undefined
        ? draft
        : applyAutoDecisions(draft, autoAcceptAboveFrequency)
    yield* validateGlossaryDraftDecisions(draftForConfirmation)
    const glossary = buildCanonicalGlossary(draftForConfirmation)
    const glossaryPath = yield* writeReferenceJson(repoRoot, CANONICAL_GLOSSARY_RELATIVE_PATH, glossary)
    yield* removeReferenceStateFile(repoRoot, GLOSSARY_DRAFT_STATE_PATH)

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
