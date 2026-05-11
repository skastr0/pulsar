/**
 * Archived OpenTUI spike.
 *
 * This file is intentionally unhooked from the main Pulsar CLI and is not part
 * of the repo TypeScript build. It was moved here from packages/cli/src after
 * proving the visual direction, so its relative imports are historical context
 * rather than a runnable module boundary.
 */

import {
  CATEGORIES,
  type Category,
} from "@skastr0/pulsar-core/signal"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import type { Registry } from "@skastr0/pulsar-core/scoring"
import {
  explainAiAssistedMode,
  timeSeriesConfigOf,
  type PulsarVector,
} from "@skastr0/pulsar-core/vector"
import type * as OpenTui from "@opentui/core"
import { Effect } from "effect"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import {
  buildPulsarRegistry,
  observeWorktree,
} from "./runtime.js"
import { discoverPulsarVector } from "./vector-discovery.js"

export interface ScoreTuiOptions {
  readonly repoPath: string
  readonly vectorPath?: string
}

const CATEGORY_LABELS: Record<Category, string> = {
  "architectural-drift": "Architectural Drift",
  "dependency-entropy": "Dependency Entropy",
  "abstraction-bloat": "Abstraction Bloat",
  "legibility-decay": "Legibility Decay",
  "generated-slop": "Generated Slop",
  "review-pain": "Review Pain",
}

const palette = {
  bg: "#061018",
  panel: "#08141c",
  panelHot: "#0a1e1c",
  stroke: "#50e8ff",
  accent: "#c0f8ff",
  dim: "#1a6878",
  text: "#e0e0ec",
  body: "#a8b8bc",
  muted: "#5f7378",
  warn: "#e0a030",
  block: "#e04050",
}

declare const __PULSAR_REPO_ROOT__: string | undefined

const importOpenTui = async (): Promise<typeof OpenTui> => {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<typeof OpenTui>

  try {
    return await dynamicImport("@opentui/core")
  } catch (error) {
    const repoRoot =
      typeof __PULSAR_REPO_ROOT__ === "string" && __PULSAR_REPO_ROOT__.length > 0
        ? __PULSAR_REPO_ROOT__
        : undefined
    if (repoRoot === undefined) throw error

    const modulePath = join(repoRoot, "packages", "cli", "node_modules", "@opentui", "core", "index.js")
    return await dynamicImport(pathToFileURL(modulePath).href)
  }
}

let Box: typeof OpenTui.Box
let Text: typeof OpenTui.Text

export const runScoreTuiCommand = (opts: ScoreTuiOptions) =>
  Effect.gen(function* () {
    const registry = yield* buildPulsarRegistry(opts.repoPath)
    const vectorSelection = yield* discoverPulsarVector({
      repoPath: opts.repoPath,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const observerVector = narrowVectorToDomain(
      registry,
      vectorSelection.vector,
      inferFallbackDomain(registry),
    )
    const timeSeriesEnabled = timeSeriesConfigOf(observerVector).enabled
    const observed = yield* observeWorktree(opts.repoPath, observerVector, {
      ...(timeSeriesEnabled ? { timeSeries: { enabled: true } } : {}),
      tsProject: { productionOnly: true },
    })

    const activeSignalCount = CATEGORIES.reduce(
      (sum, category) => sum + observed.result.categories[category].signalCount,
      0,
    )
    if (activeSignalCount === 0) {
      return yield* Effect.fail(new Error("Observer mode has no active signals."))
    }

    return yield* Effect.tryPromise({
      try: () =>
        renderScoreTui({
          repoRoot: observed.repoRoot,
          gitSha: observed.gitSha,
          output: observed.result,
          vectorLabel: vectorSelection.label,
          vectorSourceLabel: vectorSelection.sourceLabel,
          aiModeSummary: explainAiAssistedMode(vectorSelection.vector).summary,
        }),
      catch: (error) => new Error(`OpenTUI render failed: ${String(error)}`),
    })
  })

const renderScoreTui = async (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly output: ObserverOutput
  readonly vectorLabel: string
  readonly vectorSourceLabel: string
  readonly aiModeSummary: string
}): Promise<number> => {
  const openTui = await importOpenTui()
  Box = openTui.Box
  Text = openTui.Text
  const renderer = await openTui.createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  })
  renderer.setTerminalTitle("pulsar observer")
  renderer.setBackgroundColor(palette.bg)

  const topFindings = collectTopFindings(opts.output)
  const quit = (): boolean => {
    renderer.destroy()
    return true
  }
  renderer.addInputHandler((sequence) => {
    if (sequence === "q" || sequence === "Q" || sequence === "\u001b") return quit()
    return false
  })

  renderer.root.add(
    Box(
      {
        width: "100%",
        height: "100%",
        padding: 1,
        flexDirection: "column",
        gap: 1,
        backgroundColor: palette.bg,
      },
      header(opts),
      Box(
        { flexGrow: 1, flexDirection: "row", gap: 1 },
        categoryColumn(opts.output),
        centerScope(opts.output),
        findingsPanel(opts.repoRoot, topFindings),
      ),
      footer(opts),
    ),
  )
  renderer.start()
  await new Promise<void>((resolve) => renderer.once("destroy", () => resolve()))
  return 0
}

