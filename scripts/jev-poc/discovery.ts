/**
 * Automatic evidence discovery for the Jev POC.
 *
 * Turns already-computed signal outputs into a bounded, deterministic list of code candidates
 * with repo-relative pointers and automatically gathered context. The parent command supplies
 * the signal results; nothing here runs a signal, a score, or a provider call.
 *
 * Four separations this module exists to preserve:
 *
 * 1. Structural discovery is not a semantic verdict. A candidate carries facts a parser can
 *    observe (group size, token count, cyclomatic complexity) and `semanticStatus: "not_assessed"`.
 *    There is deliberately no field that says a candidate is a problem.
 * 2. Candidate enumeration uses the signal's full `output`, never its truncated `diagnostics`.
 *    A repo whose diagnostic list is capped must not look like a repo with fewer candidates.
 * 3. A clipped sample is reported as incomplete. Every limit that binds, and every candidate it
 *    drops, is listed in `coverage`, together with the source totals, so a partial sample cannot
 *    be read as a clean repository.
 * 4. A pointer's line range is either parser-exact or explicitly incomplete. Complexity results
 *    carry only a start line, so the extent is resolved from a real parser; when no parser is
 *    available the pointer says `signal_line_only` and `extentComplete: false` instead of
 *    presenting a guessed window as the function.
 *
 * Signal ids are the only domain constants. No repository path or function name is hard-coded.
 * Text scanning here locates import specifiers and lines; it never decides whether code is
 * duplicated, complex, or wrong. Snippets are raw source lines: no author, blame, or label
 * metadata is attached, and nothing here feeds snippets into a detector score.
 */
import { createHash } from "node:crypto"
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export type SemanticCandidateKind = "clone-group" | "complexity-function"

/** Structural view of a signal result. Real `SignalRunResult` values satisfy this as-is. */
export interface SignalRunResultLike {
  readonly signalId: string
  readonly score: number
  readonly output: unknown
  readonly diagnostics?: ReadonlyArray<unknown>
}

export interface DiscoveryLimits {
  readonly maxCandidates: number
  readonly maxSnippetLines: number
  readonly maxContextBytes: number
  readonly maxContextFiles?: number
  readonly maxSourceFilesScanned?: number
  readonly maxSourceFileBytes?: number
  readonly maxImportSpecifiersPerFile?: number
  readonly maxExtentFiles?: number
  readonly maxOmittedListed?: number
  /**
   * Repository-owned scope. When present, candidates are filtered **before** `maxCandidates`, so a
   * scope never competes with the candidate cap. A candidate is in scope when every one of its
   * files matches an `include` pattern (when any are given) and matches no `exclude` pattern.
   * Patterns are globs over repo-relative POSIX paths; `*` does not cross `/`, `**` does, and a
   * bare directory path means everything under it. `exclude` also prunes the source scan used for
   * context; `include` never widens or narrows that scan.
   */
  readonly include?: ReadonlyArray<string>
  readonly exclude?: ReadonlyArray<string>
}

/**
 * Optional parser capability, supplied by the caller. The parent already owns a parser
 * (`TsAnalysisLayer` → `analysis.mapFiles` → `getFunctionLikeEntriesForSourceFile`), so extents
 * arrive through this callback rather than from a second parser inside this module. When it is
 * absent the extent is reported as missing rather than guessed.
 */
export interface ExtentResolver {
  readonly resolveFunctionExtent: (
    file: string,
    name: string,
    line: number,
  ) => { readonly startLine: number; readonly endLine: number } | null
}

export interface DiscoveryOptions {
  readonly extents?: ExtentResolver
}

export interface SourcePointer {
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  /**
   * `parser` when the range is a parser-exact function extent, `signal_line_only` when only a
   * start line was reported and no parser supplied the end, `file_window` when the range is a
   * bounded read of the whole module rather than a claim about a declaration.
   */
  readonly extentSource: "parser" | "signal_line_only" | "file_window"
  readonly extentComplete: boolean
  readonly fileSha256: string
  readonly snippet: string
  readonly snippetLines: number
  readonly snippetSha256: string
  readonly clipped: boolean
}

export interface ContextPointer extends SourcePointer {
  readonly role: "import" | "consumer" | "same-file"
  readonly reason: string
}

export interface SemanticCandidate {
  readonly id: string
  readonly kind: SemanticCandidateKind
  readonly signalId: string
  readonly provenance: {
    readonly signalId: string
    readonly outputPath: string
    readonly sourceRank: number
    readonly signalScore: number
  }
  readonly semanticStatus: "not_assessed"
  readonly primary: SourcePointer
  readonly members: ReadonlyArray<SourcePointer>
  readonly context: ReadonlyArray<ContextPointer>
  readonly facts: Readonly<Record<string, unknown>>
  readonly limitations: ReadonlyArray<string>
}

export interface DiscoveryCoverage {
  readonly complete: boolean
  /** False whenever a scope filter or a clipped limit means this is not a whole-repository sample. */
  readonly coversWholeRepo: boolean
  readonly scope: {
    readonly include: ReadonlyArray<string>
    readonly exclude: ReadonlyArray<string>
    readonly scoped: boolean
    readonly inScopeCandidates: number
    readonly outOfScopeCount: number
    readonly outOfScope: ReadonlyArray<{
      readonly id: string
      readonly kind: SemanticCandidateKind
      readonly file: string
      readonly reason: string
    }>
  }
  readonly signals: ReadonlyArray<{
    readonly signalId: string
    readonly present: boolean
    readonly malformed: boolean
    readonly score: number | null
    readonly candidatesAvailable: number
    readonly candidatesSelected: number
  }>
  readonly baseline: {
    readonly cloneGroupsAvailable: number | null
    readonly cloneFunctionsAnalyzed: number | null
    readonly signalDiagnosticLimit: number | null
    readonly cloneGroupsBeyondSignalDiagnosticLimit: number | null
    /** Total measured functions, not only those over the complexity threshold. */
    readonly complexityFunctionsAvailable: number | null
    readonly complexityOverThreshold: number | null
    readonly complexityThreshold: number | null
    /** Inventory remaining after the safety rules and the repository-owned scope filter. */
    readonly inScopeCloneGroups: number
    readonly inScopeComplexityFunctions: number
  }
  readonly sourceScan: {
    readonly filesScanned: number
    /** Intentional skips: excluded directories, non-source files, symlinks, secret-shaped names. */
    readonly filesSkipped: number
    /** Source files skipped because they exceed `maxSourceFileBytes`; the scan is incomplete. */
    readonly filesSizeCapped: number
    /** Files the scan could not read; the context index is incomplete. */
    readonly filesUnreadable: number
    /** Files whose import list hit `maxImportSpecifiersPerFile`; their context may be incomplete. */
    readonly importSpecifierCaps: number
    readonly bytesRead: number
    readonly truncated: boolean
    readonly unresolvedImportSpecifiers: number
  }
  /**
   * Context caps and omissions are explicit. A clipped context can hide a contract that changes
   * the judgment, so it also prevents complete coverage and a green result.
   */
  readonly context: {
    readonly clippedCandidates: number
    readonly omittedPointers: number
  }
  readonly extents: {
    readonly resolver: "injected" | "unavailable" | "not_needed"
    readonly requested: number
    readonly resolved: number
    readonly missing: number
    /** Always 0: this module opens no parser files. Extents arrive through the resolver. */
    readonly filesOpened: number
    /** Distinct files the resolver was consulted for, bounded by `maxExtentFiles`. */
    readonly filesConsulted: number
    readonly truncated: boolean
    readonly failureReason: string | null
  }
  readonly totalCandidates: number
  readonly selectedCandidates: number
  /** Candidates dropped by `maxCandidates`. Duplicate ids are reported separately. */
  readonly omittedCount: number
  /** Ids collapsed because the same candidate was reported more than once. Not a clip. */
  readonly duplicatesRemoved: number
  readonly omitted: ReadonlyArray<{ readonly id: string; readonly kind: SemanticCandidateKind; readonly reason: string }>
  readonly rejected: ReadonlyArray<{
    readonly id: string
    readonly kind: SemanticCandidateKind
    readonly file: string
    readonly reason: string
  }>
  readonly limitations: ReadonlyArray<string>
  readonly limits: DiscoveryLimits
}

