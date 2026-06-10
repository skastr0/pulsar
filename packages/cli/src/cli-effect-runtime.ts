import { Effect, Logger } from "effect"

/**
 * CLI stdout is a data channel — `--json` output must stay
 * machine-parseable — so every Effect log line, including the runtime's
 * own version-mismatch warnings (emitted when a target repo's
 * node_modules carries a different Effect copy), goes to stderr. Before
 * this, 585 WARN lines on groundwork made `pulsar score --json`
 * unparseable.
 */
const stderrLogger = Logger.replace(
  Logger.defaultLogger,
  Logger.make((options) => {
    const message = Array.isArray(options.message)
      ? options.message.map(String).join(" ")
      : String(options.message)
    process.stderr.write(
      `timestamp=${options.date.toISOString()} level=${options.logLevel.label} fiber=${options.fiberId} message=${JSON.stringify(message)}\n`,
    )
  }),
)

export const runCliEffect = <A>(effect: Effect.Effect<A, never, never>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, stderrLogger))