const header = (opts: {
  readonly repoRoot: string
  readonly gitSha: string
  readonly vectorLabel: string
  readonly vectorSourceLabel: string
}) =>
  Box(
    {
      height: 5,
      border: true,
      borderStyle: "single",
      borderColor: palette.dim,
      backgroundColor: palette.panel,
      paddingX: 2,
      flexDirection: "column",
    },
    Text({
      content: "PULSAR OBSERVER // DEEP-FIELD REPOSITORY INSTRUMENT",
      fg: palette.accent,
    }),
    Text({
      content: `${opts.repoRoot}  sha=${opts.gitSha.slice(0, 12)}  vector=${opts.vectorLabel}`,
      fg: palette.body,
    }),
    Text({ content: `source=${opts.vectorSourceLabel}`, fg: palette.muted }),
  )

const categoryColumn = (output: ObserverOutput) =>
  Box(
    {
      width: 38,
      border: true,
      borderStyle: "single",
      borderColor: palette.dim,
      backgroundColor: palette.panel,
      padding: 1,
      flexDirection: "column",
      gap: 1,
      title: " signal field ",
    },
    ...CATEGORIES.map((category) => {
      const score = output.categories[category].score
      return Box(
        { height: 4, flexDirection: "column" },
        Text({ content: CATEGORY_LABELS[category], fg: palette.text }),
        Text({ content: `${score.toFixed(3)} ${sparkline(score)}`, fg: colorForScore(score) }),
      )
    }),
  )

const centerScope = (output: ObserverOutput) =>
  Box(
    {
      flexGrow: 1,
      border: true,
      borderStyle: "single",
      borderColor: palette.stroke,
      backgroundColor: palette.panelHot,
      padding: 2,
      flexDirection: "column",
      gap: 1,
      title: " readiness scope ",
    },
    Text({
      content: renderDial(output.readiness?.score ?? output.weighted_mean),
      fg: palette.accent,
    }),
    Text({
      content: `evidence mean ${output.weighted_mean.toFixed(3)}   hard gate ${output.hard_gate_status.toUpperCase()}`,
      fg: palette.text,
    }),
    Text({
      content: output.readiness === undefined
        ? "readiness not configured"
        : `readiness ${output.readiness.score.toFixed(3)} / ${output.readiness.status} / pressure=${output.readiness.pressure.toFixed(3)}`,
      fg: palette.body,
    }),
    Text({
      content: output.minimum === undefined
        ? "minimum none"
        : `minimum ${output.minimum.signal} :: ${output.minimum.category} :: ${output.minimum.score.toFixed(3)}`,
      fg: palette.muted,
    }),
    Box(
      {
        height: 8,
        marginTop: 1,
        border: true,
        borderStyle: "single",
        borderColor: palette.dim,
        padding: 1,
      },
      Text({ content: constellation(output), fg: palette.dim }),
    ),
  )

const findingsPanel = (
  repoRoot: string,
  findings: ReadonlyArray<ReturnType<typeof collectTopFindings>[number]>,
) =>
  Box(
    {
      width: 48,
      border: true,
      borderStyle: "single",
      borderColor: palette.dim,
      backgroundColor: palette.panel,
      padding: 1,
      flexDirection: "column",
      gap: 1,
      title: " top contacts ",
    },
    ...(findings.length === 0
      ? [Text({ content: "no diagnostics in active field", fg: palette.body })]
      : findings.map((finding) =>
          Box(
            { height: 5, flexDirection: "column" },
            Text({
              content: `${finding.signalId} ${finding.diagnostic.severity.toUpperCase()}`,
              fg: finding.diagnostic.severity === "block" ? palette.block : palette.warn,
            }),
            Text({ content: compact(finding.diagnostic.message, 52), fg: palette.body }),
            Text({ content: locationLine(repoRoot, finding.diagnostic), fg: palette.muted }),
          ),
        )),
  )

