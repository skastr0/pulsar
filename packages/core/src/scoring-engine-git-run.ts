import { spawn } from "node:child_process"
import { Effect } from "effect"

interface RunGitOpts<E> {
  readonly onFail: (message: string) => E
}

export const runGit = <E>(
  cwd: string,
  args: ReadonlyArray<string>,
  opts: RunGitOpts<E>,
): Effect.Effect<string, E> =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn("git", args as Array<string>, { cwd })
        let stdout = ""
        let stderr = ""
        const onAbort = () => {
          child.kill("SIGTERM")
        }
        signal.addEventListener("abort", onAbort, { once: true })
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString()
        })
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString()
        })
        child.on("error", (err) => {
          signal.removeEventListener("abort", onAbort)
          reject(err)
        })
        child.on("close", (code) => {
          signal.removeEventListener("abort", onAbort)
          if (code === 0) resolve(stdout)
          else
            reject(
              new Error(
                `git ${args.join(" ")} exited with code ${code}: ${stderr.trim()}`,
              ),
            )
        })
      }),
    catch: (cause) => opts.onFail(cause instanceof Error ? cause.message : String(cause)),
  })
