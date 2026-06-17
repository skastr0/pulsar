import type { SelectOption } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { buildPlan, rescore, survivingFindings } from "./calibration.js"
import { catalogById } from "./catalog.js"
import { bandColor, palette, scoreBand } from "./palette.js"
import type { CalibrationChoice, CatalogEntry, Finding, OnboardInput, ScanResult, SignalScan } from "./types.js"
import { normalizeSignalId } from "./util.js"

const SEED_Q: ReadonlyArray<{ key: string; q: string; options: SelectOption[] }> = [
  {
    key: "shape",
    q: "What kind of repo is this?",
    options: [
      { name: "Application", description: "ships to users", value: "app" },
      { name: "Library / SDK", description: "consumed by other code", value: "library" },
      { name: "Infrastructure", description: "deploy + config", value: "infra" },
      { name: "Monorepo (mixed)", description: "several of the above", value: "monorepo" },
    ],
  },
  {
    key: "team",
    q: "Who maintains it?",
    options: [
      { name: "Just me", description: "single author — bus-factor declares itself unmeasurable", value: "solo" },
      { name: "Small team (2–9)", description: "a handful of maintainers", value: "small" },
      { name: "Large team (10+)", description: "many hands, many conventions", value: "large" },
    ],
  },
  {
    key: "ai",
    q: "Tune Pulsar to be strict about AI-written-code patterns?",
    options: [
      { name: "Yes — agent-written codebase", description: "weights generated-slop + unfinished-impl signals", value: "yes" },
      { name: "No — mostly hand-written", description: "standard weighting", value: "no" },
    ],
  },
]

type Beat = "welcome" | "frame" | "consent" | "seed" | "scanstats" | "calibrate" | "reveal" | "commit" | "handoff" | "gate"

const FLOW: ReadonlyArray<Beat> = [
  "welcome",
  "frame",
  "consent",
  "seed",
  "scanstats",
  "calibrate",
  "reveal",
  "commit",
  "handoff",
  "gate",
]

const SELECT_BEATS = new Set<Beat>(["seed", "calibrate", "commit"])

const selectTheme = {
  showScrollIndicator: true,
  wrapSelection: true,
  backgroundColor: palette.panel,
  textColor: palette.text,
  descriptionColor: palette.muted,
  selectedBackgroundColor: palette.amber,
  selectedTextColor: palette.bg,
  selectedDescriptionColor: palette.bg,
  focusedBackgroundColor: palette.panelRaised,
  focusedTextColor: palette.text,
} as const

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)

// Fallback page for an active signal that has no bespoke catalog entry, so the
// walk covers EVERY signal, not just the curated ones.
const genericEntry = (sig: SignalScan): CatalogEntry => {
  const id = normalizeSignalId(sig.id)
  return {
    id,
    title: sig.title ?? id,
    pack: "",
    category: sig.category ?? "other",
    measures: "Pulsar measured this signal across your repo.",
    whyItMatters: "",
    evidence: sig.findings.length > 0 ? "file-local" : "repo-level",
    evidenceHint: "",
    question: "What's true here?",
    options: [
      {
        label: "Keep the default",
        summary: "This measurement is right for the repo as it stands.",
        calibrationKind: "keep-default",
        calibrationTarget: `signal_overrides.${id}`,
        framing: "keep",
      },
      {
        label: "Accept current findings as the floor",
        summary: "Record today's findings as known debt; CI then blocks only new ones.",
        calibrationKind: "baseline-accept",
        calibrationTarget: "pulsar-baseline.json",
        framing: "accept",
      },
    ],
    defaultOptionIndex: 0,
  }
}

interface CalibTarget {
  readonly sig: SignalScan
  readonly entry: CatalogEntry
}