export interface DiscoveryResult {
  readonly schema: "pulsar.jev_poc_discovery.v1"
  readonly repoRoot: string
  readonly candidates: ReadonlyArray<SemanticCandidate>
  readonly coverage: DiscoveryCoverage
}

/** Signal ids that provide candidate sources. No repository path or function name appears here. */
const CLONE_GROUP_SIGNAL = "TS-SL-01-duplication"
const COMPLEXITY_SIGNAL = "TS-LD-01-cyclomatic-complexity"

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".turbo", ".next", ".cache",
  ".venv", "venv", "__pycache__", ".amp", ".idea", ".vscode", "tmp",
  // Disposable repository state: caches, time series, semantic run output and materialized
  // module snapshots. Normal source scope does not include it, and reading it would let copies
  // of real modules masquerade as consumers. Candidates are unaffected: they come from signals.
  ".pulsar",
])
/** Secret-shaped basenames. Source extensions are already required, so this is belt and braces. */
const SECRET_BASENAME = /(^|\.)(env|npmrc|netrc|pypirc|git-credentials|htpasswd)(\..*)?$|\.(pem|key|p12|pfx|jks|keystore|asc|ppk)$|^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/iu
const PRIVATE_KEY_HEADER = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/u
const MAX_WORKSPACE_PACKAGES = 200

const DEFAULTS = {
  maxContextFiles: 6,
  maxSourceFilesScanned: 4_000,
  maxSourceFileBytes: 512 * 1024,
  maxImportSpecifiersPerFile: 200,
  maxExtentFiles: 24,
  maxOmittedListed: 100,
} as const

type ResolvedLimits = Required<Omit<DiscoveryLimits, "include" | "exclude">> & {
  readonly include: ReadonlyArray<string>
  readonly exclude: ReadonlyArray<string>
}

const normalizeLimits = (limits: DiscoveryLimits): ResolvedLimits => {
  const positive = (value: number | undefined, fallback: number, label: string): number => {
    if (value === undefined) return fallback
    if (!Number.isFinite(value) || value <= 0) throw new Error(`discovery limit ${label} must be a positive number`)
    return Math.floor(value)
  }
  const patterns = (value: ReadonlyArray<string> | undefined, label: string): ReadonlyArray<string> => {
    if (value === undefined) return []
    for (const pattern of value) {
      if (typeof pattern !== "string" || pattern.length === 0) throw new Error(`discovery limit ${label} entries must be non-empty strings`)
    }
    return [...value]
  }
  return {
    maxCandidates: positive(limits.maxCandidates, Number.NaN, "maxCandidates"),
    maxSnippetLines: positive(limits.maxSnippetLines, Number.NaN, "maxSnippetLines"),
    maxContextBytes: positive(limits.maxContextBytes, Number.NaN, "maxContextBytes"),
    maxContextFiles: positive(limits.maxContextFiles, DEFAULTS.maxContextFiles, "maxContextFiles"),
    maxSourceFilesScanned: positive(limits.maxSourceFilesScanned, DEFAULTS.maxSourceFilesScanned, "maxSourceFilesScanned"),
    maxSourceFileBytes: positive(limits.maxSourceFileBytes, DEFAULTS.maxSourceFileBytes, "maxSourceFileBytes"),
    maxImportSpecifiersPerFile: positive(limits.maxImportSpecifiersPerFile, DEFAULTS.maxImportSpecifiersPerFile, "maxImportSpecifiersPerFile"),
    maxExtentFiles: positive(limits.maxExtentFiles, DEFAULTS.maxExtentFiles, "maxExtentFiles"),
    maxOmittedListed: positive(limits.maxOmittedListed, DEFAULTS.maxOmittedListed, "maxOmittedListed"),
    include: patterns(limits.include, "include"),
    exclude: patterns(limits.exclude, "exclude"),
  }
}

/**
 * Repository-owned path scope. Patterns are globs over repo-relative POSIX paths; `*` stays inside
 * one path segment, `**` crosses segments, and a bare directory path means everything under it.
 */
type ScopeMatcher = { readonly path: RegExp; readonly directory: RegExp | null }

const normalizeScopePattern = (pattern: string): string => {
  const trimmed = pattern.replace(/^\.\//u, "").replace(/\/+$/u, "")
  if (trimmed.length === 0) return "**"
  if (trimmed.includes("*") || hasSourceExtension(trimmed)) return trimmed
  return `${trimmed}/**`
}

const globToRegExp = (glob: string): RegExp => {
  let source = ""
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]!
    if (character === "*") {
      if (glob[index + 1] === "*") {
        index += 1
        if (glob[index + 1] === "/") {
          index += 1
          source += "(?:.*/)?"
        } else {
          source += ".*"
        }
      } else {
        source += "[^/]*"
      }
    } else if (character === "?") {
      source += "[^/]"
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    }
  }
  return new RegExp(`^${source}$`, "u")
}

const buildScopeMatchers = (patterns: ReadonlyArray<string>): ReadonlyArray<ScopeMatcher> =>
  patterns.map((pattern) => {
    const normalized = normalizeScopePattern(pattern)
    const directoryGlob = normalized.endsWith("/**") ? normalized.slice(0, -3) : null
    return { path: globToRegExp(normalized), directory: directoryGlob === null ? null : globToRegExp(directoryGlob) }
  })

const matchesAny = (matchers: ReadonlyArray<ScopeMatcher>, file: string): boolean =>
  matchers.some((matcher) => matcher.path.test(file))

const excludesDirectory = (matchers: ReadonlyArray<ScopeMatcher>, directory: string): boolean =>
  matchers.some((matcher) => matcher.directory?.test(directory) === true || matcher.path.test(directory))

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")
/** `fileSha256` promises the file's bytes, so it hashes the buffer rather than decoded text. */
const sha256Bytes = (value: Buffer): string => createHash("sha256").update(value).digest("hex")

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null)
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null
const asPositiveInt = (value: unknown): number | null => {
  const number = asNumber(value)
  return number === null || !Number.isInteger(number) || number < 1 ? null : number
}

