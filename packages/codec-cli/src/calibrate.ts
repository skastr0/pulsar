import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { Effect } from "effect"
import { readHeadSha, resolveRepoRoot } from "./runtime.js"

export interface CalibrateCommandOptions {
  readonly action: "suggest"
  readonly repoPath: string
  readonly json?: boolean
  readonly write?: boolean
}

interface SuggestedProjectModule {
  readonly id: string
  readonly kind: "package"
  readonly packageName: string
  readonly evidence: ReadonlyArray<string>
}

interface CalibrationSuggestion {
  readonly id: string
  readonly title: string
  readonly reason: string
  readonly commands: ReadonlyArray<string>
}

interface CalibrationSuggestionReport {
  readonly schema_version: "taste-codec/calibration-suggestions/v1"
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

const RELATIVE_VECTOR_PATH = ".taste-codec/vector.json"
const RELATIVE_CONVENTIONS_PATH = ".taste-codec/conventions.json"
const RELATIVE_CONVENTIONS_DRAFT_PATH = ".taste-codec/conventions.draft.json"
const RELATIVE_GLOSSARY_PATH = ".taste-codec/glossary.json"
const RELATIVE_GLOSSARY_DRAFT_PATH = ".taste-codec/glossary.draft.json"
const RELATIVE_BASELINE_PATH = ".taste-codec/baseline.json"
const RELATIVE_PROJECT_MODULES_PATH = ".taste-codec/project-modules.json"
const RELATIVE_SUGGESTIONS_PATH = ".taste-codec/calibration-suggestions.json"

const PACKAGE_JSON_SCAN_SKIP_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".svelte-kit",
  ".taste-codec",
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
    packageName: "@taste-codec/project-module-convex",
  },
  {
    dependencyName: "effect",
    packageName: "@taste-codec/project-module-effect",
  },
] as const

export const runCalibrateCommand = (opts: CalibrateCommandOptions) =>
  Effect.gen(function* () {
    if (opts.action !== "suggest") {
      return yield* Effect.fail(new Error("calibrate requires one of: suggest"))
    }

    const report = yield* buildSuggestionReport(opts)
    const finalReport =
      opts.write === true ? yield* writeSuggestionReport(report) : report

    if (opts.json === true) {
      console.log(JSON.stringify(finalReport, null, 2))
    } else {
      printHumanReport(finalReport)
    }
    return 0
  })

const buildSuggestionReport = (opts: CalibrateCommandOptions) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const headSha = yield* readHeadSha(repoRoot)
    const packageJsons = yield* collectPackageJsons(repoRoot)
    const status = detectCalibrationStatus(repoRoot)
    const suggestedProjectModules = suggestProjectModules(packageJsons)
    const suggestions = buildSuggestions(status, suggestedProjectModules)

    return {
      schema_version: "taste-codec/calibration-suggestions/v1",
      repo_root: repoRoot,
      head_sha: headSha,
      mode: opts.write === true ? "write-report" : "dry-run",
      score_command_read_only: true,
      status,
      suggestions,
      suggested_project_modules: suggestedProjectModules,
    } satisfies CalibrationSuggestionReport
  })

