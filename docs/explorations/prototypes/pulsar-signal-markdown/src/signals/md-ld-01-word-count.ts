import type { Diagnostic, DistributionalSummary, Signal } from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { MarkdownProjectTag } from "../project.js"

/**
 * MD-LD-01: Markdown word count distribution
 * 
 * A Tier 1 legibility signal measuring documentation size.
 * Demonstrates community signal interface compliance.
 * 
 * Signal ID prefix: MD = Markdown domain
 * Category: LD = Legibility decay
 * Number: 01 = First signal in category
 */

export const MdLd01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_file_words: Schema.Number,
  min_file_words: Schema.Number,
})
export type MdLd01Config = typeof MdLd01Config.Type

export interface MdFileStats {
  readonly file: string
  readonly wordCount: number
  readonly lineCount: number
}

export interface MdLd01Output {
  readonly files: ReadonlyArray<MdFileStats>
  readonly totalWords: number
  readonly totalFiles: number
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overMaxCount: number
  readonly underMinCount: number
  readonly analysisMode: "standard-word-count"
}

const countWords = (content: string): number => {
  const cleaned = content
    .replace(/---[\s\S]*?---/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "")
  
  return cleaned
    .split(/\s+/)
    .filter(token => token.length > 0 && /\w/.test(token))
    .length
}

const countLines = (content: string): number => {
  return content.split(/\r?\n/).length
}

export const MarkdownWordCount: Signal<MdLd01Config, MdLd01Output, MarkdownProjectTag> = {
  id: "MD-LD-01",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: MdLd01Config,
  defaultConfig: {
    exclude_globs: ["**/node_modules/**", "**/dist/**", "**/target/**"],
    max_file_words: 3000,
    min_file_words: 50,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* MarkdownProjectTag
      
      return yield* Effect.tryPromise({
        try: async (): Promise<MdLd01Output> => {
          const { readFile } = await import("node:fs/promises")
          
          const files: Array<MdFileStats> = []
          for (const file of project.markdownFiles) {
            const content = await readFile(file, "utf8")
            files.push({
              file,
              wordCount: countWords(content),
              lineCount: countLines(content),
            })
          }
          
          files.sort((a, b) => b.wordCount - a.wordCount || a.file.localeCompare(b.file))
          
          const totalWords = files.reduce((sum, f) => sum + f.wordCount, 0)
          const overMaxCount = files.filter(f => f.wordCount > config.max_file_words).length
          const underMinCount = files.filter(f => f.wordCount < config.min_file_words).length
          
          // Build per-file distributional summary (simplified)
          const byFile = new Map<string, DistributionalSummary>()
          for (const f of files) {
            byFile.set(f.file, {
              count: 1,
              mean: f.wordCount,
              median: f.wordCount,
              p95: f.wordCount,
              min: f.wordCount,
              max: f.wordCount,
            } as DistributionalSummary)
          }
          
          return {
            files,
            totalWords,
            totalFiles: files.length,
            byFile,
            overMaxCount,
            underMinCount,
            analysisMode: "standard-word-count",
          }
        },
        catch: (cause) => new Error(`MD-LD-01 compute failed: ${String(cause)}`),
      })
    }),
  score: (out) => {
    if (out.totalFiles === 0) return 1
    
    // Penalize files that are too long or too short
    const violationRate = (out.overMaxCount + out.underMinCount) / out.totalFiles
    return Math.max(0, 1 - violationRate)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    
    for (const f of out.files.slice(0, 10)) {
      let severity: "info" | "warn" | "error" = "info"
      let message = `File has ${f.wordCount} words`
      
      if (f.wordCount > 3000) {
        severity = "warn"
        message = `Documentation file is very long (${f.wordCount} words) — consider splitting`
      } else if (f.wordCount < 50) {
        severity = "warn"
        message = `Documentation file is very short (${f.wordCount} words) — may be incomplete`
      }
      
      diagnostics.push({
        severity,
        message,
        location: { file: f.file, line: 1 },
        data: { wordCount: f.wordCount, lineCount: f.lineCount },
      })
    }
    
    return diagnostics
  },
}
