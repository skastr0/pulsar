// Onboarding calibration catalog. Prefers the workflow-generated catalog
// (catalog.generated.json, all ~71 signals) when present; otherwise falls back
// to this hand-authored seed covering the demo's top-pressure signals.
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CatalogEntry } from "./types.js"
import { normalizeSignalId } from "./util.js"

export const SEED_CATALOG: ReadonlyArray<CatalogEntry> = [
  {
    id: "TS-AD-04",
    title: "Boundary parser coverage",
    pack: "ts",
    category: "architectural-drift",
    measures:
      "Checks that data crossing a trust boundary — request bodies, external input — is parsed or validated before use, rather than cast.",
    whyItMatters: "An unparsed boundary is where malformed or hostile input silently enters the system.",
    evidence: "file-local",
    evidenceHint: "Handlers where a request body is used without a parse call on the parameter.",
    question: "What's true here?",
    options: [
      {
        label: "These are real unvalidated boundaries",
        summary: "Keep the default — every flagged handler is genuine debt to fix.",
        calibrationKind: "keep-default",
        calibrationTarget: "signal_overrides.TS-AD-04",
        framing: "keep",
      },
      {
        label: "Framework routes validate via helpers",
        summary:
          "Enable the Next.js calibration pack so route handlers and their helper-based validation are recognized repo-wide.",
        calibrationKind: "project-module",
        calibrationTarget: "@skastr0/pulsar-project-module-nextjs",
        framing: "sharpen",
      },
      {
        label: "Accept current findings as the floor",
        summary: "Record today's unparsed boundaries as known debt; CI then blocks only new ones.",
        calibrationKind: "baseline-accept",
        calibrationTarget: "pulsar-baseline.json",
        framing: "accept",
      },
    ],
    defaultOptionIndex: 0,
    packGate: "nextjs",
    demoFilter: { dropFilesMatching: ["app/api/honeycomb", "app/api/auth"] },
  },
  {
    id: "TS-CC-01",
    title: "Async failure control",
    pack: "ts",
    category: "concurrency-safety",
    measures: "Flags async work whose failure path is unhandled — floating promises, fire-and-forget calls, empty catches.",
    whyItMatters: "An unhandled async failure is a bug that only shows up in production, under load.",
    evidence: "file-local",
    evidenceHint: "Detached promises and swallowed errors.",
    question: "What's true here?",
    options: [
      {
        label: "Each is a genuine unhandled failure",
        summary: "Keep the default — these floating promises and empty catches are real risks.",
        calibrationKind: "keep-default",
        calibrationTarget: "signal_overrides.TS-CC-01",
        framing: "keep",
      },
      {
        label: "Lazy-dialog imports are intentional UI transitions",
        summary:
          "Enable the framework module so `void import().then()` inside event handlers reads as a deliberate detached UI load.",
        calibrationKind: "project-module",
        calibrationTarget: "@skastr0/pulsar-project-module-nextjs",
        framing: "sharpen",
      },
      {
        label: "Accept current findings as the floor",
        summary: "Record today's async findings as known debt; CI blocks only new ones.",
        calibrationKind: "baseline-accept",
        calibrationTarget: "pulsar-baseline.json",
        framing: "accept",
      },
    ],
    defaultOptionIndex: 0,
    demoFilter: { dropFilesMatching: ["components/", "dialog"] },
  },
  {
    id: "TS-LD-02",
    title: "Function size distribution",
    pack: "ts",
    category: "legibility-decay",
    measures: "Tracks functions whose length exceeds the size budget for the repo.",
    whyItMatters: "Oversized functions are where review attention goes to die.",
    evidence: "file-local",
    evidenceHint: "The longest functions, by line count.",
    question: "What's true here?",
    options: [
      {
        label: "Big functions are debt — keep the budget",
        summary: "Keep the default 50-line budget across the repo.",
        calibrationKind: "keep-default",
        calibrationTarget: "signal_overrides.TS-LD-02.config.maxLines",
        framing: "keep",
      },
      {
        label: "/legal and generated tables are expected",
        summary:
          "Tag generated and legal-content paths as integration in conventions, so they carry a relaxed budget repo-wide.",
        calibrationKind: "conventions",
        calibrationTarget: "conventions.boundaries (integration tag)",
        framing: "sharpen",
      },
      {
        label: "Raise the budget repo-wide",
        summary: "Set a higher maxLines for the whole repo if 50 is simply wrong for this codebase.",
        calibrationKind: "vector-config",
        calibrationTarget: "signal_overrides.TS-LD-02.config.maxLines",
        framing: "sharpen",
      },
      {
        label: "Accept current findings as the floor",
        summary: "Record today's oversized functions as known debt; CI blocks only new ones.",
        calibrationKind: "baseline-accept",
        calibrationTarget: "pulsar-baseline.json",
        framing: "accept",
      },
    ],
    defaultOptionIndex: 0,
    demoFilter: { dropFilesMatching: ["legal", "theme/"] },
  },
  {
    id: "TS-RP-01",
    title: "Hotspots",
    pack: "ts",
    category: "review-pain",
    measures: "Composite of code churn and complexity — the files that change often and are hard to read.",
    whyItMatters: "Hotspots are where bugs and review fatigue concentrate; they earn the most attention.",
    evidence: "mixed",
    evidenceHint: "Top files by churn × complexity.",
    question: "What's true here?",
    options: [
      {
        label: "These are real hotspots — keep them visible",
        summary: "Keep the default. The provider and session files genuinely deserve review attention.",
        calibrationKind: "keep-default",
        calibrationTarget: "signal_overrides.TS-RP-01",
        framing: "keep",
      },
      {
        label: "Accept today's hotspots as the floor",
        summary: "Record the current hotspots as known; CI surfaces new ones as they emerge.",
        calibrationKind: "baseline-accept",
        calibrationTarget: "pulsar-baseline.json",
        framing: "accept",
      },
    ],
    defaultOptionIndex: 0,
  },
  {
    id: "TS-SL-02",
    title: "Inconsistent clones",
    pack: "ts",
    category: "generated-slop",
    measures: "Detects near-duplicate code that has drifted apart — the same thing implemented two slightly different ways.",
    whyItMatters: "Divergent clones are where a fix lands in one copy and not the other.",
    evidence: "file-local",
    evidenceHint: "Clone pairs that have diverged.",
    question: "What's true here?",
    options: [
      {
        label: "Real divergent duplication — keep flagging",
        summary: "Keep the default; these clones should be reconciled.",
        calibrationKind: "keep-default",
        calibrationTarget: "signal_overrides.TS-SL-02",
        framing: "keep",
      },
      {
        label: "This is a tracked v1→v2 migration",
        summary: "Record the migration clones as known debt with the migration as their reason; CI watches for new clones.",
        calibrationKind: "baseline-accept",
        calibrationTarget: "pulsar-baseline.json",
        framing: "accept",
      },
    ],
    defaultOptionIndex: 0,
    demoFilter: { dropFilesMatching: ["settings-v2", "v2"] },
  },
  {
    id: "TS-SEC-03",
    title: "Secret material",
    pack: "ts",
    category: "security-risk",
    measures: "Looks for secrets committed to source — keys, tokens, credentials in string literals.",
    whyItMatters: "A committed secret is a breach waiting for someone to read the repo.",
    evidence: "file-local",
    evidenceHint: "String literals and declarations that look like secrets.",
    question: "What's true here?",
    options: [
      {
        label: "Treat every match as a real secret",
        summary: "Keep the default — anything resembling a secret stays flagged.",
        calibrationKind: "keep-default",
        calibrationTarget: "signal_overrides.TS-SEC-03",
        framing: "keep",
      },
      {
        label: "Infra secret-handles are declarations, not secrets",
        summary:
          "Teach Pulsar (via the framework module) that SST/Pulumi resource constructors are infra handles, not committed secret values.",
        calibrationKind: "project-module",
        calibrationTarget: "@skastr0/pulsar-project-module-nextjs",
        framing: "sharpen",
      },
    ],
    defaultOptionIndex: 0,
    demoFilter: { dropFilesMatching: ["infra/", "secret.ts"] },
  },
]

export const loadCatalog = (): ReadonlyArray<CatalogEntry> => {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const generated = join(here, "catalog.generated.json")
    if (existsSync(generated)) {
      const parsed = JSON.parse(readFileSync(generated, "utf8")) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as ReadonlyArray<CatalogEntry>
      }
    }
  } catch {
    // fall through to seed
  }
  return SEED_CATALOG
}

export const catalogById = (catalog: ReadonlyArray<CatalogEntry>): Map<string, CatalogEntry> => {
  const map = new Map<string, CatalogEntry>()
  for (const entry of catalog) map.set(normalizeSignalId(entry.id), entry)
  return map
}
