import { createHash } from "node:crypto"
import type { RoutingDiff } from "@skastr0/pulsar-core/routing"
import { normalizeWorktreeRelativePath } from "./path-utils"

export const EDIT_TOOLS = new Set(["write", "edit", "apply_patch", "morph-mcp_edit_file"])

export const fingerprintOf = (value: unknown): string => {
  const hash = createHash("sha256")
  hash.update(JSON.stringify(value))
  return hash.digest("hex")
}

export const buildRoutingDiffFromToolArgs = (
  tool: string,
  args: Readonly<Record<string, unknown>>,
  worktree: string,
): RoutingDiff => {
  const patchText = args.patchText
  if (tool === "apply_patch" && typeof patchText === "string") {
    return parseApplyPatch(patchText, worktree)
  }

  const filePath = firstPathArg(args, worktree)
  if (filePath === undefined) {
    return {
      changedFiles: [],
      changedHunks: [],
      addedFiles: [],
      addedImports: [],
      astMatches: [],
      signalChanges: {},
    }
  }

  const snippets = collectContentSnippets(args)
  const addedImports = snippets.flatMap((snippet, index) =>
    parseImportsFromSnippet(filePath, snippet, index === 0 ? 1 : undefined),
  )
  const astMatches = snippets.flatMap((snippet) =>
    parseAstMatchesFromSnippet(filePath, snippet),
  )

  return {
    changedFiles: [filePath],
    changedHunks: [buildWholeFileHunk(filePath)],
    addedFiles: [],
    addedImports,
    astMatches,
    signalChanges: {},
  }
}

export const recordFromUnknown = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value))
}

const parseApplyPatch = (patchText: string, worktree: string): RoutingDiff => {
  const changedFiles = new Set<string>()
  const addedFiles = new Set<string>()
  const addedImports: Array<RoutingDiff["addedImports"][number]> = []
  const astMatches: Array<RoutingDiff["astMatches"][number]> = []
  let currentFile: string | undefined
  let currentLine = 1

  for (const rawLine of patchText.split(/\r?\n/)) {
    const header = parseApplyPatchFileHeader(rawLine, worktree)
    if (header !== undefined) {
      currentFile = header.file
      changedFiles.add(header.file)
      if (header.added) addedFiles.add(header.file)
      currentLine = 1
      continue
    }
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue
    if (currentFile === undefined) continue

    const line = rawLine.slice(1)
    addedImports.push(...parseImportsFromSnippet(currentFile, line, currentLine))
    astMatches.push(...parseAstMatchesFromSnippet(currentFile, line, currentLine))
    currentLine += 1
  }

  return {
    changedFiles: [...changedFiles],
    changedHunks: [...changedFiles].map((file) => buildWholeFileHunk(file)),
    addedFiles: [...addedFiles],
    addedImports,
    astMatches,
    signalChanges: {},
  }
}

const parseApplyPatchFileHeader = (
  rawLine: string,
  worktree: string,
): { readonly file: string; readonly added: boolean } | undefined => {
  const prefixes = [
    { prefix: "*** Add File: ", added: true },
    { prefix: "*** Update File: ", added: false },
    { prefix: "*** Delete File: ", added: false },
  ] as const
  const matched = prefixes.find((entry) => rawLine.startsWith(entry.prefix))
  if (matched === undefined) return undefined
  return {
    file: normalizeWorktreeRelativePath(worktree, rawLine.slice(matched.prefix.length)),
    added: matched.added,
  }
}

const collectContentSnippets = (
  args: Readonly<Record<string, unknown>>,
): ReadonlyArray<string> =>
  [args.code_edit, args.content, args.newString, args.replacement, args.text].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  )

const buildWholeFileHunk = (
  file: string,
): RoutingDiff["changedHunks"][number] => ({
  file,
  oldStart: 1,
  oldLines: Number.MAX_SAFE_INTEGER,
  newStart: 1,
  newLines: Number.MAX_SAFE_INTEGER,
})

const firstPathArg = (
  args: Readonly<Record<string, unknown>>,
  worktree: string,
): string | undefined => {
  for (const candidate of [args.path, args.filePath]) {
    if (typeof candidate !== "string" || candidate.length === 0) continue
    return normalizeWorktreeRelativePath(worktree, candidate)
  }
  return undefined
}

const parseImportsFromSnippet = (
  file: string,
  snippet: string,
  lineOffset?: number,
): ReadonlyArray<RoutingDiff["addedImports"][number]> => {
  const matches: Array<RoutingDiff["addedImports"][number]> = []
  const regexes = [
    /(?:import|export)\s+[^\n]*?from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ]

  for (const [index, line] of snippet.split(/\r?\n/).entries()) {
    for (const regex of regexes) {
      for (const match of line.matchAll(regex)) {
        const specifier = match[1]
        if (specifier === undefined) continue
        const base = { file, specifier }
        matches.push(
          lineOffset === undefined ? base : { ...base, line: lineOffset + index },
        )
      }
    }
  }

  return matches
}

const parseAstMatchesFromSnippet = (
  file: string,
  snippet: string,
  lineOffset = 1,
): ReadonlyArray<RoutingDiff["astMatches"][number]> => {
  if (!file.endsWith(".rs")) return []

  return snippet.split(/\r?\n/).flatMap((line, index) =>
    /\bunsafe\b/.test(line)
      ? [
          {
            signalId: "RS-LD-01",
            outputKey: "new-unsafe-block",
            location: { file, line: lineOffset + index },
          },
        ]
      : [],
  )
}