const hasSourceExtension = (file: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension))

const toRepoRelative = (root: string, absolute: string): string => relative(root, absolute).split(sep).join("/")

/**
 * Signals report some files as absolute paths. An absolute path inside the repository is
 * normalized to its repo-relative form before it reaches a stable key, the scope filter, the
 * extent callback or the output, so the same content yields the same ids wherever the repository
 * is checked out. An absolute path that resolves outside the root is returned unchanged and then
 * rejected by the safety rules with a reason.
 */
const normalizeReportedPath = (lexicalRoot: string, root: string, file: string): string => {
  if (!isAbsolute(file)) return file
  const resolved = resolve(file)
  if (isInside(lexicalRoot, resolved)) return toRepoRelative(lexicalRoot, resolved)
  if (isInside(root, resolved)) return toRepoRelative(root, resolved)
  return file
}

const isInside = (root: string, candidate: string): boolean => {
  const rel = relative(root, candidate)
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)
}

const lineOfIndex = (text: string, index: number): number => {
  let line = 1
  for (let at = text.indexOf("\n"); at !== -1 && at < index; at = text.indexOf("\n", at + 1)) line += 1
  return line
}

type SourceRead =
  | { readonly ok: true; readonly text: string; readonly fileSha256: string; readonly bytes: number }
  | { readonly ok: false; readonly reason: string }

/**
 * Read one candidate source under the safety rules. A rejected input is reported with a reason;
 * it is never read and never silently dropped.
 */
const readSource = (root: string, file: string, limits: ResolvedLimits): SourceRead => {
  if (file.length === 0) return { ok: false, reason: "path_empty" }
  // Absolute paths are normalized before they reach here; one that survives is outside the root.
  if (isAbsolute(file)) return { ok: false, reason: "path_outside_repo_root" }
  if (!hasSourceExtension(file)) return { ok: false, reason: "non_source_input" }
  if (SECRET_BASENAME.test(basename(file))) return { ok: false, reason: "secret_like_path" }
  const absolute = resolve(root, file)
  if (!isInside(root, absolute)) return { ok: false, reason: "path_escapes_repo" }
  let stats
  try {
    stats = lstatSync(absolute)
  } catch {
    return { ok: false, reason: "path_missing" }
  }
  const leafIsSymlink = stats.isSymbolicLink()
  // Confinement is decided on the fully resolved path, not on the leaf: a symlinked parent
  // directory escapes just as effectively as a symlinked file.
  let target: string
  try {
    target = realpathSync(absolute)
  } catch {
    return { ok: false, reason: leafIsSymlink ? "symlink_unresolvable" : "path_unresolvable" }
  }
  if (!isInside(root, target)) {
    return { ok: false, reason: leafIsSymlink ? "symlink_escapes_repo" : "parent_symlink_escapes_repo" }
  }
  try {
    stats = statSync(target)
  } catch {
    return { ok: false, reason: leafIsSymlink ? "symlink_target_missing" : "path_missing" }
  }
  if (!stats.isFile()) return { ok: false, reason: "not_a_file" }
  if (stats.size > limits.maxSourceFileBytes) return { ok: false, reason: "file_exceeds_size_cap" }
  const buffer = readFileSync(target)
  const text = buffer.toString("utf8")
  if (PRIVATE_KEY_HEADER.test(text)) return { ok: false, reason: "secret_like_content" }
  return { ok: true, text, fileSha256: sha256Bytes(buffer), bytes: buffer.byteLength }
}

const fileLines = (text: string): { readonly lines: ReadonlyArray<string>; readonly lineCount: number } => {
  const lines = text.split("\n")
  // A trailing newline is a terminator, not a final empty line.
  const lineCount = text.endsWith("\n") ? Math.max(lines.length - 1, 1) : Math.max(lines.length, 1)
  return { lines, lineCount }
}

type Snippet = {
  readonly snippet: string
  readonly snippetLines: number
  readonly snippetSha256: string
  readonly clipped: boolean
  /** True when the requested range was not entirely inside the file. */
  readonly outOfRange: boolean
  readonly lineCount: number
}

/**
 * Slice a bounded snippet. A range that does not fit the file is clamped for safety but is
 * always reported: clamping must never look like a complete read.
 */
const snippetOf = (
  text: string,
  startLine: number,
  endLine: number,
  maxSnippetLines: number,
): Snippet => {
  const { lines, lineCount } = fileLines(text)
  const outOfRange = startLine < 1 || endLine < startLine || startLine > lineCount || endLine > lineCount
  const start = Math.min(Math.max(startLine, 1), lineCount)
  const end = Math.min(Math.max(endLine, start), lineCount)
  const available = end - start + 1
  const take = Math.min(available, maxSnippetLines)
  const snippet = lines.slice(start - 1, start - 1 + take).join("\n")
  return { snippet, snippetLines: take, snippetSha256: sha256(snippet), clipped: take < available || outOfRange, outOfRange, lineCount }
}

const pointerOf = (
  root: string,
  file: string,
  startLine: number,
  endLine: number,
  read: Extract<SourceRead, { ok: true }>,
  maxSnippetLines: number,
  extentSource: SourcePointer["extentSource"],
): { readonly pointer: SourcePointer; readonly outOfRange: boolean } => {
  const snippet = snippetOf(read.text, startLine, endLine, maxSnippetLines)
  return {
    pointer: {
      file: toRepoRelative(root, resolve(root, file)),
      startLine,
      endLine,
      extentSource,
      // A file window is complete only when the whole file was read; a parser extent only when the
      // snippet was not clipped.
      extentComplete: extentSource !== "signal_line_only" && !snippet.clipped &&
        (extentSource === "file_window" ? endLine === snippet.lineCount : true),
      fileSha256: read.fileSha256,
      snippet: snippet.snippet,
      snippetLines: snippet.snippetLines,
      snippetSha256: snippet.snippetSha256,
      clipped: snippet.clipped,
    },
    outOfRange: snippet.outOfRange,
  }
}

/** A bounded read of a whole module, for context that is not a claim about one declaration. */
const wholeFilePointer = (
  root: string,
  file: string,
  read: Extract<SourceRead, { ok: true }>,
  maxSnippetLines: number,
): { readonly pointer: SourcePointer; readonly outOfRange: boolean } => {
  const { lineCount } = fileLines(read.text)
  return pointerOf(root, file, 1, lineCount, read, maxSnippetLines, "file_window")
}

// ---------------------------------------------------------------------------------------------
// Extent resolution. A complexity result reports only a start line, so the function's end has to
// come from a parser. There is no built-in reader: the tsgo sync client is Node-only (it throws
// under Bun on `stdout._handle.fd`), and the async client's project program is not reachable at
// runtime. The parent already owns a parser, so extents arrive through `DiscoveryOptions.extents`.
// Without a resolver the extent is reported as missing: the pointer keeps the reported line,
// says `signal_line_only`, sets `extentComplete: false`, and adds an explicit limitation. A
// guessed window is never presented as the function.