const footer = (opts: { readonly aiModeSummary: string }) =>
  Box(
    {
      height: 3,
      border: true,
      borderStyle: "single",
      borderColor: palette.dim,
      backgroundColor: palette.panel,
      paddingX: 2,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    Text({ content: opts.aiModeSummary, fg: palette.muted }),
    Text({ content: "q / esc to exit", fg: palette.accent }),
  )

const collectTopFindings = (output: ObserverOutput) =>
  [...output.signalResults.entries()]
    .flatMap(([signalId, result]) =>
      result.diagnostics.map((diagnostic) => ({ signalId, diagnostic })),
    )
    .sort((a, b) => severityRank(b.diagnostic.severity) - severityRank(a.diagnostic.severity))
    .slice(0, 5)

const severityRank = (severity: "block" | "warn" | "info"): number =>
  severity === "block" ? 2 : severity === "warn" ? 1 : 0

const sparkline = (score: number): string => {
  const width = 18
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  return `${"━".repeat(filled)}${"·".repeat(width - filled)}`
}

const renderDial = (score: number): string => {
  const pct = Math.round(score * 100).toString().padStart(3, " ")
  return [
    "        .-=================-.",
    "     .-'    repo health      '-.",
    `   .'          ${pct}%             '.`,
    "  /     .----.       .----.       \\",
    " |    .'      '.---.'      '.      |",
    " |   /   ●       |       ●   \\     |",
    " |   \\       .---'---.       /     |",
    "  \\   '.___.'   sweep '.___.'     /",
    "   '.          locked           .'",
    "     '-._____________________.-'",
  ].join("\n")
}

const constellation = (output: ObserverOutput): string =>
  CATEGORIES.map((category, index) => {
    const score = output.categories[category].score
    const node = score >= 0.8 ? "◆" : score >= 0.55 ? "◇" : "×"
    const wire = index === CATEGORIES.length - 1 ? "" : " ─── "
    return `${node}${wire}`
  }).join("")

const colorForScore = (score: number): string =>
  score >= 0.8 ? palette.accent : score >= 0.55 ? palette.warn : palette.block

const compact = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 3)}...`

const locationLine = (
  repoRoot: string,
  diagnostic: ReturnType<typeof collectTopFindings>[number]["diagnostic"],
): string => {
  const file = diagnostic.location?.file
  if (file === undefined) return "no location"
  const display = file.startsWith("/") ? relative(repoRoot, file) : file
  return diagnostic.location?.line === undefined ? display : `${display}:${diagnostic.location.line}`
}

const narrowVectorToDomain = (
  registry: Registry,
  vector: PulsarVector | undefined,
  fallbackDomain: string,
): PulsarVector => {
  const domain = vector?.domain ?? fallbackDomain
  const signal_overrides: Record<string, PulsarVector["signal_overrides"][string]> = {
    ...(vector?.signal_overrides ?? {}),
  }

  for (const signal of registry.sorted) {
    if (signalMatchesDomain(signal.id, domain)) continue
    signal_overrides[signal.id] = {
      ...(signal_overrides[signal.id] ?? {}),
      active: false,
    }
  }

  return {
    id: vector?.id ?? "all-defaults",
    domain,
    ...(vector?.description !== undefined ? { description: vector.description } : {}),
    signal_overrides,
    ...(vector?.review_routing !== undefined ? { review_routing: vector.review_routing } : {}),
    ...(vector?.observer !== undefined ? { observer: vector.observer } : {}),
    ...(vector?.backpressure !== undefined ? { backpressure: vector.backpressure } : {}),
    ...(vector?.provenance !== undefined ? { provenance: vector.provenance } : {}),
    ...(vector?.modes !== undefined ? { modes: vector.modes } : {}),
  }
}

const signalMatchesDomain = (signalId: string, domain: string | undefined): boolean => {
  if (domain === "typescript" && signalId.startsWith("RS-")) return false
  if (domain === "rust" && signalId.startsWith("TS-")) return false
  return true
}

const inferFallbackDomain = (registry: Registry): "typescript" | "rust" | "polyglot" => {
  const hasTs = registry.sorted.some((signal) => signal.id.startsWith("TS-"))
  const hasRs = registry.sorted.some((signal) => signal.id.startsWith("RS-"))
  if (hasTs && hasRs) return "polyglot"
  if (hasRs) return "rust"
  return "typescript"
}
