import { existsSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import {
  suggestProjectModules,
  type SuggestedProjectModule,
} from "./calibrate-project-modules.js"
import { readHeadSha, resolveRepoRoot } from "./runtime.js"

export interface CalibrateCommandOptions {
  readonly action: "suggest"
  readonly repoPath: string
  readonly json?: boolean
  readonly write?: boolean
}

export interface CalibrationSuggestion {
  readonly id: string
  readonly title: string
  readonly reason: string
  readonly commands: ReadonlyArray<string>
}

export interface CalibrationSuggestionReport {
  readonly schema_version: "pulsar/calibration-suggestions/v1"
  readonly repo_root: string
  readonly head_sha: string
  readonly mode: "dry-run" | "write-report"
  readonly score_command_read_only: true
  readonly status: {
    readonly vector: "repo-local" | "missing"
    readonly conventions: "canonical" | "draft" | "missing"
    readonly glossary: "canonical" | "draft" | "missing"
    readonly baseline: "present" | "missing"
    readonly project_modules: "manifest" | "missing"
  }
  readonly suggestions: ReadonlyArray<CalibrationSuggestion>
  readonly suggested_project_modules: ReadonlyArray<SuggestedProjectModule>
  readonly write_path?: string
}

const RELATIVE_VECTOR_PATH = ".pulsar/vector.json"
const RELATIVE_CONVENTIONS_PATH = ".pulsar/conventions.json"
const RELATIVE_CONVENTIONS_DRAFT_PATH = ".pulsar/conventions.draft.json"
const RELATIVE_GLOSSARY_PATH = ".pulsar/glossary.json"
const RELATIVE_GLOSSARY_DRAFT_PATH = ".pulsar/glossary.draft.json"
const RELATIVE_BASELINE_PATH = ".pulsar/baseline.json"
const RELATIVE_PROJECT_MODULES_PATH = ".pulsar/project-modules.json"

export const buildSuggestionReport = (opts: CalibrateCommandOptions) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const headSha = yield* readHeadSha(repoRoot)
    const status = detectCalibrationStatus(repoRoot)
    const suggestedProjectModules = yield* suggestProjectModules(repoRoot)
    const suggestions = buildSuggestions(status, suggestedProjectModules)

    return {
      schema_version: "pulsar/calibration-suggestions/v1",
      repo_root: repoRoot,
      head_sha: headSha,
      mode: opts.write === true ? "write-report" : "dry-run",
      score_command_read_only: true,
      status,
      suggestions,
      suggested_project_modules: suggestedProjectModules,
    } satisfies CalibrationSuggestionReport
  })

const detectCalibrationStatus = (
  repoRoot: string,
): CalibrationSuggestionReport["status"] => ({
  vector: existsSync(join(repoRoot, RELATIVE_VECTOR_PATH)) ? "repo-local" : "missing",
  conventions: referenceStatus(
    repoRoot,
    RELATIVE_CONVENTIONS_PATH,
    RELATIVE_CONVENTIONS_DRAFT_PATH,
  ),
  glossary: referenceStatus(repoRoot, RELATIVE_GLOSSARY_PATH, RELATIVE_GLOSSARY_DRAFT_PATH),
  baseline: existsSync(join(repoRoot, RELATIVE_BASELINE_PATH)) ? "present" : "missing",
  project_modules: existsSync(join(repoRoot, RELATIVE_PROJECT_MODULES_PATH))
    ? "manifest"
    : "missing",
})

const referenceStatus = (
  repoRoot: string,
  canonicalPath: string,
  draftPath: string,
): "canonical" | "draft" | "missing" => {
  if (existsSync(join(repoRoot, canonicalPath))) return "canonical"
  if (existsSync(join(repoRoot, draftPath))) return "draft"
  return "missing"
}

const buildSuggestions = (
  status: CalibrationSuggestionReport["status"],
  projectModules: ReadonlyArray<SuggestedProjectModule>,
): ReadonlyArray<CalibrationSuggestion> => {
  return [
    ...vectorSuggestions(status),
    ...conventionSuggestions(status),
    ...glossarySuggestions(status),
    ...baselineSuggestions(status),
    ...projectModuleSuggestions(status, projectModules),
  ].sort((left, right) => left.id.localeCompare(right.id))
}

const vectorSuggestions = (
  status: CalibrationSuggestionReport["status"],
): ReadonlyArray<CalibrationSuggestion> =>
  status.vector === "missing"
    ? [
        {
          id: "vector.apply-preset",
          title: "Create a repo-owned vector from a preset",
          reason:
            "Presets are templates; active pulsar starts when the repo owns .pulsar/vector.json.",
          commands: [
            "pulsar persona diff ai-slop-defense .",
            "pulsar persona apply ai-slop-defense --to .pulsar/vector.json .",
          ],
        },
      ]
    : []

const conventionSuggestions = (
  status: CalibrationSuggestionReport["status"],
): ReadonlyArray<CalibrationSuggestion> => {
  if (status.conventions === "missing") {
    return [
      {
        id: "reference-data.conventions.extract",
        title: "Extract repo-owned conventions",
        reason:
          "Conventions activate boundary and naming evidence without adding project facts to generic signals.",
        commands: ["pulsar conventions extract --sha HEAD .", "pulsar conventions confirm ."],
      },
    ]
  }
  if (status.conventions === "draft") {
    return [
      {
        id: "reference-data.conventions.confirm",
        title: "Confirm the conventions draft",
        reason: "A draft exists but is not yet canonical scoring evidence.",
        commands: ["pulsar conventions confirm ."],
      },
    ]
  }
  return []
}

const glossarySuggestions = (
  status: CalibrationSuggestionReport["status"],
): ReadonlyArray<CalibrationSuggestion> => {
  if (status.glossary === "missing") {
    return [
      {
        id: "reference-data.glossary.extract",
        title: "Extract a domain glossary draft",
        reason:
          "Glossary data lets domain-term signals detect language drift instead of treating missing reference data as health.",
        commands: [
          "pulsar glossary extract --sha HEAD .",
          "pulsar glossary confirm --auto-accept-above-frequency 3 .",
        ],
      },
    ]
  }
  if (status.glossary === "draft") {
    return [
      {
        id: "reference-data.glossary.confirm",
        title: "Confirm the glossary draft",
        reason: "A draft exists but is not yet canonical scoring evidence.",
        commands: ["pulsar glossary confirm --auto-accept-above-frequency 3 ."],
      },
    ]
  }
  return []
}

const baselineSuggestions = (
  status: CalibrationSuggestionReport["status"],
): ReadonlyArray<CalibrationSuggestion> =>
  status.baseline === "missing"
    ? [
        {
          id: "baseline.set",
          title: "Record current hard-gate debt as a ratcheting baseline",
          reason:
            "Baselines make CI fail on new violations without pretending historical debt is already fixed.",
          commands: ["pulsar baseline set .", "pulsar score --ci ."],
        },
      ]
    : []

const projectModuleSuggestions = (
  status: CalibrationSuggestionReport["status"],
  projectModules: ReadonlyArray<SuggestedProjectModule>,
): ReadonlyArray<CalibrationSuggestion> =>
  status.project_modules === "missing" && projectModules.length > 0
    ? [
        {
          id: "project-modules.manifest",
          title: "Review technology project-module suggestions",
          reason:
            "Technology packs are explicit calibration processors with activation evidence, not hidden source-signal exceptions.",
          commands: [
            "Review suggested_project_modules and create .pulsar/project-modules.json if appropriate.",
          ],
        },
      ]
    : []
