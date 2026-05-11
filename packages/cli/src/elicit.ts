import { Effect } from "effect"
import { runBootstrapAction } from "./elicit-bootstrap.js"
import { runReviewAction, runResolutionAction } from "./elicit-proposals.js"
import { runQuizAction } from "./elicit-quiz.js"
import type { ElicitCommandOptions } from "./elicit-types.js"

export const runElicitCommand = (opts: ElicitCommandOptions) =>
  Effect.gen(function* () {
    if (opts.action === "quiz") {
      return yield* runQuizAction(opts)
    }

    if (opts.action === "bootstrap") {
      return yield* runBootstrapAction(opts)
    }

    if (opts.action === "review") {
      return yield* runReviewAction(opts)
    }

    if (opts.action === "accept") {
      return yield* runResolutionAction(opts, "accepted")
    }

    if (opts.action === "reject") {
      return yield* runResolutionAction(opts, "rejected")
    }

    return yield* Effect.fail(new Error(`Unknown elicit action: ${String(opts.action)}`))
  })
