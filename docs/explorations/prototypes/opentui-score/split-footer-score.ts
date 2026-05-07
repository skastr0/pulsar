#!/usr/bin/env bun
import { BoxRenderable, createCliRenderer, TextRenderable } from "@opentui/core"

const args = process.argv.slice(2)
const repoPath = args.find((arg) => !arg.startsWith("--")) ?? "."
const footerHeight = Number(args.find((arg) => arg.startsWith("--height="))?.slice("--height=".length) ?? 18)
const persist = args.includes("--persist")
const live = args.includes("--live")
const closeDelayMs = Number(args.find((arg) => arg.startsWith("--close-delay="))?.slice("--close-delay=".length) ?? 5000)
const json = args.includes("--json")
const scoreArgs = args.filter((arg) => !arg.startsWith("--height=") && !arg.startsWith("--close-delay=") && arg !== "--persist" && arg !== "--no-persist" && arg !== "--live")
const jsonScoreArgs = scoreArgs.filter((arg) => arg !== "--json")

if (json || !process.stdout.isTTY) {
  const proc = Bun.spawn(["pulsar", "score", ...scoreArgs.filter((arg) => arg !== "--json"), "--json"], {
    cwd: process.cwd(),
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  })
  process.exit(await proc.exited)
}

const palette = {
  bg: "#061018",
  panel: "#08141c",
  line: "#1a6878",
  accent: "#c0f8ff",
  text: "#e0e0ec",
  body: "#a8b8bc",
  muted: "#5f7378",
  warn: "#e0a030",
  block: "#e04050",
  good: "#8bd49c",
}
const lineWidth = Math.max(24, Math.min(120, (process.stdout.columns ?? 100) - 8))

if (!live) {
  const proc = Bun.spawn(["pulsar", "score", ...jsonScoreArgs, "--json"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "inherit",
  })
  const exitCode = await proc.exited
  const jsonOutput = await new Response(proc.stdout).text()
  if (jsonOutput.trim() === "") {
    process.stdout.write(renderAnsiPanel(buildRawOutputLines(`pulsar score produced no JSON output; exit=${exitCode}`, exitCode)))
    process.exit(exitCode)
  }
  try {
    process.stdout.write(renderWildAnsiReport(JSON.parse(jsonOutput), exitCode))
  } catch {
    process.stdout.write(renderAnsiPanel(buildRawOutputLines(jsonOutput, exitCode)))
  }
  process.exit(exitCode)
}

const renderer = await createCliRenderer({
  screenMode: "split-footer",
  footerHeight: Math.min(6, footerHeight),
  externalOutputMode: "capture-stdout",
  consoleMode: "disabled",
  clearOnShutdown: false,
  targetFps: 12,
  useMouse: false,
  useKittyKeyboard: null,
  exitOnCtrlC: true,
})

renderer.setTerminalTitle("pulsar observer")
renderer.setBackgroundColor(palette.bg)

let phase = "starting observer"
let frame = 0
const lineTexts: TextRenderable[] = []
const activeFooterHeight = Math.min(6, footerHeight)

const ring = ["◇", "◆", "◈", "◆"]
const scan = (): string => {
  const width = 28
  const head = frame % width
  return Array.from({ length: width }, (_, index) => (index === head ? "◆" : index < head ? "━" : "·")).join("")
}

const updateFooter = (): void => {
  setLines([
    { content: `PULSAR OBSERVER ${ring[frame % ring.length]}`, fg: palette.accent },
    { content: `${phase}  ${scan()}`, fg: palette.body },
    { content: `Repo: ${shortRepo(repoPath)}   output=scrollback   json=passthrough`, fg: palette.muted },
    { content: "Final report will be written below the command.", fg: palette.muted },
  ])
  renderer.requestRender()
}

const close = (): boolean => {
  renderer.destroy()
  return true
}

renderer.addInputHandler((sequence) => {
  if (sequence === "q" || sequence === "Q" || sequence === "\u001b") return close()
  return false
})

