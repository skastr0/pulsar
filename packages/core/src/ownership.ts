import { createHash } from "node:crypto"
import { lstat, readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Schema } from "effect"
import { AiFactLabelArtifact, type AiFactLabelArtifact as Artifact } from "./ai-facts.js"
import { stableCalibrationStringify } from "./calibration-fingerprint.js"

export const CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH = ".pulsar/ownership.json"
export const CANONICAL_OWNERSHIP_ASSESSMENT_RELATIVE_PATH = ".pulsar/ownership-assessment.json"
export const OWNERSHIP_REFERENCE_DATA_KEY = "ownership"
export const OWNERSHIP_POLICY_SCHEMA_VERSION = 1
export const OWNERSHIP_ASSESSMENT_SCHEMA_VERSION = 1
export const OWNERSHIP_LABEL_KIND = "ownership_alignment"
export const OWNERSHIP_LABEL_VALUE_SCHEMA_VERSION = "pulsar.ownership_label.v1"

const Name = Schema.NonEmptyString
const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const AnchorId = Schema.Literals(["contrary", "mixed", "meets", "exceeds"])
const strict = { onExcessProperty: "error" } as const
const Anchor = Schema.Struct({ id: AnchorId, value: NonNegative, description: Name })
const Group = Schema.Struct({
  id: Name,
  owner_paths: Schema.Array(Name),
  caller_paths: Schema.Array(Name),
  context_paths: Schema.optional(Schema.Array(Name)),
  description: Schema.optional(Name),
  origin: Schema.optional(Schema.Literals(["declared", "detector_proposed"])),
})
export const OwnershipPolicy = Schema.Struct({
  schema_version: Schema.Literal(1),
  preference: Schema.Literals(["shared_domain_rule", "caller_local"]),
  target: Schema.Literal(1),
  anchors: Schema.Array(Anchor),
  allowed_classifiers: Schema.Array(Schema.Struct({
    id: Name, model_id: Name, version: Schema.optional(Name), prompt_id: Schema.optional(Name),
  })),
  groups: Schema.Array(Group),
  stretch: Schema.optional(Schema.Struct({ anchor_id: Schema.Literal("exceeds"), value: Schema.Finite.check(Schema.isGreaterThan(1)), requirement: Name })),
})
export type OwnershipPolicy = typeof OwnershipPolicy.Type
export type OwnershipGroup = typeof Group.Type

export const OwnershipLabelValue = Schema.Struct({
  schema_version: Schema.Literal(OWNERSHIP_LABEL_VALUE_SCHEMA_VERSION),
  group_id: Name,
  policy_fingerprint: Name,
  rubric_fingerprint: Name,
  status: Schema.Literals(["resolved", "unresolved", "not_applicable"]),
  anchor_id: Schema.optional(AnchorId),
  anchor_value: Schema.optional(NonNegative),
  distribution: Schema.Array(Schema.Struct({
    anchor_id: Name,
    anchor_value: Schema.optional(NonNegative),
    probability: Probability,
    selected: Schema.Boolean,
  })),
  receipt: Schema.optional(Schema.Struct({
    artifact_id: Name, classifier_id: Name, model_id: Name, prompt_id: Name, prompt_fingerprint: Name,
  })),
})
export type OwnershipLabelValue = typeof OwnershipLabelValue.Type

export const OwnershipAssessmentArtifact = Schema.Struct({
  schema_version: Schema.Literal(1),
  policy_path: Schema.Literal(CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH),
  policy_fingerprint: Name,
  created_at: Name,
  labels: Schema.Array(AiFactLabelArtifact),
})
export type OwnershipAssessmentArtifact = typeof OwnershipAssessmentArtifact.Type

const hashBytes = (bytes: string | Uint8Array): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const hashValue = (value: unknown): string => hashBytes(stableCalibrationStringify(value))
export const computeOwnershipPolicyFingerprint = hashBytes
export const computeOwnershipRubricFingerprint = (policy: OwnershipPolicy): string => hashValue({
  preference: policy.preference, target: policy.target, anchors: policy.anchors, stretch: policy.stretch ?? null,
})
export const computeOwnershipContentHash = (sourceHashes: Readonly<Record<string, string>>): string => hashValue(sourceHashes)
export const computeOwnershipInputFingerprint = (policyFingerprint: string, groupId: string, sourceHashes: Readonly<Record<string, string>>): string =>
  hashValue({ policyFingerprint, groupId, contentHash: computeOwnershipContentHash(sourceHashes) })
export const ownershipGroupPaths = (group: OwnershipGroup): ReadonlyArray<string> =>
  [...new Set([...group.owner_paths, ...group.caller_paths, ...(group.context_paths ?? [])])].sort()

