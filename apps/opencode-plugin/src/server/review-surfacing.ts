import { isAbsolute, relative } from "node:path"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import type { ReviewPlan, RoutingDiff } from "@skastr0/pulsar-core/routing"
import type { Diagnostic } from "@skastr0/pulsar-core/signal"

export interface ScoreDelta {
  readonly category: string
  readonly previous: number
  readonly current: number
}

export interface SurfacedDiagnostic {
  readonly signalId: string
  readonly severity: string
  readonly message: string
  readonly file?: string
  readonly line?: number
}

export interface PulsarAnnotation {
  readonly status: "pending" | "ready" | "error"
  readonly changedFiles: ReadonlyArray<string>
  readonly fingerprint: string
  readonly message?: string
  readonly scoreDeltas?: ReadonlyArray<ScoreDelta>
  readonly newDiagnostics?: ReadonlyArray<SurfacedDiagnostic>
  readonly reviewRequests?: ReadonlyArray<ReviewPlan["reviewRequests"][number]>
}

export const createPendingAnnotation = (input: {
  readonly changedFiles: ReadonlyArray<string>
  readonly fingerprint: string
}): PulsarAnnotation => ({
  status: "pending",
  changedFiles: input.changedFiles,
  fingerprint: input.fingerprint,
  message: "Background analysis queued",
})

export const createErrorAnnotation = (input: {
  readonly changedFiles: ReadonlyArray<string>
  readonly fingerprint: string
  readonly message: string
}): PulsarAnnotation => ({
  status: "error",
  changedFiles: input.changedFiles,
  fingerprint: input.fingerprint,
  message: input.message,
})

export const createReadyAnnotation = (input: {
  readonly worktree: string
  readonly fingerprint: string
  readonly diff: RoutingDiff
  readonly observerOutput: ObserverOutput
  readonly reviewPlan: ReviewPlan
  readonly previousObserverOutput?: ObserverOutput
}): PulsarAnnotation => ({
  status: "ready",
  changedFiles: input.diff.changedFiles,
  fingerprint: input.fingerprint,
  scoreDeltas: summarizeScoreDeltas(
    input.observerOutput,
    input.previousObserverOutput,
  ),
  newDiagnostics: summarizeDiagnostics(
    input.worktree,
    input.observerOutput,
    input.previousObserverOutput,
    input.diff.changedFiles,
  ),
  reviewRequests: input.reviewPlan.reviewRequests,
})

export const appendPulsarAnnotation = (
  output: { output: string; metadata: unknown },
  annotation: PulsarAnnotation,
): void => {
  const rendered = renderPulsarAnnotation(annotation)
  output.output = output.output.length > 0 ? `${output.output}\n\n${rendered}` : rendered

  const metadata =
    typeof output.metadata === "object" && output.metadata !== null
      ? { ...(output.metadata as Record<string, unknown>) }
      : {}
  metadata.pulsar = annotation
  output.metadata = metadata
}

const renderPulsarAnnotation = (annotation: PulsarAnnotation): string => {
  const changedFilesLabel = annotation.changedFiles.join(", ") || "current edit"

  if (annotation.status === "pending") {
    return [
      `## Pulsar — after edit to ${changedFilesLabel}`,
      "",
      `ℹ ${annotation.message ?? "Background analysis queued"}`,
    ].join("\n")
  }

  if (annotation.status === "error") {
    return [
      `## Pulsar — after edit to ${changedFilesLabel}`,
      "",
      `ℹ Pulsar analysis failed but the edit was preserved: ${annotation.message ?? "unknown error"}`,
    ].join("\n")
  }

  const lines = [`## Pulsar — after edit to ${changedFilesLabel}`, ""]

  for (const delta of annotation.scoreDeltas?.slice(0, 2) ?? []) {
    const direction = delta.current < delta.previous ? "⚠" : "ℹ"
    lines.push(
      `${direction} ${delta.category} score ${delta.current.toFixed(2)} (was ${delta.previous.toFixed(2)})`,
    )
  }

  if ((annotation.newDiagnostics?.length ?? 0) > 0) {
    lines.push("")
    for (const diagnostic of annotation.newDiagnostics!.slice(0, 5)) {
      lines.push(`- [${diagnostic.signalId}] ${diagnostic.message}${formatLocation(diagnostic)}`)
    }
  }

  if ((annotation.reviewRequests?.length ?? 0) > 0) {
    lines.push("", "Review recommendations:")
    for (const request of annotation.reviewRequests!.slice(0, 4)) {
      lines.push(
        `- ${request.priority} ${request.reviewerRole} — ${request.trigger.detail}`,
      )
    }
  }

  if (
    (annotation.newDiagnostics?.length ?? 0) === 0 &&
    (annotation.reviewRequests?.length ?? 0) === 0 &&
    (annotation.scoreDeltas?.length ?? 0) === 0
  ) {
    lines.push("ℹ No new pulsar evidence surfaced for the changed files.")
  }

  return lines.join("\n")
}

