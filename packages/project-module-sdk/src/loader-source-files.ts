import { createRequire } from "node:module"
import { dirname, extname, resolve } from "node:path"
import { Effect } from "effect"
import { ProjectModuleLoadError } from "./loader-types.js"
import type { ProjectModuleRef } from "./manifest.js"
import {
  isPathInside,
  isRecord,
  realFileOption,
  toSourceRef,
} from "./loader-paths.js"

export interface ProjectModuleSourceFile {
  readonly sourceRef: string
  readonly path: string
}

const PROJECT_MODULE_SOURCE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json",
] as const

export const collectProjectModuleSourceFiles = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  sourceRefForPath: (path: string) => string,
): Effect.Effect<ReadonlyArray<ProjectModuleSourceFile>, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const files: Array<ProjectModuleSourceFile> = []
    const seen = new Set<string>()
    const sourcePackageName = yield* readProjectModulePackageNameOption(
      ref,
      target,
      sourceRoot,
    )
    const addFile = (path: string): void => {
      if (seen.has(path)) return
      seen.add(path)
      files.push({
        sourceRef: sourceRefForPath(path),
        path,
      })
    }
    const visit = (path: string): Effect.Effect<void, ProjectModuleLoadError> =>
      Effect.gen(function* () {
        const resolvedPath = yield* realpathOrSourceError(ref, target, path)
        if (!isPathInside(sourceRoot, resolvedPath)) {
          return yield* new ProjectModuleLoadError({
            refId: ref.id,
            target,
            message: `Project module ${ref.id} imports source outside its owned source root`,
          })
        }
        if (seen.has(resolvedPath)) return
        addFile(resolvedPath)

        if (!isJavaScriptLikeProjectModuleSource(resolvedPath)) return
        const content = yield* readSourceFile(ref, target, resolvedPath)
        for (const specifier of projectModuleSourceSpecifiers(content)) {
          const importedPath = yield* resolveOwnedProjectModuleSourceSpecifier(
            ref,
            target,
            sourceRoot,
            resolvedPath,
            specifier,
            sourcePackageName,
          )
          if (importedPath !== undefined) {
            yield* visit(importedPath)
          }
        }
      })

    yield* visit(target)
    const packageJsonPath = yield* realFileOption(resolve(sourceRoot, "package.json"))
    if (packageJsonPath !== undefined && isPathInside(sourceRoot, packageJsonPath)) {
      addFile(packageJsonPath)
    }
    return files
  })

/**
 * TypeScript 7 is the native compiler and no longer ships the legacy
 * JavaScript compiler API, so `preProcessFile` is unavailable. This loader
 * only needs the narrow contract that API was used for: statically collect
 * the module specifiers of `import`/`export` declarations, dynamic
 * `import()` calls, `require()` calls, AMD `define()` dependencies,
 * `import x = require(...)` assignments, and `/// <reference path="..." />`
 * directives (the union of `preProcessFile`'s `importedFiles` and
 * `referencedFiles`). The scanner below implements exactly that contract;
 * resolution and ownership filtering are unchanged.
 */
type ProjectModuleSourceToken =
  | { readonly kind: "name"; readonly value: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "punct"; readonly value: string }

const PROJECT_MODULE_SOURCE_REFERENCE_PATH =
  /^\/\/\/\s*<reference\b[^>]*?\bpath\s*=\s*["']([^"']+)["']/

const PROJECT_MODULE_SOURCE_REGEXP_PRECEDING_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
])

const projectModuleSourceSpecifiers = (
  content: string,
): ReadonlyArray<string> =>
  [...collectProjectModuleSourceSpecifiers(content)].sort()