const requireUnique = (ids: ReadonlyArray<string>, what: string): void => {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${what}`)
}
const assertPath = (path: string): void => {
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error("Ownership paths must be confined repo-relative POSIX file paths")
  }
  if (path.startsWith(".git/") || path.startsWith(".pulsar/")) throw new Error("Ownership evidence cannot be tool state")
}

export const decodeOwnershipPolicySync = (input: unknown): OwnershipPolicy => {
  const policy = Schema.decodeUnknownSync(OwnershipPolicy)(input, strict)
  requireUnique(policy.groups.map((group) => group.id), "group id")
  requireUnique(policy.anchors.map((anchor) => anchor.id), "anchor id")
  const anchors = new Map(policy.anchors.map((anchor) => [anchor.id, anchor]))
  if (anchors.get("meets")?.value !== 1 || anchors.get("contrary")?.value !== 0 || !anchors.has("mixed")) {
    throw new Error("Ownership anchors require contrary=0, mixed between 0 and 1, and meets=1")
  }
  const mixed = anchors.get("mixed")!.value
  if (mixed <= 0 || mixed >= 1) throw new Error("Mixed attainment must be between contrary and meets")
  const exceeds = anchors.get("exceeds")
  if ((exceeds === undefined) !== (policy.stretch === undefined) || (exceeds !== undefined && exceeds.value !== policy.stretch?.value)) {
    throw new Error("Exceeding requires an explicit matching stretch anchor and requirement")
  }
  if (policy.allowed_classifiers.length === 0) throw new Error("Ownership policy must authorize an evaluator")
  for (const group of policy.groups) {
    if (group.origin === "detector_proposed") throw new Error("Proposed groups must be explicitly adopted as declared before scoring")
    const paths = ownershipGroupPaths(group)
    if (paths.length === 0 || group.owner_paths.length + group.caller_paths.length === 0) throw new Error("Ownership group needs implementation evidence")
    paths.forEach(assertPath)
  }
  return policy
}

export const decodeOwnershipLabelValueSync = (input: unknown): OwnershipLabelValue => {
  const value = Schema.decodeUnknownSync(OwnershipLabelValue)(input, strict)
  if (value.status === "resolved" ? value.anchor_id === undefined || value.anchor_value === undefined
    : value.anchor_id !== undefined || value.anchor_value !== undefined) throw new Error("Anchor is present iff ownership judgment is resolved")
  requireUnique(value.distribution.map((entry) => entry.anchor_id), "distribution anchor")
  const selected = value.distribution.filter((entry) => entry.selected)
  if (selected.length !== 1 || selected[0]!.probability < Math.max(...value.distribution.map((entry) => entry.probability))) {
    throw new Error("Ownership distribution must retain exactly one raw maximum selection")
  }
  const sum = value.distribution.reduce((total, entry) => total + entry.probability, 0)
  if (Math.abs(sum - 1) > 0.005000001 * value.distribution.length) throw new Error("Ownership distribution does not sum to one")
  if (value.status === "resolved" && selected[0]!.anchor_id !== value.anchor_id) throw new Error("Resolved anchor differs from raw selection")
  if (value.status === "not_applicable" && selected[0]!.anchor_id !== "not_applicable") throw new Error("Not-applicable label lacks corresponding selection")
  return value
}

export const decodeOwnershipAssessmentArtifactSync = (input: unknown): OwnershipAssessmentArtifact => {
  const artifact = Schema.decodeUnknownSync(OwnershipAssessmentArtifact)(input, strict)
  if (!Number.isFinite(Date.parse(artifact.created_at))) throw new Error("Invalid ownership assessment date")
  requireUnique(artifact.labels.map((label) => label.artifact_id), "artifact id")
  requireUnique(artifact.labels.map((label) => decodeOwnershipLabelValueSync(label.label.value).group_id), "label group id")
  return artifact
}

export interface OwnershipAggregate {
  readonly applicability: "applicable" | "not_applicable" | "insufficient_evidence"
  readonly attainment?: number
  readonly observedAttainment?: number
  readonly target: 1
  readonly score?: number
  readonly histogram: Readonly<Record<string, number>>
  readonly resolvedGroupIds: ReadonlyArray<string>
  readonly unresolvedGroupIds: ReadonlyArray<string>
  readonly notApplicableGroupIds: ReadonlyArray<string>
  readonly missingGroupIds: ReadonlyArray<string>
}

/** Non-compensating rubric attainment; model certainty never enters the arithmetic. */
export const aggregateOwnershipAttainment = (input: {
  readonly preference: OwnershipPolicy["preference"]
  readonly target: 1
  readonly anchors: OwnershipPolicy["anchors"]
  readonly groups: OwnershipPolicy["groups"]
  readonly labels: ReadonlyArray<OwnershipLabelValue>
  readonly inventoryComplete: boolean
  readonly validityState: "fresh" | "expired"
}): OwnershipAggregate => {
  requireUnique(input.groups.map((group) => group.id), "group id")
  requireUnique(input.labels.map((label) => label.group_id), "label group id")
  const byGroup = new Map(input.labels.map((label) => [label.group_id, label]))
  const anchors = new Map(input.anchors.map((anchor) => [anchor.id, anchor.value]))
  const resolvedGroupIds: string[] = [], unresolvedGroupIds: string[] = [], notApplicableGroupIds: string[] = [], missingGroupIds: string[] = []
  const values: number[] = []
  const histogram: Record<string, number> = {}
  for (const group of input.groups) {
    const label = byGroup.get(group.id)
    if (label === undefined) { missingGroupIds.push(group.id); continue }
    if (label.status === "not_applicable") { notApplicableGroupIds.push(group.id); continue }
    if (label.status === "unresolved") { unresolvedGroupIds.push(group.id); continue }
    const value = label.anchor_id === undefined ? undefined : anchors.get(label.anchor_id)
    if (value === undefined || value !== label.anchor_value) throw new Error("Resolved ownership value does not match repo rubric")
    resolvedGroupIds.push(group.id)
    values.push(value)
    histogram[label.anchor_id!] = (histogram[label.anchor_id!] ?? 0) + 1
  }
  const incomplete = !input.inventoryComplete || input.validityState === "expired" || missingGroupIds.length > 0 || unresolvedGroupIds.length > 0
  const applicability = incomplete ? "insufficient_evidence" : values.length === 0 ? "not_applicable" : "applicable"
  const observed = values.length === 0 ? undefined : Math.min(...values)
  return {
    applicability, target: 1, histogram, resolvedGroupIds, unresolvedGroupIds, notApplicableGroupIds, missingGroupIds,
    ...(observed === undefined ? {} : { observedAttainment: observed }),
    ...(applicability !== "applicable" || observed === undefined ? {} : { attainment: observed, score: Math.min(1, observed) }),
  }
}

export interface OwnershipFacts {
  readonly state: "present" | "not_configured" | "unknown"
  readonly policy?: OwnershipPolicy
  readonly policyFingerprint?: string
  readonly assessmentFingerprint?: string
  readonly sourceFingerprint: string
  readonly checkedPaths: ReadonlyArray<string>
  readonly sourceHashes: Readonly<Record<string, string>>
  readonly inventory: { readonly declaredGroupIds: ReadonlyArray<string>; readonly labeledGroupIds: ReadonlyArray<string>; readonly complete: boolean }
  readonly validityState: "fresh" | "expired"
  readonly findings: ReadonlyArray<{ readonly groupId?: string; readonly message: string }>
  readonly labels: ReadonlyArray<Artifact>
  readonly aggregate?: OwnershipAggregate
}

/** Realpath checks include parent symlinks. No provider or executable repo modules. */
const readConfined = async (root: string, path: string): Promise<Buffer> => {
  const absolute = await realpath(resolve(root, path))
  const rel = relative(root, absolute)
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error("Ownership path escapes repository")
  const info = await stat(absolute)
  if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error("Ownership file missing or exceeds 16 MiB")
  return readFile(absolute)
}

export const loadOwnershipFacts = async (repoRoot: string, now = Date.now()): Promise<OwnershipFacts> => {
  const root = await realpath(repoRoot)
  const checkedPaths = [CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH]
  const sourceHashes: Record<string, string> = {}
  const findings: Array<{ groupId?: string; message: string }> = []
  let policy: OwnershipPolicy | undefined, policyFingerprint: string | undefined, assessmentFingerprint: string | undefined
  let validityState: "fresh" | "expired" = "fresh"
  let labels: Artifact[] = []
  let values: OwnershipLabelValue[] = []
  let inventoryComplete = false
  const finish = (state: OwnershipFacts["state"]): OwnershipFacts => ({
    state, ...(policy === undefined ? {} : { policy }),
    ...(policyFingerprint === undefined ? {} : { policyFingerprint }),
    ...(assessmentFingerprint === undefined ? {} : { assessmentFingerprint }),
    sourceFingerprint: hashValue(sourceHashes), sourceHashes, checkedPaths,
    inventory: { declaredGroupIds: policy?.groups.map((group) => group.id) ?? [], labeledGroupIds: values.map((value) => value.group_id), complete: inventoryComplete },
    validityState, findings, labels,
    ...(policy === undefined ? {} : { aggregate: aggregateOwnershipAttainment({
      ...policy, labels: values, inventoryComplete: inventoryComplete && state === "present", validityState,
    }) }),
  })
  try {
    // Only a genuinely absent policy is neutral, not an unreadable/broken symlink.
    try { await lstat(join(root, CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH)) }
    catch (cause) {
      if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") return finish("not_configured")
      throw cause
    }
    const policyBytes = await readConfined(root, CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH)
    policyFingerprint = computeOwnershipPolicyFingerprint(policyBytes)
    sourceHashes[CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH] = policyFingerprint
    policy = decodeOwnershipPolicySync(JSON.parse(policyBytes.toString("utf8")))
    if (policy.groups.length === 0) {
      inventoryComplete = true
      return finish("present")
    }
    for (const path of [...new Set(policy.groups.flatMap(ownershipGroupPaths))].sort()) {
      checkedPaths.push(path)
      try { sourceHashes[path] = hashBytes(await readConfined(root, path)) }
      catch { findings.push({ message: `Ownership source unavailable or unsafe: ${path}` }) }
    }
    checkedPaths.push(CANONICAL_OWNERSHIP_ASSESSMENT_RELATIVE_PATH)
    const assessmentBytes = await readConfined(root, CANONICAL_OWNERSHIP_ASSESSMENT_RELATIVE_PATH)
    assessmentFingerprint = hashBytes(assessmentBytes)
    sourceHashes[CANONICAL_OWNERSHIP_ASSESSMENT_RELATIVE_PATH] = assessmentFingerprint
    const assessment = decodeOwnershipAssessmentArtifactSync(JSON.parse(assessmentBytes.toString("utf8")))
    if (assessment.policy_fingerprint !== policyFingerprint) throw new Error("Ownership policy changed since assessment")
    const groupById = new Map(policy.groups.map((group) => [group.id, group]))
    const rubricFingerprint = computeOwnershipRubricFingerprint(policy)
    for (const artifact of assessment.labels) {
      const value = decodeOwnershipLabelValueSync(artifact.label.value)
      try {
        const group = groupById.get(value.group_id)
        if (group === undefined) throw new Error("Label is outside declared inventory")
        if (artifact.label.kind !== OWNERSHIP_LABEL_KIND || value.policy_fingerprint !== policyFingerprint || value.rubric_fingerprint !== rubricFingerprint) throw new Error("Label policy/rubric mismatch")
        if (!policy.allowed_classifiers.some((allowed) => allowed.id === artifact.classifier.id && allowed.model_id === artifact.classifier.model_id && (allowed.version === undefined || allowed.version === artifact.classifier.version) && (allowed.prompt_id === undefined || allowed.prompt_id === artifact.classifier.prompt_id))) throw new Error("Classifier is not authorized by repo policy")
        const paths = ownershipGroupPaths(group)
        const pathsMatch = stableCalibrationStringify([...artifact.input.source_paths].sort()) === stableCalibrationStringify(paths)
        const hashes = Object.fromEntries(paths.map((path) => {
          const hash = sourceHashes[path]
          if (hash === undefined) throw new Error("Missing source bytes")
          return [path, hash]
        }))
        if (!pathsMatch || artifact.input.content_hash !== computeOwnershipContentHash(hashes) || artifact.input.input_fingerprint !== computeOwnershipInputFingerprint(policyFingerprint, group.id, hashes)) throw new Error("Source or context changed since assessment")
        const optionIds = [...policy.anchors.map((anchor) => anchor.id), "unknown", "not_applicable"].sort()
        if (stableCalibrationStringify(value.distribution.map((entry) => entry.anchor_id).sort()) !== stableCalibrationStringify(optionIds)) throw new Error("Label distribution differs from rubric")
        for (const entry of value.distribution) {
          const anchor = policy.anchors.find((candidate) => candidate.id === entry.anchor_id)
          if (entry.anchor_value !== anchor?.value) throw new Error("Distribution value differs from rubric")
        }
        if (value.status === "resolved" && policy.anchors.find((anchor) => anchor.id === value.anchor_id)?.value !== value.anchor_value) throw new Error("Label value differs from rubric")
        const created = Date.parse(artifact.provenance.created_at)
        const expires = artifact.policy.expires_at === undefined ? Infinity : Date.parse(artifact.policy.expires_at)
        const days = artifact.policy.stale_after_days
        if (!Number.isFinite(created) || created > now || Number.isNaN(expires) || (days !== undefined && (!Number.isFinite(days) || days < 0))) throw new Error("Invalid artifact freshness metadata")
        if (now > expires || (days !== undefined && now > created + days * 86_400_000)) {
          validityState = "expired"
          throw new Error("Ownership assessment expired")
        }
        labels.push(artifact)
        values.push(value)
      } catch (cause) { findings.push({ groupId: value.group_id, message: cause instanceof Error ? cause.message : "Invalid ownership label" }) }
    }
    inventoryComplete = findings.length === 0 && values.length === policy.groups.length
    return finish(findings.length > 0 ? "unknown" : "present")
  } catch {
    // Do not surface parse errors containing fragments of repository content.
    findings.push({ message: "Ownership policy or assessment is missing, malformed, unsafe, or bound to different evidence" })
    return finish("unknown")
  }
}
