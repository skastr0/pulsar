import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { Effect } from "effect"
import { readHeadSha, resolveRepoRoot } from "./runtime.js"

export interface CalibrateCommandOptions {
  readonly action: "suggest"
  readonly repoPath: string
  readonly json?: boolean
  readonly write?: boolean
}

export interface SuggestedProjectModule {
  readonly id: string
  readonly kind: "package"
  readonly packageName: string
  readonly evidence: ReadonlyArray<string>
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

const PACKAGE_JSON_SCAN_SKIP_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".svelte-kit",
  ".pulsar",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "gen",
  "generated",
  "node_modules",
  "out",
  "target",
  "vendor",
])

const PROJECT_MODULE_SUGGESTION_CATALOG = [
  {
    dependencyName: "convex",
    packageName: "@skastr0/pulsar-project-module-convex",
  },
  {
    dependencyName: "effect",
    packageName: "@skastr0/pulsar-project-module-effect",
  },
] as const

export const buildSuggestionReport = (opts: CalibrateCommandOptions) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const headSha = yield* readHeadSha(repoRoot)
    const packageJsons = yield* collectPackageJsons(repoRoot)
    const status = detectCalibrationStatus(repoRoot)
    const suggestedProjectModules = suggestProjectModules(packageJsons)
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

interface PackageJsonInfo {
  readonly relativePath: string
  readonly dependencies: ReadonlySet<string>
}

const collectPackageJsons = (
  repoRoot: string,
): Effect.Effect<ReadonlyArray<PackageJsonInfo>, Error, never> =>
  Effect.gen(function* () {
    const paths = yield* findPackageJsonPaths(repoRoot)
    const infos = yield* Effect.forEach(
      paths,
      (path) => readPackageJsonInfo(repoRoot, path),
      { concurrency: 8 },
    )
    return infos.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  })

const findPackageJsonPaths = (
  root: string,
): Effect.Effect<ReadonlyArray<string>, Error, never> =>
  Effect.gen(function* () {
    const out: Array<string> = []
    const visit = (dir: string): Effect.Effect<void, Error, never> =>
      Effect.gen(function* () {
        const entries = yield* Effect.tryPromise({
          try: () => readdir(dir, { withFileTypes: true }),
          catch: (cause) => new Error(`Failed to read ${dir}: ${String(cause)}`),
        })
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          if (shouldSkipDirectory(entry.name)) continue
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            yield* visit(fullPath)
          } else if (entry.isFile() && entry.name === "package.json") {
            out.push(fullPath)
          }
        }
      })

    yield* visit(root)
    return out.sort((left, right) => left.localeCompare(right))
  })

const shouldSkipDirectory = (name: string): boolean =>
  PACKAGE_JSON_SCAN_SKIP_DIRECTORIES.has(name)

const readPackageJsonInfo = (repoRoot: string, path: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => new Error(`Failed to read ${path}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as Record<string, unknown>,
      catch: (cause) => new Error(`Failed to parse ${path}: ${String(cause)}`),
    })
    return {
      relativePath: relative(repoRoot, path),
      dependencies: collectDependencyNames(parsed),
    } satisfies PackageJsonInfo
  })

const collectDependencyNames = (packageJson: Record<string, unknown>): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const blockName of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const block = packageJson[blockName]
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue
    for (const name of Object.keys(block).sort()) names.add(name)
  }
  return names
}

const suggestProjectModules = (
  packageJsons: ReadonlyArray<PackageJsonInfo>,
): ReadonlyArray<SuggestedProjectModule> => {
  return PROJECT_MODULE_SUGGESTION_CATALOG.flatMap((module) => {
    const evidence = dependencyEvidence(packageJsons, module.dependencyName)
    if (evidence.length === 0) return []
    return [
      {
        id: module.packageName,
        kind: "package",
        packageName: module.packageName,
        evidence,
      } satisfies SuggestedProjectModule,
    ]
  }).sort((left, right) => left.id.localeCompare(right.id))
}

const dependencyEvidence = (
  packageJsons: ReadonlyArray<PackageJsonInfo>,
  dependencyName: string,
): ReadonlyArray<string> =>
  packageJsons
    .filter((info) => info.dependencies.has(dependencyName))
    .map((info) => `${info.relativePath} dependency ${dependencyName}`)