const collectProjectModuleSourceSpecifiers = (
  content: string,
): Set<string> => {
  const specifiers = new Set<string>()
  const tokens = tokenizeProjectModuleSource(content, specifiers)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token?.kind !== "name") continue
    if (token.value === "import" && !isProjectModuleSourcePropertyName(tokens, index)) {
      collectProjectModuleImportSpecifier(tokens, index, specifiers)
    } else if (
      token.value === "export" &&
      !isProjectModuleSourcePropertyName(tokens, index)
    ) {
      collectProjectModuleExportSpecifier(tokens, index, specifiers)
    } else if (token.value === "require") {
      collectProjectModuleRequireSpecifier(tokens, index, specifiers)
    } else if (token.value === "define") {
      collectProjectModuleDefineSpecifiers(tokens, index, specifiers)
    }
  }
  return specifiers
}

const tokenizeProjectModuleSource = (
  content: string,
  specifiers: Set<string>,
): ReadonlyArray<ProjectModuleSourceToken> => {
  const tokens: Array<ProjectModuleSourceToken> = []
  let index = 0
  while (index < content.length) {
    const char = content[index]
    if (char === undefined) break
    if (isProjectModuleSourceWhitespace(char)) {
      index += 1
      continue
    }
    if (char === "/" && content[index + 1] === "/") {
      const end = content.indexOf("\n", index)
      const comment = end === -1 ? content.slice(index) : content.slice(index, end)
      const reference = PROJECT_MODULE_SOURCE_REFERENCE_PATH.exec(comment)
      if (reference !== null) {
        const path = reference[1]
        if (path !== undefined) specifiers.add(path)
      }
      index = end === -1 ? content.length : end
      continue
    }
    if (char === "/" && content[index + 1] === "*") {
      const end = content.indexOf("*/", index + 2)
      index = end === -1 ? content.length : end + 2
      continue
    }
    if (char === "'" || char === '"' || char === "`") {
      const scanned = scanProjectModuleSourceString(content, index)
      for (const expression of scanned.expressions) {
        for (const specifier of collectProjectModuleSourceSpecifiers(expression)) {
          specifiers.add(specifier)
        }
      }
      if (scanned.plain) {
        tokens.push({ kind: "string", value: scanned.value })
      }
      index = scanned.end
      continue
    }
    if (isProjectModuleSourceIdentifierStart(char)) {
      const start = index
      index += 1
      while (index < content.length) {
        const nextChar = content[index]
        if (nextChar === undefined || !isProjectModuleSourceIdentifierPart(nextChar)) {
          break
        }
        index += 1
      }
      tokens.push({ kind: "name", value: content.slice(start, index) })
      continue
    }
    if (char === "/") {
      const end = scanProjectModuleSourceRegExp(content, index, tokens)
      if (end !== undefined) {
        index = end
        continue
      }
    }
    tokens.push({ kind: "punct", value: char })
    index += 1
  }
  return tokens
}

const scanProjectModuleSourceString = (
  content: string,
  start: number,
): {
  readonly value: string
  readonly end: number
  readonly plain: boolean
  readonly expressions: ReadonlyArray<string>
} => {
  const quote = content[start]
  if (quote !== "`") {
    let index = start + 1
    let value = ""
    while (index < content.length) {
      const char = content[index]
      if (char === "\\") {
        value += char
        if (index + 1 < content.length) {
          value += content[index + 1]
          index += 2
        } else {
          index += 1
        }
        continue
      }
      if (char === quote) {
        return {
          value: decodeProjectModuleSourceString(value),
          end: index + 1,
          plain: true,
          expressions: [],
        }
      }
      value += char
      index += 1
    }
    return { value, end: content.length, plain: false, expressions: [] }
  }
  let index = start + 1
  let value = ""
  const expressions: Array<string> = []
  while (index < content.length) {
    const char = content[index]
    if (char === "\\") {
      value += char
      if (index + 1 < content.length) value += content[index + 1]
      index += 2
      continue
    }
    if (char === "$" && content[index + 1] === "{") {
      const expression = scanProjectModuleTemplateExpression(content, index + 2)
      expressions.push(expression.value)
      index = expression.end
      continue
    }
    if (char === "`") {
      return {
        value: decodeProjectModuleSourceString(value),
        end: index + 1,
        plain: expressions.length === 0,
        expressions,
      }
    }
    value += char
    index += 1
  }
  return { value, end: content.length, plain: false, expressions }
}

