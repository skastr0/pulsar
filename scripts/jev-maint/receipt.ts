#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  applyPatch,
  baseFiles,
  ENFORCEMENT,
  OBSERVER,
  OBSERVER_CACHE,
  PATCHES,
  RUNNER,
  type PatchId,
} from "./patches.ts"
import { canonical, sha256 } from "../jev-spike/model.ts"
import { replay } from "../jev-maint.ts"

/**
 * Assembles a secret-free receipt archive for the maintenance-utility
 * experiment: the prepared plans, the raw run ledgers including per-request
 * intents, the independently verified patch matrix, one diff per candidate
 * patch, a corrected replay with the untouched answer objects, and a
 * hash/latency summary. Nothing here contains an authorization header; the
 * transport records only status, body, request id, and elapsed time.
 *
 * The archive is versioned and the builder never overwrites an earlier
 * version, so a corrected archive can be produced without disturbing the
 * original.
 */

const ROOT = resolve(import.meta.dir, "../..")
const RESEARCH = resolve(ROOT, ".pulsar/jev-research/maint-utility")
const version = process.argv[2] ?? "v1"
const STAGE = resolve(RESEARCH, `receipt-${version}`)
const ARCHIVE = resolve(RESEARCH, `maint-utility-receipts-${version}.tar.gz`)

/** Ledger files copied into the archive for one run directory. */
export const LEDGER_FILES = ["manifest.json", "run.json", "summary.json"] as const
export function ledgerEntries(names: ReadonlyArray<string>): ReadonlyArray<string> {
  return names
    .filter((name) => LEDGER_FILES.includes(name as (typeof LEDGER_FILES)[number]) || /\.(intent|receipt)\.json$/.test(name))
    .sort()
}

const sha256File = (path: string): string => sha256(readFileSync(path, "utf8"))

/** Re-derive the summary from recorded run bytes with the current decoder. */
const replayRun = (runPath: string) => {
  const bytes = readFileSync(runPath, "utf8")
  return replay(bytes, sha256(bytes))
}

const canonicalReplay = (runPath: string): string => canonical(JSON.stringify(replayRun(runPath)))

const percentile = (values: ReadonlyArray<number>, fraction: number): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1)
  return sorted[index] ?? 0
}

const runReceipt = (dir: string) => {
  const runPath = join(dir, "run.json")
  const run = JSON.parse(readFileSync(runPath, "utf8")) as {
    planHash: string
    records: ReadonlyArray<{ id: string; status: string; receipt: { status: number; requestId: string | null; elapsedMs: number } | null }>
  }
  const latencies = run.records
    .map((record) => record.receipt?.elapsedMs)
    .filter((value): value is number => typeof value === "number")
  return {
    runSha256: sha256File(runPath),
    planHash: run.planHash,
    requests: run.records.length,
    http200: run.records.filter((record) => record.receipt?.status === 200).length,
    transportErrors: run.records.filter((record) => record.status === "transport_error").length,
    requestIds: run.records.map((record) => record.receipt?.requestId ?? null),
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: Math.max(0, ...latencies),
      count: latencies.length,
    },
  }
}

const writeDiff = (path: string, variant: "a" | "b", patchId: PatchId): void => {
  const base = baseFiles(ROOT, variant)
  const patched = applyPatch(ROOT, variant, patchId)
  const pieces: Array<string> = []
  for (const file of Object.keys(patched).sort()) {
    if (patched[file] === base[file]) continue
    const before = join(STAGE, "tmp", `${variant}-${patchId}-before-${file.replaceAll("/", "_")}`)
    const after = join(STAGE, "tmp", `${variant}-${patchId}-after-${file.replaceAll("/", "_")}`)
    mkdirSync(dirname(before), { recursive: true })
    writeFileSync(before, base[file]!)
    writeFileSync(after, patched[file]!)
    const result = Bun.spawnSync({
      cmd: ["git", "diff", "--no-index", "--unified=3", "--no-color", "--", before, after],
      stdout: "pipe",
      stderr: "pipe",
    })
    pieces.push(result.stdout.toString().replaceAll(before, `a/${file}`).replaceAll(after, `b/${file}`))
  }
  writeFileSync(path, pieces.join("\n"), { flag: "wx" })
}

