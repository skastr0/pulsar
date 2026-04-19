/**
 * WR-LD-01 — vocabulary drift prototype
 *
 * This file is an exploration artifact for TC-063, not production code.
 * It is intentionally self-contained and dependency-free so the exploration
 * remains inspectable without adding a new NLP stack to the workspace.
 *
 * Goal:
 * - sketch how a prose-domain signal could compare a target document against
 *   a small reference corpus
 * - prove the signal contract shape is plausible outside code analysis
 * - stay honest that scoring quality is unvalidated
 */

export interface VocabularyDriftInput {
  readonly referenceDocuments: ReadonlyArray<string>
  readonly candidateDocument: string
}

export interface VocabularyDriftTerm {
  readonly token: string
  readonly referenceWeight: number
  readonly candidateWeight: number
  readonly delta: number
}

export interface VocabularyDriftResult {
  readonly score: number
  readonly cosineSimilarity: number
  readonly referenceVocabularySize: number
  readonly candidateVocabularySize: number
  readonly topOutlierTerms: ReadonlyArray<VocabularyDriftTerm>
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
])

const tokenize = (text: string): ReadonlyArray<string> =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token))

const termFrequency = (tokens: ReadonlyArray<string>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }

  const total = tokens.length
  const normalized = new Map<string, number>()
  for (const [token, count] of counts) {
    normalized.set(token, total === 0 ? 0 : count / total)
  }
  return normalized
}

const inverseDocumentFrequency = (
  referenceDocuments: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyMap<string, number> => {
  const documentCount = referenceDocuments.length
  const appearances = new Map<string, number>()

  for (const document of referenceDocuments) {
    const unique = new Set(document)
    for (const token of unique) {
      appearances.set(token, (appearances.get(token) ?? 0) + 1)
    }
  }

  const idf = new Map<string, number>()
  for (const [token, count] of appearances) {
    idf.set(token, Math.log((1 + documentCount) / (1 + count)) + 1)
  }
  return idf
}

const tfIdfVector = (
  tf: ReadonlyMap<string, number>,
  idf: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> => {
  const vector = new Map<string, number>()
  for (const [token, frequency] of tf) {
    vector.set(token, frequency * (idf.get(token) ?? 1))
  }
  return vector
}

const cosineSimilarity = (
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): number => {
  const allTokens = new Set<string>([...left.keys(), ...right.keys()])

  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0

  for (const token of allTokens) {
    const leftWeight = left.get(token) ?? 0
    const rightWeight = right.get(token) ?? 0
    dot += leftWeight * rightWeight
    leftMagnitude += leftWeight * leftWeight
    rightMagnitude += rightWeight * rightWeight
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

const meanVector = (vectors: ReadonlyArray<ReadonlyMap<string, number>>): ReadonlyMap<string, number> => {
  const totals = new Map<string, number>()

  for (const vector of vectors) {
    for (const [token, weight] of vector) {
      totals.set(token, (totals.get(token) ?? 0) + weight)
    }
  }

  const mean = new Map<string, number>()
  const divisor = vectors.length === 0 ? 1 : vectors.length
  for (const [token, total] of totals) {
    mean.set(token, total / divisor)
  }
  return mean
}

const outlierTerms = (
  reference: ReadonlyMap<string, number>,
  candidate: ReadonlyMap<string, number>,
): ReadonlyArray<VocabularyDriftTerm> =>
  [...candidate.entries()]
    .map(([token, candidateWeight]) => {
      const referenceWeight = reference.get(token) ?? 0
      return {
        token,
        referenceWeight,
        candidateWeight,
        delta: candidateWeight - referenceWeight,
      }
    })
    .sort((left, right) => right.delta - left.delta)
    .slice(0, 10)

/**
 * Prototype scoring rule:
 * - build TF/IDF vectors from the reference corpus
 * - compare the candidate document to the mean reference vector
 * - use cosine similarity directly as the health score
 *
 * This is deliberately simple. Real production scoring would need stemming,
 * corpus hygiene, better stop-word handling, and empirical calibration.
 */
export const analyzeVocabularyDrift = (
  input: VocabularyDriftInput,
): VocabularyDriftResult => {
  const referenceTokens = input.referenceDocuments.map(tokenize)
  const candidateTokens = tokenize(input.candidateDocument)

  const idf = inverseDocumentFrequency(referenceTokens)
  const referenceVectors = referenceTokens.map((tokens) => tfIdfVector(termFrequency(tokens), idf))
  const referenceMean = meanVector(referenceVectors)
  const candidateVector = tfIdfVector(termFrequency(candidateTokens), idf)

  const similarity = cosineSimilarity(referenceMean, candidateVector)

  return {
    score: similarity,
    cosineSimilarity: similarity,
    referenceVocabularySize: referenceMean.size,
    candidateVocabularySize: candidateVector.size,
    topOutlierTerms: outlierTerms(referenceMean, candidateVector),
  }
}