const decodeProjectModuleSourceString = (raw: string): string => {
  let value = ""
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char !== "\\") {
      value += char
      continue
    }

    const escaped = raw[index + 1]
    if (escaped === undefined) return `${value}\\`
    if (escaped === "\n") {
      index += 1
      continue
    }
    if (escaped === "\r") {
      index += raw[index + 2] === "\n" ? 2 : 1
      continue
    }
    const simpleEscape = PROJECT_MODULE_SOURCE_SIMPLE_ESCAPES[escaped]
    if (simpleEscape !== undefined) {
      value += simpleEscape
      index += 1
      continue
    }
    if (escaped === "x") {
      const hex = raw.slice(index + 2, index + 4)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        value += String.fromCharCode(Number.parseInt(hex, 16))
        index += 3
        continue
      }
    } else if (escaped === "u") {
      const braced = /^\{([0-9A-Fa-f]{1,6})\}/.exec(raw.slice(index + 2))
      if (braced !== null) {
        const codePoint = Number.parseInt(braced[1] ?? "", 16)
        if (codePoint <= 0x10ffff) {
          value += String.fromCodePoint(codePoint)
          index += 1 + braced[0].length
          continue
        }
      }
      const hex = raw.slice(index + 2, index + 6)
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        value += String.fromCharCode(Number.parseInt(hex, 16))
        index += 5
        continue
      }
    }

    value += escaped
    index += 1
  }
  return value
}

const PROJECT_MODULE_SOURCE_SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  "0": "\0",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
}

const scanProjectModuleTemplateExpression = (
  content: string,
  start: number,
): { readonly value: string; readonly end: number } => {
  let index = start
  let depth = 1
  while (index < content.length) {
    const char = content[index]
    if (char === "'" || char === '"' || char === "`") {
      index = scanProjectModuleSourceString(content, index).end
      continue
    }
    if (char === "/" && content[index + 1] === "/") {
      const end = content.indexOf("\n", index + 2)
      index = end === -1 ? content.length : end
      continue
    }
    if (char === "/" && content[index + 1] === "*") {
      const end = content.indexOf("*/", index + 2)
      index = end === -1 ? content.length : end + 2
      continue
    }
    if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return { value: content.slice(start, index), end: index + 1 }
      }
    }
    index += 1
  }
  return { value: content.slice(start), end: content.length }
}

const scanProjectModuleSourceRegExp = (
  content: string,
  start: number,
  tokens: ReadonlyArray<ProjectModuleSourceToken>,
): number | undefined => {
  if (!isProjectModuleSourceRegExpStart(tokens)) return undefined
  let index = start + 1
  let inCharacterClass = false
  while (index < content.length) {
    const char = content[index]
    if (char === "\\") {
      index += 2
      continue
    }
    if (char === "[") {
      inCharacterClass = true
    } else if (char === "]") {
      inCharacterClass = false
    } else if (char === "/" && !inCharacterClass) {
      return index + 1
    } else if (char === "\n") {
      return undefined
    }
    index += 1
  }
  return undefined
}

const isProjectModuleSourceRegExpStart = (
  tokens: ReadonlyArray<ProjectModuleSourceToken>,
): boolean => {
  const previous = tokens[tokens.length - 1]
  if (previous === undefined) return true
  if (previous.kind === "name") {
    return PROJECT_MODULE_SOURCE_REGEXP_PRECEDING_KEYWORDS.has(previous.value)
  }
  if (previous.kind === "string") return false
  return (
    previous.value !== ")" &&
    previous.value !== "]" &&
    previous.value !== "}" &&
    !/[0-9]/.test(previous.value)
  )
}

