import type { Diagnostic, Signal } from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { MarkdownProjectTag } from "../project.js"

/**
 * MD-LD-02: Markdown heading structure
 * 
 * A Tier 1.5 compound signal measuring documentation structure.
 * Detects issues like:
 * - Missing H1
 * - Deep nesting (h4+ without intermediate structure)
 * - Inconsistent heading hierarchy
 * 
 * Demonstrates community signal with compound logic.
 */

export const MdLd02Config = Schema.Struct({
  max_nesting_depth: Schema.Number,
  require_h1: Schema.Boolean,
})
export type MdLd02Config = typeof MdLd02Config.Type

export interface HeadingInfo {
  readonly level: number
  readonly text: string
  readonly line: number
}

export interface MdFileStructure {
  readonly file: string
  readonly headings: ReadonlyArray<HeadingInfo>
  readonly maxDepth: number
  readonly hasH1: boolean
  readonly hasH2: boolean
  readonly issues: ReadonlyArray<string>
}

export interface MdLd02Output {
  readonly files: ReadonlyArray<MdFileStructure>
  readonly totalFiles: number
  readonly filesWithH1: number
  readonly filesWithDeepNesting: number
  readonly filesWithHierarchyIssues: number
}

const parseHeadings = (content: string, file: string): MdFileStructure => {
  const headings: Array<HeadingInfo> = []
  const lines = content.split(/\r?\n/)
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // Match ATX headings: ## Heading
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1]!.length,
        text: match[2]!.trim(),
        line: i + 1,
      })
    }
  }
  
  const maxDepth = headings.length > 0
    ? Math.max(...headings.map(h => h.level))
    : 0
  
  const hasH1 = headings.some(h => h.level === 1)
  const hasH2 = headings.some(h => h.level === 2)
  
  const issues: Array<string> = []
  if (!hasH1) {
    issues.push("Missing H1 (top-level heading)")
  }
  
  // Check for hierarchy issues: h3+ without h2, h4+ without h3, etc.
  const levels = headings.map(h => h.level)
  for (let i = 1; i < levels.length; i++) {
    const jump = levels[i]! - levels[i - 1]!
    if (jump > 1) {
      issues.push(`Heading level jumps from ${levels[i - 1]} to ${levels[i]} at line ${headings[i]!.line}`)
    }
  }
  
  return {
    file,
    headings,
    maxDepth,
    hasH1,
    hasH2,
    issues,
  }
}

export const MarkdownHeadingStructure: Signal<MdLd02Config, MdLd02Output, MarkdownProjectTag> = {
  id: "MD-LD-02",
  tier: 1.5, // Compound — depends on parsing context
  category: "legibility-decay",
  kind: "legibility",
  configSchema: MdLd02Config,
  defaultConfig: {
    max_nesting_depth: 3,
    require_h1: true,
  },
  inputs: [], // In a full implementation, might depend on MD-LD-01
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* MarkdownProjectTag
      
      return yield* Effect.tryPromise({
        try: async (): Promise<MdLd02Output> => {
          const { readFile } = await import("node:fs/promises")
          
          const files: Array<MdFileStructure> = []
          for (const file of project.markdownFiles) {
            const content = await readFile(file, "utf8")
            files.push(parseHeadings(content, file))
          }
          
          return {
            files,
            totalFiles: files.length,
            filesWithH1: files.filter(f => f.hasH1).length,
            filesWithDeepNesting: files.filter(f => f.maxDepth > config.max_nesting_depth).length,
            filesWithHierarchyIssues: files.filter(f => f.issues.length > 0).length,
          }
        },
        catch: (cause) => new Error(`MD-LD-02 compute failed: ${String(cause)}`),
      })
    }),
  score: (out) => {
    if (out.totalFiles === 0) return 1
    
    // Score based on structural health
    const h1Compliance = out.filesWithH1 / out.totalFiles
    const nestingCompliance = 1 - (out.filesWithDeepNesting / out.totalFiles)
    const hierarchyCompliance = 1 - (out.filesWithHierarchyIssues / out.totalFiles)
    
    return (h1Compliance + nestingCompliance + hierarchyCompliance) / 3
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    
    for (const f of out.files) {
      if (!f.hasH1) {
        diagnostics.push({
          severity: "warn",
          message: "Missing H1 heading — document lacks top-level structure",
          location: { file: f.file, line: 1 },
          data: { issue: "missing-h1" },
        })
      }
      
      if (f.maxDepth > 3) {
        diagnostics.push({
          severity: "info",
          message: `Deep heading nesting (h${f.maxDepth}) — consider flattening structure`,
          location: { file: f.file, line: 1 },
          data: { maxDepth: f.maxDepth },
        })
      }
      
      for (const issue of f.issues) {
        diagnostics.push({
          severity: "warn",
          message: issue,
          location: { file: f.file, line: 1 },
          data: { issue: "hierarchy" },
        })
      }
    }
    
    return diagnostics
  },
}