// ---------------------------------------------------------------------------------------------
// Source scan: a deterministic, bounded walk plus an import index. This locates lines and import
// specifiers for context. It never classifies code.
// ---------------------------------------------------------------------------------------------

const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => match.replace(/[^\n]/gu, " "))
    .replace(/^([ \t]*)\/\/.*$/gmu, "$1")

const IMPORT_SPECIFIER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfrom\s*["']([^"'\n]+)["']/gu,
  /\bimport\s*["']([^"'\n]+)["']/gu,
  /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/gu,
  /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/gu,
]

const extractImportSpecifiers = (
  text: string,
  max: number,
): { readonly specifiers: ReadonlyArray<{ readonly specifier: string; readonly line: number }>; readonly capped: boolean } => {
  const stripped = stripComments(text)
  const found: Array<{ specifier: string; line: number }> = []
  const seen = new Set<string>()
  for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0
    let match = pattern.exec(stripped)
    while (match !== null) {
      if (found.length >= max) return { specifiers: found, capped: true }
      const specifier = match[1] ?? ""
      if (specifier.length > 0 && !seen.has(specifier)) {
        seen.add(specifier)
        found.push({ specifier, line: lineOfIndex(stripped, match.index) })
      }
      match = pattern.exec(stripped)
    }
  }
  return { specifiers: found, capped: false }
}

type PackageEntry = { readonly dir: string; readonly exports: Record<string, unknown> }

const readJsonRecord = (path: string): Record<string, unknown> | null => {
  try {
    return asRecord(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return null
  }
}

/** Generic npm-workspaces index: package name to directory and declared exports. */
const buildWorkspacePackageIndex = (root: string): { readonly index: ReadonlyMap<string, PackageEntry>; readonly truncated: boolean } => {
  const index = new Map<string, PackageEntry>()
  const manifest = readJsonRecord(join(root, "package.json"))
  if (manifest === null) return { index, truncated: false }
  const patterns = asArray(manifest["workspaces"]).flatMap((value) => (typeof value === "string" ? [value] : []))
  const directories: Array<string> = []
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const parent = pattern.slice(0, -2)
      let entries
      try {
        entries = readdirSync(resolve(root, parent), { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isDirectory() && !entry.isSymbolicLink()) directories.push(`${parent}/${entry.name}`)
      }
    } else if (!pattern.includes("*")) {
      directories.push(pattern)
    }
  }
  let truncated = false
  for (const directory of directories.sort()) {
    if (index.size >= MAX_WORKSPACE_PACKAGES) {
      truncated = true
      break
    }
    const packageManifest = readJsonRecord(resolve(root, directory, "package.json"))
    const name = packageManifest === null ? null : asString(packageManifest["name"])
    if (name === null) continue
    index.set(name, { dir: directory, exports: asRecord(packageManifest?.["exports"]) ?? {} })
  }
  return { index, truncated }
}

const probeSourceFile = (root: string, base: string): string | null => {
  // TypeScript ESM writes `./x.js` for a `./x.ts` source, so a runtime extension is also probed
  // with each source extension in its place.
  const runtimeStripped = base.replace(/\.([cm]?jsx?)$/u, "")
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...(runtimeStripped === base ? [] : SOURCE_EXTENSIONS.map((extension) => `${runtimeStripped}${extension}`)),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
    ...(runtimeStripped === base ? [] : SOURCE_EXTENSIONS.map((extension) => join(runtimeStripped, `index${extension}`))),
  ]
  for (const candidate of candidates) {
    if (!hasSourceExtension(candidate)) continue
    if (!isInside(root, candidate)) continue
    try {
      const stats = lstatSync(candidate)
      if (stats.isFile() && !stats.isSymbolicLink()) return toRepoRelative(root, candidate)
    } catch {
      continue
    }
  }
  return null
}

const splitPackageSpecifier = (specifier: string): { readonly name: string; readonly subpath: string } | null => {
  const segments = specifier.split("/")
  const count = specifier.startsWith("@") ? 2 : 1
  if (segments.length < count || segments[0] === undefined || segments[0].length === 0) return null
  const name = segments.slice(0, count).join("/")
  const rest = segments.slice(count).join("/")
  return { name, subpath: rest.length === 0 ? "." : `./${rest}` }
}

/** Map a build-output export target onto the source that produced it. */
const sourceFromBuildTarget = (target: string): string =>
  target.replace(/^\.\/(dist|build|out)\//u, "./src/").replace(/\.[cm]?jsx?$/u, "")

const resolveSpecifier = (
  root: string,
  fromFile: string,
  specifier: string,
  packages: ReadonlyMap<string, PackageEntry>,
): string | null => {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return probeSourceFile(root, resolve(root, dirname(fromFile), specifier))
  }
  const split = splitPackageSpecifier(specifier)
  if (split === null) return null
  const entry = packages.get(split.name)
  if (entry === undefined) return null
  const exported = entry.exports[split.subpath]
  const target = asString(exported) ??
    asString(asRecord(exported)?.["default"]) ??
    asString(asRecord(exported)?.["import"]) ??
    asString(asRecord(exported)?.["require"])
  if (target !== null) {
    const resolved = probeSourceFile(root, resolve(root, entry.dir, sourceFromBuildTarget(target)))
    if (resolved !== null) return resolved
  }
  const fallback = split.subpath === "." ? "src/index" : `src/${split.subpath.replace(/^\.\//u, "")}`
  return probeSourceFile(root, resolve(root, entry.dir, fallback))
}

type ImportEdge = { readonly file: string; readonly line: number; readonly specifier: string }

type ImportIndex = {
  readonly importsByFile: ReadonlyMap<string, ReadonlyArray<ImportEdge>>
  readonly consumersByFile: ReadonlyMap<string, ReadonlyArray<ImportEdge>>
  readonly filesScanned: number
  readonly filesSkipped: number
  readonly filesSizeCapped: number
  readonly filesUnreadable: number
  readonly importSpecifierCaps: number
  readonly bytesRead: number
  readonly truncated: boolean
  readonly unresolvedSpecifiers: number
  readonly packageIndexTruncated: boolean
}

