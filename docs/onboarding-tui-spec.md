# Pulsar Onboarding — `pulsar init` TUI Spec

**Status:** design draft · **Surface:** rich TUI via OpenTUI (`@opentui/core` + `@opentui/react`) · **Monetization:** free for public/OSS repos, license required for private repos.

## Thesis

The onboarding is not polish on a working product. It is the mechanism that earns the trust the positioning promises. Pulsar's default verdict is wrong-by-construction until calibrated — the OpenCode assessment is the proof (production repo, RED 0.00, mostly calibration false positives). The uncalibrated first run *breaks* the promise "you will always know the truth."

`pulsar init` converts **uncalibrated-red → co-authored, repo-owned, trusted verdict**, using the consumer-onboarding quiz pattern for one reason: the IKEA effect. A verdict the user calibrated screen-by-screen is one they believe and won't rage-quit — and the "no accept button" moat only holds if they believe the verdict.

`pulsar init` is not new machinery. It is the **TUI-dramatized choreography of verbs that already exist** and are run manually today: `persona apply`, `score`, `conventions extract`, `glossary extract`, `elicit quiz`, `calibrate suggest`, `baseline set`. The onboarding sequences them, wraps them in psychology and copy, and lands the user in a populated, committed `.pulsar/`.

## Two must-hold framings

1. **Calibration is sharpening, never suppression.** Sixty screens of "tune the vector" read as *accept buttons in a trenchcoat* if the copy is wrong — and that would quietly destroy the "no accept button" positioning. Every calibration prompt is phrased as *"what is true here"* (repo-wide, attributable, committed), never *"dismiss a finding you don't like."* Options are calibration moves (set a budget, tag a path as `integration`/`generated`, accept debt into the baseline). The word "ignore" appears nowhere.
2. **Never wall the aha — the trial always includes the full calibrated reveal.** Conversion depends on the user *feeling* the before/after delta. In beta this is free for everyone; in Phase 1 it's the time-boxed trial. Either way the license gates *continued* use (re-scoring, CI enforcement), never the first calibrated verdict. See §3.

## Register

The audience is high-intent, high-context, fluff-allergic. Keep the architecture of consumer onboarding (quiz, loader, reveal, commitment). Invert the tone: **credible instrument, not warm coach.** No emoji confetti, no "You've got this!", no tap-and-hold theater — *except* where it is a real mechanism (baseline = commitment is genuine, so it earns its screen).

---

## 1. Flow

Beats with a `*` loop or scale with the repo. The per-signal loop (beat 6) is where the "60 screens" honestly compresses — it is as long as the repo's top-pressure list warrants, and the user can exit to defaults at any point.

| # | Beat | Psych job | Pulsar verb | Writes | OpenTUI |
|---|------|-----------|-------------|--------|---------|
| 0 | Launch + detect | Built-for-you, before any question | `init` detection | — (sets gate state) | `ASCIIFontRenderable`, `box`, `text` |
| 1 | The honest frame | Orient; set register + doctrine | — | — | `MarkdownRenderable` |
| 2 | Deterministic seed | Micro-commitments (IKEA begins) | `persona apply` (seed) | `vector.json` draft | `select` |
| 3 | Consent to scan | Trust beat (skeptics) | — | — | `box`, confirm |
| 4 | The real loader | Genuine analysis as theater | `score` (running) | cache | `useTimeline`, `TextTableRenderable` |
| 5 | Founder + method | Social proof; honest doctrine | — | — | `MarkdownRenderable` |
| 6* | Per-signal calibration | The engine — co-authorship | `conventions/glossary extract`, `elicit` | `conventions.json`, `glossary.json`, `vector.json` | `CodeRenderable`, `LineNumberRenderable`, `select` |
| 6b* | Pack enablement | Kill false-positive classes | `init` pack toggle | `project-modules.json` | `select` |
| 7 | The reveal | Emotional peak (real before/after) | `score` (re-weight) | — | `ASCIIFontRenderable`, `DiffRenderable`, `TextTableRenderable` |
| 8 | Commitment | Never-worse, real mechanism | `baseline set` | `pulsar-baseline.json` | `box`, hold-to-confirm |
| 9 | Handoff | Show what they co-authored | — | (shows `.pulsar/`) | `TextTableRenderable` |
| 10 | The gate (private only) | Ask at peak value | license flow | license token | `box`, QR (`@opentui/qrcode`) |
| 11 | What's waiting | Seed the value ladder | — | — | `MarkdownRenderable` |

