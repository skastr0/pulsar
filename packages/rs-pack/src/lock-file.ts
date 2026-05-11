export class CargoLockParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CargoLockParseError"
  }
}

export interface CargoLockPackage {
  readonly name: string
  readonly version: string
  readonly source: string | undefined
  readonly checksum: string | undefined
  readonly dependencies: ReadonlyArray<string>
}

export interface CargoLockfile {
  readonly version: number | undefined
  readonly packages: ReadonlyArray<CargoLockPackage>
}

export interface CargoLockDuplicate {
  readonly name: string
  readonly versions: ReadonlyArray<string>
  readonly packages: ReadonlyArray<CargoLockPackage>
}

interface MutableCargoLockPackage {
  name?: string
  version?: string
  source?: string
  checksum?: string
  dependencies: Array<string>
}

interface CargoLockParseState {
  current: MutableCargoLockPackage | undefined
  lockfileVersion: number | undefined
  packages: Array<CargoLockPackage>
}

const KEY_VALUE_PATTERN = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/

const parseStringLiteral = (value: string, path: string): string => {
  const trimmed = value.trim().replace(/,$/, "")
  if (!trimmed.startsWith('"')) {
    throw new CargoLockParseError(`${path} must be a TOML string literal`)
  }
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    throw new CargoLockParseError(`${path} is not a valid string literal: ${String(error)}`)
  }
}

const parseNumberLiteral = (value: string, path: string): number => {
  const trimmed = value.trim()
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) {
    throw new CargoLockParseError(`${path} must be an integer literal`)
  }
  return parsed
}

const collectArrayBody = (
  lines: ReadonlyArray<string>,
  startIndex: number,
  initialValue: string,
): { readonly body: string; readonly nextIndex: number } => {
  let body = initialValue.trim()
  let cursor = startIndex
  while (!body.includes("]")) {
    cursor += 1
    if (cursor >= lines.length) {
      throw new CargoLockParseError("Unterminated array literal in Cargo.lock")
    }
    body = `${body}\n${lines[cursor] ?? ""}`
  }
  return { body, nextIndex: cursor + 1 }
}

const parseStringArray = (value: string, path: string): ReadonlyArray<string> => {
  const start = value.indexOf("[")
  const end = value.lastIndexOf("]")
  if (start === -1 || end === -1 || end < start) {
    throw new CargoLockParseError(`${path} must be an array literal`)
  }
  const inner = value.slice(start + 1, end)
  const matches = inner.match(/"(?:[^"\\]|\\.)*"/g) ?? []
  return matches.map((token, index) => parseStringLiteral(token, `${path}[${index}]`))
}

const finalizePackage = (
  current: MutableCargoLockPackage | undefined,
  packages: Array<CargoLockPackage>,
): void => {
  if (current === undefined) return
  if (current.name === undefined || current.version === undefined) {
    throw new CargoLockParseError(
      "Every [[package]] entry in Cargo.lock must include name and version",
    )
  }
  packages.push({
    name: current.name,
    version: current.version,
    source: current.source,
    checksum: current.checksum,
    dependencies: current.dependencies,
  })
}

export const parseCargoLock = (input: string): CargoLockfile => {
  const lines = input.split(/\r?\n/)
  const state: CargoLockParseState = {
    current: undefined,
    lockfileVersion: undefined,
    packages: [],
  }
  let index = 0

  while (index < lines.length) {
    index = consumeCargoLockLine(lines, index, state)
  }

  finalizePackage(state.current, state.packages)

  return {
    version: state.lockfileVersion,
    packages: state.packages,
  }
}

const consumeCargoLockLine = (
  lines: ReadonlyArray<string>,
  index: number,
  state: CargoLockParseState,
): number => {
  const line = (lines[index] ?? "").trim()
  if (line.length === 0 || line.startsWith("#")) return index + 1

  if (line === "[[package]]") {
    finalizePackage(state.current, state.packages)
    state.current = { dependencies: [] }
    return index + 1
  }

  const match = KEY_VALUE_PATTERN.exec(line)
  if (match === null) return index + 1
  return consumeCargoLockKeyValue(lines, index, state, match[1]!, match[2]!)
}

const consumeCargoLockKeyValue = (
  lines: ReadonlyArray<string>,
  index: number,
  state: CargoLockParseState,
  key: string,
  rawValue: string,
): number => {
  if (state.current === undefined) {
    if (key === "version") {
      state.lockfileVersion = parseNumberLiteral(rawValue, "Cargo.lock.version")
    }
    return index + 1
  }

  if (key === "dependencies") {
    const { body, nextIndex } = collectArrayBody(lines, index, rawValue)
    state.current.dependencies = [...parseStringArray(body, "Cargo.lock.dependencies")]
    return nextIndex
  }

  assignCargoLockPackageField(state.current, key, rawValue)
  return index + 1
}

const assignCargoLockPackageField = (
  current: MutableCargoLockPackage,
  key: string,
  rawValue: string,
): void => {
  switch (key) {
    case "name":
      current.name = parseStringLiteral(rawValue, "Cargo.lock.package.name")
      return
    case "version":
      current.version = parseStringLiteral(rawValue, "Cargo.lock.package.version")
      return
    case "source":
      current.source = parseStringLiteral(rawValue, "Cargo.lock.package.source")
      return
    case "checksum":
      current.checksum = parseStringLiteral(rawValue, "Cargo.lock.package.checksum")
      return
    default:
      return
  }
}

export const findDuplicateCargoLockPackages = (
  lockfile: CargoLockfile,
): ReadonlyArray<CargoLockDuplicate> => {
  const byName = new Map<string, Array<CargoLockPackage>>()
  for (const pkg of lockfile.packages) {
    const existing = byName.get(pkg.name) ?? []
    existing.push(pkg)
    byName.set(pkg.name, existing)
  }

  return [...byName.entries()]
    .map(([name, packages]) => ({
      name,
      packages,
      versions: [...new Set(packages.map((pkg) => pkg.version))].sort(),
    }))
    .filter((entry) => entry.versions.length > 1)
    .sort((a, b) => a.name.localeCompare(b.name))
}
