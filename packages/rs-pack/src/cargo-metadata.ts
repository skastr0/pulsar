import { execFile } from "node:child_process"
import { promisify } from "node:util"

class CargoMetadataParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CargoMetadataParseError"
  }
}

interface CargoMetadataDependency {
  readonly name: string
  readonly kind: string | null | undefined
  readonly rename: string | null | undefined
  readonly optional: boolean
  readonly usesDefaultFeatures: boolean
  readonly features: ReadonlyArray<string>
  readonly path: string | null | undefined
  readonly target: string | null | undefined
  readonly req: string | undefined
}

interface CargoMetadataTarget {
  readonly name: string
  readonly kind: ReadonlyArray<string>
  readonly crateTypes: ReadonlyArray<string>
  readonly srcPath: string
  readonly edition: string | undefined
}

export interface CargoMetadataPackage {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly edition: string | undefined
  readonly manifestPath: string
  readonly dependencies: ReadonlyArray<CargoMetadataDependency>
  readonly features: Readonly<Record<string, ReadonlyArray<string>>>
  readonly targets: ReadonlyArray<CargoMetadataTarget>
}

interface CargoMetadataResolveDepKind {
  readonly kind: string | null | undefined
  readonly target: string | null | undefined
}

interface CargoMetadataResolveDep {
  readonly name: string
  readonly pkg: string
  readonly depKinds: ReadonlyArray<CargoMetadataResolveDepKind>
}

interface CargoMetadataResolveNode {
  readonly id: string
  readonly dependencies: ReadonlyArray<string>
  readonly deps: ReadonlyArray<CargoMetadataResolveDep>
  readonly features: ReadonlyArray<string>
}

interface CargoMetadataResolve {
  readonly root: string | null | undefined
  readonly nodes: ReadonlyArray<CargoMetadataResolveNode>
}

export interface CargoMetadata {
  readonly version: number
  readonly workspaceRoot: string
  readonly targetDirectory: string
  readonly workspaceMembers: ReadonlyArray<string>
  readonly packages: ReadonlyArray<CargoMetadataPackage>
  readonly resolve: CargoMetadataResolve | undefined
}

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const asRecord = (value: unknown, path: string): JsonRecord => {
  if (!isRecord(value)) {
    throw new CargoMetadataParseError(`${path} must be an object`)
  }
  return value
}

const asArray = (value: unknown, path: string): ReadonlyArray<unknown> => {
  if (!Array.isArray(value)) {
    throw new CargoMetadataParseError(`${path} must be an array`)
  }
  return value
}

const asString = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    throw new CargoMetadataParseError(`${path} must be a string`)
  }
  return value
}

const asNumber = (value: unknown, path: string): number => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new CargoMetadataParseError(`${path} must be a number`)
  }
  return value
}

const asBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    throw new CargoMetadataParseError(`${path} must be a boolean`)
  }
  return value
}

const asOptionalString = (value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined
  return asString(value, path)
}

const asNullableString = (value: unknown, path: string): string | null | undefined => {
  if (value === undefined || value === null) return value
  return asString(value, path)
}

const asStringArray = (value: unknown, path: string): ReadonlyArray<string> =>
  asArray(value, path).map((entry, index) => asString(entry, `${path}[${index}]`))

const asStringArrayRecord = (
  value: unknown,
  path: string,
): Readonly<Record<string, ReadonlyArray<string>>> => {
  const record = asRecord(value, path)
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, asStringArray(entry, `${path}.${key}`)]),
  )
}

const parseDependency = (value: unknown, path: string): CargoMetadataDependency => {
  const record = asRecord(value, path)
  return {
    name: asString(record.name, `${path}.name`),
    kind: asNullableString(record.kind, `${path}.kind`),
    rename: asNullableString(record.rename, `${path}.rename`),
    optional: asBoolean(record.optional, `${path}.optional`),
    usesDefaultFeatures: asBoolean(
      record.uses_default_features,
      `${path}.uses_default_features`,
    ),
    features: asStringArray(record.features, `${path}.features`),
    path: asNullableString(record.path, `${path}.path`),
    target: asNullableString(record.target, `${path}.target`),
    req: asOptionalString(record.req, `${path}.req`),
  }
}

const parseTarget = (value: unknown, path: string): CargoMetadataTarget => {
  const record = asRecord(value, path)
  return {
    name: asString(record.name, `${path}.name`),
    kind: asStringArray(record.kind, `${path}.kind`),
    crateTypes: asStringArray(record.crate_types, `${path}.crate_types`),
    srcPath: asString(record.src_path, `${path}.src_path`),
    edition: asOptionalString(record.edition, `${path}.edition`),
  }
}