const buildImportIndex = (
  root: string,
  limits: ResolvedLimits,
  excludeMatchers: ReadonlyArray<ScopeMatcher>,
): ImportIndex => {
  const files: Array<string> = []
  let filesSkipped = 0
  let filesSizeCapped = 0
  let filesUnreadable = 0
  let truncated = false
  const visit = (directory: string): void => {
    if (truncated) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (truncated) return
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        filesSkipped += 1
        continue
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name) || excludesDirectory(excludeMatchers, toRepoRelative(root, absolute))) {
          filesSkipped += 1
          continue
        }
        visit(absolute)
        continue
      }
      if (!entry.isFile()) {
        filesSkipped += 1
        continue
      }
      if (!hasSourceExtension(entry.name)) continue
      if (SECRET_BASENAME.test(entry.name)) {
        filesSkipped += 1
        continue
      }
      const relativeFile = toRepoRelative(root, absolute)
      if (matchesAny(excludeMatchers, relativeFile)) {
        filesSkipped += 1
        continue
      }
      try {
        if (statSync(absolute).size > limits.maxSourceFileBytes) {
          filesSizeCapped += 1
          continue
        }
      } catch {
        filesUnreadable += 1
        continue
      }
      if (files.length >= limits.maxSourceFilesScanned) {
        truncated = true
        return
      }
      files.push(relativeFile)
    }
  }
  visit(root)
  files.sort()

  const packages = buildWorkspacePackageIndex(root)
  const importsByFile = new Map<string, Array<ImportEdge>>()
  const consumersByFile = new Map<string, Array<ImportEdge>>()
  let bytesRead = 0
  let unresolvedSpecifiers = 0
  let importSpecifierCaps = 0
  for (const file of files) {
    const read = readSource(root, file, limits)
    if (!read.ok) {
      filesUnreadable += 1
      continue
    }
    bytesRead += read.bytes
    const extracted = extractImportSpecifiers(read.text, limits.maxImportSpecifiersPerFile)
    if (extracted.capped) importSpecifierCaps += 1
    for (const { specifier, line } of extracted.specifiers) {
      const target = resolveSpecifier(root, file, specifier, packages.index)
      if (target === null) {
        unresolvedSpecifiers += 1
        continue
      }
      if (target === file) continue
      const outgoing = importsByFile.get(file) ?? []
      outgoing.push({ file: target, line, specifier })
      importsByFile.set(file, outgoing)
      const incoming = consumersByFile.get(target) ?? []
      incoming.push({ file, line, specifier })
      consumersByFile.set(target, incoming)
    }
  }
  return {
    importsByFile, consumersByFile,
    filesScanned: files.length, filesSkipped, filesSizeCapped, filesUnreadable, importSpecifierCaps,
    bytesRead, truncated, unresolvedSpecifiers, packageIndexTruncated: packages.truncated,
  }
}

// ---------------------------------------------------------------------------------------------
// Candidate enumeration from signal outputs.
// ---------------------------------------------------------------------------------------------

type RawMember = { readonly file: string; readonly name: string; readonly startLine: number; readonly endLine: number }

type RawCandidate = {
  readonly kind: SemanticCandidateKind
  readonly signalId: string
  readonly outputPath: string
  readonly sourceRank: number
  readonly signalScore: number
  readonly stableKey: string
  readonly importancePrimary: number
  readonly importanceSecondary: number
  readonly members: ReadonlyArray<RawMember>
  /** Clone members already carry parser-exact extents; complexity results carry a start line only. */
  readonly extentsFromParser: boolean
  readonly facts: Record<string, unknown>
}

const readCloneMember = (value: unknown, normalize: (file: string) => string): RawMember | null => {
  const record = asRecord(value)
  if (record === null) return null
  const reported = asString(record["file"])
  const name = asString(record["name"]) ?? ""
  const startLine = asPositiveInt(record["startLine"])
  const endLine = asPositiveInt(record["endLine"])
  if (reported === null || startLine === null || endLine === null || endLine < startLine) return null
  return { file: normalize(reported), name, startLine, endLine }
}

/** All clone groups, in the signal's own order. `output.diagnostics` is deliberately not read. */
const cloneGroupCandidates = (
  signal: SignalRunResultLike,
  normalize: (file: string) => string,
): { readonly candidates: ReadonlyArray<RawCandidate>; readonly groupsAvailable: number; readonly malformed: boolean } => {
  const output = asRecord(signal.output)
  if (output === null) return { candidates: [], groupsAvailable: 0, malformed: true }
  if (!Array.isArray(output["groups"])) return { candidates: [], groupsAvailable: 0, malformed: true }
  const groups = asArray(output["groups"])
  const candidates: Array<RawCandidate> = []
  let groupsAvailable = 0
  let malformed = false
  for (const [index, rawGroup] of groups.entries()) {
    const group = asRecord(rawGroup)
    if (group === null) { malformed = true; continue }
    const members = asArray(group["members"])
      .map((member) => readCloneMember(member, normalize))
      .filter((member): member is RawMember => member !== null)
    if (members.length < 2 || members.length !== asArray(group["members"]).length) { malformed = true; continue }
    const groupId = asString(group["groupId"]) ?? `index-${index}`
    const groupKind = asString(group["kind"]) ?? "unknown"
    const tokenCount = asNumber(group["tokenCount"]) ?? 0
    const structuralHash = asString(group["structuralHash"]) ?? ""
    groupsAvailable += 1
    candidates.push({
      kind: "clone-group",
      signalId: signal.signalId,
      outputPath: `output.groups[${index}]`,
      sourceRank: groupsAvailable - 1,
      signalScore: signal.score,
      stableKey: `${groupKind}:${structuralHash}:${members.map((member) => `${member.file}:${member.startLine}-${member.endLine}`).join("|")}`,
      importancePrimary: members.length,
      importanceSecondary: tokenCount,
      members,
      extentsFromParser: true,
      facts: { groupKind, tokenCount, memberCount: members.length, groupId },
    })
  }
  return { candidates, groupsAvailable, malformed }
}

/**
 * Every measured function, in the signal's own order. The signal's `output.functions` is the full
 * inventory, not the over-threshold subset, so low-complexity functions remain candidates for
 * abstraction questions; `overThresholdCount` is reported separately in `coverage.baseline`.
 */
