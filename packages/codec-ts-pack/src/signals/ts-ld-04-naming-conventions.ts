import {
  computeDiagnosticHash,
  type Diagnostic,
  type NamingConventions,
  ReferenceDataTag,
  type SchemaConventions,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Option, Schema } from "effect"
import { type RecognizedCasingPattern, parseCasingPatternAlternatives } from "../casing.js"
import { TsProjectTag } from "../ts-project.js"
import {
  collectIdentifierDeclarations,
  type ConstIdentifierContext,
  type IdentifierDeclarationKind,
} from "./shared-identifiers.js"

export const TsLd04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsLd04Config = typeof TsLd04Config.Type

export interface NamingViolation {
  readonly file: string
  readonly line: number
  readonly kind: IdentifierDeclarationKind
  readonly constContext?: ConstIdentifierContext
  readonly name: string
  readonly expectedPatterns: ReadonlyArray<RecognizedCasingPattern>
  readonly actualPattern: RecognizedCasingPattern | "unrecognized"
}

export interface TsLd04Output {
  readonly violations: ReadonlyArray<NamingViolation>
  readonly byKind: ReadonlyMap<
    IdentifierDeclarationKind,
    { readonly total: number; readonly violating: number }
  >
  readonly totalIdentifiers: number
  readonly referenceDataStatus: "loaded" | "missing"
  readonly diagnosticLimit: number
}

const IDENTIFIER_KINDS: ReadonlyArray<IdentifierDeclarationKind> = [
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "const",
]

export const TsLd04: Signal<TsLd04Config, TsLd04Output, TsProjectTag | ReferenceDataTag> = {
  id: "TS-LD-04",
  tier: 2,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: TsLd04Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const referenceData = yield* ReferenceDataTag

      return yield* Effect.try({
        try: (): TsLd04Output => {
          const identifiers = collectIdentifierDeclarations(project, config.exclude_globs)
          const rawConventions = Effect.runSync(
            referenceData.get<SchemaConventions>("schema-conventions"),
          )

          if (Option.isNone(rawConventions)) {
            return {
              violations: [],
              byKind: summarizeByKind(identifiers, []),
              totalIdentifiers: identifiers.length,
              referenceDataStatus: "missing",
              diagnosticLimit: config.top_n_diagnostics,
            }
          }

          const namingConventions = rawConventions.value.naming_conventions
          const violations = identifiers.flatMap((identifier) => {
            const expectedPatterns = expectedPatternsForKind(namingConventions, identifier.kind)
            const violation = {
              file: identifier.file,
              line: identifier.line,
              kind: identifier.kind,
              name: identifier.name,
              expectedPatterns,
              actualPattern: identifier.pattern,
              ...(identifier.constContext !== undefined
                ? { constContext: identifier.constContext }
                : {}),
            } satisfies NamingViolation
            return identifier.pattern !== "unrecognized" && expectedPatterns.includes(identifier.pattern)
              ? []
              : [violation]
          })

          return {
            violations,
            byKind: summarizeByKind(identifiers, violations),
            totalIdentifiers: identifiers.length,
            referenceDataStatus: "loaded",
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-04",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.referenceDataStatus === "missing" || out.totalIdentifiers === 0) return 1
    return Math.max(0, 1 - out.violations.length / out.totalIdentifiers)
  },
  outputMetadata: (out) =>
    out.referenceDataStatus === "missing"
      ? { applicability: "insufficient_evidence" as const }
      : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.referenceDataStatus === "missing") {
      return [{ severity: "info", message: "no naming conventions configured" }]
    }

    return out.violations.slice(0, out.diagnosticLimit).map((violation) => ({
      severity: "warn" as const,
      message:
        `Naming convention violation for ${violation.kind} \`${violation.name}\`: ` +
        `expected ${violation.expectedPatterns.join(" or ")}, got ${violation.actualPattern}`,
      location: { file: violation.file, line: violation.line },
      data: {
        hash: computeDiagnosticHash(
          [
            violation.file,
            violation.line,
            violation.kind,
            violation.name,
            violation.expectedPatterns.join("|"),
          ].join("|"),
        ),
        ...violation,
      },
    }))
  },
}

const expectedPatternsForKind = (
  namingConventions: NamingConventions,
  kind: IdentifierDeclarationKind,
): ReadonlyArray<RecognizedCasingPattern> => {
  switch (kind) {
    case "function":
      return parseCasingPatternAlternatives(namingConventions.function)
    case "class":
      return parseCasingPatternAlternatives(namingConventions.class)
    case "interface":
      return parseCasingPatternAlternatives(namingConventions.interface)
    case "type":
      return parseCasingPatternAlternatives(namingConventions.type)
    case "enum":
      return parseCasingPatternAlternatives(namingConventions.enum)
    case "const":
      return parseCasingPatternAlternatives(namingConventions.const)
  }
}

const summarizeByKind = (
  identifiers: ReadonlyArray<ReturnType<typeof collectIdentifierDeclarations>[number]>,
  violations: ReadonlyArray<NamingViolation>,
): ReadonlyMap<IdentifierDeclarationKind, { readonly total: number; readonly violating: number }> => {
  const violationKeys = new Set(
    violations.map((violation) => `${violation.file}:${violation.line}:${violation.kind}:${violation.name}`),
  )
  const stats = new Map<
    IdentifierDeclarationKind,
    { total: number; violating: number }
  >(IDENTIFIER_KINDS.map((kind) => [kind, { total: 0, violating: 0 }]))

  for (const identifier of identifiers) {
    const current = stats.get(identifier.kind)
    if (current === undefined) continue
    current.total += 1
    if (
      violationKeys.has(
        `${identifier.file}:${identifier.line}:${identifier.kind}:${identifier.name}`,
      )
    ) {
      current.violating += 1
    }
  }

  return new Map(
    [...stats.entries()].map(([kind, value]) => [
      kind,
      { total: value.total, violating: value.violating },
    ]),
  )
}