renderer.root.add(
  new BoxRenderable(renderer, {
    id: "pulsar-footer",
    width: "100%",
    height: "100%",
    border: true,
    borderStyle: "single",
    borderColor: palette.line,
    backgroundColor: palette.panel,
    paddingX: 2,
    flexDirection: "column",
  }),
)

const panel = renderer.root.getRenderable("pulsar-footer")
const contentRows = Math.max(4, activeFooterHeight - 2)
for (let index = 0; index < contentRows; index += 1) {
  const line = new TextRenderable(renderer, { content: "", fg: palette.body, width: "100%", height: 1 })
  lineTexts.push(line)
  panel?.add(line)
}

updateFooter()
renderer.start()

const timer = setInterval(() => {
  frame += 1
  updateFooter()
}, 120)

const proc = Bun.spawn(["pulsar", "score", ...jsonScoreArgs, "--json"], {
  cwd: process.cwd(),
  stdout: "pipe",
  stderr: "inherit",
  stdin: "inherit",
})

const exitCode = await proc.exited
const jsonOutput = await new Response(proc.stdout).text()
phase = exitCode === 0 ? "complete" : `score exited ${exitCode}`
frame += 1
clearInterval(timer)

let finalLines: Array<{ content: string; fg?: string }> = []
if (jsonOutput.trim() !== "") {
  try {
    finalLines = buildHumanSummaryLines(JSON.parse(jsonOutput), exitCode)
  } catch {
    finalLines = buildRawOutputLines(jsonOutput, exitCode)
  }
} else {
  finalLines = buildRawOutputLines(`pulsar score produced no JSON output; exit=${exitCode}`, exitCode)
}

if (persist) {
  renderHumanSummary(finalLines, exitCode)
  await new Promise<void>((resolve) => renderer.once("destroy", () => resolve()))
} else {
  await new Promise((resolve) => setTimeout(resolve, Math.min(closeDelayMs, 700)))
  writeDurablePanel(finalLines)
  await new Promise((resolve) => setTimeout(resolve, 50))
  renderer.destroy()
}

process.exit(exitCode)

function buildHumanSummaryLines(output: any, exitCode: number): Array<{ content: string; fg?: string }> {
  const categories = output.categories ?? {}
  const vector = output.vector ?? {}
  const readiness = output.readiness
  const minimum = output.minimum
  const hardGate = String(output.hard_gate_status ?? "unknown").toUpperCase()
  const findings = Array.isArray(output.hard_gate_violations) ? output.hard_gate_violations.slice(0, 2) : []
  const statusColor = exitCode === 0 ? palette.good : palette.block
  const lines: Array<{ content: string; fg?: string }> = [
    { content: `PULSAR OBSERVER ${exitCode === 0 ? "complete" : `exit ${exitCode}`}`, fg: statusColor },
    { content: `Repo: ${shortRepo(process.cwd() === repoPath ? process.cwd() : repoPath)}`, fg: palette.text },
    { content: `Vector: ${vector.id ?? "unknown"}   Source: ${vector.source_label ?? vector.source ?? "unknown"}`, fg: palette.body },
    { content: "" },
  ]

  for (const [id, label] of [
    ["architectural-drift", "Arch Drift"],
    ["dependency-entropy", "Dependency"],
    ["abstraction-bloat", "Abstraction"],
    ["legibility-decay", "Legibility"],
    ["generated-slop", "Generated"],
    ["review-pain", "Review Pain"],
  ] as const) {
    const score = Number(categories[id]?.score ?? 0)
    lines.push({ content: `${label.padEnd(13, " ")} ${score.toFixed(2)}  ${bar(score, 18)}`, fg: score < 0.35 ? palette.block : score < 0.7 ? palette.warn : palette.text })
  }

  lines.push({ content: "-----------------------------------------------", fg: palette.muted })
  if (readiness !== undefined) {
    const score = Number(readiness.score ?? 0)
    lines.push({
      content: `Readiness     ${score.toFixed(2)}  ${bar(score, 18)}  ${readiness.status ?? "unknown"} / pressure=${Number(readiness.pressure ?? 0).toFixed(2)}`,
      fg: score < 0.35 ? palette.block : palette.warn,
    })
  }
  lines.push({ content: `Evidence Mean ${Number(output.weighted_mean ?? 0).toFixed(2)}   Hard Gate ${hardGate}`, fg: hardGate === "PASS" ? palette.good : palette.block })
  if (minimum !== undefined) {
    lines.push({ content: `Minimum       ${minimum.signal ?? "unknown"} / ${minimum.category ?? "unknown"} / ${Number(minimum.score ?? 0).toFixed(2)}`, fg: palette.text })
    if (typeof minimum.detail === "string" && minimum.detail !== "") {
    lines.push({ content: `              ${compact(JSON.stringify(minimum.detail), lineWidth - 14)}`, fg: palette.body })
    }
  }

  if (findings.length > 0) {
    lines.push({ content: "" })
    lines.push({ content: `Top Findings (${findings.length})`, fg: palette.accent })
    for (const finding of findings) {
      const diagnostic = finding.diagnostic ?? {}
      const location = diagnostic.location
      lines.push({
        content: `${finding.signalId ?? "unknown"} ${String(diagnostic.severity ?? "info").toUpperCase().padEnd(5, " ")} ${compact(String(diagnostic.message ?? ""), lineWidth - 18)}`,
        fg: palette.body,
      })
      if (location?.file !== undefined) {
        lines.push({ content: `  at ${relativePath(String(location.file))}${location.line !== undefined ? `:${location.line}` : ""}`, fg: palette.muted })
      }
    }
  }

  if (persist) {
    lines.push({ content: "q/esc close", fg: palette.muted })
  }
  return lines
}

