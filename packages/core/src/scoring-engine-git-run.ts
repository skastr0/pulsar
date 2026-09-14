import { Effect } from "effect"
import { collectGitStdout } from "./shared-git.js"

interface RunGitOpts<E> {
  readonly onFail: (message: string) => E
}

export const runGit = <E>(
  cwd: string,
  args: ReadonlyArray<string>,
  opts: RunGitOpts<E>,
): Effect.Effect<string, E> =>
  Effect.tryPromise({
    try: (signal) => collectGitStdout(cwd, args, { signal }),
    catch: (cause) => opts.onFail(cause instanceof Error ? cause.message : String(cause)),
  })