Public repos skip beat 10 entirely and land on *"Free forever for open source."*

---

## 2. Screen-by-screen

### Beat 0 — Launch + detect
- **Render:** `ASCIIFontRenderable` "PULSAR" (font `slick`), one-line promise beneath. Then a live-filling detection panel.
- **Copy:** `Reading your repo… TypeScript · Next.js · 1,240 files · 3 contributors · private`
- **Logic:** detect languages, frameworks, size, contributors, **and repo visibility** (git remote → public host vs private/none). Visibility sets the gate state for beat 10; nothing is gated yet.
- **Success metric:** reaches beat 1 (≈100%, but instrument it — a crash here is fatal).

### Beat 1 — The honest frame
- **Copy:**
  > Pulsar reads your repo and gives one verdict: a readiness band, and the single thing driving it.
  >
  > It has no ignore flag and no waiver file. Three honest moves exist — **calibrate** what's true here, **baseline** today's debt and never get worse, or **fix**. There is no fourth.
  >
  > Let's calibrate it to your repo. Takes a few minutes. You'll commit the result.
- **Interaction:** Continue.

### Beat 2 — Deterministic seed (no scan needed)
Four `select` screens, each a micro-commitment that seeds the vector so the *first* score is already less wrong:
1. **Repo shape:** app / library / infra / monorepo
2. **Maintainership:** solo / small team / large team → seeds `SHARED-02` bus-factor applicability (a single-author window declares itself unmeasurable rather than emitting a constant)
3. **AI-written-code defense:** "Tune Pulsar to be strict about generated-slop and unfinished-implementation signals?" → seeds the AI-slop-defense persona
4. **Primary language confirm** (pre-filled from detection)
- **Writes:** persona choice + seed factors into the in-memory vector draft (lands in `.pulsar/vector.json`).

### Beat 3 — Consent to scan
- **Copy:** `Pulsar reads only what git tracks. It runs locally. It writes nothing until you say so. Ready to read the repo?`
- **Interaction:** single confirm. This beat exists *only* to earn trust from a skeptical engineer before touching their code. Do not cut it.

### Beat 4 — The real loader
The scan (`pulsar score`) runs here. Do not idle.
- **Render:** live `TextTableRenderable` of signals computing, driven by `useTimeline`: `TS-LD-02 ✓ 340  ·  TS-AD-04 ⟳  ·  TS-SEC-03 …`. The genuine tick-by-tick *is* the entertainment and reinforces instrument-not-theater.
- While it runs, advance through beats 5 (founder/method). On big repos the scan covers the reading time for free.

### Beat 5 — Founder + methodology
- **Screen A — shared pain** (`MarkdownRenderable`):
  > I'm Guilherme. I've shipped dozens of projects and spent tens of billions of tokens on agentic engineering. However much context I gave the agents, the same thing kept happening: the codebase filled with issues that were never urgent enough to stop a release — and never went away. Compounding debt I'd burn my own hours hunting by hand.
- **Screen B — the handoff:**
  > Pulsar is the instrument I built to find that debt and point the agents straight at it. Here's yours.
- **Screen C — method (1 screen):** why the band can be trusted — authority bounds (a heuristic can never be the verdict alone), `not_applicable` over invented numbers, engine faults shape status not score. Sets up calibration honestly: *"When Pulsar is wrong here, you don't silence it — you tell it what's true, for the whole repo, in a file you commit."*

### Beat 6 — Per-signal calibration loop `*` (the engine)
Iterates over the **top-pressure signals only** (bounded ≈5–8, ordered by pressure), not all 59. Remaining signals use seeded defaults. The user can pick *"calibrate the rest with defaults"* to exit the loop early.

**Layout — split-screen.** A `<box flexDirection="row" gap={1}>` with two bordered children: **left** (`flexBasis ~42%`) is the explainer + question + options; **right** (`~58%`, code needs the width) is the live evidence from *their* repo.

