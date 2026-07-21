import type { SelectOption } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { actionForOption } from "./actions.js"
import { buildPlan } from "./calibration.js"
import { catalogById } from "./catalog.js"
import { bandColor, palette, scoreBand } from "./palette.js"
import type {
  BaselineDecision,
  CalibrationChoice,
  CalibrationPreview,
  CalibrationWriteResult,
  CatalogEntry,
  OnboardInput,
  ScanResult,
  SignalScan,
} from "./types.js"
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

type Beat =
  | "welcome"
  | "frame"
  | "consent"
  | "seed"
  | "scanstats"
  | "calibrate"
  | "calibration-value"
  | "reveal"
  | "commit"
  | "handoff"
  | "gate"

const FLOW: ReadonlyArray<Beat> = [
  "welcome",
  "frame",
  "consent",
  "seed",
  "scanstats",
  "calibrate",
  "calibration-value",
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
  const [choices, setChoices] = useState<Record<string, CalibrationChoice>>({})
  const [enabledPacks, setEnabledPacks] = useState<string[]>([])
  const [baseline, setBaseline] = useState<BaselineDecision>("not-provided")
  const [valueText, setValueText] = useState("")
  const [valueError, setValueError] = useState<string | null>(null)
  const [preview, setPreview] = useState<CalibrationPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [written, setWritten] = useState<CalibrationWriteResult | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)

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
      choices: Object.values(choices),
      enabledPacks,
      baseline,
      seed,
      detection: input.detection,
    })
    input
      .writeConfig(plan)
      .then((result) => {
        if (!cancelled) setWritten(result)
      })
      .catch((cause) => {
        if (!cancelled) setWriteError(String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (next: Beat) => setStep(next)

  const liveElapsed = (): number => (scanning ? Date.now() - scanStartRef.current : elapsedMs)

  const planOf = (
    nextChoices: Record<string, CalibrationChoice>,
    nextPacks: ReadonlyArray<string>,
    nextBaseline: BaselineDecision,
  ) =>
    buildPlan({
      choices: Object.values(nextChoices),
      enabledPacks: nextPacks,
      baseline: nextBaseline,
      seed,
      detection: input.detection,
    })

  const beginPreview = (
    nextChoices: Record<string, CalibrationChoice>,
    nextPacks: ReadonlyArray<string>,
    nextBaseline: BaselineDecision,
  ): void => {
    const plan = planOf(nextChoices, nextPacks, nextBaseline)
    setPreview(null)
    setPreviewError(null)
    setPreviewing(true)
    goTo("reveal")
    input
      .preview(plan)
      .then(setPreview)
      .catch((cause) => setPreviewError(String(cause)))
      .finally(() => setPreviewing(false))
  }

  const enterCalibrate = () => {
    setCalibIdx(0)
    setSelIdx(targets[0]?.entry.defaultOptionIndex ?? 0)
    if (targets.length > 0) goTo("calibrate")
    else beginPreview(choices, enabledPacks, baseline)
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
        if (previewing || preview === null) return
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
    if (step === "calibration-value") {
      setValueError(null)
      return goTo("calibrate")
    }
    if (step === "commit") {
      return goTo("reveal")
    }
    if (step === "calibrate" && calibIdx > 0) {
      const prev = calibIdx - 1
      setCalibIdx(prev)
      setSelIdx(targets[prev]?.entry.defaultOptionIndex ?? 0)
    }
  }

  const finishCalibrationChoice = (choice: CalibrationChoice): void => {
    const nextChoices = { ...choices, [choice.signalId]: choice }
    const nextPacks = [
      ...new Set(
        Object.values(nextChoices).flatMap((candidate) =>
          candidate.action.kind === "enable-pack" ? [candidate.action.packId] : [],
        ),
      ),
    ].sort()
    const nextBaseline: BaselineDecision = Object.values(nextChoices).some(
      (candidate) => candidate.action.kind === "baseline-accept",
    )
      ? "accept"
      : "not-provided"
    setChoices(nextChoices)
    setEnabledPacks(nextPacks)
    setBaseline(nextBaseline)
    setValueText("")
    setValueError(null)
    if (calibIdx < targets.length - 1) {
      const next = calibIdx + 1
      setCalibIdx(next)
      setSelIdx(targets[next]?.entry.defaultOptionIndex ?? 0)
      goTo("calibrate")
    } else {
      beginPreview(nextChoices, nextPacks, nextBaseline)
    }
  }

  const submitCalibrationValue = (): void => {
    const target = targets[calibIdx]
    if (target === undefined) return
    try {
      finishCalibrationChoice({
        signalId: target.entry.id,
        optionIndex: selIdx,
        action: actionForOption(target.entry, selIdx, valueText),
      })
    } catch (cause) {
      setValueError(String(cause))
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
        const opt = target.entry.options[selIdx]
        if (
          opt?.calibrationKind === "vector-config" ||
          opt?.calibrationKind === "vector-weight" ||
          opt?.calibrationKind === "vector-active"
        ) {
          setValueText("")
          setValueError(null)
          goTo("calibration-value")
          return
        }
        finishCalibrationChoice({
          signalId: target.entry.id,
          optionIndex: selIdx,
          action: actionForOption(target.entry, selIdx),
        })
      }
      return
    }
    if (step === "commit") {
      const requiredByChoice = Object.values(choices).some(
        (choice) => choice.action.kind === "baseline-accept",
      )
      setBaseline(requiredByChoice || selIdx === 0 ? "accept" : "reject")
      setWritten(null)
      setWriteError(null)
      goTo("handoff")
      return
    }
  }

  useKeyboard((key) => {
    const name = (key as { name?: string }).name ?? ""
    const ctrl = (key as { ctrl?: boolean }).ctrl ?? false
    if (ctrl && name === "c") return input.onExit()
    if (SELECT_BEATS.has(step) || step === "calibration-value") return
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
      case "calibration-value":
        return renderCalibrationValue()
      case "reveal":
        return renderReveal()
      case "commit": {
        const requiredByChoice = Object.values(choices).some(
          (choice) => choice.action.kind === "baseline-accept",
        )
        return (
          <Panel title="commit">
            <text fg={palette.text} wrapMode="word">
              {requiredByChoice
                ? "A signal choice explicitly accepted today's debt. Confirm the production baseline snapshot."
                : "Choose explicitly whether to accept today's debt as the floor. Pulsar never assumes this in headless or interactive mode."}
            </text>
            <box style={{ flexGrow: 1, marginTop: 1 }}>
              <select
                focused
                width="100%"
                height="100%"
                options={
                  requiredByChoice
                    ? [
                        {
                          name: "Confirm the baseline — never worse",
                          description: "records the explicitly selected baseline with the production serializer",
                          value: "yes",
                        },
                      ]
                    : [
                        { name: "Accept the baseline — never worse", description: "records pulsar-baseline.json", value: "yes" },
                        { name: "Reject baseline creation", description: "persists calibration without a baseline", value: "no" },
                      ]
                }
                selectedIndex={selIdx}
                onChange={setSelIdx}
                onSelect={choose}
                {...selectTheme}
              />
            </box>
          </Panel>
        )
      }
      case "handoff":
        return (
          <Panel title="your .pulsar">
            <text fg={palette.text}>Co-authored, repo-owned, attributable. Commit it.</text>
            <text fg={palette.muted}> </text>
            {writeError !== null ? (
              <text fg={palette.red}>{trunc(writeError, cols - 4)}</text>
            ) : written === null ? (
              <text fg={palette.muted}>writing…</text>
            ) : (
              written.written.map((p) => (
                <text key={p} fg={palette.green}>
                  ✓ {trunc(p, cols - 4)}
                </text>
              ))
            )}
            {written?.receipts
              .filter((receipt) => receipt.status === "unapplied")
              .map((receipt) => (
                <text key={`${receipt.signalId}:${receipt.optionIndex}`} fg={palette.amber}>
                  ! {receipt.signalId} unapplied · {trunc(receipt.detail, cols - 28)}
                </text>
              ))}
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
    const top = sig.findings[0]
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
          title={`in your repo · ${sig.findingCount} currently flagged`}
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
            sig.findings.slice(0, 5).map((f, i) => (
              <text key={`${f.file}:${f.line ?? i}`} fg={palette.textDim}>
                ✗ {trunc(`${f.file}${f.line ? `:${f.line}` : ""} — ${f.detail}`, evidenceWidth - 2)}
              </text>
            ))
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

  function renderCalibrationValue() {
    const target = targets[calibIdx]
    const option = target?.entry.options[selIdx]
    if (target === undefined || option === undefined) return null
    const prompt =
      option.calibrationKind === "vector-config"
        ? 'Enter typed JSON: {"key":"actual_config_key","value":...}'
        : option.calibrationKind === "vector-weight"
          ? "Enter a JSON number from 0 through 2"
          : "Enter true or false"
    return (
      <Panel title={`typed calibration · ${target.entry.id}`}>
        <text fg={palette.text}>{option.label}</text>
        <text fg={palette.muted} wrapMode="word">
          {prompt}
        </text>
        <text fg={palette.textDim} wrapMode="word">
          The catalog target is display context only. Pulsar validates this value against the registered signal before any write.
        </text>
        <box style={{ height: 3, marginTop: 1, border: true, borderColor: palette.border }}>
          <input
            focused
            width="100%"
            value={valueText}
            placeholder={prompt}
            onInput={setValueText}
            onSubmit={submitCalibrationValue}
          />
        </box>
        {valueError === null ? null : <text fg={palette.red}>{trunc(valueError, cols - 4)}</text>}
      </Panel>
    )
  }

  function renderReveal() {
    if (scan === null) return null
    if (previewing) {
      return (
        <Centered>
          <text fg={palette.amber}>scoring the proposed vector…</text>
          <text fg={palette.muted}>real observer run; the repository remains unchanged</text>
        </Centered>
      )
    }
    if (previewError !== null || preview === null) {
      return (
        <Panel title="preview failed">
          <text fg={palette.red}>{previewError ?? "No preview result"}</text>
        </Panel>
      )
    }
    const calibratedList = Object.values(choices)
      .map((choice) => {
        const option = byId.get(choice.signalId)?.options[choice.optionIndex]
        return option !== undefined && choice.action.kind !== "keep-default"
          ? { id: choice.signalId, label: option.label, status: choice.action.kind === "unsupported" ? "unapplied" : "applied" }
          : null
      })
      .filter((item): item is { id: string; label: string; status: "applied" | "unapplied" } => item !== null)
    // Post-calibration, "real debt" is meaningful: signals you kept the default
    // on (acknowledged as-is) whose measurement is still low.
    const keptDebt = targets
      .filter((t) => {
        const choice = choices[normalizeSignalId(t.sig.id)]
        return (choice?.action.kind ?? "keep-default") === "keep-default" && t.sig.score < 0.6
      })
      .sort((a, b) => a.sig.score - b.sig.score)
      .slice(0, 6)
    return (
      <box style={{ flexGrow: 1, flexDirection: "column", gap: 1 }}>
        <box style={{ flexDirection: "row", gap: 4 }}>
          <box style={{ flexDirection: "column" }}>
            <text fg={palette.muted}>before</text>
            <text fg={bandColor(preview.before.band)}>
              {preview.before.band.toUpperCase()} · {preview.before.score.toFixed(2)}
            </text>
          </box>
          <box style={{ flexDirection: "column" }}>
            <text fg={palette.muted}>after calibration (observed)</text>
            <text fg={bandColor(preview.after.band)}>
              {preview.after.band.toUpperCase()} · {preview.after.score.toFixed(2)}
            </text>
          </box>
          <box style={{ flexDirection: "column" }}>
            <text fg={palette.muted}>driver</text>
            <text fg={palette.text}>{trunc(preview.after.driver, cols - 40)}</text>
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
                <text fg={c.status === "applied" ? palette.green : palette.amber}>{c.status === "applied" ? "✓" : "!"}</text>
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
