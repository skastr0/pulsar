import { spawn, type ChildProcess } from "node:child_process"

/**
 * Same fail-closed ceiling as the previous execFile maxBuffer. Streaming
 * history parses must not retain this buffer; they may only read up to it.
 * Exceeding a ceiling rejects; it must not truncate evidence.
 */
export const GIT_SUBPROCESS_MAX_BYTES = 256 * 1024 * 1024
export const GIT_STDERR_MAX_BYTES = 64 * 1024

export class GitSubprocessLimitExceeded extends Error {
  readonly stream: "stdout" | "stderr"
  readonly maxBytes: number
  readonly bytesRead: number

  constructor(stream: "stdout" | "stderr", maxBytes: number, bytesRead: number) {
    super(`git subprocess ${stream} exceeded ${maxBytes} bytes`)
    this.name = "GitSubprocessLimitExceeded"
    this.stream = stream
    this.maxBytes = maxBytes
    this.bytesRead = bytesRead
  }
}

export class GitSubprocessAborted extends Error {
  constructor() {
    super("git subprocess aborted")
    this.name = "GitSubprocessAborted"
  }
}

export interface GitSubprocessOptions {
  readonly signal?: AbortSignal
  readonly maxBytes?: number
  readonly maxStderrBytes?: number
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

const GIT_CANCEL_KILL_MS = 1_000

const runGitProcess = (
  repoPath: string,
  args: ReadonlyArray<string>,
  options: RunGitProcessOptions,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const signal = options.signal
    if (signal?.aborted) {
      reject(new GitSubprocessAborted())
      return
    }

    const maxBytes = options.maxBytes ?? GIT_SUBPROCESS_MAX_BYTES
    const maxStderrBytes = options.maxStderrBytes ?? GIT_STDERR_MAX_BYTES
    const child = spawn("git", args as Array<string>, { cwd: repoPath })
    let stdoutBytes = 0
    let stderrBytes = 0
    let stderr = ""
    let settled = false

    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort)
    }

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      child.stdout.removeAllListeners("data")
      child.stderr.removeAllListeners("data")
      waitForChildExit(child, () => {
        reject(error)
      })
    }

    const onAbort = (): void => {
      fail(new GitSubprocessAborted())
    }
    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
        return
      }
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return
      stdoutBytes += chunk.length
      if (stdoutBytes > maxBytes) {
        fail(new GitSubprocessLimitExceeded("stdout", maxBytes, stdoutBytes))
        return
      }
      try {
        options.onStdoutChunk(chunk)
      } catch (cause) {
        fail(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })

    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return
      stderrBytes += chunk.length
      if (stderrBytes > maxStderrBytes) {
        fail(new GitSubprocessLimitExceeded("stderr", maxStderrBytes, stderrBytes))
        return
      }
      stderr += chunk.toString("utf8")
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

const childHasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null || child.pid === undefined

const waitForChildExit = (child: ChildProcess, onExited: () => void): void => {
  if (childHasExited(child)) {
    onExited()
    return
  }

  const killTimer = setTimeout(() => {
    if (!childHasExited(child)) child.kill("SIGKILL")
  }, GIT_CANCEL_KILL_MS)
  killTimer.unref()

  child.once("close", () => {
    clearTimeout(killTimer)
    onExited()
  })
  child.kill("SIGTERM")
}
