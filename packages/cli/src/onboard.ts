import { execFile, execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { collectPositional, parseArg, rejectUnknownFlags } from "./cli-args.js"
import { writeStdout } from "./cli-output.js"
import {
  parseOnboardAnswers,
  previewOnboardPlan,
  scanCurrentOnboardRepo,
  writeOnboardPlan,
  type OnboardBaselineDecision,
  type OnboardCalibrationAction,
  type OnboardCalibrationReceipt,
  type OnboardCatalogEntry,
} from "./onboard-persistence.js"

const execFileP = promisify(execFile)

// Local structural types. The onboarding TUI lives in @skastr0/pulsar-onboard
// and is loaded via a dynamic import with a non-literal specifier, so it never
// enters this package's tsc graph or the compiled binary. The CLI only injects
// scan + writeConfig and chooses TUI vs headless.
interface LocalFinding {
  readonly file: string
  readonly line?: number | undefined
  readonly detail: string
}
interface LocalSignalScan {
  readonly id: string
  readonly score: number
  readonly findingCount: number
  readonly findings: ReadonlyArray<LocalFinding>
  readonly category?: string | undefined
  readonly title?: string | undefined
}
interface LocalScanResult {
  readonly band: "green" | "yellow" | "red" | "unknown"
  readonly score: number
  readonly driver: string
  readonly topPressures: ReadonlyArray<{ readonly id: string; readonly score: number; readonly category: string }>
  readonly signals: ReadonlyArray<LocalSignalScan>
}
interface LocalDetection {
  readonly languages: ReadonlyArray<string>
  readonly frameworks: ReadonlyArray<string>
  readonly fileCount: number
  readonly contributors: number
  readonly visibility: "public" | "private" | "unknown"
  readonly repoPath: string
}
interface LocalPack {
  readonly id: string
  readonly label: string
  readonly reason: string
}
interface LocalInput {
  readonly repoPath: string
  readonly detection: LocalDetection
  readonly detectedPacks: ReadonlyArray<LocalPack>
  readonly catalog: ReadonlyArray<OnboardCatalogEntry>
  readonly scan: () => Promise<LocalScanResult>
  readonly preview: (plan: OnboardPlan) => Promise<{
    readonly before: LocalScanResult
    readonly after: LocalScanResult
    readonly receipts: ReadonlyArray<OnboardCalibrationReceipt>
  }>
  readonly writeConfig: (plan: OnboardPlan) => Promise<{
    readonly written: ReadonlyArray<string>
    readonly receipts: ReadonlyArray<OnboardCalibrationReceipt>
    readonly baseline: OnboardBaselineDecision
  }>
  readonly writeOutput: (contents: string) => Promise<void>
  readonly headlessAnswers?: {
    readonly choices?: ReadonlyArray<OnboardPlan["choices"][number]>
    readonly enabledPacks?: ReadonlyArray<string>
    readonly baseline?: OnboardBaselineDecision
    readonly seed?: Record<string, string>
  }
  readonly phase: "beta" | "private-license" | "enterprise"
  readonly onExit: () => void
}
interface OnboardPlan {
  readonly choices: ReadonlyArray<{
    readonly signalId: string
    readonly optionIndex: number
    readonly action: OnboardCalibrationAction
  }>
  readonly enabledPacks: ReadonlyArray<string>
  readonly baseline: OnboardBaselineDecision
  readonly seed: Record<string, string>
}
interface OnboardModule {
  runOnboardTui(input: LocalInput): Promise<void>
  runOnboardHeadless(input: LocalInput): Promise<number>
  loadCatalog(): ReadonlyArray<OnboardCatalogEntry>
  demoScan(): Promise<LocalScanResult>
}

const PACK_DEFS: Record<string, LocalPack> = {
  "Next.js": { id: "nextjs", label: "Next.js calibration pack", reason: "next dependency detected" },
  Effect: { id: "effect", label: "Effect calibration pack", reason: "effect dependency detected" },
  Convex: { id: "convex", label: "Convex calibration pack", reason: "convex dependency detected" },
}
const sh = (repoPath: string, command: string): string => {
  try {
    return execFileSync("bash", ["-c", command], {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return ""
  }
}

const detect = (repoPath: string): LocalDetection => {
  const languages: string[] = []
  const frameworks: string[] = []
  try {
    const pkg = JSON.parse(readFileSync(join(repoPath, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    languages.push("TypeScript")
    if (deps["next"]) frameworks.push("Next.js")
    if (deps["effect"]) frameworks.push("Effect")
    if (deps["convex"]) frameworks.push("Convex")
  } catch {
    // no package.json
  }
  if (existsSync(join(repoPath, "Cargo.toml"))) languages.push("Rust")
  if (languages.length === 0) languages.push("code")

  const fileCount = Number(sh(repoPath, "git ls-files | wc -l")) || 0
  const contributors = Number(sh(repoPath, "git log --format='%ae' | sort -u | wc -l")) || 0
  const remote = sh(repoPath, "git remote get-url origin")
  const visibility: LocalDetection["visibility"] = remote === "" ? "private" : "unknown"

  return { languages, frameworks, fileCount, contributors, visibility, repoPath }
}

const buildScan =
  (repoPath: string, fallback: () => Promise<LocalScanResult>) => async (): Promise<LocalScanResult> => {
    try {
      return scanCurrentOnboardRepo(repoPath)
    } catch {
      return fallback()
    }
  }

// Run the scan in a child process so the heavy CPU-bound AST pass never blocks
// the TUI's event loop — keeps the seed questions responsive while it runs.
const spawnScan =
  (binPath: string, repoPath: string, fallback: () => Promise<LocalScanResult>) => async (): Promise<LocalScanResult> => {
    try {
      const { stdout } = await execFileP("bun", [binPath, "onboard", "--scan-json", repoPath], {
        maxBuffer: 128 * 1024 * 1024,
      })
      const parsed = JSON.parse(stdout) as LocalScanResult
      if (parsed && Array.isArray(parsed.signals) && parsed.signals.length > 0) return parsed
      return fallback()
    } catch {
      return fallback()
    }
  }

export const runOnboardCli = async (commandArgs: ReadonlyArray<string>): Promise<number> => {
  const flagsWithValues = new Set(["--answers"])
  rejectUnknownFlags(
    "onboard",
    commandArgs,
    new Set(["--json", "--agent", "--no-tui", "--no-progress", "--scan-json", ...flagsWithValues]),
  )
  if (commandArgs.some((arg) => arg.startsWith("--answers="))) {
    throw new Error("pulsar: --answers=path is not supported; use --answers <path>")
  }
  const answersFlagIndex = commandArgs.indexOf("--answers")
  if (
    answersFlagIndex !== -1 &&
    (commandArgs[answersFlagIndex + 1] === undefined || commandArgs[answersFlagIndex + 1]!.startsWith("--"))
  ) {
    throw new Error("pulsar: --answers requires a file path")
  }
  const repoPath = resolve(collectPositional(commandArgs, flagsWithValues)[0] ?? ".")

  // Scan-only mode: the TUI spawns this as a child process so the heavy scan
  // never blocks the interactive event loop. Prints the full ScanResult JSON.
  if (commandArgs.includes("--scan-json")) {
    const result = await buildScan(
      repoPath,
      async (): Promise<LocalScanResult> => ({ band: "unknown", score: 0, driver: "—", topPressures: [], signals: [] }),
    )()
    await writeStdout(JSON.stringify(result))
    return 0
  }

  const headless =
    commandArgs.includes("--json") ||
    commandArgs.includes("--agent") ||
    commandArgs.includes("--no-tui") ||
    commandArgs.includes("--answers") ||
    !(process.stdin.isTTY === true && process.stdout.isTTY === true)

  const onboardSpecifier = ["@skastr0", "pulsar-onboard"].join("/")
  const onboard = (await import(onboardSpecifier)) as unknown as OnboardModule

  const detection = detect(repoPath)
  const detectedPacks = detection.frameworks
    .map((f) => PACK_DEFS[f])
    .filter((p): p is LocalPack => p !== undefined)

  // TUI offloads the scan to a child process (responsive UI); headless runs it inline.
  const binPath = join(dirname(fileURLToPath(import.meta.url)), "bin.ts")
  const scanFn = headless
    ? buildScan(repoPath, () => onboard.demoScan())
    : spawnScan(binPath, repoPath, () => onboard.demoScan())

  const catalog = onboard.loadCatalog()
  const answersPath = parseArg(commandArgs, "--answers")
  const headlessAnswers =
    answersPath === undefined
      ? undefined
      : parseOnboardAnswers(JSON.parse(readFileSync(resolve(answersPath), "utf8")))

  const input: LocalInput = {
    repoPath,
    detection,
    detectedPacks,
    catalog,
    scan: scanFn,
    preview: (plan) => previewOnboardPlan(repoPath, plan, catalog),
    writeConfig: (plan) => writeOnboardPlan(repoPath, plan, catalog),
    writeOutput: writeStdout,
    ...(headlessAnswers === undefined ? {} : { headlessAnswers }),
    phase: "beta",
    onExit: () => {},
  }

  if (headless) {
    return onboard.runOnboardHeadless(input)
  }
  await onboard.runOnboardTui(input)
  return 0
}
