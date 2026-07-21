// Realistic demo scan, grounded in docs/explorations/opencode-pulsar-assessment.md.
// Used for standalone TUI dev runs and as a safe fallback when the live scan
// cannot be wired. The CLI replaces `scan` with the real observeWorktree adapter.
import { SEED_CATALOG } from "./catalog.js"
import type { CatalogEntry, DetectedPack, RepoDetection, ScanResult } from "./types.js"

export const demoDetection: RepoDetection = {
  languages: ["TypeScript"],
  frameworks: ["Next.js", "Effect"],
  fileCount: 1240,
  contributors: 7,
  visibility: "private",
  repoPath: ".",
}

export const demoPacks: ReadonlyArray<DetectedPack> = [
  { id: "nextjs", label: "Next.js calibration pack", reason: "next dependency + app/ route handlers" },
  { id: "effect", label: "Effect calibration pack", reason: "effect imported across 240 files" },
]

export const demoScan = async (): Promise<ScanResult> => ({
  band: "red",
  score: 0.0,
  driver: "TS-AD-04 · boundary parser coverage",
  evidenceMean: 0.44,
  topPressures: [
    { id: "TS-AD-04", score: 0.0, category: "architectural-drift" },
    { id: "TS-CC-01", score: 0.02, category: "concurrency-safety" },
    { id: "TS-LD-02", score: 0.04, category: "legibility-decay" },
    { id: "TS-RP-01", score: 0.27, category: "review-pain" },
    { id: "TS-SL-02", score: 0.44, category: "generated-slop" },
    { id: "TS-SEC-03", score: 0.6, category: "security-risk" },
  ],
  signals: [
    {
      id: "TS-AD-04",
      title: "Boundary parser coverage",
      category: "architectural-drift",
      score: 0.0,
      findingCount: 38,
      findings: [
        {
          file: "app/api/enterprise/route.ts",
          line: 61,
          detail: "request body cast `as EnterpriseFormData`, never parsed",
          snippet: [
            "export async function POST(req: Request) {",
            "  const body = (await req.json()) as EnterpriseFormData",
            "  await createEnterprise(body)",
            "}",
          ],
          flagLine: 1,
        },
        {
          file: "app/api/honeycomb/webhook/route.ts",
          line: 77,
          detail: "body IS parsed — parser called on an alias, not the param",
          snippet: [
            "export async function POST(req: Request) {",
            "  const body = await req.json()",
            "  const parsed = webhookSchema.safeParse(body)",
            "}",
          ],
          flagLine: 2,
        },
        { file: "app/api/auth/[...callback]/route.ts", line: 12, detail: "cookie read via helper; validation not seen inline" },
      ],
    },
    {
      id: "TS-CC-01",
      title: "Async failure control",
      category: "concurrency-safety",
      score: 0.02,
      findingCount: 14,
      findings: [
        {
          file: "components/dialog-connect-provider.tsx",
          line: 27,
          detail: "void import().then() — flagged as fire-and-forget",
          snippet: [
            "const open = () => {",
            "  void import('./dialog-select-provider').then((x) => {",
            "    dialog.show(() => <x.DialogSelectProvider />)",
            "  })",
            "}",
          ],
          flagLine: 1,
        },
        { file: "lib/github/index.ts", line: 284, detail: "empty catch block swallows error" },
      ],
    },
    {
      id: "TS-LD-02",
      title: "Function size distribution",
      category: "legibility-decay",
      score: 0.04,
      findingCount: 340,
      findings: [
        {
          file: "app/legal/privacy-policy/page.tsx",
          line: 41,
          detail: "PrivacyPolicy — 1337 lines",
          snippet: [
            "export function PrivacyPolicy() {",
            "  return (",
            "    <article>",
            "      … 1337 lines …",
            "  )",
            "}",
          ],
          flagLine: 0,
        },
        { file: "app/page.tsx", line: 1, detail: "Home — 782 lines" },
        { file: "components/prompt-input.tsx", line: 1, detail: "PromptInput — 581 lines" },
        { file: "lib/theme/index.ts", line: 1, detail: "getSyntaxRules — 502 lines (generated table)" },
        { file: "app/legal/terms/page.tsx", line: 1, detail: "TermsOfService — 456 lines" },
      ],
    },
    {
      id: "TS-RP-01",
      title: "Hotspots",
      category: "review-pain",
      score: 0.27,
      findingCount: 5,
      findings: [
        { file: "lib/provider/provider.ts", detail: "churn 20 × complexity 142" },
        { file: "lib/provider/transform.ts", detail: "churn 20 × complexity 67" },
        { file: "lib/session/prompt.ts", detail: "churn 19 × complexity 36" },
        { file: "lib/session/processor.ts", detail: "churn 12 × complexity 76" },
        { file: "lib/session/compaction.ts", detail: "churn 10 × complexity 38" },
      ],
    },
    {
      id: "TS-SL-02",
      title: "Inconsistent clones",
      category: "generated-slop",
      score: 0.44,
      findingCount: 9,
      findings: [
        {
          file: "components/settings-general.tsx",
          line: 1,
          detail: "diverges from settings-v2/general.tsx (migration in progress)",
          snippet: [
            "// settings-general.tsx (v1)",
            "export function SettingsGeneral() { … }",
            "// components/settings-v2/general.tsx (v2)",
            "export function GeneralSettings() { … }",
          ],
          flagLine: 0,
        },
      ],
    },
    {
      id: "TS-SL-04-unfinished-implementations",
      title: "Unfinished implementations",
      category: "generated-slop",
      score: 0.72,
      findingCount: 1,
      findings: [
        {
          file: "src/adapter.ts",
          line: 42,
          detail: "function body throws a not-implemented placeholder",
        },
      ],
    },
    {
      id: "TS-SEC-03",
      title: "Secret material",
      category: "security-risk",
      score: 0.6,
      findingCount: 4,
      findings: [
        {
          file: "infra/secret.ts",
          line: 8,
          detail: "string literal `R2SecretKey` flagged as committed secret",
          snippet: [
            "export const R2SecretKey = new sst.Secret('R2SecretKey')",
            "export const dbPassword = new random.RandomPassword('db')",
          ],
          flagLine: 0,
        },
      ],
    },
    {
      id: "TS-RP-02",
      title: "PR size",
      category: "review-pain",
      score: 0.71,
      findingCount: 2,
      findings: [{ file: "(recent PRs)", detail: "median changed LOC above budget" }],
    },
    {
      id: "TS-DE-04",
      title: "Package dependency health",
      category: "dependency-entropy",
      score: 0.93,
      findingCount: 3,
      findings: [
        { file: "packages/enterprise/package.json", detail: "missing dependency @opencode-ai/sdk" },
        { file: "infra/api.ts", detail: "production code imports devDependency `sst`" },
      ],
    },
    {
      id: "SHARED-02-bus-factor",
      title: "Bus factor",
      category: "maintainability",
      score: 1.0,
      findingCount: 0,
      findings: [],
    },
  ],
})

// Graft the seed's curated demo re-filter hints onto the (full, generated)
// catalog by signal id, so the demo's split-screen shows real false positives
// clearing while genuine debt stays lit. No-op for signals without a seed hint.
export const withDemoFilters = (catalog: ReadonlyArray<CatalogEntry>): ReadonlyArray<CatalogEntry> =>
  catalog.map((entry) => {
    const seed = SEED_CATALOG.find((s) => s.id === entry.id)
    return seed?.demoFilter ? { ...entry, demoFilter: seed.demoFilter } : entry
  })
