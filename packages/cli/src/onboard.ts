import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  loadCatalog,
  runOnboardHeadless,
  runOnboardTui,
  type DetectedPack,
  type OnboardInput,
  type RepoDetection,
  type ScanResult,
} from "@skastr0/pulsar-onboard"
import { collectPositional, parseArg, rejectUnknownFlags } from "./cli-args.js"
import { writeStdout } from "./cli-output.js"
import {
  parseOnboardAnswers,
  previewOnboardPlan,
  scanCurrentOnboardRepo,
  writeOnboardPlan,
} from "./onboard-persistence.js"

const PACK_DEFS: Record<string, DetectedPack> = {
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

const detect = (repoPath: string): RepoDetection => {
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
  const visibility: RepoDetection["visibility"] = remote === "" ? "private" : "unknown"

  return { languages, frameworks, fileCount, contributors, visibility, repoPath }
}

const buildScan = (repoPath: string) => async (): Promise<ScanResult> =>
  scanCurrentOnboardRepo(repoPath)

export const runOnboardCli = async (commandArgs: ReadonlyArray<string>): Promise<number> => {
  const flagsWithValues = new Set(["--answers"])
  rejectUnknownFlags(
    "onboard",
    commandArgs,
    new Set(["--json", "--agent", "--no-tui", "--no-progress", ...flagsWithValues]),
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

  const headless =
    commandArgs.includes("--json") ||
    commandArgs.includes("--agent") ||
    commandArgs.includes("--no-tui") ||
    commandArgs.includes("--answers") ||
    !(process.stdin.isTTY === true && process.stdout.isTTY === true)

  const detection = detect(repoPath)
  const detectedPacks = detection.frameworks
    .map((f) => PACK_DEFS[f])
    .filter((p): p is DetectedPack => p !== undefined)

  // Source and compiled binaries use the same real observer. Scan failures are
  // surfaced; production paths never substitute the demo dataset.
  const scanFn = buildScan(repoPath)
  const catalog = loadCatalog()
  const answersPath = parseArg(commandArgs, "--answers")
  const headlessAnswers =
    answersPath === undefined
      ? undefined
      : parseOnboardAnswers(JSON.parse(readFileSync(resolve(answersPath), "utf8")))

  const input: OnboardInput = {
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
    onExit: () => undefined,
  }

  if (headless) {
    return runOnboardHeadless(input)
  }
  await runOnboardTui(input)
  return 0
}
