import { execFile, execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Effect } from "effect"
import { collectPositional, rejectUnknownFlags } from "./cli-args.js"
import { observeWorktree } from "./runtime.js"

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
  readonly catalog: ReadonlyArray<unknown>
  readonly scan: () => Promise<LocalScanResult>
  readonly writeConfig: (plan: OnboardPlan) => Promise<string[]>
  readonly phase: "beta" | "private-license" | "enterprise"
  readonly onExit: () => void
}
interface OnboardPlan {
  readonly choices: ReadonlyArray<{ readonly signalId: string; readonly optionIndex: number }>
  readonly enabledPacks: ReadonlyArray<string>
  readonly baseline: boolean
  readonly seed: Record<string, string>
}
interface OnboardModule {
  runOnboardTui(input: LocalInput): Promise<void>
  runOnboardHeadless(input: LocalInput): Promise<number>
  loadCatalog(): ReadonlyArray<unknown>
  demoScan(): Promise<LocalScanResult>
}

const PACK_DEFS: Record<string, LocalPack> = {
  "Next.js": { id: "nextjs", label: "Next.js calibration pack", reason: "next dependency detected" },
  Effect: { id: "effect", label: "Effect calibration pack", reason: "effect dependency detected" },
  Convex: { id: "convex", label: "Convex calibration pack", reason: "convex dependency detected" },
}
const PACK_MODULE: Record<string, string> = {
  nextjs: "@skastr0/pulsar-project-module-nextjs",
  effect: "@skastr0/pulsar-project-module-effect",
  convex: "@skastr0/pulsar-project-module-convex",
}

const sh = (repoPath: string, command: string): string => {
  try {
    return execFileSync("bash", ["-c", command], { cwd: repoPath, encoding: "utf8" }).trim()
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
      const run = (await Effect.runPromise(observeWorktree(repoPath, undefined))) as {
        result: {
          readiness?: {
            band?: "green" | "yellow" | "red"
            score?: number
            top_pressures?: ReadonlyArray<{ signal_id?: string; score?: number; category?: string }>
          }
          weighted_mean?: number
          hard_gate_violations?: ReadonlyArray<{ signalId?: string }>
          signalResults?: ReadonlyMap<string, { score?: number; diagnostics?: ReadonlyArray<{ message?: string; location?: { file?: string; line?: number } }> }>
        }
        registry?: { byId?: { get?: (id: string) => { title?: string; category?: string } | undefined } }
      }
      const out = run.result
      const reg = run.registry?.byId
      const readiness = out.readiness
      const band = readiness?.band ?? "unknown"
      const score = typeof readiness?.score === "number" ? readiness.score : (out.weighted_mean ?? 0)
      const driverId =
        readiness?.top_pressures?.[0]?.signal_id ?? out.hard_gate_violations?.[0]?.signalId ?? "—"
      const driverTitle = reg?.get?.(driverId)?.title
      const signals: LocalSignalScan[] = []
      const results = out.signalResults
      if (results) {
        for (const [id, res] of results) {
          const diags = res.diagnostics ?? []
          const meta = reg?.get?.(id)
          signals.push({
            id,
            score: typeof res.score === "number" ? res.score : 0,
            findingCount: diags.length,
            findings: diags.slice(0, 8).map((d) => ({
              file: d.location?.file ?? "—",
              line: d.location?.line,
              detail: d.message ?? "",
            })),
            category: meta?.category,
            title: meta?.title,
          })
        }
      }
      const topPressures = (readiness?.top_pressures ?? [])
        .filter((p): p is { signal_id: string; score?: number; category?: string } => typeof p.signal_id === "string")
        .map((p) => ({ id: p.signal_id, score: typeof p.score === "number" ? p.score : 0, category: p.category ?? "—" }))
      return {
        band,
        score,
        driver: driverTitle ? `${driverId} · ${driverTitle}` : driverId,
        topPressures,
        signals,
      }
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

const buildWriteConfig = (repoPath: string) => async (plan: OnboardPlan): Promise<string[]> => {
  const baseDir = join(repoPath, ".pulsar")
  // Non-destructive: never overwrite an already-calibrated repo's config.
  const dir = existsSync(join(baseDir, "vector.json")) ? join(baseDir, "onboard-preview") : baseDir
  mkdirSync(dir, { recursive: true })
  const files: string[] = []

  const vector = {
    id: "repo",
    domain: plan.seed["shape"] ?? "app",
    description: "Calibrated via pulsar onboard",
    signal_overrides: Object.fromEntries(plan.choices.map((c) => [c.signalId, {}])),
  }
  const vectorPath = join(dir, "vector.json")
  writeFileSync(vectorPath, JSON.stringify(vector, null, 2))
  files.push(vectorPath)

  if (plan.enabledPacks.length > 0) {
    const modulesPath = join(dir, "project-modules.json")
    writeFileSync(
      modulesPath,
      JSON.stringify(
        {
          schema: "pulsar/project-modules/v1",
          modules: plan.enabledPacks.map((id) => ({ kind: "builtin", id: PACK_MODULE[id] ?? id, enabled: true })),
        },
        null,
        2,
      ),
    )
    files.push(modulesPath)
  }
  return files
}

export const runOnboardCli = async (commandArgs: ReadonlyArray<string>): Promise<void> => {
  rejectUnknownFlags("onboard", commandArgs, new Set(["--json", "--agent", "--no-tui", "--no-progress", "--scan-json"]))
  const repoPath = resolve(collectPositional(commandArgs, new Set<string>())[0] ?? ".")

  // Scan-only mode: the TUI spawns this as a child process so the heavy scan
  // never blocks the interactive event loop. Prints the full ScanResult JSON.
  if (commandArgs.includes("--scan-json")) {
    const result = await buildScan(
      repoPath,
      async (): Promise<LocalScanResult> => ({ band: "unknown", score: 0, driver: "—", topPressures: [], signals: [] }),
    )()
    process.stdout.write(JSON.stringify(result))
    process.exit(0)
  }

  const headless =
    commandArgs.includes("--json") ||
    commandArgs.includes("--agent") ||
    commandArgs.includes("--no-tui") ||
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

  const input: LocalInput = {
    repoPath,
    detection,
    detectedPacks,
    catalog: onboard.loadCatalog(),
    scan: scanFn,
    writeConfig: buildWriteConfig(repoPath),
    phase: "beta",
    onExit: () => {},
  }

  if (headless) {
    const code = await onboard.runOnboardHeadless(input)
    process.exit(code)
  }
  await onboard.runOnboardTui(input)
  process.exit(0)
}
