#!/usr/bin/env bun
/** End-to-end development fixtures, not held-out accuracy evidence.
 * The real signal engine discovers source; no fixture labels enter a Jev request.
 */
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Effect } from "effect"
import repoPolicy from "../.pulsar/modules/semantic-policy.ts"
import { runCliEffect } from "../packages/cli/src/cli-effect-runtime.ts"
import { executeSemanticPlan, prepareSemanticPlan } from "./jev-poc.ts"
import { replay } from "./jev-poc/pipeline.ts"
import { sha256 } from "./jev-spike/model.ts"
import { jevLayer } from "./jev-spike/transport.ts"

const sourceRoot = resolve(import.meta.dir, "..")
const account = `export interface Account { verified: boolean; suspended: boolean; balance: number; limit: number }
export function maySpend(account: Account, amount: number): boolean {
  if (!account.verified || account.suspended) return false
  if (amount <= 0 || amount > account.limit) return false
  return account.balance >= amount
}
`
const delegated = `import { maySpend, type Account } from './account.js'
export const preview = (account: Account, amount: number) => maySpend(account, amount)
export const submit = (account: Account, amount: number) => maySpend(account, amount)
`
const copied = `import { type Account } from './account.js'
export function preview(account: Account, amount: number): boolean {
  if (!account.verified || account.suspended) return false
  if (amount <= 0 || amount > account.limit) return false
  return account.balance >= amount
}
export function submit(account: Account, amount: number): boolean {
  if (!account.verified || account.suspended) return false
  if (amount <= 0 || amount > account.limit) return false
  return account.balance >= amount
}
`
const independent = `const supportedLocales = new Set(['en', 'fr', 'ja'])
const supportedMediaTypes = new Set(['image/png', 'image/jpeg', 'text/plain'])
export function acceptsLocale(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return supportedLocales.has(normalized)
}
export function acceptsMediaType(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return supportedMediaTypes.has(normalized)
}
`

async function main() {
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY required")
  // The production parser deliberately excludes hidden tool-state ancestors such as .pulsar.
  const output = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "pulsar-semantic-smoke-")))
  mkdirSync(output, { recursive: true })
  const rows = []
  for (const variant of ["delegated", "copied", "independent", "repaired"] as const) {
    const root = join(output, variant)
    mkdirSync(root, { recursive: false })
    mkdirSync(join(root, "src"))
    mkdirSync(join(root, ".pulsar/modules"), { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "spending-library", version: "1.0.0", type: "module", dependencies: { typescript: "7.0.2" } }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true }, include: ["src/**/*.ts"] }))
    writeFileSync(join(root, ".gitignore"), "node_modules/\n.pulsar/*\n!.pulsar/modules/\n")
    symlinkSync(join(sourceRoot, "node_modules"), join(root, "node_modules"), "dir")
    const policy = { ...repoPolicy, id: "semantic-smoke-single-owner-v1", include: ["src/**/*.ts"], exclude: [], rules: [repoPolicy.rules[0]], budgets: { maxCandidates: 40, maxCalls: 40, maxSnippetLines: 160, maxContextBytes: 24000 } }
    writeFileSync(join(root, ".pulsar/modules/semantic-policy.ts"), `export default ${JSON.stringify(policy)} as const\n`)
    writeFileSync(join(root, "src/account.ts"), account)
    writeFileSync(join(root, "src/operations.ts"), variant === "copied" ? copied : delegated)
    writeFileSync(join(root, "src/formats.ts"), variant === "independent" ? independent : "export {}\n")
    for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Semantic POC", "-c", "user.email=poc@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Development fixture"]]) {
      const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" })
      if (result.exitCode !== 0) throw new Error("Failed to initialize disposable Git fixture")
    }
    const compiled = Bun.spawnSync([process.execPath, join(sourceRoot, "node_modules/typescript/bin/tsc"), "--project", join(root, "tsconfig.json")], { cwd: root, stdout: "pipe", stderr: "pipe" })
    if (compiled.exitCode !== 0) throw new Error(`Fixture does not compile: ${compiled.stdout.toString()}`)
    const { plan } = await runCliEffect(prepareSemanticPlan(root, true, "jev-latest"))
    if ((plan.discovery.coverage.baseline.complexityFunctionsAvailable ?? 0) < 3) throw new Error("Smoke fixture was not analyzed; refusing a vacuous pass")
    const receipts = join(root, ".pulsar/run")
    mkdirSync(receipts)
    writeFileSync(join(receipts, "plan.json"), JSON.stringify(plan, null, 2) + "\n")
    const run = await runCliEffect(executeSemanticPlan(plan, receipts).pipe(Effect.provide(jevLayer(process.env.TYPESAFE_API_KEY))))
    replay(run)
    const runPath = join(receipts, "run.json")
    rows.push({ variant, runPath, runHash: sha256(readFileSync(runPath, "utf8")), policyFingerprint: plan.policyFingerprint, coverage: plan.discovery.coverage, summary: run.summary })
    console.error(`${variant}: semantic ${JSON.stringify(run.summary.semantic)}, ${run.summary.calls} calls`)
  }
  const file = join(output, "results.json")
  writeFileSync(file, JSON.stringify({ scope: "development smoke, not held-out", rows }, null, 2) + "\n")
  console.log(JSON.stringify({ file, rows: rows.map(({ variant, summary, runHash }) => ({ variant, semantic: summary.semantic, health: summary.health, calls: summary.calls, runHash })) }, null, 2))
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : "Smoke failed"); process.exitCode = 1 })
