import type { ResolvedCalibrationContext } from "@skastr0/pulsar-core/calibration"
import type { Registry } from "@skastr0/pulsar-core/scoring"
import type { PulsarVector } from "@skastr0/pulsar-core/vector"
import type { ProjectModuleManifest } from "@skastr0/pulsar-project-module-sdk"
import type { DiscoveredPulsarVector } from "./vector-discovery.js"

/** Opt-in POC contract; existing CLI output contracts remain unchanged. */
export const AGENT_SCHEMA = "pulsar/agent/v1alpha1" as const

export interface AgentPolicyOptions {
  readonly repoPath: string
  readonly vectorPath?: string
  readonly modulesPath?: string
  readonly moduleDependencyRoot?: string
  readonly trustProjectCode?: boolean
}

export interface AgentCatalogOptions {
  readonly repoPath: string
  readonly signalId?: string
  readonly slotId?: string
}

/** Static decoding never executes project modules. */
export interface AgentStaticPolicy {
  readonly repoRoot: string
  readonly registry: Registry
  readonly vectorSelection: DiscoveredPulsarVector
  readonly vector: PulsarVector | undefined
  readonly manifest: ProjectModuleManifest | undefined
  readonly manifestSource: string | undefined
  readonly moduleDependencyRoot: string | undefined
  readonly explanation: Readonly<Record<string, unknown>>
}

/** Prepared once, then passed explicitly to the existing observation runtime. */
export interface AgentPreparedPolicy {
  readonly fingerprint: string
  readonly calibrationContext: ResolvedCalibrationContext
  readonly explanation: Readonly<Record<string, unknown>>
}

export class AgentCommandError extends Error {
  readonly _tag = "AgentCommandError"
  constructor(
    readonly code: string,
    message: string,
    readonly issues: ReadonlyArray<{ readonly path: string; readonly message: string }> = [],
    readonly recovery: ReadonlyArray<string> = [],
  ) {
    super(message)
    this.name = "AgentCommandError"
  }
}