const parsePackage = (value: unknown, path: string): CargoMetadataPackage => {
  const record = asRecord(value, path)
  return {
    id: asString(record.id, `${path}.id`),
    name: asString(record.name, `${path}.name`),
    version: asString(record.version, `${path}.version`),
    edition: asOptionalString(record.edition, `${path}.edition`),
    manifestPath: asString(record.manifest_path, `${path}.manifest_path`),
    dependencies: asArray(record.dependencies, `${path}.dependencies`).map((entry, index) =>
      parseDependency(entry, `${path}.dependencies[${index}]`),
    ),
    features: asStringArrayRecord(record.features, `${path}.features`),
    targets: asArray(record.targets ?? [], `${path}.targets`).map((entry, index) =>
      parseTarget(entry, `${path}.targets[${index}]`),
    ),
  }
}

const parseResolveDepKind = (value: unknown, path: string): CargoMetadataResolveDepKind => {
  const record = asRecord(value, path)
  return {
    kind: asNullableString(record.kind, `${path}.kind`),
    target: asNullableString(record.target, `${path}.target`),
  }
}

const parseResolveDep = (value: unknown, path: string): CargoMetadataResolveDep => {
  const record = asRecord(value, path)
  return {
    name: asString(record.name, `${path}.name`),
    pkg: asString(record.pkg, `${path}.pkg`),
    depKinds: asArray(record.dep_kinds ?? [], `${path}.dep_kinds`).map((entry, index) =>
      parseResolveDepKind(entry, `${path}.dep_kinds[${index}]`),
    ),
  }
}

const parseResolveNode = (value: unknown, path: string): CargoMetadataResolveNode => {
  const record = asRecord(value, path)
  return {
    id: asString(record.id, `${path}.id`),
    dependencies: asStringArray(record.dependencies ?? [], `${path}.dependencies`),
    deps: asArray(record.deps ?? [], `${path}.deps`).map((entry, index) =>
      parseResolveDep(entry, `${path}.deps[${index}]`),
    ),
    features: asStringArray(record.features ?? [], `${path}.features`),
  }
}

const parseResolve = (value: unknown, path: string): CargoMetadataResolve => {
  const record = asRecord(value, path)
  return {
    root: asNullableString(record.root, `${path}.root`),
    nodes: asArray(record.nodes, `${path}.nodes`).map((entry, index) =>
      parseResolveNode(entry, `${path}.nodes[${index}]`),
    ),
  }
}

const parseJson = (input: string): unknown => {
  try {
    return JSON.parse(input)
  } catch (error) {
    throw new CargoMetadataParseError(`Invalid cargo metadata JSON: ${String(error)}`)
  }
}

const parseCargoMetadata = (input: string | unknown): CargoMetadata => {
  const raw = typeof input === "string" ? parseJson(input) : input
  const record = asRecord(raw, "cargo metadata")
  return {
    version: asNumber(record.version, "cargo metadata.version"),
    workspaceRoot: asString(record.workspace_root, "cargo metadata.workspace_root"),
    targetDirectory: asString(record.target_directory, "cargo metadata.target_directory"),
    workspaceMembers: asStringArray(
      record.workspace_members,
      "cargo metadata.workspace_members",
    ),
    packages: asArray(record.packages, "cargo metadata.packages").map((entry, index) =>
      parsePackage(entry, `cargo metadata.packages[${index}]`),
    ),
    resolve:
      record.resolve === undefined || record.resolve === null
        ? undefined
        : parseResolve(record.resolve, "cargo metadata.resolve"),
  }
}

export const workspacePackages = (
  metadata: CargoMetadata,
): ReadonlyArray<CargoMetadataPackage> => {
  const workspaceIds = new Set(metadata.workspaceMembers)
  return metadata.packages.filter((pkg) => workspaceIds.has(pkg.id))
}

const execFileAsync = promisify(execFile)

export const loadCargoMetadata = async (
  cwd: string,
): Promise<CargoMetadata | undefined> => {
  let stdout: string
  try {
    const result = await execFileAsync(
      "cargo",
      ["metadata", "--format-version", "1", "--all-features", "--no-deps"],
      {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      },
    )
    stdout = result.stdout
  } catch (error) {
    if (isCargoMetadataCommandFailure(error)) return undefined
    throw error
  }

  return parseCargoMetadata(stdout)
}

const isCargoMetadataCommandFailure = (error: unknown): boolean =>
  errorCodeOf(error) !== undefined

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
