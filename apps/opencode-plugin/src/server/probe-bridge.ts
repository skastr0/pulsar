import { execFile } from "node:child_process"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { extname, join } from "node:path"
import { promisify } from "node:util"
import { evaluateBackpressure } from "@skastr0/pulsar-core/backpressure"
import { toObserverJson } from "@skastr0/pulsar-core/observer"
import { createTimeSeriesServices } from "@skastr0/pulsar-core/time-series"
import type { PulsarVector } from "@skastr0/pulsar-core/vector"
import { observeCurrentWorktree } from "./pulsar-observer"
import { Effect } from "effect"

const execFileAsync = promisify(execFile)

interface ProbePulsarMetadata {
  readonly supported: boolean
  readonly note: string
  readonly sha?: string
  readonly observerOutput?: ReturnType<typeof toObserverJson>
  readonly backpressure?: ReturnType<typeof evaluateBackpressure>
}

const isProbeSessionOpenCommand = (command: string): boolean =>
  /(?:^|\s)(?:probe\s+session\s+open|bun\s+run\s+probe\s+--\s+session\s+open)(?:\s|$)/.test(
    command,
  )

export const maybeHandleProbeSessionOpen = async (input: {
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  readonly output: string
  readonly worktree: string
  readonly vector: PulsarVector | undefined
  readonly probeHome?: string
}): Promise<ProbePulsarMetadata | undefined> => {
  if (input.tool !== "bash") return undefined
  const command = typeof input.args.command === "string" ? input.args.command : undefined
  if (command === undefined || !isProbeSessionOpenCommand(command)) return undefined

  const parsed = parseProbeOpenOutput(input.output)
  if (parsed === undefined) return undefined

  const metadata = await computeProbePulsarMetadata({
    worktree: input.worktree,
    vector: input.vector,
  })
  await attachProbeSessionMetadata({
    sessionId: parsed.sessionId,
    metadata,
    probeHome: input.probeHome,
  })
  return metadata
}

const computeProbePulsarMetadata = async (input: {
  readonly worktree: string
  readonly vector: PulsarVector | undefined
}): Promise<ProbePulsarMetadata> => {
  const supported = await detectSupportedTargetLanguage(input.worktree)
  if (!supported) {
    return {
      supported: false,
      note: "Probe target language is not supported by the Pulsar yet; only TypeScript and Rust targets are precomputed in phase 6.",
    }
  }

  const snapshot = await observeCurrentWorktree({
    worktree: input.worktree,
    vector: input.vector,
    persistTimeSeries: true,
  })
  const entries = await Effect.runPromise(
    createTimeSeriesServices(input.worktree).reader.entries(),
  )
  return {
    supported: true,
    note: "Probe session received a precomputed pulsar snapshot before planning.",
    sha: snapshot.sha,
    observerOutput: toObserverJson(snapshot.observerOutput),
    backpressure: evaluateBackpressure(entries, input.vector),
  }
}

const attachProbeSessionMetadata = async (input: {
  readonly sessionId: string
  readonly metadata: ProbePulsarMetadata
  readonly probeHome?: string
}): Promise<void> => {
  const probeHome = input.probeHome ?? join(homedir(), ".probe")
  const sessionRoot = join(probeHome, "sessions", input.sessionId)
  const manifestPath = join(sessionRoot, "meta", "session-manifest.json")
  const outputsDir = join(sessionRoot, "outputs")

  await mkdir(join(sessionRoot, "meta"), { recursive: true })
  await mkdir(outputsDir, { recursive: true })

  const manifest = await readJson<Record<string, unknown>>(manifestPath, {})
  const nextManifest = {
    ...manifest,
    extensions: {
      ...(isRecord(manifest.extensions) ? manifest.extensions : {}),
      pulsar: input.metadata,
    },
  }
  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8")

  const artifactPath = join(outputsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-pulsar-snapshot.json`)
  await writeFile(artifactPath, `${JSON.stringify(input.metadata, null, 2)}\n`, "utf8")
}

const parseProbeOpenOutput = (
  output: string,
): { readonly sessionId: string } | undefined => {
  try {
    const parsed = JSON.parse(output) as { readonly sessionId?: unknown; readonly session_id?: unknown }
    const sessionId =
      typeof parsed.sessionId === "string"
        ? parsed.sessionId
        : typeof parsed.session_id === "string"
          ? parsed.session_id
          : undefined
    return sessionId === undefined ? undefined : { sessionId }
  } catch {
    return undefined
  }
}

const detectSupportedTargetLanguage = async (worktree: string): Promise<boolean> => {
  try {
    const result = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd: worktree },
    )
    return result.stdout.split("\n").some((file) => {
      const trimmed = file.trim()
      return (
        trimmed.endsWith(".ts") ||
        trimmed.endsWith(".tsx") ||
        trimmed.endsWith(".rs") ||
        trimmed.endsWith("tsconfig.json") ||
        trimmed.endsWith("Cargo.toml")
      )
    })
  } catch {
    const entries = await readdir(worktree, { withFileTypes: true })
    return entries.some(
      (entry) =>
        entry.isFile() &&
        (entry.name === "tsconfig.json" || entry.name === "Cargo.toml" || [".ts", ".tsx", ".rs"].includes(extname(entry.name))),
    )
  }
}

const readJson = async <A>(path: string, fallback: A): Promise<A> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as A
  } catch {
    return fallback
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