const summarizeScoreDeltas = (
  current: ObserverOutput,
  previous: ObserverOutput | undefined,
): ReadonlyArray<ScoreDelta> => {
  if (previous === undefined) return []

  const entries = Object.entries(current.categories) as ReadonlyArray<
    [string, ObserverOutput["categories"][keyof ObserverOutput["categories"]]]
  >

  return entries
    .flatMap(([category, entry]) => {
      const previousScore = previous.categories[category as keyof typeof previous.categories]?.score
      if (previousScore === undefined) return []
      if (Math.abs(previousScore - entry.score) < 0.01) return []
      return [
        {
          category,
          previous: previousScore,
          current: entry.score,
        } satisfies ScoreDelta,
      ]
    })
    .sort(
      (left, right) =>
        Math.abs(right.current - right.previous) - Math.abs(left.current - left.previous),
    )
}

const summarizeDiagnostics = (
  worktree: string,
  current: ObserverOutput,
  previous: ObserverOutput | undefined,
  changedFiles: ReadonlyArray<string>,
): ReadonlyArray<SurfacedDiagnostic> => {
  const previousKeys = new Set<string>()

  if (previous !== undefined) {
    for (const [signalId, result] of previous.signalResults.entries()) {
      for (const diagnostic of result.diagnostics) {
        previousKeys.add(diagnosticKey(worktree, signalId, diagnostic))
      }
    }
  }

  return [...current.signalResults.entries()]
    .flatMap(([signalId, result]) =>
      result.diagnostics.flatMap((diagnostic: Diagnostic) => {
        if (!isRelevantDiagnostic(worktree, diagnostic, changedFiles)) return []
        const key = diagnosticKey(worktree, signalId, diagnostic)
        if (previousKeys.has(key)) return []

        return [
          {
            signalId,
            severity: diagnostic.severity,
            message: diagnostic.message,
            ...(diagnostic.location?.file !== undefined
              ? { file: displayFile(worktree, diagnostic.location.file) }
              : {}),
            ...(diagnostic.location?.line !== undefined
              ? { line: diagnostic.location.line }
              : {}),
          } satisfies SurfacedDiagnostic,
        ]
      }),
    )
    .sort((left, right) => left.signalId.localeCompare(right.signalId))
}

const isRelevantDiagnostic = (
  worktree: string,
  diagnostic: Diagnostic,
  changedFiles: ReadonlyArray<string>,
): boolean => {
  if (changedFiles.length === 0) return true
  const file = diagnostic.location?.file
  if (file === undefined) return true
  const rendered = displayFile(worktree, file)
  return changedFiles.includes(rendered)
}

const diagnosticKey = (
  worktree: string,
  signalId: string,
  diagnostic: Diagnostic,
): string =>
  [
    signalId,
    diagnostic.severity,
    diagnostic.message,
    diagnostic.location?.file === undefined
      ? ""
      : displayFile(worktree, diagnostic.location.file),
    diagnostic.location?.line ?? -1,
    diagnostic.location?.column ?? -1,
  ].join(":" )

const displayFile = (worktree: string, file: string): string => {
  const normalized = file.replace(/\\/g, "/")
  if (!isAbsolute(normalized)) return trimDotSlash(normalized)
  return trimDotSlash(relative(worktree, normalized).replace(/\\/g, "/"))
}

const trimDotSlash = (value: string): string => value.replace(/^\.\//, "")

const formatLocation = (diagnostic: SurfacedDiagnostic): string => {
  if (diagnostic.file === undefined) return ""
  if (diagnostic.line === undefined) return ` (${diagnostic.file})`
  return ` (${diagnostic.file}:${diagnostic.line})`
}