```
┌ PULSAR ─────────────────────────────  calibrate · signal 3/7 ┐
│ ┌ TS-LD-02 · function size ─────┐ ┌ your repo · top flag 1/5 ┐│
│ │ 340 functions over the        │ │ routes/legal/privacy.tsx ││
│ │ 50-line budget.               │ │  41   PrivacyPolicy() {  ││
│ │ Big functions are where       │ │ ▸42   return (           ││
│ │ review attention goes to die. │ │       …1337 lines…       ││
│ │ What's true here?             │ │ ▸  } // ✗ over budget    ││
│ │ ▸ keep the 50-line budget     │ │ next  index.tsx     782  ││
│ │   /legal,generated → relax    │ │       prompt-input  581  ││
│ │   raise budget repo-wide      │ │       getSyntaxRules 502 ││
│ │   accept into baseline        │ │                          ││
│ └───────────────────────────────┘ └──────────────────────────┘│
│ ↑↓ move   ⏎ choose   → inspect   esc skip to defaults         │
└───────────────────────────────────────────────────────────────┘
```

For each signal:
- **Show the real evidence (right pane).** `CodeRenderable` renders the actual top-offending file, syntax-highlighted; `LineNumberRenderable` annotates the flagged lines with the diagnostic. They see *their* code, not a description. The pane cycles the top-N offenders (`1/5`) so they grasp scope.
- **One-line what it measures (left pane).**
- **The calibration question, phrased as truth-not-dismissal:**
  > 340 functions exceed the default size budget. Top offenders: two legal pages and a syntax-rule table (shown right).
  > What's true here?
  > → Big functions are debt — keep the default budget
  > → `/legal` and generated tables are expected — tag them `integration` (relaxed budget, repo-wide)
  > → Raise the budget to N for the whole repo
  > → Accept these into the baseline as known debt
- **The right pane is LIVE.** On answer, it redraws: the false-positive flags clear, the count animates (`340 → 12`), and the *genuine* debt stays lit. This is "calibration is sharpening, not suppression" shown, not claimed — false positives evaporate while real hotspots refuse to budge. Cheap because it re-filters already-computed evidence (see §6), never a re-scan.
- **Evidence pane adapts to signal type.** File-local signals → `CodeRenderable`. Repo-level signals (bus-factor, churn, dependency-health, PR-size) have no single line → `TextTableRenderable` / distribution / dependency summary. Same frame, different right-hand instrument; never force code into a pane whose evidence is a distribution.
- **Focus:** left `SelectRenderable` is interactive; right pane is ambient display. `→` optionally focuses the right pane to scroll the full offender list; `esc` skips the rest of the loop to seeded defaults.
- **Writes:** the chosen move into `conventions.json` (path tags, budgets), `glossary.json` (domain terms, via `glossary extract` confirmation), or a `vector.json` factor. Never an ignore.

Interleave **beat 6b — pack enablement** when a framework is detected:
> Detected Next.js. Enable the Next.js calibration pack so route handlers and server actions aren't misread as unsafe boundaries? `[Enable ✓]`
Writes `.pulsar/project-modules.json`. This single toggle kills the #1 false-positive class from the OpenCode assessment (`APIEvent`/framework boundary misreads).

### Beat 7 — The reveal
- **Logic:** re-score with the calibrated vector. Cheap — re-weights cached signal evidence and reprocesses through enabled modules; not a full re-scan.
- **Render:** `ASCIIFontRenderable` band in color (GREEN/YELLOW/RED). The before/after delta is the value proof:
  > Uncalibrated: **RED · 0.00**
  > Calibrated to what you told us: **YELLOW · 0.58**
  > Driver: review-pain hotspots — `provider.ts` (churn 20 × complexity 142)
- Top pressures as `TextTableRenderable`. `DiffRenderable` can dramatize the score movement.
- **Success metric:** the delta is non-trivial. If calibration doesn't move the band, the loop isn't earning its screens — instrument this.

