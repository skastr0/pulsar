// Data contract for the onboarding TUI. The TUI is decoupled from the scoring
// engine: the CLI injects `scan` + `writeConfig`, so this package never imports
// pulsar-core directly. Structural types only.

export type Band = "green" | "yellow" | "red" | "unknown"

export type CalibrationKind =
  | "vector-weight"
  | "vector-config"
  | "vector-active"
  | "conventions"
  | "project-module"
  | "pack-toggle"
  | "baseline-accept"
  | "keep-default"

export type Framing = "sharpen" | "accept" | "keep"

export interface CatalogOption {
  readonly label: string
  readonly summary: string
  readonly calibrationKind: CalibrationKind
  readonly calibrationTarget: string
  readonly framing: Framing
}

export interface CatalogEntry {
  readonly id: string
  readonly title: string
  readonly pack: string
  readonly category: string
  readonly measures: string
  readonly whyItMatters: string
  readonly evidence: "file-local" | "repo-level" | "mixed"
  readonly evidenceHint: string
  readonly question: string
  readonly options: ReadonlyArray<CatalogOption>
  readonly defaultOptionIndex: number
  readonly packGate?: string
}

export interface Finding {
  readonly file: string
  readonly line?: number
  readonly detail: string
  readonly snippet?: ReadonlyArray<string>
  readonly flagLine?: number // index within snippet that is flagged
}

export interface SignalScan {
  readonly id: string
  readonly score: number // 0..1, higher is healthier
  readonly findingCount: number
  readonly findings: ReadonlyArray<Finding>
  readonly category?: string
  readonly title?: string
}

export interface SignalPressure {
  readonly id: string
  readonly score: number
  readonly category: string
}

export interface ScanResult {
  readonly band: Band
  readonly score: number
  readonly driver: string
  readonly evidenceMean?: number
  readonly topPressures: ReadonlyArray<SignalPressure>
  readonly signals: ReadonlyArray<SignalScan>
}

export interface RepoDetection {
  readonly languages: ReadonlyArray<string>
  readonly frameworks: ReadonlyArray<string>
  readonly fileCount: number
  readonly contributors: number
  readonly visibility: "public" | "private" | "unknown"
  readonly repoPath: string
}

export interface DetectedPack {
  readonly id: string
  readonly label: string
  readonly reason: string
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

export type CalibrationAction =
  | { readonly kind: "keep-default" }
  | { readonly kind: "vector-config"; readonly key: string; readonly value: JsonValue }
  | { readonly kind: "vector-weight"; readonly value: number }
  | { readonly kind: "vector-active"; readonly value: boolean }
  | { readonly kind: "baseline-accept" }
  | { readonly kind: "enable-pack"; readonly packId: string }
  | { readonly kind: "unsupported"; readonly reason: string }

export interface CalibrationChoice {
  readonly signalId: string
  readonly optionIndex: number
  readonly action: CalibrationAction
}

export type BaselineDecision = "accept" | "reject" | "not-provided"

export interface CalibrationPlan {
  readonly choices: ReadonlyArray<CalibrationChoice>
  readonly enabledPacks: ReadonlyArray<string>
  readonly baseline: BaselineDecision
  readonly seed: Record<string, string>
  readonly detection: RepoDetection
}

export interface CalibrationReceipt {
  readonly signalId: string
  readonly optionIndex: number
  readonly action: CalibrationAction
  readonly status: "applied" | "kept" | "unapplied"
  readonly detail: string
}

export interface CalibrationPreview {
  readonly before: ScanResult
  readonly after: ScanResult
  readonly receipts: ReadonlyArray<CalibrationReceipt>
}

export interface CalibrationWriteResult {
  readonly written: ReadonlyArray<string>
  readonly receipts: ReadonlyArray<CalibrationReceipt>
  readonly baseline: BaselineDecision
}

export interface HeadlessAnswers {
  readonly choices?: ReadonlyArray<CalibrationChoice>
  readonly enabledPacks?: ReadonlyArray<string>
  readonly baseline?: BaselineDecision
  readonly seed?: Record<string, string>
}

export type OnboardPhase = "beta" | "private-license" | "enterprise"

export interface OnboardInput {
  readonly repoPath: string
  readonly detection: RepoDetection
  readonly detectedPacks: ReadonlyArray<DetectedPack>
  readonly catalog: ReadonlyArray<CatalogEntry>
  readonly scan: () => Promise<ScanResult>
  readonly preview: (plan: CalibrationPlan) => Promise<CalibrationPreview>
  readonly writeConfig: (plan: CalibrationPlan) => Promise<CalibrationWriteResult>
  readonly writeOutput: (contents: string) => Promise<void>
  readonly headlessAnswers?: HeadlessAnswers
  readonly phase: OnboardPhase
  readonly onExit: () => void
  // Test seam: jump straight to a beat with a pre-resolved scan (render checks).
  readonly __debugBeat?: string
  readonly __debugScan?: ScanResult
}
