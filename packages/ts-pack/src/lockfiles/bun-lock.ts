import { readFile } from "node:fs/promises"

interface BunLockWorkspace {
  readonly path: string
  readonly name: string | undefined
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly optionalDependencies: Readonly<Record<string, string>>
}

export interface BunResolvedPackage {
  readonly lockKey: string
  readonly name: string
  readonly version: string
  readonly resolution: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly chain: ReadonlyArray<string>
}

interface ParsedBunLock {
  readonly workspaces: ReadonlyArray<BunLockWorkspace>
  readonly packages: ReadonlyArray<BunResolvedPackage>
  readonly packageNames: ReadonlySet<string>
}

export const readBunLockFile = async (filePath: string): Promise<ParsedBunLock> => {
  const text = await readFile(filePath, "utf8")
  return parseBunLock(text)
}

const parseBunLock = (text: string): ParsedBunLock => {
  const parsed = JSON.parse(stripTrailingCommas(text)) as {
    readonly workspaces?: Record<string, Record<string, unknown>>
    readonly packages?: Record<string, ReadonlyArray<unknown>>
  }

  const workspaces = Object.entries(parsed.workspaces ?? {})
    .map(([path, value]): BunLockWorkspace => ({
      path,
      name: asOptionalString(value.name),
      dependencies: asDependencyRecord(value.dependencies),
      devDependencies: asDependencyRecord(value.devDependencies),
      peerDependencies: asDependencyRecord(value.peerDependencies),
      optionalDependencies: asDependencyRecord(value.optionalDependencies),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))

  const packageNames = new Set<string>()
  const rawEntries = Object.entries(parsed.packages ?? {})
    .map(([lockKey, value]) => {
      const resolution = typeof value[0] === "string" ? value[0] : lockKey
      const { name, version } = parseResolution(resolution)
      packageNames.add(name)
      return {
        lockKey,
        resolution,
        name,
        version,
        info: asPackageInfo(value[2]),
      }
    })
    .sort((left, right) => left.lockKey.localeCompare(right.lockKey))

  const packages = rawEntries.map((entry): BunResolvedPackage => ({
    lockKey: entry.lockKey,
    name: entry.name,
    version: entry.version,
    resolution: entry.resolution,
    dependencies: entry.info,
    chain: parseLockKeyChain(entry.lockKey, packageNames),
  }))

  return {
    workspaces,
    packages,
    packageNames,
  }
}

const parseResolution = (resolution: string): { name: string; version: string } => {
  const separator = resolution.lastIndexOf("@")
  if (separator <= 0) {
    return { name: resolution, version: resolution }
  }
  return {
    name: resolution.slice(0, separator),
    version: resolution.slice(separator + 1),
  }
}

const parseLockKeyChain = (
  lockKey: string,
  knownNames: ReadonlySet<string>,
): ReadonlyArray<string> => {
  const names = [...knownNames].sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length
    }
    return left.localeCompare(right)
  })

  let remaining = lockKey
  const chain: Array<string> = []
  while (remaining.length > 0) {
    const match = names.find((name) => remaining === name || remaining.startsWith(`${name}/`))
    if (match === undefined) {
      chain.push(remaining)
      break
    }
    chain.push(match)
    remaining = remaining === match ? "" : remaining.slice(match.length + 1)
  }

  return chain
}

const asPackageInfo = (value: unknown): Readonly<Record<string, string>> => {
  if (value === null || typeof value !== "object") {
    return {}
  }

  const record = value as Record<string, unknown>
  return {
    ...asDependencyRecord(record.dependencies),
    ...asDependencyRecord(record.optionalDependencies),
    ...asDependencyRecord(record.peerDependencies),
  }
}

const asDependencyRecord = (value: unknown): Readonly<Record<string, string>> => {
  if (value === null || typeof value !== "object") {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const stripTrailingCommas = (text: string): string => {
  let result = ""
  let inString = false
  let isEscaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (inString) {
      result += char
      if (isEscaped) {
        isEscaped = false
        continue
      }
      if (char === "\\") {
        isEscaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === ",") {
      let nextIndex = index + 1
      while (nextIndex < text.length && /\s/.test(text[nextIndex]!)) {
        nextIndex += 1
      }
      const next = text[nextIndex]
      if (next === "}" || next === "]") {
        continue
      }
    }

    result += char
  }

  return result
}
