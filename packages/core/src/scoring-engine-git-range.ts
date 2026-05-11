import { Effect } from "effect"
import { GitRevListFailed } from "./errors.js"
import { runGit } from "./scoring-engine-git-run.js"

/**
 * Resolve `git rev-list <from>..<to> --reverse` — returns commit SHAs in
 * oldest → newest order so score-range streaming mirrors natural history.
 * Includes `to` and excludes `from` (same as git's two-dot range).
 */
export const resolveRange = (
  repoPath: string,
  fromSha: string,
  toSha: string,
): Effect.Effect<ReadonlyArray<string>, GitRevListFailed> =>
  Effect.gen(function* () {
    const out = yield* runGit(
      repoPath,
      ["rev-list", "--reverse", `${fromSha}..${toSha}`],
      {
        onFail: (msg) =>
          new GitRevListFailed({ repoPath, fromSha, toSha, message: msg }),
      },
    )
    const shas = out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    return shas
  })
