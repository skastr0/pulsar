import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Schema } from "effect"

export const CONTRACT_FRESHNESS_REFERENCE_DATA_KEY = "contract-freshness" as const
export const CANONICAL_CONTRACT_FRESHNESS_RELATIVE_PATH =
  ".pulsar/contract-freshness.json" as const

const ContractFreshnessContract = Schema.Struct({
  id: Schema.String,
  group_id: Schema.optional(Schema.String),
  source_paths: Schema.Array(Schema.String),
  artifact_path: Schema.String,
  source_hashes: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  artifact_sha256: Schema.optional(Schema.String),
  generator: Schema.optional(Schema.String),
  provenance_path: Schema.optional(Schema.String),
})
type ContractFreshnessContract = typeof ContractFreshnessContract.Type

export const ContractFreshnessManifest = Schema.Struct({
  schema_version: Schema.Literal(1),
  generated_artifact_globs: Schema.optional(Schema.Array(Schema.String)),
  exclude_globs: Schema.optional(Schema.Array(Schema.String)),
  contracts: Schema.Array(ContractFreshnessContract),
})
export type ContractFreshnessManifest = typeof ContractFreshnessManifest.Type

export type ContractFreshnessFactState =
  | "present"
  | "zero"
  | "not_configured"
  | "unknown"
  | "not_applicable"

export type ContractFreshnessFindingKind =
  | "missing-provenance"
  | "stale-artifact"
  | "missing-generated-artifact"
  | "orphan-generated-artifact"

export interface ContractFreshnessFinding {
  readonly findingId: string
  readonly contractId: string
  readonly groupId: string
  readonly kind: ContractFreshnessFindingKind
  readonly file: string
  readonly sourceFile?: string
  readonly artifactFile?: string
  readonly severity: "info" | "warn"
  readonly weight: number
  readonly evidence: ReadonlyArray<string>
}

export interface ContractFreshnessArtifactFact {
  readonly contractId: string
  readonly groupId: string
  readonly artifactPath: string
  readonly sourcePaths: ReadonlyArray<string>
  readonly sourceHashes: Readonly<Record<string, string>>
  readonly expectedSourceHashes: Readonly<Record<string, string>>
  readonly artifactHash?: string
  readonly expectedArtifactHash?: string
  readonly generator?: string
}

export interface ContractFreshnessFacts {
  readonly state: ContractFreshnessFactState
  readonly sourcePath?: string
  readonly checkedPaths: ReadonlyArray<string>
  readonly contracts: ReadonlyArray<ContractFreshnessArtifactFact>
  readonly findings: ReadonlyArray<ContractFreshnessFinding>
  readonly sourceFingerprint: string
  readonly message?: string
}