function renderHumanSummary(lines: Array<{ content: string; fg?: string }>, _exitCode: number): void {
  setLines(lines)
  renderer.requestRender()
}

function buildRawOutputLines(output: string, exitCode: number): Array<{ content: string; fg?: string }> {
  return [
    { content: `PULSAR OBSERVER ${exitCode === 0 ? "complete" : `exit ${exitCode}`}`, fg: exitCode === 0 ? palette.good : palette.block },
    ...output
      .trim()
      .split("\n")
      .slice(0, 18)
      .map((content) => ({ content: compact(content, lineWidth), fg: palette.body })),
    ...(persist ? [{ content: "q/esc close", fg: palette.muted }] : []),
  ]
}

function renderRawOutput(output: string, exitCode: number): void {
  setLines(buildRawOutputLines(output, exitCode))
  renderer.requestRender()
}

function writeDurablePanel(lines: Array<{ content: string; fg?: string }>): void {
  renderer.writeToScrollback((ctx) => {
    const width = Math.min(ctx.width, lineWidth + 6)
    const root = new BoxRenderable(ctx.renderContext, {
      width,
      height: lines.length + 2,
      border: true,
      borderStyle: "single",
      borderColor: palette.line,
      backgroundColor: palette.panel,
      paddingX: 2,
      flexDirection: "column",
    })

    for (const sourceLine of lines) {
      root.add(
        new TextRenderable(ctx.renderContext, {
          content: compact(sourceLine.content, Math.max(12, width - 6)).padEnd(Math.max(12, width - 6), " "),
          fg: sourceLine.fg ?? palette.body,
        }),
      )
    }

    return {
      root,
      width,
      height: lines.length + 2,
      startOnNewLine: true,
      trailingNewline: true,
    }
  })
}

function renderAnsiPanel(lines: Array<{ content: string; fg?: string }>): string {
  const width = Math.min(lineWidth + 6, process.stdout.columns ?? lineWidth + 6)
  const innerWidth = Math.max(20, width - 4)
  const output = [
    `${ansiFg(palette.line)}${ansiBg(palette.panel)}┌${"─".repeat(innerWidth + 2)}┐${ansiReset()}`,
    ...lines.map((line) => {
      const content = compact(line.content, innerWidth).padEnd(innerWidth, " ")
      return `${ansiFg(palette.line)}${ansiBg(palette.panel)}│  ${ansiFg(line.fg ?? palette.body)}${content}${ansiFg(palette.line)}  │${ansiReset()}`
    }),
    `${ansiFg(palette.line)}${ansiBg(palette.panel)}└${"─".repeat(innerWidth + 2)}┘${ansiReset()}`,
  ]
  return `\n${output.join("\n")}\n`
}

