import type { runElicitCommand } from "./elicit.js"

export type ElicitAction = "quiz" | "bootstrap" | "review" | "accept" | "reject"
type ElicitOptions = Parameters<typeof runElicitCommand>[0]

export const parseElicitOptions = (
  actionArg: ElicitAction,
  commandArgs: ReadonlyArray<string>,
  fail: (message: string) => never,
): ElicitOptions => {
  const actionArgs = commandArgs.slice(1)
  if (actionArg === "quiz") return parseElicitQuizOptions(actionArgs, commandArgs, fail)
  if (actionArg === "bootstrap") return parseElicitBootstrapOptions(actionArgs, fail)
  if (actionArg === "review") return parseElicitReviewOptions(actionArgs)
  return parseElicitResolutionOptions(actionArg, actionArgs, fail)
}

const parseElicitQuizOptions = (
  actionArgs: ReadonlyArray<string>,
  commandArgs: ReadonlyArray<string>,
  fail: (message: string) => never,
): ElicitOptions => {
  const flagsWithValues = new Set(["--items", "--resume", "--to", "--vector"])
  const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
  return {
    action: "quiz",
    repoPath,
    ...(parseArg(actionArgs, "--items") !== undefined
      ? { items: parsePositiveInt(parseArg(actionArgs, "--items"), 15, "--items", fail) }
      : {}),
    ...(parseArg(actionArgs, "--resume") !== undefined
      ? { resumePath: parseArg(actionArgs, "--resume")! }
      : {}),
    ...(parseArg(actionArgs, "--to") !== undefined ? { outputPath: parseArg(actionArgs, "--to")! } : {}),
    ...(parseArg(actionArgs, "--vector") !== undefined
      ? { vectorPath: parseArg(actionArgs, "--vector")! }
      : {}),
    ...(commandArgs.includes("--force") ? { force: true } : {}),
  } satisfies ElicitOptions
}

const parseElicitBootstrapOptions = (
  actionArgs: ReadonlyArray<string>,
  fail: (message: string) => never,
): ElicitOptions => {
  const flagsWithValues = new Set(["--commits", "--preset", "--vector"])
  const repoPath = collectPositional(actionArgs, flagsWithValues)[0] ?? "."
  return {
    action: "bootstrap",
    repoPath,
    ...(parseArg(actionArgs, "--commits") !== undefined
      ? { commits: parsePositiveInt(parseArg(actionArgs, "--commits"), 60, "--commits", fail) }
      : {}),
    ...(parseArg(actionArgs, "--preset") !== undefined
      ? { presetId: parseArg(actionArgs, "--preset")! }
      : {}),
    ...(parseArg(actionArgs, "--vector") !== undefined
      ? { vectorPath: parseArg(actionArgs, "--vector")! }
      : {}),
  } satisfies ElicitOptions
}

const parseElicitReviewOptions = (
  actionArgs: ReadonlyArray<string>,
): ElicitOptions => ({
  action: "review",
  repoPath: collectPositional(actionArgs, new Set())[0] ?? ".",
})

const parseElicitResolutionOptions = (
  action: "accept" | "reject",
  actionArgs: ReadonlyArray<string>,
  fail: (message: string) => never,
): ElicitOptions => {
  const flagsWithValues = new Set(["--vector"])
  const proposalId =
    collectPositional(actionArgs, flagsWithValues)[0] ??
    fail(`elicit ${action} requires a proposal id`)
  const repoPath = collectPositional(actionArgs, flagsWithValues)[1] ?? "."
  return {
    action,
    proposalId,
    repoPath,
    ...(parseArg(actionArgs, "--vector") !== undefined
      ? { vectorPath: parseArg(actionArgs, "--vector")! }
      : {}),
  } satisfies ElicitOptions
}

const parseArg = (args: ReadonlyArray<string>, flag: string): string | undefined => {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  return args[i + 1]
}

const collectPositional = (
  args: ReadonlyArray<string>,
  flagsWithValues: ReadonlySet<string>,
): ReadonlyArray<string> =>
  args.filter((arg, index) => {
    if (arg.startsWith("--")) return false
    const prev = args[index - 1]
    return prev === undefined || !flagsWithValues.has(prev)
  })

const parsePositiveInt = (
  raw: string | undefined,
  fallback: number,
  flag: string,
  fail: (message: string) => never,
): number => {
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) {
    fail(`${flag} must be a positive integer, got: ${raw}`)
  }
  return n
}