const writeSuggestionReport = (report: CalibrationSuggestionReport) =>
  Effect.gen(function* () {
    const writePath = join(report.repo_root, RELATIVE_SUGGESTIONS_PATH)
    yield* Effect.tryPromise({
      try: () => mkdir(join(writePath, ".."), { recursive: true }),
      catch: (cause) => new Error(`Failed to create .taste-codec directory: ${String(cause)}`),
    })
    const withWritePath = { ...report, write_path: writePath }
    yield* Effect.tryPromise({
      try: () => writeFile(writePath, `${JSON.stringify(withWritePath, null, 2)}\n`, "utf8"),
      catch: (cause) => new Error(`Failed to write calibration suggestions: ${String(cause)}`),
    })
    return withWritePath
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
  const suggestions: Array<CalibrationSuggestion> = []

  if (status.vector === "missing") {
    suggestions.push({
      id: "vector.apply-preset",
      title: "Create a repo-owned vector from a preset",
      reason:
        "Presets are templates; active taste starts when the repo owns .taste-codec/vector.json.",
      commands: [
        "taste persona diff ai-slop-defense .",
        "taste persona apply ai-slop-defense --to .taste-codec/vector.json .",
      ],
    })
  }

  if (status.conventions === "missing") {
    suggestions.push({
      id: "reference-data.conventions.extract",
      title: "Extract repo-owned conventions",
      reason:
        "Conventions activate boundary and naming evidence without adding project facts to generic signals.",
      commands: ["taste conventions extract --sha HEAD .", "taste conventions confirm ."],
    })
  } else if (status.conventions === "draft") {
    suggestions.push({
      id: "reference-data.conventions.confirm",
      title: "Confirm the conventions draft",
      reason: "A draft exists but is not yet canonical scoring evidence.",
      commands: ["taste conventions confirm ."],
    })
  }

  if (status.glossary === "missing") {
    suggestions.push({
      id: "reference-data.glossary.extract",
      title: "Extract a domain glossary draft",
      reason:
        "Glossary data lets domain-term signals detect language drift instead of treating missing reference data as health.",
      commands: [
        "taste glossary extract --sha HEAD .",
        "taste glossary confirm --auto-accept-above-frequency 3 .",
      ],
    })
  } else if (status.glossary === "draft") {
    suggestions.push({
      id: "reference-data.glossary.confirm",
      title: "Confirm the glossary draft",
      reason: "A draft exists but is not yet canonical scoring evidence.",
      commands: ["taste glossary confirm --auto-accept-above-frequency 3 ."],
    })
  }

  if (status.baseline === "missing") {
    suggestions.push({
      id: "baseline.set",
      title: "Record current hard-gate debt as a ratcheting baseline",
      reason:
        "Baselines make CI fail on new violations without pretending historical debt is already fixed.",
      commands: ["taste baseline set .", "taste score --ci ."],
    })
  }

  if (status.project_modules === "missing" && projectModules.length > 0) {
    suggestions.push({
      id: "project-modules.manifest",
      title: "Review technology project-module suggestions",
      reason:
        "Technology packs are explicit calibration processors with activation evidence, not hidden source-signal exceptions.",
      commands: ["Review suggested_project_modules and create .taste-codec/project-modules.json if appropriate."],
    })
  }

  return suggestions.sort((left, right) => left.id.localeCompare(right.id))
}

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

const printHumanReport = (report: CalibrationSuggestionReport): void => {
  console.log("")
  console.log("  Calibration Suggestions")
  console.log(`  Repo:      ${report.repo_root}`)
  console.log(`  SHA:       ${report.head_sha}`)
  console.log(`  Mode:      ${report.mode}`)
  console.log("  Guarantee: taste score remains read-only; suggestions require explicit commands.")
  console.log("")
  console.log("  Current repo-owned artifacts:")
  console.log(`    vector            ${report.status.vector}`)
  console.log(`    conventions       ${report.status.conventions}`)
  console.log(`    glossary          ${report.status.glossary}`)
  console.log(`    baseline          ${report.status.baseline}`)
  console.log(`    project modules   ${report.status.project_modules}`)
  console.log("")

  if (report.suggestions.length === 0) {
    console.log("  No missing OOTB calibration steps detected.")
  } else {
    console.log("  Recommended next steps:")
    for (const suggestion of report.suggestions) {
      console.log(`    ${suggestion.id}`)
      console.log(`      ${suggestion.title}`)
      console.log(`      ${suggestion.reason}`)
      for (const command of suggestion.commands) {
        console.log(`      $ ${command}`)
      }
    }
  }

  if (report.suggested_project_modules.length > 0) {
    console.log("")
    console.log("  Suggested project modules:")
    for (const module of report.suggested_project_modules) {
      console.log(`    ${module.packageName}`)
      for (const evidence of module.evidence) {
        console.log(`      evidence: ${evidence}`)
      }
    }
  }

  if (report.write_path !== undefined) {
    console.log("")
    console.log(`  Report written: ${report.write_path}`)
  }
  console.log("")
}
