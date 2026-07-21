export interface PublishedExportTargets {
  readonly types: string
  readonly default: string
}

export interface PublishedExportsContract {
  readonly schema_version: "pulsar/published-exports/v2"
  readonly packages: Readonly<
    Record<string, Readonly<Record<string, PublishedExportTargets>>>
  >
}

export interface PublishedPackageManifest {
  readonly name: string
  readonly version: string
  readonly main?: unknown
  readonly types?: unknown
  readonly exports?: unknown
}

export interface NpmPackMetadata {
  readonly name?: string
  readonly version?: string
  readonly filename?: string
  readonly files?: ReadonlyArray<{ readonly path?: string }>
}

export interface PlatformPackageManifest {
  readonly name: string
  readonly version: string
  readonly os?: unknown
  readonly cpu?: unknown
}

export interface MetaPackageManifest {
  readonly name: string
  readonly version: string
  readonly optionalDependencies?: unknown
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)]),
  )
}

export const stableJson = (value: unknown): string => JSON.stringify(stable(value))

export const assertReleaseEqual = (
  label: string,
  expectedLabel: string,
  expected: unknown,
  actual: unknown,
): void => {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(
      `${label} diverged from ${expectedLabel}\nexpected: ${stableJson(expected)}\nactual:   ${stableJson(actual)}`,
    )
  }
}

const asSingleString = (label: string, value: unknown): string => {
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== "string") {
    throw new Error(`${label} must contain exactly one string`)
  }
  return value[0]
}

const publishedExportTargets = (
  manifest: PublishedPackageManifest,
): Readonly<Record<string, PublishedExportTargets>> => {
  if (typeof manifest.exports !== "object" || manifest.exports === null) {
    throw new Error(`${manifest.name} must declare package exports`)
  }

  return Object.fromEntries(
    Object.entries(manifest.exports).map(([subpath, conditions]) => {
      if (typeof conditions !== "object" || conditions === null) {
        throw new Error(`${manifest.name} export ${subpath} must declare conditional targets`)
      }
      const { types, default: defaultTarget } = conditions as {
        readonly types?: unknown
        readonly default?: unknown
      }
      if (typeof types !== "string" || typeof defaultTarget !== "string") {
        throw new Error(`${manifest.name} export ${subpath} must declare string types and default targets`)
      }
      return [subpath, { types, default: defaultTarget }] as const
    }),
  )
}

export const assertPublishedExportContract = (
  contract: PublishedExportsContract,
  packages: ReadonlyArray<{
    readonly manifest: PublishedPackageManifest
    readonly pack: NpmPackMetadata
  }>,
): number => {
  if (contract.schema_version !== "pulsar/published-exports/v2") {
    throw new Error(`Unsupported export contract ${String(contract.schema_version)}`)
  }

  const actual: Record<string, Readonly<Record<string, PublishedExportTargets>>> = {}
  let targetCount = 0
  for (const { manifest, pack } of packages) {
    const targets = publishedExportTargets(manifest)
    const root = targets["."]
    if (root === undefined) throw new Error(`${manifest.name} must export its package root`)
    if (manifest.main !== root.default || manifest.types !== root.types) {
      throw new Error(`${manifest.name} main/types must match its root default/types exports`)
    }
    if (pack.name !== manifest.name || pack.version !== manifest.version) {
      throw new Error(
        `${manifest.name} npm pack metadata identified ${String(pack.name)}@${String(pack.version)}`,
      )
    }
    if (!Array.isArray(pack.files)) {
      throw new Error(`${manifest.name} npm pack metadata omitted its file inventory`)
    }

    const packedFiles = new Set(
      pack.files.flatMap(({ path }) => (typeof path === "string" ? [path.replace(/^\.\//, "")] : [])),
    )
    for (const [subpath, conditions] of Object.entries(targets)) {
      for (const [condition, target] of Object.entries(conditions)) {
        targetCount += 1
        const packedPath = target.replace(/^\.\//, "")
        if (!packedFiles.has(packedPath)) {
          throw new Error(
            `${manifest.name} packed tarball omits ${subpath} ${condition} target ${target}`,
          )
        }
      }
    }
    actual[manifest.name] = targets
  }

  assertReleaseEqual("published exports", "checked-in contract", contract.packages, actual)
  return targetCount
}

export const assertNpmPlatformContract = (input: {
  readonly rootVersion: string
  readonly meta: MetaPackageManifest
  readonly platforms: ReadonlyArray<PlatformPackageManifest>
}): ReadonlyArray<string> => {
  const { rootVersion, meta, platforms } = input
  if (meta.version !== rootVersion) {
    throw new Error(`${meta.name}@${meta.version} does not match root version ${rootVersion}`)
  }

  const expectedNames = platforms.map((manifest) => {
    const os = asSingleString(`${manifest.name} os`, manifest.os)
    const cpu = asSingleString(`${manifest.name} cpu`, manifest.cpu)
    const expectedName = `@skastr0/pulsar-${os}-${cpu}`
    if (manifest.name !== expectedName) {
      throw new Error(`${manifest.name} does not match its supported target ${os}-${cpu}`)
    }
    if (manifest.version !== rootVersion) {
      throw new Error(`${manifest.name}@${manifest.version} does not match root version ${rootVersion}`)
    }
    return expectedName
  })
  if (new Set(expectedNames).size !== expectedNames.length) {
    throw new Error("Supported npm platform packages contain a duplicate target")
  }

  if (typeof meta.optionalDependencies !== "object" || meta.optionalDependencies === null) {
    throw new Error(`${meta.name} must declare optionalDependencies`)
  }
  const actual = meta.optionalDependencies as Readonly<Record<string, unknown>>
  assertReleaseEqual(
    `${meta.name} optional dependency names`,
    "supported platform packages",
    expectedNames.sort(),
    Object.keys(actual).sort(),
  )
  for (const packageName of expectedNames) {
    if (actual[packageName] !== rootVersion) {
      throw new Error(
        `${meta.name} optional dependency ${packageName} must equal root version ${rootVersion}`,
      )
    }
  }
  return expectedNames.sort()
}

// No score fields are normalized today. Provenance-bearing score fields are part
// of the release contract; any future exception must name an exact JSON path here
// and add a focused test before it can be removed from parity comparison.
export const SCORE_PARITY_PROVENANCE_NORMALIZATION: ReadonlyArray<string> = []

export const normalizeScoreForReleaseParity = (score: unknown): unknown => score

export const assertCompleteScoreParity = (
  label: string,
  referenceLabel: string,
  reference: unknown,
  actual: unknown,
): void => {
  assertReleaseEqual(
    `${label} complete deterministic score JSON`,
    `${referenceLabel} complete deterministic score JSON`,
    normalizeScoreForReleaseParity(reference),
    normalizeScoreForReleaseParity(actual),
  )
}