function renderWildAnsiReport(output: any, exitCode: number): string {
  const width = Math.min(Math.max(92, process.stdout.columns ?? 112), 132)
  const inner = width - 4
  const categories = output.categories ?? {}
  const vector = output.vector ?? {}
  const readiness = output.readiness ?? {}
  const minimum = output.minimum ?? {}
  const hardGate = String(output.hard_gate_status ?? "unknown").toUpperCase()
  const readinessScore = Number(readiness.score ?? 0)
  const pressure = Number(readiness.pressure ?? 0)
  const weightedMean = Number(output.weighted_mean ?? 0)
  const failed = exitCode !== 0 || hardGate === "FAIL" || readinessScore < 0.35
  const statusColor = failed ? palette.block : palette.good
  const rows: string[] = []
  const push = (content = "") => rows.push(content)

  push(
    `${ansiFg(palette.accent)}PULSAR${ansiFg(palette.muted)} / repo health observer ` +
      `${ansiFg(statusColor)}${failed ? "FAIL" : "PASS"}${ansiFg(palette.muted)} ` +
      `${ansiFg(palette.body)}${shortRepo(process.cwd() === repoPath ? process.cwd() : repoPath)}`,
  )
  push(
    `${ansiFg(palette.muted)}vector ${ansiFg(palette.text)}${vector.id ?? "unknown"}   ` +
      `${ansiFg(palette.muted)}source ${ansiFg(palette.text)}${vector.source_label ?? vector.source ?? "unknown"}   ` +
      `${ansiFg(palette.muted)}mean ${ansiFg(scoreColor(weightedMean))}${weightedMean.toFixed(2)}`,
  )
  push("")
  push(
    `${ansiFg(statusColor)}${readinessCard(readinessScore, String(readiness.status ?? "unknown"), pressure)}  ` +
      `${ansiFg(palette.body)}${compact(String(minimum.signal ?? "minimum unknown"), 14)} ` +
      `${ansiFg(palette.muted)}is the floor`,
  )
  push("")

  const categoryRows = [
    ["architectural-drift", "ARCH", "Architectural Drift"],
    ["dependency-entropy", "DEPS", "Dependency Entropy"],
    ["abstraction-bloat", "ABST", "Abstraction Bloat"],
    ["legibility-decay", "READ", "Legibility Decay"],
    ["generated-slop", "GEN", "Generated Slop"],
    ["review-pain", "REV", "Review Pain"],
  ] as const

  const metricWidth = Math.floor((inner - 3) / 2)
  for (let index = 0; index < categoryRows.length; index += 2) {
    const left = metricCell(categories, categoryRows[index], metricWidth)
    const right = metricCell(categories, categoryRows[index + 1], metricWidth)
    push(`${left}${ansiFg(palette.muted)} │ ${right}`)
  }

  push("")
  push(
    `${ansiFg(palette.muted)}minimum ${ansiFg(palette.text)}${minimum.signal ?? "unknown"} ` +
      `${ansiFg(palette.muted)}/ ${minimum.category ?? "unknown"} / ` +
      `${ansiFg(scoreColor(Number(minimum.score ?? 0)))}${Number(minimum.score ?? 0).toFixed(2)}`,
  )
  if (typeof minimum.detail === "string" && minimum.detail !== "") {
    push(`${ansiFg(palette.body)}${compact(JSON.stringify(minimum.detail), inner - 2)}`)
  }

  const findings = Array.isArray(output.hard_gate_violations) ? output.hard_gate_violations.slice(0, 4) : []
  if (findings.length > 0) {
    push("")
    push(`${ansiFg(palette.accent)}TOP FINDINGS${ansiFg(palette.muted)} (${findings.length} shown)`)
    for (const finding of findings) {
      const diagnostic = finding.diagnostic ?? {}
      const location = diagnostic.location
      const severity = String(diagnostic.severity ?? "info").toUpperCase()
      push(
        `${ansiFg(palette.block)}${String(finding.signalId ?? "unknown").padEnd(9, " ")} ` +
          `${severity.padEnd(5, " ")} ${ansiFg(palette.body)}${compact(String(diagnostic.message ?? ""), inner - 18)}`,
      )
      if (location?.file !== undefined) {
        push(`${ansiFg(palette.muted)}          at ${relativePath(String(location.file))}${location.line !== undefined ? `:${location.line}` : ""}`)
      }
    }
  }

  return renderAnsiRows(rows, width)
}

