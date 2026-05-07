import { Context, Effect, Layer } from "effect"
import { readdir, readFile } from "node:fs/promises"
import { join, extname } from "node:path"

/**
 * Service tag for markdown project context.
 * 
 * Similar to TsProjectTag or RustProjectTag, this provides domain-specific
 * context that markdown signals need for analysis.
 */
export interface MarkdownProject {
  readonly worktreePath: string
  readonly markdownFiles: ReadonlyArray<string>
  readonly totalWordCount: number
}

export class MarkdownProjectTag extends Context.Tag("@community/markdown/MarkdownProject")<
  MarkdownProjectTag,
  MarkdownProject
>() {}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".output",
  "coverage",
  ".turbo",
  ".cache",
  "target",
])

const discoverMarkdownFiles = (rootDir: string): Effect.Effect<ReadonlyArray<string>> =>
  Effect.promise(async () => {
    const files: Array<string> = []
    
    async function walk(dir: string): Promise<void> {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue
            await walk(join(dir, entry.name))
          } else if (
            extname(entry.name) === ".md" ||
            extname(entry.name) === ".mdx"
          ) {
            files.push(join(dir, entry.name))
          }
        }
      } catch {
        // Ignore permission errors
      }
    }
    
    await walk(rootDir)
    return files.sort()
  })

const countWordsInMarkdown = (content: string): number => {
  // Simple word count: split on whitespace and count non-empty tokens
  // In production, this would strip frontmatter, code blocks, etc.
  const text = content
    .replace(/---[\s\S]*?---/g, "") // Remove YAML frontmatter
    .replace(/```[\s\S]*?```/g, "") // Remove code blocks
    .replace(/`[^`]*`/g, "") // Remove inline code
    .replace(/[#*\[\]()\-_]/g, " ") // Remove markdown syntax
  
  return text
    .split(/\s+/)
    .filter(token => token.length > 0 && /\w/.test(token))
    .length
}

const computeTotalWordCount = (files: ReadonlyArray<string>): Effect.Effect<number> =>
  Effect.promise(async () => {
    let total = 0
    for (const file of files) {
      try {
        const content = await readFile(file, "utf8")
        total += countWordsInMarkdown(content)
      } catch {
        // Skip unreadable files
      }
    }
    return total
  })

export const makeMarkdownProject = (worktreePath: string): Effect.Effect<MarkdownProject> =>
  Effect.gen(function* () {
    const files = yield* discoverMarkdownFiles(worktreePath)
    const wordCount = yield* computeTotalWordCount(files)
    
    return {
      worktreePath,
      markdownFiles: files,
      totalWordCount: wordCount,
    }
  })

/**
 * Layer providing MarkdownProject service.
 * 
 * This demonstrates the community signal pattern: domain-specific
 * services are provided via Effect Layer, consumed by signals.
 */
export const MarkdownProjectLayer = (worktreePath: string): Layer.Layer<MarkdownProjectTag> =>
  Layer.effect(MarkdownProjectTag, makeMarkdownProject(worktreePath))
