import { spawn } from "node:child_process"

/**
 * Same fail-closed ceiling as the previous execFile maxBuffer. Streaming
 * history parses must not retain this buffer; they may only read up to it.
 */
export const GIT_SUBPROCESS_MAX_BYTES = 256 * 1024 * 1024
const GIT_STDERR_MAX_BYTES = 64 * 1024

export class GitSubprocessLimitExceeded extends Error {
  readonly maxBytes: number
  readonly bytesRead: number

  constructor(maxBytes: number, bytesRead: number) {
    super(`git subprocess output exceeded ${maxBytes} bytes`)
    this.name = "GitSubprocessLimitExceeded"
    this.maxBytes = maxBytes
    this.bytesRead = bytesRead
  }
}

export interface GitSubprocessOptions {
  readonly signal?: AbortSignal
  readonly maxBytes?: number
}

export const collectGitStdout = async (
  repoPath: string,
  args: ReadonlyArray<string>,
  options?: GitSubprocessOptions,
): Promise<string> => {
  const chunks: Buffer[] = []
  let total = 0
  await runGitProcess(repoPath, args, {
    ...options,
    onStdoutChunk: (chunk) => {
      chunks.push(chunk)
      total += chunk.length
    },
  })
  return Buffer.concat(chunks, total).toString("utf8")
}

export const forEachGitLine = async (
  repoPath: string,
  args: ReadonlyArray<string>,
  onLine: (line: string) => void,
  options?: GitSubprocessOptions,
): Promise<void> => {
  const decoder = new TextDecoder("utf-8")
  let pending = ""
  await runGitProcess(repoPath, args, {
    ...options,
    onStdoutChunk: (chunk) => {
      pending += decoder.decode(chunk, { stream: true })
      emitCompleteGitLines(pending, onLine)
      pending = remainderAfterLastNewline(pending)
    },
  })
  onLine(pending + decoder.decode())
}

const emitCompleteGitLines = (pending: string, onLine: (line: string) => void): void => {
  let start = 0
  let newline = pending.indexOf("\n")
  while (newline !== -1) {
    onLine(pending.slice(start, newline))
    start = newline + 1
    newline = pending.indexOf("\n", start)
  }
}

const remainderAfterLastNewline = (pending: string): string => {
  const newline = pending.lastIndexOf("\n")
  return newline === -1 ? pending : pending.slice(newline + 1)
}

interface RunGitProcessOptions extends GitSubprocessOptions {
  readonly onStdoutChunk: (chunk: Buffer) => void
}

const runGitProcess = (
  repoPath: string,
  args: ReadonlyArray<string>,
  options: RunGitProcessOptions,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const maxBytes = options.maxBytes ?? GIT_SUBPROCESS_MAX_BYTES
    const child = spawn("git", args as Array<string>, { cwd: repoPath })
    let bytesRead = 0
    let stderr = ""
    let settled = false

    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", onAbort)
    }

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      child.kill("SIGTERM")
      reject(error)
    }

    const onAbort = (): void => {
      fail(new Error("git subprocess aborted"))
    }
    options.signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return
      bytesRead += chunk.length
      if (bytesRead > maxBytes) {
        fail(new GitSubprocessLimitExceeded(maxBytes, bytesRead))
        return
      }
      try {
        options.onStdoutChunk(chunk)
      } catch (cause) {
        fail(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length >= GIT_STDERR_MAX_BYTES) return
      stderr += chunk.toString("utf8").slice(0, GIT_STDERR_MAX_BYTES - stderr.length)
    })

    child.on("error", (error) => {
      fail(error)
    })

    child.on("close", (code) => {
      if (settled) return
      cleanup()
      if (code === 0) {
        settled = true
        resolve()
        return
      }
      fail(new Error(`git ${args.join(" ")} exited with code ${code}: ${stderr.trim()}`))
    })
  })