const DEFAULT_EXCLUDE_GLOBS = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.turbo/**",
  "**/target/**",
  "**/vendor/**",
  "**/fixtures/**",
]

const FINDING_WEIGHT: Record<ContractFreshnessFindingKind, number> = {
  "missing-provenance": 2,
  "stale-artifact": 5,
  "missing-generated-artifact": 4,
  "orphan-generated-artifact": 3,
}

export const decodeContractFreshnessManifestSync =
  Schema.decodeUnknownSync(ContractFreshnessManifest)

export const loadContractFreshnessFacts = async (
  repoRoot: string,
): Promise<ContractFreshnessFacts> => {
  const checkedPaths = [CANONICAL_CONTRACT_FRESHNESS_RELATIVE_PATH]
  const sourcePath = join(repoRoot, CANONICAL_CONTRACT_FRESHNESS_RELATIVE_PATH)
  if (!existsSync(sourcePath)) return buildNotConfiguredContractFreshnessFacts(checkedPaths)

  try {
    const raw = await readFile(sourcePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    const manifest = decodeContractFreshnessManifestSync(parsed)
    return await collectContractFreshnessFacts(repoRoot, sourcePath, checkedPaths, manifest)
  } catch (cause) {
    return buildUnknownContractFreshnessFacts(
      checkedPaths,
      `Failed to load contract freshness reference data: ${String(cause)}`,
      sourcePath,
    )
  }
}

export const buildNotConfiguredContractFreshnessFacts = (
  checkedPaths: ReadonlyArray<string>,
): ContractFreshnessFacts => ({
  state: "not_configured",
  checkedPaths,
  contracts: [],
  findings: [],
  sourceFingerprint: fingerprint({ checkedPaths, state: "not_configured" }),
  message: "Contract freshness reference data was not configured",
})

export const buildUnknownContractFreshnessFacts = (
  checkedPaths: ReadonlyArray<string>,
  message: string,
  sourcePath?: string,
): ContractFreshnessFacts => ({
  state: "unknown",
  ...(sourcePath === undefined ? {} : { sourcePath }),
  checkedPaths,
  contracts: [],
  findings: [],
  sourceFingerprint: fingerprint({ checkedPaths, message, state: "unknown" }),
  message,
})

const collectContractFreshnessFacts = async (
  repoRoot: string,
  sourcePath: string,
  checkedPaths: ReadonlyArray<string>,
  manifest: ContractFreshnessManifest,
): Promise<ContractFreshnessFacts> => {
  const contracts: Array<ContractFreshnessArtifactFact> = []
  const findings: Array<ContractFreshnessFinding> = []
  const checkedPathSet = new Set(checkedPaths)
  const declaredArtifacts = new Set(manifest.contracts.map((contract) => normalizePath(contract.artifact_path)))

  for (const contract of manifest.contracts) {
    const groupId = contract.group_id ?? "default"
    const expectedSourceHashes = normalizeHashRecord(contract.source_hashes ?? {})
    const normalizedSourcePaths = contract.source_paths.map(normalizePath)
    for (const source of normalizedSourcePaths) checkedPathSet.add(source)
    const artifactPath = normalizePath(contract.artifact_path)
    checkedPathSet.add(artifactPath)
    const sourceHashes = await currentSourceHashes(repoRoot, normalizedSourcePaths)
    const artifactAbsolutePath = safeResolve(repoRoot, artifactPath)
    const artifactExists = artifactAbsolutePath !== undefined && existsSync(artifactAbsolutePath)
    const artifactHash = artifactExists ? await fileHash(artifactAbsolutePath) : undefined

    contracts.push({
      contractId: contract.id,
      groupId,
      artifactPath,
      sourcePaths: normalizedSourcePaths,
      sourceHashes,
      expectedSourceHashes,
      ...(artifactHash === undefined ? {} : { artifactHash }),
      ...(contract.artifact_sha256 === undefined ? {} : { expectedArtifactHash: contract.artifact_sha256.toLowerCase() }),
      ...(contract.generator === undefined ? {} : { generator: contract.generator }),
    })

    if (!artifactExists) {
      findings.push(makeFinding({
        contractId: contract.id,
        groupId,
        kind: "missing-generated-artifact",
        file: artifactPath,
        artifactFile: artifactPath,
        evidence: ["declared generated artifact is missing"],
      }))
      continue
    }

    if (Object.keys(expectedSourceHashes).length === 0 && contract.artifact_sha256 === undefined) {
      findings.push(makeFinding({
        contractId: contract.id,
        groupId,
        kind: "missing-provenance",
        file: artifactPath,
        artifactFile: artifactPath,
        evidence: ["declared generated artifact has no recorded source or artifact hash provenance"],
      }))
    }

    for (const source of normalizedSourcePaths) {
      if (sourceHashes[source] !== undefined) continue
      findings.push(makeFinding({
        contractId: contract.id,
        groupId,
        kind: "stale-artifact",
        file: artifactPath,
        sourceFile: source,
        artifactFile: artifactPath,
        evidence: ["declared source contract is missing"],
      }))
    }

    for (const [source, expectedHash] of Object.entries(expectedSourceHashes)) {
      const actualHash = sourceHashes[source]
      if (actualHash !== undefined && actualHash !== expectedHash) {
        findings.push(makeFinding({
          contractId: contract.id,
          groupId,
          kind: "stale-artifact",
          file: artifactPath,
          sourceFile: source,
          artifactFile: artifactPath,
          evidence: [
            `expected source hash ${expectedHash}`,
            `current source hash ${actualHash}`,
          ],
        }))
      }
    }

    if (
      contract.artifact_sha256 !== undefined &&
      artifactHash !== undefined &&
      artifactHash !== contract.artifact_sha256.toLowerCase()
    ) {
      findings.push(makeFinding({
        contractId: contract.id,
        groupId,
        kind: "stale-artifact",
        file: artifactPath,
        artifactFile: artifactPath,
        evidence: [
          `expected artifact hash ${contract.artifact_sha256.toLowerCase()}`,
          `current artifact hash ${artifactHash}`,
        ],
      }))
    }
  }

  const orphanArtifacts = await collectOrphanArtifacts(
    repoRoot,
    manifest.generated_artifact_globs ?? [],
    [...DEFAULT_EXCLUDE_GLOBS, ...(manifest.exclude_globs ?? [])],
    declaredArtifacts,
  )
  for (const artifact of orphanArtifacts) checkedPathSet.add(artifact)
  findings.push(...orphanArtifacts.map((artifact) =>
    makeFinding({
      contractId: artifact,
      groupId: "detected",
      kind: "orphan-generated-artifact",
      file: artifact,
      artifactFile: artifact,
      evidence: ["generated artifact matched contract freshness globs but is not declared in provenance data"],
    }),
  ))

  findings.sort(compareFindings)
  const state = findings.length > 0 ? "present" : "zero"
  return {
    state,
    sourcePath,
    checkedPaths: [...checkedPathSet].sort(),
    contracts,
    findings,
    sourceFingerprint: fingerprint({ contracts, findings, manifest, state }),
  }
}

const currentSourceHashes = async (
  repoRoot: string,
  sourcePaths: ReadonlyArray<string>,
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {}
  for (const sourcePath of sourcePaths.map(normalizePath)) {
    const absolutePath = safeResolve(repoRoot, sourcePath)
    if (absolutePath === undefined || !existsSync(absolutePath)) continue
    result[sourcePath] = await fileHash(absolutePath)
  }
  return result
}

const collectOrphanArtifacts = async (
  repoRoot: string,
  artifactGlobs: ReadonlyArray<string>,
  excludeGlobs: ReadonlyArray<string>,
  declaredArtifacts: ReadonlySet<string>,
): Promise<ReadonlyArray<string>> => {
  if (artifactGlobs.length === 0) return []
  const files = await listFiles(repoRoot, excludeGlobs)
  return files
    .filter((path) => matchesAnyGlob(path, artifactGlobs))
    .filter((path) => !declaredArtifacts.has(path))
    .sort()
}

const listFiles = async (
  root: string,
  excludeGlobs: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> => {
  const files: Array<string> = []
  const visit = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = resolve(dir, entry.name)
      const path = normalizePath(relative(root, absolutePath))
      if (path === "" || matchesAnyGlob(path, excludeGlobs)) continue
      if (entry.isDirectory()) {
        await visit(absolutePath)
      } else if (entry.isFile()) {
        files.push(path)
      }
    }
  }
  await visit(root)
  return files
}

const makeFinding = (args: {
  readonly contractId: string
  readonly groupId: string
  readonly kind: ContractFreshnessFindingKind
  readonly file: string
  readonly sourceFile?: string
  readonly artifactFile?: string
  readonly evidence: ReadonlyArray<string>
}): ContractFreshnessFinding => ({
  findingId: `${args.contractId}:${args.kind}:${args.file}`,
  contractId: args.contractId,
  groupId: args.groupId,
  kind: args.kind,
  file: args.file,
  ...(args.sourceFile === undefined ? {} : { sourceFile: args.sourceFile }),
  ...(args.artifactFile === undefined ? {} : { artifactFile: args.artifactFile }),
  severity: args.kind === "missing-provenance" ? "info" : "warn",
  weight: FINDING_WEIGHT[args.kind],
  evidence: args.evidence,
})

const normalizeHashRecord = (record: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).map(([path, hash]) => [normalizePath(path), hash.toLowerCase()]),
  )

const safeResolve = (repoRoot: string, path: string): string | undefined => {
  const root = resolve(repoRoot)
  const resolved = resolve(root, path)
  const rel = relative(root, resolved)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
    ? resolved
    : undefined
}

const fileHash = async (path: string): Promise<string> =>
  sha256(await readFile(path))

const sha256 = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex")

const fingerprint = (value: unknown): string =>
  sha256(stableStringify(value))

const stableStringify = (value: unknown): string =>
  JSON.stringify(sortJson(value))

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    )
  }
  return value
}

const matchesAnyGlob = (path: string, globs: ReadonlyArray<string>): boolean =>
  globs.some((glob) => globMatches(path, glob))

const globMatches = (path: string, glob: string): boolean =>
  globToRegex(glob).test(normalizePath(path))

const globToRegex = (glob: string): RegExp => {
  const escaped = normalizePath(glob)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replace(/\*\*/gu, "<<<GLOBSTAR>>>")
    .replace(/\*/gu, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/gu, ".*")
  return new RegExp(`^${escaped}$`, "u")
}

const normalizePath = (path: string): string => path.replace(/\\/gu, "/")

const compareFindings = (
  left: ContractFreshnessFinding,
  right: ContractFreshnessFinding,
): number => {
  const bySeverity = severityRank(right.severity) - severityRank(left.severity)
  if (bySeverity !== 0) return bySeverity
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.groupId !== right.groupId) return left.groupId.localeCompare(right.groupId)
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.kind.localeCompare(right.kind)
}

const severityRank = (severity: "info" | "warn"): number =>
  severity === "warn" ? 1 : 0