function main(): void {
  if (existsSync(STAGE) || existsSync(ARCHIVE)) {
    throw new Error("Receipt version already exists; choose a new version")
  }
  mkdirSync(join(STAGE, "patches"), { recursive: true })

  for (const name of ["dev-plan.json", "eval-plan.json", "patch-matrix.json"]) {
    copyFileSync(join(RESEARCH, name), join(STAGE, name))
  }
  for (const name of ["dev-run", "eval-run"]) {
    mkdirSync(join(STAGE, name), { recursive: true })
    const ledger = join(RESEARCH, name)
    const entries = ledgerEntries([...new Bun.Glob("*.json").scanSync({ cwd: ledger })])
    for (const entry of entries) {
      copyFileSync(join(ledger, entry), join(STAGE, name, entry))
    }
  }

  for (const variant of ["a", "b"] as const) {
    for (const patch of PATCHES) {
      writeDiff(join(STAGE, "patches", `${variant}-${patch.id}.diff`), variant, patch.id)
    }
  }

  const matrix = JSON.parse(readFileSync(join(RESEARCH, "patch-matrix.json"), "utf8")) as {
    outcomes: ReadonlyArray<{
      patch: string
      variant: string
      compiles: boolean
      requirementSatisfied: boolean
      obligationsViolated: ReadonlyArray<string>
      declaredEditedOwners: ReadonlyArray<string>
    }>
  }

  const receipts = {
    schema: "pulsar.jev_maint_receipt.v2",
    version,
    repositorySha: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT }).stdout.toString().trim(),
    producedAt: new Date().toISOString(),
    secretHandling:
      "The transport records status, response body, x-typesafe-request-id, and elapsed time only. No authorization header is read, logged, or archived.",
    model: "jev-latest (all responses identified jev-1.13.0)",
    correctionNote:
      version === "v1"
        ? undefined
        : "v2 preserves the v1 plans, expected labels, run ledgers and patch matrix unchanged. It adds the per-request intent files that v1 omitted, a corrected replay that exposes the untouched answer objects and each Score distribution with its modal level, and analysis.json. No live inference was repeated.",
    plans: {
      development: { sha256: sha256File(join(RESEARCH, "dev-plan.json")), requests: 2 },
      evaluation: { sha256: sha256File(join(RESEARCH, "eval-plan.json")), requests: 11 },
    },
    runs: { development: runReceipt(join(RESEARCH, "dev-run")), evaluation: runReceipt(join(RESEARCH, "eval-run")) },
    summaries: {
      development: sha256File(join(RESEARCH, "dev-run/summary.json")),
      evaluation: sha256File(join(RESEARCH, "eval-run/summary.json")),
    },
    correctedReplays: {
      note: "Re-derived from the recorded run.json bytes with the corrected decoder; each result carries the untouched answer objects.",
      development: sha256(canonicalReplay(join(RESEARCH, "dev-run/run.json"))),
      evaluation: sha256(canonicalReplay(join(RESEARCH, "eval-run/run.json"))),
    },
    patchMatrix: {
      sha256: sha256File(join(RESEARCH, "patch-matrix.json")),
      rows: matrix.outcomes.length,
      outcomes: matrix.outcomes.map((outcome) => ({
        variant: outcome.variant,
        patch: outcome.patch,
        compiles: outcome.compiles,
        satisfies: outcome.requirementSatisfied,
        owners: outcome.declaredEditedOwners.length,
        violations: outcome.obligationsViolated,
      })),
    },
    sourceFiles: {
      runner: sha256File(join(ROOT, RUNNER)),
      observer: sha256File(join(ROOT, OBSERVER)),
      observerCache: sha256File(join(ROOT, OBSERVER_CACHE)),
      enforcement: sha256File(join(ROOT, ENFORCEMENT)),
    },
  }
  writeFileSync(join(STAGE, "receipts.json"), JSON.stringify(receipts, null, 2) + "\n", { flag: "wx" })
  const originalArchive = ["maint-utility-receipts-v1.tar.gz", "maint-utility-receipts.tar.gz"]
    .map((name) => resolve(RESEARCH, name))
    .find((path) => existsSync(path))
  const v1Line =
    originalArchive === undefined
      ? "- Original archive: not present in this working copy"
      : `- Original archive: \`${originalArchive.slice(RESEARCH.length + 1)}\`, ${readFileSync(originalArchive).byteLength} bytes, SHA256 \`${createHash("sha256").update(readFileSync(originalArchive)).digest("hex")}\` (preserved unchanged)`
  writeFileSync(
    join(STAGE, "README.md"),
    [
      `# Maintenance-utility receipts (${version})`,
      "",
      "Contents: both prepared plans, both run ledgers with per-request intents and receipts,",
      "both recorded summaries, the 24-row patch matrix, one unified diff per candidate patch,",
      "`analysis.json` (corrected replay of the recorded runs with the untouched answer objects),",
      "and `receipts.json` with every hash and latency percentile.",
      "",
      "No authorization header is present anywhere in this archive. The transport records status,",
      "response body, `x-typesafe-request-id`, and elapsed time only.",
      "",
      "## Version note",
      "",
      v1Line,
      "",
      version === "v1"
        ? "This is the original archive."
        : [
            "v2 changes nothing about the inference: the plans, expected labels, run ledgers, and patch",
            "matrix are byte-identical to v1. v2 adds the per-request `*.intent.json` files that v1",
            "omitted, and `analysis.json`, which re-derives each summary from the recorded `run.json`",
            "bytes with a corrected decoder that exposes the raw answer objects and reports each Score",
            "answer as a distribution with its modal level instead of presenting the rounded mean as the",
            "selected level. Replays are digest-checked against the recorded run hashes.",
            "",
            "The recorded `summary.json` files are the original decoder's output and are kept as-is;",
            "`analysis.json` is the corrected reading of the same recorded bytes.",
          ].join("\n"),
      "",
    ].join("\n") + "\n",
    { flag: "wx" },
  )
  writeFileSync(
    join(STAGE, "analysis.json"),
    JSON.stringify(
      {
        schema: "pulsar.jev_maint_analysis.v1",
        note: "Corrected replay of the recorded runs. No new inference. Each result exposes the raw answer objects beside the comparison, and each Score answer reports mean, distribution, modal level, and both agreement readings.",
        development: replayRun(join(RESEARCH, "dev-run/run.json")),
        evaluation: replayRun(join(RESEARCH, "eval-run/run.json")),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  )

  rmSync(join(STAGE, "tmp"), { recursive: true, force: true })
  const archive = ARCHIVE
  const tar = Bun.spawnSync({
    cmd: ["tar", "-czf", archive, "-C", RESEARCH, `receipt-${version}`],
    stdout: "pipe",
    stderr: "pipe",
  })
  if ((tar.exitCode ?? 1) !== 0) throw new Error(`tar failed: ${tar.stderr.toString()}`)
  const bytes = readFileSync(archive)
  console.log(`archive ${archive}`)
  console.log(`sha256 ${createHash("sha256").update(bytes).digest("hex")}`)
  console.log(`bytes ${bytes.byteLength}`)
}

if (import.meta.main) main()