export function OnboardApp({ input }: { readonly input: OnboardInput }) {
  const byId = useMemo(() => catalogById(input.catalog), [input.catalog])
  const cols = Math.max(60, process.stdout.columns ?? 100)
  const evidenceWidth = cols - 8

  const [step, setStep] = useState<Beat>((input.__debugBeat as Beat | undefined) ?? "welcome")
  const [seedIdx, setSeedIdx] = useState(0)
  const [seed, setSeed] = useState<Record<string, string>>({})
  const [scan, setScan] = useState<ScanResult | null>(input.__debugScan ?? null)
  const [scanning, setScanning] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [, setTick] = useState(0)
  const scanStartRef = useRef(0)
  const startedRef = useRef(input.__debugScan !== undefined)
  const [calibIdx, setCalibIdx] = useState(0)
  const [selIdx, setSelIdx] = useState(0)
  const [choices, setChoices] = useState<Record<string, number>>({})
  const [enabledPacks, setEnabledPacks] = useState<string[]>([])
  const [baseline, setBaseline] = useState(false)
  const [written, setWritten] = useState<ReadonlyArray<string> | null>(null)

  // EVERY active signal gets a page. Pre-calibration scores are NOT a selector —
  // they're meaningless until the user confirms what's true, so we never filter
  // or rank by "pressure" here. Grouped by category for a coherent walk.
  const targets = useMemo<ReadonlyArray<CalibTarget>>(() => {
    if (!scan) return []
    const picks: CalibTarget[] = []
    const seen = new Set<string>()
    for (const sig of scan.signals) {
      const norm = normalizeSignalId(sig.id)
      if (seen.has(norm)) continue
      seen.add(norm)
      picks.push({ sig, entry: byId.get(norm) ?? genericEntry(sig) })
    }
    picks.sort((a, b) => {
      const c = a.entry.category.localeCompare(b.entry.category)
      return c !== 0 ? c : normalizeSignalId(a.sig.id).localeCompare(normalizeSignalId(b.sig.id))
    })
    return picks
  }, [scan, byId])

  const titleOf = (normId: string): string =>
    scan?.signals.find((s) => normalizeSignalId(s.id) === normId)?.title ?? byId.get(normId)?.title ?? normId

  const startScan = (): void => {
    if (startedRef.current) return
    startedRef.current = true
    setScanning(true)
    scanStartRef.current = Date.now()
    input
      .scan()
      .then((r) => {
        setScan(r)
        setElapsedMs(Date.now() - scanStartRef.current)
        setScanning(false)
      })
      .catch(() => setScanning(false))
  }

  // Tick the clock while scanning so the elapsed time is live.
  useEffect(() => {
    if (!scanning) return
    const t = setInterval(() => setTick((n) => n + 1), 200)
    return () => clearInterval(t)
  }, [scanning])

  useEffect(() => {
    if (step !== "handoff" || !scan) return
    let cancelled = false
    const plan = buildPlan({
      choices: Object.entries(choices).map<CalibrationChoice>(([signalId, optionIndex]) => ({ signalId, optionIndex })),
      enabledPacks,
      baseline,
      seed,
      detection: input.detection,
    })
    input
      .writeConfig(plan)
      .then((paths) => {
        if (!cancelled) setWritten(paths)
      })
      .catch(() => {
        if (!cancelled) setWritten(["(write failed — see logs)"])
      })
    return () => {
      cancelled = true
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (next: Beat) => setStep(next)

  const liveElapsed = (): number => (scanning ? Date.now() - scanStartRef.current : elapsedMs)

  const enterCalibrate = () => {
    setCalibIdx(0)
    setSelIdx(targets[0]?.entry.defaultOptionIndex ?? 0)
    goTo(targets.length > 0 ? "calibrate" : "reveal")
  }

  const advance = () => {
    switch (step) {
      case "welcome":
        return goTo("frame")
      case "frame":
        return goTo("consent")
      case "consent":
        startScan()
        setSeedIdx(0)
        setSelIdx(0)
        return goTo("seed")
      case "scanstats":
        if (scanning) return
        return enterCalibrate()
      case "reveal":
        setSelIdx(0)
        return goTo("commit")
      case "handoff":
        return goTo("gate")
      case "gate":
        return input.onExit()
      default:
        return
    }
  }

  const back = () => {
    if (step === "calibrate" && calibIdx > 0) {
      const prev = calibIdx - 1
      setCalibIdx(prev)
      setSelIdx(targets[prev]?.entry.defaultOptionIndex ?? 0)
    }
  }

  const choose = () => {
    if (step === "seed") {
      const q = SEED_Q[seedIdx]!
      const value = q.options[selIdx]?.value
      setSeed((s) => ({ ...s, [q.key]: String(value ?? "") }))
      if (seedIdx < SEED_Q.length - 1) {
        setSeedIdx((i) => i + 1)
        setSelIdx(0)
      } else {
        goTo("scanstats")
      }
      return
    }
    if (step === "calibrate") {
      const target = targets[calibIdx]
      if (target) {
        const norm = normalizeSignalId(target.sig.id)
        setChoices((c) => ({ ...c, [norm]: selIdx }))
        const opt = target.entry.options[selIdx]
        if (opt && (opt.calibrationKind === "project-module" || opt.calibrationKind === "pack-toggle") && target.entry.packGate) {
          setEnabledPacks((p) => (p.includes(target.entry.packGate!) ? p : [...p, target.entry.packGate!]))
        }
      }
      if (calibIdx < targets.length - 1) {
        const next = calibIdx + 1
        setCalibIdx(next)
        setSelIdx(targets[next]?.entry.defaultOptionIndex ?? 0)
      } else {
        goTo("reveal")
      }
      return
    }
    if (step === "commit") {
      setBaseline(selIdx === 0)
      setWritten(null)
      goTo("handoff")
      return
    }
  }

  useKeyboard((key) => {
    const name = (key as { name?: string }).name ?? ""
    const ctrl = (key as { ctrl?: boolean }).ctrl ?? false
    if (ctrl && name === "c") return input.onExit()
    if (SELECT_BEATS.has(step)) return
    if (name === "q" || name === "escape") return input.onExit()
    if (name === "return" || name === "enter") return advance()
    if (name === "b" || name === "backspace") return back()
  })

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", backgroundColor: palette.bg, padding: 1, gap: 1 }}>
      <Header step={step} seedIdx={seedIdx} calibIdx={calibIdx} total={targets.length} scanning={scanning} phase={input.phase} />
      <box style={{ flexGrow: 1, flexDirection: "column" }}>{renderBody()}</box>
      <Footer step={step} scanning={scanning} />
    </box>
  )

  function renderBody() {
    switch (step) {
      case "welcome":
        return (
          <Centered>
            <text fg={palette.amber}>PULSAR</text>
            <text fg={palette.text}>The code-trust band for repos written faster than they are read.</text>
            <text fg={palette.muted}> </text>
            <text fg={palette.textDim}>
              {input.detection.languages.join(", ")} · {input.detection.frameworks.join(", ") || "—"} ·{" "}
              {input.detection.fileCount} files · {input.detection.contributors} contributors · {input.detection.visibility}
            </text>
            <text fg={palette.muted}> </text>
            <text fg={palette.muted}>We'll read your repo, then walk its signals one at a time. A few minutes.</text>
          </Centered>
        )
      case "frame":
        return (
          <Panel title="how it works">
            <text fg={palette.text} wrapMode="word">
              Pulsar scores your repo and renders one verdict: a readiness band and the single thing driving it. No
              ignore flag, no waiver file — three honest moves: calibrate what's true here, baseline today's debt, or fix.
            </text>
            <text fg={palette.muted}> </text>
            <text fg={palette.amber} wrapMode="word">
              When Pulsar is wrong here, you don't silence it — you tell it what's true, for the whole repo.
            </text>
          </Panel>
        )
      case "consent":
        return (
          <Panel title="consent">
            <text fg={palette.text} wrapMode="word">
              Pulsar reads only what git tracks. It runs locally. It writes nothing until you say so.
            </text>
            <text fg={palette.muted}> </text>
            <text fg={palette.amber}>Press Enter — we'll start reading while you answer a few quick questions.</text>
          </Panel>
        )
      case "seed": {
        const q = SEED_Q[seedIdx]!
        return (
          <Panel title={`setup · ${seedIdx + 1}/${SEED_Q.length}`}>
            <text fg={palette.text} wrapMode="word">
              {q.q}
            </text>
            <box style={{ flexGrow: 1, marginTop: 1 }}>
              <select
                focused
                width="100%"
                height="100%"
                options={q.options}
                selectedIndex={selIdx}
                onChange={setSelIdx}
                onSelect={choose}
                {...selectTheme}
              />
            </box>
          </Panel>
        )
      }
      case "scanstats":
        return renderScanStats()
      case "calibrate":
        return renderCalibrate()
      case "reveal":
        return renderReveal()
      case "commit":
        return (
          <Panel title="commit">
            <text fg={palette.text} wrapMode="word">
              Accept today's debt as the floor. From here, CI fails only on new violations — never inherited ones.
            </text>
            <box style={{ flexGrow: 1, marginTop: 1 }}>
              <select
                focused
                width="100%"
                height="100%"
                options={[
                  { name: "Accept the baseline — never worse", description: "records pulsar-baseline.json", value: "yes" },
                  { name: "Skip for now", description: "calibrate without recording a baseline", value: "no" },
                ]}
                selectedIndex={selIdx}
                onChange={setSelIdx}
                onSelect={choose}
                {...selectTheme}
              />
            </box>
          </Panel>
        )
      case "handoff":
        return (
          <Panel title="your .pulsar">
            <text fg={palette.text}>Co-authored, repo-owned, attributable. Commit it.</text>
            <text fg={palette.muted}> </text>
            {written === null ? (
              <text fg={palette.muted}>writing…</text>
            ) : (
              written.map((p) => (
                <text key={p} fg={palette.green}>
                  ✓ {trunc(p, cols - 4)}
                </text>
              ))
            )}
          </Panel>
        )
      case "gate":
        return renderGate()
      default:
        return null
    }
  }

  function renderScanStats() {
    const secs = (liveElapsed() / 1000).toFixed(1)
    if (scanning || !scan) {
      return (
        <Centered>
          <text fg={palette.amber}>analyzing your repo…</text>
          <text fg={palette.muted}> </text>
          <text fg={palette.textDim}>
            {secs}s · {input.detection.fileCount} files · {input.detection.languages.join(", ")}
          </text>
          <text fg={palette.muted}>(first scan is a cold pass; re-runs are cached)</text>
        </Centered>
      )
    }
    return (
      <Centered>
        <text fg={palette.green}>✓ scan complete</text>
        <text fg={palette.muted}> </text>
        <text fg={palette.text}>
          {scan.signals.length} signals measured · {secs}s · {input.detection.fileCount} files
        </text>
        <text fg={palette.muted}> </text>
        <text fg={palette.textDim} wrapMode="word">
          These scores are uncalibrated — they don't mean anything yet. We'll walk every signal so you can tell Pulsar
          what's true here. The verdict comes after.
        </text>
        <text fg={palette.muted}> </text>
        <text fg={palette.amber}>Press Enter to start — {targets.length} signals, one at a time.</text>
      </Centered>
    )
  }

  function renderCalibrate() {
    const target = targets[calibIdx]
    if (!target) {
      return (
        <Panel title="calibrate">
          <text fg={palette.muted}>Nothing under pressure to calibrate — your repo is already green-and-holding.</text>
        </Panel>
      )
    }
    const { sig, entry } = target
    const survivors = survivingFindings(entry, sig.findings, selIdx)
    const survivorSet = new Set(survivors)
    const option = entry.options[selIdx]
    const after =
      option?.framing === "accept"
        ? 0
        : option?.framing === "keep"
          ? sig.findingCount
          : Math.round((sig.findingCount * survivors.length) / Math.max(1, sig.findings.length))
    const top = survivors[0] ?? sig.findings[0]
    const options: SelectOption[] = entry.options.map((o) => ({
      name: `${o.framing === "keep" ? "›" : o.framing === "accept" ? "+" : "~"} ${o.label}`,
      description: o.summary,
      value: o.label,
    }))
    return (
      <box style={{ flexGrow: 1, flexDirection: "column", gap: 1 }}>
        {/* header: name + score, full width */}
        <box style={{ flexDirection: "row", gap: 1 }}>
          <text fg={palette.muted}>
            signal {calibIdx + 1}/{targets.length}
          </text>
          <text fg={bandColor(scoreBand(sig.score))}>{sig.score.toFixed(2)}</text>
          <text fg={palette.text}>{entry.title}</text>
          <text fg={palette.muted}>· {entry.category}</text>
        </box>
        <text fg={palette.textDim} wrapMode="word">
          {entry.measures}
        </text>
        {/* evidence: full width, fixed height, truncated so it never garbles */}
        <box
          title={`in your repo · ${sig.findingCount} flagged → ${after}`}
          style={{ height: 9, border: true, borderColor: palette.border, backgroundColor: palette.panelRaised, padding: 1, flexDirection: "column" }}
        >
          {top?.snippet ? (
            <box style={{ flexDirection: "column" }}>
              <text fg={palette.amber}>{trunc(`${top.file}${top.line ? `:${top.line}` : ""}`, evidenceWidth)}</text>
              {top.snippet.slice(0, 4).map((lineText, i) => {
                const flagged = top.flagLine === i
                return (
                  <text key={i} fg={flagged ? palette.red : palette.textDim}>
                    {flagged ? "▸ " : "  "}
                    {trunc(lineText, evidenceWidth - 2)}
                  </text>
                )
              })}
            </box>
          ) : (
            sig.findings.slice(0, 5).map((f, i) => {
              const live = survivorSet.has(f)
              return (
                <text key={`${f.file}:${f.line ?? i}`} fg={live ? palette.textDim : palette.muted}>
                  {live ? "✗ " : "✓ "}
                  {trunc(`${f.file}${f.line ? `:${f.line}` : ""} — ${live ? f.detail : "calibrated"}`, evidenceWidth - 2)}
                </text>
              )
            })
          )}
        </box>
        <text fg={palette.amber}>{entry.question}</text>
        <box style={{ flexGrow: 1 }}>
          <select
            focused
            width="100%"
            height="100%"
            options={options}
            selectedIndex={selIdx}
            onChange={setSelIdx}
            onSelect={choose}
            {...selectTheme}
          />
        </box>
      </box>
    )
  }

  function renderReveal() {
    if (!scan) return null
    const calibratedIds = new Set(
      Object.entries(choices)
        .filter(([id, idx]) => {
          const o = byId.get(id)?.options[idx]
          return o !== undefined && o.framing !== "keep"
        })
        .map(([id]) => id),
    )
    const calibratedList = Object.entries(choices)
      .map(([id, idx]) => {
        const o = byId.get(id)?.options[idx]
        return o && o.framing !== "keep" ? { id, label: o.label } : null
      })
      .filter((x): x is { id: string; label: string } => x !== null)
    const after = rescore(scan, calibratedIds)
    // Post-calibration, "real debt" is meaningful: signals you kept the default
    // on (acknowledged as-is) whose measurement is still low.
    const keptDebt = targets
      .filter((t) => {
        const idx = choices[normalizeSignalId(t.sig.id)]
        const opt = idx !== undefined ? t.entry.options[idx] : undefined
        return (opt?.framing ?? "keep") === "keep" && t.sig.score < 0.6
      })
      .sort((a, b) => a.sig.score - b.sig.score)
      .slice(0, 6)
    return (
      <box style={{ flexGrow: 1, flexDirection: "column", gap: 1 }}>
        <box style={{ flexDirection: "row", gap: 4 }}>
          <box style={{ flexDirection: "column" }}>
            <text fg={palette.muted}>before</text>
            <text fg={bandColor(scan.band)}>
              {scan.band.toUpperCase()} · {scan.score.toFixed(2)}
            </text>
          </box>
          <box style={{ flexDirection: "column" }}>
            <text fg={palette.muted}>after calibration (est.)</text>
            <text fg={bandColor(after.band)}>
              {after.band.toUpperCase()} · {after.score.toFixed(2)}
            </text>
          </box>
          <box style={{ flexDirection: "column" }}>
            <text fg={palette.muted}>driver</text>
            <text fg={palette.text}>{trunc(titleOf(normalizeSignalId(scan.topPressures[0]?.id ?? "")), cols - 40)}</text>
          </box>
        </box>
        <box
          title={`you calibrated ${calibratedList.length}`}
          style={{ flexGrow: 1, border: true, borderColor: palette.border, backgroundColor: palette.panelRaised, padding: 1, flexDirection: "column" }}
        >
          {calibratedList.length === 0 ? (
            <text fg={palette.muted}>You kept the defaults — every verdict stands as Pulsar measured it.</text>
          ) : (
            calibratedList.map((c) => (
              <box key={c.id} style={{ flexDirection: "row", gap: 1 }}>
                <text fg={palette.green}>✓</text>
                <text fg={palette.text}>{trunc(titleOf(c.id), 32)}</text>
                <text fg={palette.muted}>{trunc(c.label, cols - 42)}</text>
              </box>
            ))
          )}
        </box>
        <box
          title="real debt you kept"
          style={{ height: 8, border: true, borderColor: palette.border, backgroundColor: palette.panel, padding: 1, flexDirection: "column" }}
        >
          {keptDebt.length === 0 ? (
            <text fg={palette.green}>Nothing kept as real debt.</text>
          ) : (
            keptDebt.map((t) => (
              <box key={t.sig.id} style={{ flexDirection: "row", gap: 1 }}>
                <text fg={bandColor(scoreBand(t.sig.score))}>{t.sig.score.toFixed(2)}</text>
                <text fg={palette.text}>{trunc(titleOf(normalizeSignalId(t.sig.id)), 36)}</text>
                <text fg={palette.muted}>{trunc(t.entry.category, 24)}</text>
              </box>
            ))
          )}
        </box>
      </box>
    )
  }

  function renderGate() {
    if (input.phase === "beta") {
      return (
        <Panel title="beta">
          <text fg={palette.text} wrapMode="word">
            You're in the Pulsar beta — free on every repo, public or private.
          </text>
          <text fg={palette.muted}> </text>
          <text fg={palette.amber} wrapMode="word">
            Come back after a few runs and tell us what held up. The testimonials we earn here open the door to charging
            for private repos.
          </text>
          <text fg={palette.muted}> </text>
          <text fg={palette.muted}>Press Enter to finish.</text>
        </Panel>
      )
    }
    if (input.detection.visibility === "public") {
      return (
        <Panel title="open source">
          <text fg={palette.green}>Free forever for open source.</text>
          <text fg={palette.muted}> </text>
          <text fg={palette.text} wrapMode="word">
            Your agents consume the regressions directly: pulsar score --agent-view
          </text>
          <text fg={palette.muted}>Press Enter to finish.</text>
        </Panel>
      )
    }
    return (
      <Panel title="license">
        <text fg={palette.text} wrapMode="word">
          Pulsar is free for open source. This repo is private.
        </text>
        <text fg={palette.muted} wrapMode="word">
          Ongoing use needs a license — this run and the verdict above were free.
        </text>
        <text fg={palette.muted}> </text>
        <text fg={palette.amber}>[ Start trial ]   [ Paste license key ]   [ Get a license ↗ ]</text>
        <text fg={palette.muted}>Press Enter to finish.</text>
      </Panel>
    )
  }
}

function Header({
  step,
  seedIdx,
  calibIdx,
  total,
  scanning,
  phase,
}: {
  readonly step: Beat
  readonly seedIdx: number
  readonly calibIdx: number
  readonly total: number
  readonly scanning: boolean
  readonly phase: string
}) {
  const label =
    step === "seed"
      ? `setup · ${seedIdx + 1}/${SEED_Q.length}${scanning ? " · analyzing" : ""}`
      : step === "calibrate"
        ? `signal ${calibIdx + 1}/${total}`
        : step === "scanstats"
          ? scanning
            ? "analyzing"
            : "scan complete"
          : step
  const idx = FLOW.indexOf(step) + 1
  return (
    <box style={{ height: 2, flexDirection: "row", justifyContent: "space-between" }}>
      <text fg={palette.amber}>PULSAR · {label}</text>
      <text fg={palette.muted}>
        {idx}/{FLOW.length} · {phase}
      </text>
    </box>
  )
}

function Footer({ step, scanning }: { readonly step: Beat; readonly scanning: boolean }) {
  const hint =
    step === "scanstats" && scanning
      ? "analyzing… (this can take a moment on a cold scan)"
      : SELECT_BEATS.has(step)
        ? "↑↓ move   ⏎ choose   b back   ⌃C quit"
        : "⏎ continue   ⌃C quit"
  return (
    <box style={{ height: 2, border: true, borderColor: palette.border, backgroundColor: palette.panelRaised, paddingX: 1 }}>
      <text fg={palette.muted}>{hint}</text>
    </box>
  )
}

function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <box
      title={title}
      style={{ flexGrow: 1, border: true, borderColor: palette.border, backgroundColor: palette.panel, padding: 1, flexDirection: "column", gap: 0 }}
    >
      {children}
    </box>
  )
}

function Centered({ children }: { readonly children: ReactNode }) {
  return (
    <box style={{ flexGrow: 1, flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 0 }}>{children}</box>
  )
}