const isProjectModuleSourcePropertyName = (
  tokens: ReadonlyArray<ProjectModuleSourceToken>,
  index: number,
): boolean => {
  const previous = tokens[index - 1]
  return previous?.kind === "punct" && previous.value === "."
}

const collectProjectModuleImportSpecifier = (
  tokens: ReadonlyArray<ProjectModuleSourceToken>,
  index: number,
  specifiers: Set<string>,
): void => {
  const next = tokens[index + 1]
  if (next === undefined) return
  if (next.kind === "punct" && next.value === "(") {
    const specifier = tokens[index + 2]
    if (specifier?.kind === "string") specifiers.add(specifier.value)
    return
  }
  if (next.kind === "string") {
    specifiers.add(next.value)
    return
  }
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const current = tokens[cursor]
    if (current === undefined) continue
    if (current.kind === "punct" && current.value === ";") return
    if (current.kind === "name" && current.value === "from") {
      const specifier = tokens[cursor + 1]
      if (specifier?.kind === "string") specifiers.add(specifier.value)
      return
    }
    if (current.kind === "name" && current.value === "require") {
      const previous = tokens[cursor - 1]
      const open = tokens[cursor + 1]
      const specifier = tokens[cursor + 2]
      if (
        previous?.kind === "punct" &&
        previous.value === "=" &&
        open?.kind === "punct" &&
        open.value === "(" &&
        specifier?.kind === "string"
      ) {
        specifiers.add(specifier.value)
      }
      return
    }
  }
}

const collectProjectModuleExportSpecifier = (
  tokens: ReadonlyArray<ProjectModuleSourceToken>,
  index: number,
  specifiers: Set<string>,
): void => {
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const current = tokens[cursor]
    if (current === undefined) continue
    if (current.kind === "punct" && current.value === ";") return
    if (current.kind === "name" && current.value === "from") {
      const specifier = tokens[cursor + 1]
      if (specifier?.kind === "string") specifiers.add(specifier.value)
      return
    }
  }
}

const collectProjectModuleRequireSpecifier = (
  tokens: ReadonlyArray<ProjectModuleSourceToken>,
  index: number,
  specifiers: Set<string>,
): void => {
  const open = tokens[index + 1]
  const specifier = tokens[index + 2]
  if (
    open?.kind === "punct" &&
    open.value === "(" &&
    specifier?.kind === "string"
  ) {
    specifiers.add(specifier.value)
  }
}

const collectProjectModuleDefineSpecifiers = (
  tokens: ReadonlyArray<ProjectModuleSourceToken>,
  index: number,
  specifiers: Set<string>,
): void => {
  if (tokens[index + 1]?.value !== "(") return
  let cursor = index + 2
  if (tokens[cursor]?.kind === "string") cursor += 1
  while (cursor < tokens.length && tokens[cursor]?.value !== "[") cursor += 1
  if (tokens[cursor]?.value !== "[") return
  for (cursor += 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor]
    if (token?.value === "]") return
    if (token?.kind === "string") specifiers.add(token.value)
  }
}

const isProjectModuleSourceWhitespace = (char: string): boolean =>
  char === " " ||
  char === "\t" ||
  char === "\n" ||
  char === "\r" ||
  char === "\u000b" ||
  char === "\u000c" ||
  char === "\u00a0" ||
  char === "\ufeff"

const isProjectModuleSourceIdentifierStart = (char: string): boolean =>
  /[A-Za-z_$]/.test(char)

const isProjectModuleSourceIdentifierPart = (char: string): boolean =>
  /[A-Za-z0-9_$]/.test(char)

const resolveOwnedProjectModuleSourceSpecifier = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromFile: string,
  specifier: string,
  sourcePackageName: string | undefined,
): Effect.Effect<string | undefined, ProjectModuleLoadError> => {
  if (isRelativeModuleSpecifier(specifier)) {
    return resolveLocalProjectModuleSourceFile(
      ref,
      target,
      sourceRoot,
      dirname(fromFile),
      specifier,
    )
  }

  if (!isOwnedPackageModuleSpecifier(specifier, sourcePackageName)) {
    return Effect.succeed(undefined)
  }

  return resolvePackageLocalProjectModuleSourceFile(
    ref,
    target,
    sourceRoot,
    fromFile,
    specifier,
  )
}