const complexityCandidates = (
  signal: SignalRunResultLike,
  normalize: (file: string) => string,
): { readonly candidates: ReadonlyArray<RawCandidate>; readonly functionsAvailable: number; readonly malformed: boolean } => {
  const output = asRecord(signal.output)
  if (output === null) return { candidates: [], functionsAvailable: 0, malformed: true }
  if (!Array.isArray(output["functions"])) return { candidates: [], functionsAvailable: 0, malformed: true }
  const functions = asArray(output["functions"])
  const candidates: Array<RawCandidate> = []
  let malformed = false
  for (const [index, rawFunction] of functions.entries()) {
    const record = asRecord(rawFunction)
    if (record === null) { malformed = true; continue }
    const reported = asString(record["file"])
    const name = asString(record["name"])
    const line = asPositiveInt(record["line"])
    const complexity = asNumber(record["complexity"])
    if (reported === null || name === null || line === null || complexity === null) { malformed = true; continue }
    const file = normalize(reported)
    candidates.push({
      kind: "complexity-function",
      signalId: signal.signalId,
      outputPath: `output.functions[${index}]`,
      sourceRank: candidates.length,
      signalScore: signal.score,
      stableKey: `${file}:${name}:${line}`,
      importancePrimary: complexity,
      importanceSecondary: 0,
      members: [{ file, name, startLine: line, endLine: line }],
      extentsFromParser: false,
      facts: {
        functionName: name,
        complexity,
        complexityThreshold: asNumber(output["complexityThreshold"]),
      },
    })
  }
  return { candidates, functionsAvailable: candidates.length, malformed }
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

const compareStrings = (left: string, right: string): number => (left === right ? 0 : left < right ? -1 : 1)

const candidateId = (candidate: RawCandidate): string =>
  `${candidate.kind}:${candidate.signalId}:${sha256(candidate.stableKey).slice(0, 16)}`

/**
 * Discover semantic-question candidates from already-computed signal results.
 *
 * Deterministic: the same repository, signal results and limits produce the same ids and order.
 */
export function collectSemanticCandidates(
  repoRoot: string,
  signalResults: ReadonlyArray<SignalRunResultLike>,
  limits: DiscoveryLimits,
  options: DiscoveryOptions = {},
): DiscoveryResult {
  const resolvedLimits = normalizeLimits(limits)
  const lexicalRoot = resolve(repoRoot)
  const root = realpathSync(lexicalRoot)
  const limitations: Array<string> = []
  const normalize = (file: string): string => normalizeReportedPath(lexicalRoot, root, file)

  const bySignal = new Map(signalResults.map((signal) => [signal.signalId, signal]))
  const cloneSignal = bySignal.get(CLONE_GROUP_SIGNAL)
  const complexitySignal = bySignal.get(COMPLEXITY_SIGNAL)
  const clone = cloneSignal === undefined
    ? { candidates: [], groupsAvailable: 0, malformed: false }
    : cloneGroupCandidates(cloneSignal, normalize)
  const complexity = complexitySignal === undefined
    ? { candidates: [], functionsAvailable: 0, malformed: false }
    : complexityCandidates(complexitySignal, normalize)

  const cloneOutput = cloneSignal === undefined ? null : asRecord(cloneSignal.output)
  const complexityOutput = complexitySignal === undefined ? null : asRecord(complexitySignal.output)
  const signalDiagnosticLimit = cloneOutput === null ? null : asNumber(cloneOutput["diagnosticLimit"])

  const includeMatchers = buildScopeMatchers(resolvedLimits.include)
  const excludeMatchers = buildScopeMatchers(resolvedLimits.exclude)
  const scoped = includeMatchers.length > 0 || excludeMatchers.length > 0
  const inScope = (file: string): boolean =>
    (includeMatchers.length === 0 || matchesAny(includeMatchers, file)) && !matchesAny(excludeMatchers, file)

  const index = buildImportIndex(root, resolvedLimits, excludeMatchers)
  if (index.truncated) limitations.push(`source_scan_truncated_at_maxSourceFilesScanned=${resolvedLimits.maxSourceFilesScanned}`)
  if (index.packageIndexTruncated) limitations.push(`workspace_package_index_truncated_at=${MAX_WORKSPACE_PACKAGES}`)
  if (index.unresolvedSpecifiers > 0) limitations.push(`unresolved_import_specifiers=${index.unresolvedSpecifiers}`)

  const reads = new Map<string, SourceRead>()
  const readOnce = (file: string): SourceRead => {
    const cached = reads.get(file)
    if (cached !== undefined) return cached
    const read = readSource(root, file, resolvedLimits)
    reads.set(file, read)
    return read
  }

  // Safety validation and the repository-owned scope both happen before selection, so a rejected
  // or out-of-scope candidate can never be counted as a discovered one, and the scope never
  // competes with the candidate cap.
  const rejected: Array<{ id: string; kind: SemanticCandidateKind; file: string; reason: string }> = []
  const outOfScope: Array<{ id: string; kind: SemanticCandidateKind; file: string; reason: string }> = []
  const admissible: Array<{ candidate: RawCandidate; members: ReadonlyArray<RawMember>; limitations: ReadonlyArray<string> }> = []
  for (const candidate of [...clone.candidates, ...complexity.candidates]) {
    const id = candidateId(candidate)
    const accepted: Array<RawMember> = []
    const candidateLimitations: Array<string> = []
    let rejectedMember = false
    for (const [position, member] of candidate.members.entries()) {
      const read = readOnce(member.file)
      if (read.ok) {
        accepted.push(member)
        continue
      }
      if (position === 0) {
        rejected.push({ id, kind: candidate.kind, file: member.file, reason: read.reason })
        candidateLimitations.push(`rejected_member:${member.file}:${read.reason}`)
        rejectedMember = true
      } else {
        candidateLimitations.push(`dropped_member:${member.file}:${read.reason}`)
      }
    }
    if (rejectedMember || accepted.length === 0) continue
    const excludedFile = candidate.members.map((member) => member.file).find((file) => !inScope(file))
    if (excludedFile !== undefined) {
      outOfScope.push({ id, kind: candidate.kind, file: excludedFile, reason: "outside_repository_scope" })
      continue
    }
    // A group whose member set lost an unsafe member is still a real finding, but its member set
    // is incomplete and the candidate says so rather than presenting a partial group as whole.
    if (accepted.length < candidate.members.length) {
      candidateLimitations.push(`member_set_incomplete:expected=${candidate.members.length}:admissible=${accepted.length}`)
    }
    admissible.push({
      candidate: { ...candidate, facts: { ...candidate.facts, admissibleMemberCount: accepted.length } },
      members: accepted,
      limitations: candidateLimitations,
    })
  }
  // Out-of-scope candidates are reported structurally in `coverage.scope`; they are a policy
  // boundary, not a clip, so they do not by themselves make `complete` false.

  const rank = (left: { candidate: RawCandidate }, right: { candidate: RawCandidate }): number =>
    right.candidate.importancePrimary - left.candidate.importancePrimary ||
    right.candidate.importanceSecondary - left.candidate.importanceSecondary ||
    compareStrings(candidateId(left.candidate), candidateId(right.candidate))

  const cloneRanked = admissible.filter((entry) => entry.candidate.kind === "clone-group").sort(rank)
  const complexityRanked = admissible.filter((entry) => entry.candidate.kind === "complexity-function").sort(rank)
  // Interleave by rank so neither kind starves the other under maxCandidates.
  const interleaved: typeof admissible = []
  const widest = Math.max(cloneRanked.length, complexityRanked.length)
  for (let position = 0; position < widest; position += 1) {
    const cloneEntry = cloneRanked[position]
    const complexityEntry = complexityRanked[position]
    if (cloneEntry !== undefined) interleaved.push(cloneEntry)
    if (complexityEntry !== undefined) interleaved.push(complexityEntry)
  }

  // A signal can report the same group twice, and two groups can describe the same members. Ids
  // are stable, so a repeated id is a duplicate rather than a second candidate.
  const seenIds = new Set<string>()
  const deduped: typeof admissible = []
  const duplicates: Array<{ id: string; kind: SemanticCandidateKind; reason: string }> = []
  for (const entry of interleaved) {
    const id = candidateId(entry.candidate)
    if (seenIds.has(id)) {
      duplicates.push({ id, kind: entry.candidate.kind, reason: "duplicate_candidate" })
      continue
    }
    seenIds.add(id)
    deduped.push(entry)
  }
  const selected = deduped.slice(0, resolvedLimits.maxCandidates)
  const dropped = deduped.slice(resolvedLimits.maxCandidates)
  // The exact omitted count is always reported; the list itself is bounded so a thousands-strong
  // function inventory cannot turn the payload into a second copy of the repository.
  const omitted = [
    ...duplicates,
    ...dropped.map((entry) => ({
      id: candidateId(entry.candidate),
      kind: entry.candidate.kind,
      reason: "max_candidates",
    })),
  ].slice(0, resolvedLimits.maxOmittedListed)
  // A duplicate is deduplication, not a clipped sample: it is reported but does not make the
  // result partial.
  const omittedCount = dropped.length
  if (dropped.length > 0) limitations.push(`candidates_omitted_by_maxCandidates=${dropped.length}`)

  // Extents: only complexity candidates need a parser, and only for files actually selected.
  const needsExtents = selected.filter((entry) => !entry.candidate.extentsFromParser)
  const extentFiles = [...new Set(needsExtents.map((entry) => entry.candidate.members[0]?.file ?? ""))]
    .filter((file) => file.length > 0)
    .sort()
  const extentFilesOpened = extentFiles.slice(0, resolvedLimits.maxExtentFiles)
  const extentTruncated = extentFiles.length > extentFilesOpened.length
  if (extentTruncated) limitations.push(`extent_resolution_truncated_at_maxExtentFiles=${resolvedLimits.maxExtentFiles}`)
  let resolver = options.extents ?? null
  const resolverKind: DiscoveryCoverage["extents"]["resolver"] =
    needsExtents.length === 0 ? "not_needed" : options.extents !== undefined ? "injected" : "unavailable"
  if (resolver === null && needsExtents.length > 0) {
    limitations.push("function_extent_parser_unavailable:no_extent_resolver_supplied")
  }

  // The resolver is consulted only for files inside the cap; the cap is enforced, not just reported.
  const openedExtentFiles = new Set(extentFilesOpened)
  const consultedExtentFiles = new Set<string>()

  const extentOf = (
    member: RawMember,
    candidate: RawCandidate,
  ): { readonly startLine: number; readonly endLine: number; readonly extentSource: SourcePointer["extentSource"]; readonly limitation: string | null } => {
    if (candidate.extentsFromParser) {
      return { startLine: member.startLine, endLine: member.endLine, extentSource: "parser", limitation: null }
    }
    const missing = (limitation: string) => ({
      startLine: member.startLine, endLine: member.startLine,
      extentSource: "signal_line_only" as const, limitation,
    })
    if (!openedExtentFiles.has(member.file)) return missing(`extent_file_not_opened:${member.file}`)
    consultedExtentFiles.add(member.file)
    const resolved = resolver === null ? null : resolver.resolveFunctionExtent(member.file, member.name, member.startLine)
    if (resolved === null) return missing(`function_extent_missing:${member.file}:${member.name}:${member.startLine}`)
    return { startLine: resolved.startLine, endLine: resolved.endLine, extentSource: "parser", limitation: null }
  }

  const buildCandidate = (entry: (typeof selected)[number]): SemanticCandidate => {
    const candidateLimitations: Array<string> = [...entry.limitations]
    const members: Array<SourcePointer> = []
    for (const member of entry.members) {
      const read = readOnce(member.file)
      if (!read.ok) continue
      const extent = extentOf(member, entry.candidate)
      if (extent.limitation !== null) candidateLimitations.push(extent.limitation)
      const built = pointerOf(root, member.file, extent.startLine, extent.endLine, read, resolvedLimits.maxSnippetLines, extent.extentSource)
      if (built.outOfRange) {
        candidateLimitations.push(`extent_out_of_file:${built.pointer.file}:${extent.startLine}-${extent.endLine}`)
      }
      if (built.pointer.clipped) {
        candidateLimitations.push(`snippet_clipped:${built.pointer.file}:${built.pointer.startLine}-${built.pointer.endLine}->${built.pointer.snippetLines}lines`)
      }
      if (extent.extentSource === "signal_line_only") {
        candidateLimitations.push(`extent_incomplete_no_parser:${built.pointer.file}`)
      }
      members.push(built.pointer)
    }
    const primary = members[0]
    if (primary === undefined) throw new Error(`candidate ${candidateId(entry.candidate)} lost every admissible member`)

    // Include each member's enclosing module, not only other selected functions. Module-local
    // tables and contracts can be the very evidence distinguishing shared from independent rules.
    const collected: Array<ContextPointer> = []
    const contextFiles = new Set<string>()
    const collect = (target: string, role: ContextPointer["role"], reason: string): void => {
      if (contextFiles.has(target)) return
      contextFiles.add(target)
      const read = readOnce(target)
      if (!read.ok) {
        candidateLimitations.push(`context_unreadable:${target}:${read.reason}`)
        return
      }
      const built = wholeFilePointer(root, target, read, resolvedLimits.maxSnippetLines)
      if (built.outOfRange) candidateLimitations.push(`context_range_out_of_file:${target}`)
      if (built.pointer.clipped) {
        candidateLimitations.push(`context_snippet_clipped:${target}:${built.pointer.snippetLines}lines`)
      }
      collected.push({ ...built.pointer, role, reason })
    }
    const memberFiles = [...new Set(members.map((member) => member.file))]
    for (const file of memberFiles) collect(file, "same-file", "enclosing module of a candidate member; includes module-local declarations")
    // Every distinct context file is collected first, so the cap reports actual omissions.
    for (const file of memberFiles) {
      for (const entryImport of index.importsByFile.get(file) ?? []) {
        collect(entryImport.file, "import", `imports ${entryImport.specifier} (declared at ${file}:${entryImport.line})`)
      }
      for (const consumer of index.consumersByFile.get(file) ?? []) {
        collect(
          consumer.file, "consumer",
          `imports this file via ${consumer.specifier} (declared at ${consumer.file}:${consumer.line}); module-level consumer evidence, symbol-level caller analysis not attempted`,
        )
      }
    }

    const bounded: Array<ContextPointer> = []
    let contextBytes = 0
    let omittedByFiles = 0
    let omittedByBytes = 0
    for (const pointer of collected) {
      if (bounded.length >= resolvedLimits.maxContextFiles) {
        omittedByFiles += 1
        continue
      }
      const size = Buffer.byteLength(pointer.snippet, "utf8")
      if (contextBytes + size > resolvedLimits.maxContextBytes) {
        omittedByBytes += 1
        continue
      }
      contextBytes += size
      bounded.push(pointer)
    }
    if (omittedByFiles > 0) candidateLimitations.push(`context_clipped_by_maxContextFiles:omitted=${omittedByFiles}`)
    if (omittedByBytes > 0) candidateLimitations.push(`context_clipped_by_maxContextBytes:omitted=${omittedByBytes}`)
    return {
      id: candidateId(entry.candidate),
      kind: entry.candidate.kind,
      signalId: entry.candidate.signalId,
      provenance: {
        signalId: entry.candidate.signalId,
        outputPath: entry.candidate.outputPath,
        sourceRank: entry.candidate.sourceRank,
        signalScore: entry.candidate.signalScore,
      },
      semanticStatus: "not_assessed",
      primary,
      members,
      context: bounded,
      facts: entry.candidate.facts,
      limitations: candidateLimitations,
    }
  }

  const candidates = selected.map(buildCandidate).sort((left, right) =>
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.primary.file, right.primary.file) ||
    left.primary.startLine - right.primary.startLine ||
    compareStrings(left.id, right.id),
  )

  const selectedCounts = new Map<SemanticCandidateKind, number>()
  for (const candidate of candidates) selectedCounts.set(candidate.kind, (selectedCounts.get(candidate.kind) ?? 0) + 1)

  // Only complexity candidates need a parser; clone members carry their own parser extents and
  // must not inflate the resolved count.
  const extentPopulation = candidates.filter((candidate) => candidate.kind === "complexity-function")
  const extentCounts = {
    requested: extentPopulation.length,
    missing: extentPopulation.filter((candidate) => candidate.members.some((member) => member.extentSource === "signal_line_only")).length,
    resolved: extentPopulation.filter((candidate) => candidate.members.every((member) => member.extentSource !== "signal_line_only")).length,
  }
  if (extentCounts.missing > 0) limitations.push(`function_extents_missing=${extentCounts.missing}`)

  // A required signal that is absent or malformed is not an empty inventory: it is unknown, and an
  // unknown inventory must never read as a clean repository.
  const requiredSignalProblems: Array<string> = []
  for (const [signalId, present, malformed] of [
    [CLONE_GROUP_SIGNAL, cloneSignal !== undefined, clone.malformed] as const,
    [COMPLEXITY_SIGNAL, complexitySignal !== undefined, complexity.malformed] as const,
  ]) {
    if (!present) requiredSignalProblems.push(`required_signal_missing:${signalId}`)
    else if (malformed) requiredSignalProblems.push(`required_signal_output_malformed:${signalId}`)
  }
  limitations.push(...requiredSignalProblems)
  if (index.filesSizeCapped > 0) limitations.push(`source_scan_size_capped_files=${index.filesSizeCapped}`)
  if (index.filesUnreadable > 0) limitations.push(`source_scan_unreadable_files=${index.filesUnreadable}`)
  if (index.importSpecifierCaps > 0) limitations.push(`source_scan_import_list_capped_files=${index.importSpecifierCaps}`)
  if (admissible.length === 0) limitations.push("no_in_scope_candidate_evidence")

  const isContextLimitation = (entry: string): boolean => entry.startsWith("context_")
  const contextClippedCandidates = candidates.filter((candidate) =>
    candidate.limitations.some(isContextLimitation)).length
  const contextOmittedPointers = candidates.reduce(
    (total, candidate) => total + candidate.limitations.reduce((inner, entry) => {
      const omitted = /^context_clipped_by_\w+:omitted=(\d+)$/u.exec(entry)
      return inner + (omitted === null ? 0 : Number(omitted[1]))
    }, 0),
    0,
  )
  const clipped = admissible.length === 0 || omittedCount > 0 ||
    candidates.some((candidate) => candidate.limitations.length > 0) ||
    index.truncated || index.packageIndexTruncated ||
    index.filesSizeCapped > 0 || index.filesUnreadable > 0 || index.importSpecifierCaps > 0 ||
    rejected.length > 0 || extentTruncated || extentCounts.missing > 0 ||
    requiredSignalProblems.length > 0
  if (candidates.some((candidate) => candidate.limitations.some((entry) => entry.startsWith("snippet_clipped")))) {
    limitations.push(`snippets_clipped_at_maxSnippetLines=${resolvedLimits.maxSnippetLines}`)
  }
  if (rejected.length > 0) limitations.push(`candidates_rejected_by_safety_rules=${rejected.length}`)

  return {
    schema: "pulsar.jev_poc_discovery.v1",
    repoRoot: root,
    candidates,
    coverage: {
      complete: !clipped,
      // A scoped sample is a real sample of a scoped question; it is never whole-repository coverage.
      coversWholeRepo: !clipped && !scoped,
      scope: {
        include: resolvedLimits.include,
        exclude: resolvedLimits.exclude,
        scoped,
        inScopeCandidates: admissible.length,
        outOfScopeCount: outOfScope.length,
        outOfScope: outOfScope.slice(0, resolvedLimits.maxOmittedListed),
      },
      signals: [
        {
          signalId: CLONE_GROUP_SIGNAL,
          present: cloneSignal !== undefined,
          malformed: clone.malformed,
          score: cloneSignal?.score ?? null,
          candidatesAvailable: clone.candidates.length,
          candidatesSelected: selectedCounts.get("clone-group") ?? 0,
        },
        {
          signalId: COMPLEXITY_SIGNAL,
          present: complexitySignal !== undefined,
          malformed: complexity.malformed,
          score: complexitySignal?.score ?? null,
          candidatesAvailable: complexity.candidates.length,
          candidatesSelected: selectedCounts.get("complexity-function") ?? 0,
        },
      ],
      baseline: {
        cloneGroupsAvailable: cloneSignal === undefined ? null : clone.groupsAvailable,
        cloneFunctionsAnalyzed: cloneOutput === null ? null : asNumber(cloneOutput["totalFunctionsAnalyzed"]),
        signalDiagnosticLimit,
        cloneGroupsBeyondSignalDiagnosticLimit: signalDiagnosticLimit === null
          ? null
          : Math.max(0, clone.groupsAvailable - signalDiagnosticLimit),
        complexityFunctionsAvailable: complexitySignal === undefined ? null : complexity.functionsAvailable,
        complexityOverThreshold: complexityOutput === null ? null : asNumber(complexityOutput["overThresholdCount"]),
        complexityThreshold: complexityOutput === null ? null : asNumber(complexityOutput["complexityThreshold"]),
        inScopeCloneGroups: cloneRanked.length,
        inScopeComplexityFunctions: complexityRanked.length,
      },
      context: { clippedCandidates: contextClippedCandidates, omittedPointers: contextOmittedPointers },
      sourceScan: {
        filesScanned: index.filesScanned,
        filesSkipped: index.filesSkipped,
        filesSizeCapped: index.filesSizeCapped,
        filesUnreadable: index.filesUnreadable,
        importSpecifierCaps: index.importSpecifierCaps,
        bytesRead: index.bytesRead,
        truncated: index.truncated,
        unresolvedImportSpecifiers: index.unresolvedSpecifiers,
      },
      extents: {
        resolver: resolverKind,
        requested: extentCounts.requested,
        resolved: extentCounts.resolved,
        missing: extentCounts.missing,
        filesOpened: 0,
        filesConsulted: consultedExtentFiles.size,
        truncated: extentTruncated,
        failureReason: resolverKind === "unavailable" ? "no_extent_resolver_supplied" : null,
      },
      totalCandidates: clone.candidates.length + complexity.candidates.length,
      selectedCandidates: candidates.length,
      omittedCount,
      duplicatesRemoved: duplicates.length,
      omitted,
      rejected,
      limitations,
      limits: resolvedLimits,
    },
  }
}
