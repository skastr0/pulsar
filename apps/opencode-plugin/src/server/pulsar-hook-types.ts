import type {
  ObserverOutput,
} from "@skastr0/pulsar-core/observer"
import type {
  PulsarVector,
} from "@skastr0/pulsar-core/vector"
import type {
  ReviewPlan,
  RoutingDiff,
  RoutingOutput,
} from "@skastr0/pulsar-core/routing"
import type { PulsarAnnotation } from "./review-surfacing"

export interface ToolAfterInput {
  readonly tool: string
  readonly sessionID: string
  readonly callID: string
  readonly args: unknown
}

export interface ToolAfterOutput {
  title: string
  output: string
  metadata: unknown
}

export interface PulsarAnalysis {
  readonly fingerprint: string
  readonly diff: RoutingDiff
  readonly observerOutput: ObserverOutput
  readonly routingOutput: RoutingOutput
  readonly reviewPlan: ReviewPlan
  readonly annotation: PulsarAnnotation
}

export type PulsarAnalyzer = (input: {
  readonly fingerprint: string
  readonly toolName: string
  readonly worktree: string
  readonly diff: RoutingDiff
  readonly vector: PulsarVector | undefined
  readonly previous?: PulsarAnalysis
}) => Promise<PulsarAnalysis>

export type SettledAnalysis =
  | { readonly status: "ready"; readonly analysis: PulsarAnalysis }
  | { readonly status: "error"; readonly message: string }

export interface HookAnalysisRequest {
  readonly fingerprint: string
  readonly toolName: string
  readonly sessionID: string
  readonly diff: RoutingDiff
}

export interface PulsarState {
  readonly analyzer: PulsarAnalyzer
  readonly inlineWaitMs: number
  readonly inFlight: Map<string, Promise<SettledAnalysis>>
  readonly completed: Map<string, PulsarAnalysis>
  readonly lastCompletedBySession: Map<string, PulsarAnalysis>
  readonly lastSurfacedFingerprintBySession: Map<string, string>
}