const resolveLocalProjectModuleSourceFile = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromDirectory: string,
  specifier: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const requestedPath = resolve(fromDirectory, specifier)
    if (!isPathInside(sourceRoot, requestedPath)) {
      return yield* outsideOwnedSourceError(ref, target)
    }

    for (const candidate of localProjectModuleSourceCandidates(requestedPath)) {
      const file = yield* realFileOption(candidate)
      if (file === undefined) continue
      if (!isPathInside(sourceRoot, file)) {
        return yield* outsideOwnedSourceError(ref, target)
      }
      return file
    }

    return undefined
  })

const resolvePackageLocalProjectModuleSourceFile = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromFile: string,
  specifier: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.sync(() => {
      try {
        return createRequire(fromFile).resolve(specifier)
      } catch {
        return undefined
      }
    })
    if (resolved === undefined) return undefined
    const file = yield* realFileOption(resolved)
    if (file === undefined) return undefined
    if (!isPathInside(sourceRoot, file)) return undefined
    return file
  })

const readProjectModulePackageNameOption = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageJsonPath = yield* realFileOption(resolve(sourceRoot, "package.json"))
    if (packageJsonPath === undefined) return undefined
    const packageJson = yield* readSourceFile(ref, target, packageJsonPath)
    const parsed = yield* Effect.try({
      try: () => JSON.parse(packageJson) as unknown,
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to parse project module package scope manifest`,
          cause,
        }),
    })
    const name = isRecord(parsed) ? parsed.name : undefined
    return typeof name === "string" ? name : undefined
  })

const localProjectModuleSourceCandidates = (requestedPath: string): ReadonlyArray<string> => {
  const candidates = new Set<string>([requestedPath])
  for (const extension of PROJECT_MODULE_SOURCE_EXTENSIONS) {
    candidates.add(`${requestedPath}${extension}`)
    candidates.add(resolve(requestedPath, `index${extension}`))
  }
  return [...candidates]
}

const isJavaScriptLikeProjectModuleSource = (path: string): boolean =>
  new Set(PROJECT_MODULE_SOURCE_EXTENSIONS).has(
    extname(path) as (typeof PROJECT_MODULE_SOURCE_EXTENSIONS)[number],
  ) && extname(path) !== ".json"

const isRelativeModuleSpecifier = (specifier: string): boolean =>
  specifier.startsWith("./") || specifier.startsWith("../")

const isOwnedPackageModuleSpecifier = (
  specifier: string,
  sourcePackageName: string | undefined,
): boolean =>
  specifier.startsWith("#") ||
  (sourcePackageName !== undefined &&
    (specifier === sourcePackageName || specifier.startsWith(`${sourcePackageName}/`)))

const realpathOrSourceError = (
  ref: ProjectModuleRef,
  target: string,
  path: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: async () => {
      const { realpath } = await import("node:fs/promises")
      return realpath(path)
    },
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Failed to resolve project module source file ${path}`,
        cause,
      }),
  })

const readSourceFile = (
  ref: ProjectModuleRef,
  target: string,
  path: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.tryPromise({
    try: async () => {
      const { readFile } = await import("node:fs/promises")
      return readFile(path, "utf8")
    },
    catch: (cause) =>
      new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Failed to read project module source file ${path}`,
        cause,
      }),
  })

const outsideOwnedSourceError = (
  ref: ProjectModuleRef,
  target: string,
): ProjectModuleLoadError =>
  new ProjectModuleLoadError({
    refId: ref.id,
    target,
    message: `Project module ${ref.id} imports local source outside its owned source root`,
  })