function metricCell(categories: any, [id, code, label]: readonly [string, string, string], width: number): string {
  const score = Number(categories[id]?.score ?? 0)
  const color = scoreColor(score)
  const barWidth = Math.max(6, Math.min(10, width - 27))
  const raw = `${ansiFg(palette.muted)}${code.padEnd(4, " ")} ${ansiFg(palette.text)}${compact(label, 16).padEnd(16, " ")} ${ansiFg(color)}${score.toFixed(2)} ${sparkBar(score, barWidth)}`
  return padAnsi(raw, width)
}

function readinessCard(score: number, status: string, pressure: number): string {
  return `${status.toUpperCase().padEnd(8, " ")} ${score.toFixed(2)} ${sparkBar(score, 26)} pressure ${pressure.toFixed(2)}`
}

function sparkBar(score: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  const color = scoreColor(score)
  const emptyColor = "#314349"
  return `${ansiFg(color)}${"▰".repeat(filled)}${ansiFg(emptyColor)}${"▱".repeat(width - filled)}`
}

function scoreColor(score: number): string {
  if (score < 0.35) return palette.block
  if (score < 0.7) return palette.warn
  return palette.text
}

function renderAnsiRows(rows: string[], width: number): string {
  const inner = width - 4
  const rendered = [
    `${ansiFg(palette.line)}${ansiBg(palette.panel)}╭${"─".repeat(inner + 2)}╮${ansiReset()}`,
    ...rows.map((content) => `${ansiFg(palette.line)}${ansiBg(palette.panel)}│ ${padAnsi(content, inner)} ${ansiFg(palette.line)}│${ansiReset()}`),
    `${ansiFg(palette.line)}${ansiBg(palette.panel)}╰${"─".repeat(inner + 2)}╯${ansiReset()}`,
  ]
  return `\n${rendered.join("\n")}\n`
}

function padAnsi(value: string, width: number): string {
  const clipped = clipAnsi(value, width)
  return `${clipped}${" ".repeat(Math.max(0, width - visibleLength(clipped)))}`
}

function clipAnsi(value: string, max: number): string {
  let visible = 0
  let output = ""
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\x1b") {
      const end = value.indexOf("m", index)
      if (end === -1) break
      output += value.slice(index, end + 1)
      index = end
      continue
    }
    if (visible >= max - 1) {
      output += "…"
      break
    }
    output += value[index]
    visible += 1
  }
  return output
}

function visibleLength(value: string): number {
  return value.replace(/\x1b\[[0-9;]*m/g, "").length
}

function ansiFg(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `\x1b[38;2;${r};${g};${b}m`
}

function ansiBg(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `\x1b[48;2;${r};${g};${b}m`
}

function ansiReset(): string {
  return "\x1b[0m"
}

function rgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function setLines(lines: Array<{ content: string; fg?: string }>): void {
  for (let index = 0; index < lineTexts.length; index += 1) {
    const line = lineTexts[index]
    const next = lines[index]
    line.content = fitLine(next?.content ?? "")
    line.fg = next?.fg ?? palette.body
  }
}

function fitLine(value: string): string {
  return compact(value, lineWidth).padEnd(lineWidth, " ")
}

function bar(score: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`
}

function compact(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`
}

function relativePath(path: string): string {
  const normalizedRepo = repoPath.replace(/\/$/, "")
  return path.startsWith(`${normalizedRepo}/`) ? path.slice(normalizedRepo.length + 1) : path
}

function shortRepo(path: string): string {
  if (path.length <= 48) return path
  const parts = path.split("/")
  return `.../${parts.slice(-3).join("/")}`
}