### Beat 8 — Commitment (baseline + ratchet)
- **Copy:** `Accept today's debt as the floor. From here, CI fails only on new violations — never inherited ones. Lock it in?`
- **Interaction:** hold-to-confirm (the one place consumer theater is legitimate — it's a real commitment to a real mechanism). Fires `pulsar baseline set` → `pulsar-baseline.json`.

### Beat 9 — Handoff
- **Render:** `TextTableRenderable` of the populated `.pulsar/` tree they co-authored — `vector.json`, `conventions.json`, `glossary.json`, `project-modules.json`, `pulsar-baseline.json`.
- **Copy:** `This is yours. Repo-owned, diffable, attributable. Commit it.`

### Beat 10 — The gate (phase-driven; see §3)
Content is server-driven config and swaps per monetization phase — the rest of the flow never changes.
- **Beta (now):** no gate. *"You're in the Pulsar beta — free on every repo."* Capture feedback + a testimonial ask + community invite. The onboarding farms the social proof Phase 1 needs.
- **Phase 1 — public repo:** skipped → *"Free forever for open source"* + `--agent-view`.
- **Phase 1 — private repo:**
  > Pulsar is free for open source. This repo is private.
  > Ongoing use needs a license — this `pulsar init` and the verdict above were free.
  > `[Start trial →]`  `[Paste license key]`  `[Get a license ↗]`
  > Checkout bounces to browser; `@opentui/qrcode` renders the URL as a scannable QR for the device-auth path. Paste-key returns to the terminal.
- **Phase 2:** per-seat / per-CI-run / hosted-cloud enterprise routing.

### Beat 11 — What's waiting (value ladder, not a carousel)
One screen seeding depth, each a one-liner + doc link: `bisect` (find the commit that regressed a signal), `backpressure` (watch the trend), `persona` (swap calibration profiles), `--agent-view` (your agents consume the regressions directly). Then exit to a populated, committed repo.

---

## 3. Monetization — phased rollout

The wedge is repo *visibility*, not feature tier, and it arrives in three phases. The flow (§1) is identical across phases; only **beat 10** changes, and because the flow is server-driven config (§6), each phase transition is a config swap, not a rebuild.

- **Phase 0 — Beta (now): no license gate.** Runs free for *any* repo, public or private. Goal: happy users, ironed-out bugs, surfaced methodology problems, and **testimonials** for the site. Beat 10 becomes feedback + testimonial capture + community invite — the onboarding itself farms the social proof Phase 1 depends on.
- **Phase 1 — Private license (post-beta, once testimonials + hardening land).** Public/OSS → free forever, full power. Private (even a repo you are only testing) → paid. A time-boxed license trial includes a full `pulsar init` + calibrated reveal so the value lands before the ask; the license then gates ongoing `score`/`--ci` use on private repos.
- **Phase 2 — Enterprise (post-traction).** Per-seat / per-CI-run / hosted cloud, org governance. The "legitimate startup" tier; layers on top of Phase 1, does not replace it.

**Detection, fail-honest (Phase 1+):** public host remote → free; private/no remote → treat as private. Handle edges: local-only repo mid-evaluation (generous grace before first push), airgapped/enterprise, public mirror of private work. Never wall a solo dev mid-`init`.

**License-check vs local-first ethos:** offline-validatable keys + generous grace, **no server round-trip per scan**. Pulsar's brand is local + deterministic; DRM paranoia must not tax real customers. Anyone pirating a code-*quality* tool isn't the buyer.

**Lapse behavior:** degrade to read-only band (no new baseline, no CI gate) rather than hard-refuse — keep the instrument honest even when unpaid.

---

## 4. Retention (dev-tool translation)

There are no push notifications; the equivalents are mechanical.
- **The habit = the CI ratchet.** Every PR gets the band + the diff gate (`score --ci --diff main..WORKTREE --changed-only`). New violations fail; inherited ones never do.
- **The streak = green-and-holding.** `backpressure --trend` is the retention surface — the slope over time, the "never quietly get worse" promise made visible.
- **Re-engagement = re-`init` on change.** New framework detected, or drift in detection → prompt a re-calibration of the affected signals.
- **Agent loop = `--agent-view`.** The agents writing the code consume regressions directly; Pulsar lives in the loop that created the need for it.

## 5. Measurement

Instrument from day one, pre-users.
- **Per-beat transition + drop-off.** The beat before the biggest drop needs a copy/format change or a trust beat.
- **Calibration-loop completion rate** and **early-exit-to-defaults rate.**
- **Reveal delta magnitude** (does calibration move the band? if not, the loop isn't earning its place).
- **Pack-enable rate**, **baseline-set rate** (commitment conversion), **license-trial-start (Day 0)**, **trial→paid**.
- **First experiments (priority order):** (1) full per-signal loop vs a 3-question quick path; (2) reveal framing — before/after delta vs absolute band; (3) founder-story placement; (4) trial length.

## 6. Technical recommendations

- **Authoring layer:** `@opentui/react` (React 19 reconciler) for ergonomics; `@opentui/core` for the rich renderables (`CodeRenderable`, `DiffRenderable`, `ASCIIFontRenderable`, `MarkdownRenderable`, `TextTableRenderable`, `useTimeline`). Bun + TS, drops into the Effect monorepo cleanly; native binaries ship prebuilt (Zig compiler only needed to rebuild core).
- **State:** React `useState` for flow/step state; **Effect for the verb-firing logic** (score, extract, baseline) to match the monorepo and keep the orchestration typed and cancellable.
- **App shell:** one persistent root `<box flexDirection="column">` = header (wordmark + progress) / body (swaps per beat) / footer (keybindings). Yoga flexbox throughout; no absolute coords, let it reflow on resize. The body is the only thing that changes between beats.
- **Focus model:** `useFocus`/`useKeyboard`; single interactive control per beat by default. In the split-screen the left `Select` holds focus and the right pane is ambient display, with `→` to optionally focus/scroll the evidence and `esc` to skip the loop to defaults.
- **The bet that makes "live" cheap:** the split-screen right-pane reaction and the beat-7 reveal are both **re-filtering / re-weighting already-computed evidence, never a re-scan.** Beat 4 computes each signal's findings once into a cached evidence set; a calibration answer mutates an in-memory vector draft and the affected signal's surviving findings are re-derived from cache. Keep that caching boundary clean and the magic is effectively free.
- **Hold-to-confirm (beat 8):** no built-in; compose `useKeyboard` keydown/keyup (`release` option) with a `useTimeline`-driven width fill on a box (~800ms). Genuine commitment friction.

## 7. Implementation status (2026-06-17)

Shipped as the command **`pulsar onboard`** (built with OpenTUI, `~/Playground/opentui` → `@opentui/react`). TUI by default; `--json` / `--agent` / non-TTY → headless agent path.

- **`packages/onboard`** (`@skastr0/pulsar-onboard`) — the TUI: `app.tsx` (all beats incl. the live split-screen calibrate), `catalog.ts` (+ generated `catalog.generated.json`, all **74 signals**), `calibration.ts` (live re-filter + approximate re-score), `demo.ts` (assessment-grounded demo dataset), `mount.tsx`, `headless.ts`.
- **`packages/cli/src/onboard.ts`** — TTY gate, real `observeWorktree` → `ScanResult` adapter (demo fallback), non-destructive `.pulsar/` writer (→ `onboard-preview/` if already calibrated). Lazy-imported via a variable specifier so it never enters cli's `tsc -b` or compiled binary.
- **Dev build:** `pulsar-dev` source shim in `~/.local/bin` (runs from source via Bun; never touches the npm `pulsar`).
- **Catalog generation:** a Workflow (sonnet draft → haiku deterministic verify → opus review) drafted a grounded calibration entry per signal — explanation, "what's true here" question, real calibration target (`signal_overrides[id].config.<key>`, conventions, project-module, baseline), and evidence type. Zero suppression-word violations across all 74 × options.
- **Visualize:** `bun packages/onboard/src/dev.tsx` (curated demo) or `pulsar onboard` on a repo.
- **Deferred:** wiring onboard into the compiled production binary; confirming builtin project-module ids; real engine re-weight on calibration (currently approximated for the reveal).
- **`pulsar init` is an orchestrator, not a reimplementation.** It calls the existing verbs (`persona apply`, `score`, `conventions/glossary extract`, `elicit`, `baseline set`). The per-signal loop already has a backend in `elicit quiz` — dramatize it, don't rebuild it.
- **Server-driven flow config.** Beat order, copy, and which signals get elicited live in a JSON config the CLI reads — not hardcoded. Iterate the funnel and the copy without a CLI release, and A/B the flow.
- **Live scan:** drive the beat-4 signal feed off the real scoring pipeline's progress events via `useTimeline`; the progress must be genuine, never a fake spinner.
