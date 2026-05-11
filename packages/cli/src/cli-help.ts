import { CLI_VERSION } from "./index.js"

const HELP_SECTIONS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  [
    "Usage",
    [
      "  pulsar score [<repo-path>]",
      "  pulsar score --signal <id> [<repo-path>]",
      "  pulsar baseline <set|refresh|show> [<repo-path>]",
      "  pulsar backpressure [--trend] [--vector <path>] [<repo-path>]",
      "  pulsar bisect --signal <id> --range <from>..<to> [<repo-path>]",
      "  pulsar bisect --observer --range <from>..<to> [--vector <path>] [<repo-path>]",
      "  pulsar bisect --range <from>..<to> [--vector <path>] [<repo-path>]",
      "  pulsar calibrate suggest [--write] [--json] [<repo-path>]",
      "  pulsar persona <list|show|apply|diff> [args]",
      "  pulsar elicit <quiz|bootstrap|review|accept|reject> [args]",
      "  pulsar glossary extract --sha <ref> [--no-parameters] [<repo-path>]",
      "  pulsar glossary confirm [--auto-accept-above-frequency <n>] [<repo-path>]",
      "  pulsar conventions extract --sha <ref> [<repo-path>]",
      "  pulsar conventions confirm [<repo-path>]",
      "  pulsar --version",
    ],
  ],
  [
    "Commands",
    [
      "  score        Run one signal or the full Observer against a repo.",
      "  baseline     Record or inspect tolerated hard-gate debt for ratcheting.",
      "  backpressure Evaluate the score history as green/yellow/red pressure.",
      "  bisect       Replay a commit range into compact signal/category score curves.",
      "  calibrate    Suggest repo-owned calibration/reference-data onboarding steps.",
      "  persona      List, show, apply, or diff curated pulsar presets.",
      "  elicit       Run quiz, bootstrap, and proposal review workflows.",
      "  glossary     Extract a draft glossary and confirm canonical terms.",
      "  conventions  Extract a draft schema-conventions file and confirm it.",
    ],
  ],
  ["Global options", ["  --no-progress        Disable the terminal loading indicator."]],
  [
    "Score options",
    [
      "  --signal <id>        Single-signal mode (existing TC-003 path).",
      "  --vector <path>      Load a specific pulsar vector JSON.",
      "  --json               Emit ObserverOutput JSON plus CLI vector source metadata.",
      "  --category <name>    Human output for one category only.",
      "  --ci                 Apply baseline ratcheting and exit 2 on new violations.",
      "  --profile            Include runtime attribution and bypass observer cache.",
    ],
  ],
  [
    "Baseline options",
    [
      "  set                  Write .pulsar/baseline.json from current hard-gate debt.",
      "  refresh              Replace the baseline with current state.",
      "  show                 Render tolerated counts per signal + baseline age.",
    ],
  ],
  [
    "Backpressure options",
    [
      "  --trend              Render the persisted series as a trend table.",
      "  --vector <path>      Optional pulsar vector JSON.",
    ],
  ],
  [
    "Bisect options",
    [
      "  --signal <id>        Single-signal bisect mode.",
      "  --observer           Run the full Observer across active signals.",
      "  --vector <path>      Optional pulsar vector JSON.",
      "  --range <a>..<b>     Commit range, oldest..newest.",
      "  --concurrency <n>    Parallel worktrees (default 4).",
      "  --sample <mode>      auto, full, merge-only, or adaptive-delta.",
      "  --top <n>            Number of culprit commits (default 5).",
      "  --category <name>    Restrict observer curves/output to one category (repeatable).",
      "  --scope <id>         Restrict observer signal curves/output to one signal (repeatable).",
      "  --first-crossing <expr>",
      "                       First commit where a metric crosses a threshold, e.g. TS-LD-02<0.5.",
      "  --json               Emit JSON instead of human-readable output.",
    ],
  ],
  [
    "Calibrate options",
    [
      "  suggest              Print deterministic repo-owned calibration suggestions.",
      "  --write              Write .pulsar/calibration-suggestions.json.",
      "  --json               Emit the suggestion report as JSON.",
    ],
  ],
  [
    "Persona options",
    [
      "  list                 Enumerate available presets.",
      "  show <name>          Print the full preset vector and rationale.",
      "  apply <name>         Write the preset to --to <path> (refuses overwrite without --force).",
      "  diff <name>          Show deltas between the current vector and the preset.",
      "  --to <path>          Output path for persona apply.",
      "  --force              Overwrite an existing output file.",
      "  --vector <path>      Compare against an explicit vector instead of discovery.",
    ],
  ],
  [
    "Elicit options",
    [
      "  quiz                 Run the pairwise tradeoff quiz.",
      "  bootstrap            Infer a pending proposal from recent repo history.",
      "  review               Show pending elicitation proposals.",
      "  accept <id>          Accept one pending proposal and update the vector.",
      "  reject <id>          Reject one pending proposal without resurfacing it.",
      "  --items <count>      Quiz questions to ask (default 15, max 20).",
      "  --resume <path>      Resume a saved quiz session JSON.",
      "  --to <path>          Quiz output path for the final vector.",
      "  --vector <path>      Explicit vector path for quiz/bootstrap/accept flows.",
      "  --force              Overwrite an existing quiz output vector.",
      "  --commits <count>    Bootstrap over the most recent N commits (default 60).",
      "  --preset <name>      Optional preset prior for low-sample bootstrap runs.",
    ],
  ],
  [
    "Glossary options",
    [
      "  --sha <ref>          Commit or ref to inspect in a detached worktree.",
      "  --no-parameters      Exclude parameter names from glossary extraction.",
      "  --auto-accept-above-frequency <n>",
      "                       On confirm, accept undecided terms with frequency >= n",
      "                       and reject lower-frequency undecided terms.",
    ],
  ],
  ["Conventions options", ["  --sha <ref>          Commit or ref to inspect in a detached worktree."]],
  [
    "Vector discovery order (score + baseline when --vector is omitted)",
    [
      "  1. .pulsar/vector.json at the worktree root",
      "  2. ~/.config/pulsar/vector.json as an organization-standard fallback",
      "  3. Fallback: detected language-pack/shared signals active with default config and weight 1",
    ],
  ],
  [
    "Trust boundary",
    [
      "  Pulsar is repo- or organization-owned. The home fallback is only a transport",
      "  location for an organization-standard vector; it is not personal pulsar.",
      "  Repo-local .pulsar/vector.json always overrides the home fallback.",
    ],
  ],
  [
    "Examples",
    [
      "  pulsar score .",
      "  pulsar score --json .",
      "  pulsar score --profile --category generated-slop .",
      "  pulsar score --category legibility-decay .",
      "  pulsar score --ci .",
      "  pulsar baseline set .",
      "  pulsar baseline show .",
      "  pulsar backpressure .",
      "  pulsar backpressure --trend .",
      "  pulsar bisect --signal TS-RP-01 --range HEAD~50..HEAD",
      "  pulsar bisect --observer --range HEAD~50..HEAD",
      "  pulsar bisect --range HEAD~50..HEAD --vector ./pulsar-vector.json --json /path/to/repo",
      "  pulsar calibrate suggest .",
      "  pulsar calibrate suggest --write .",
      "  pulsar persona list",
      "  pulsar persona show security-paranoid",
      "  pulsar persona apply strict-type-safety --to ./.pulsar/vector.json",
      "  pulsar persona diff ai-slop-defense",
      "  pulsar elicit quiz --items 15 .",
      "  pulsar elicit bootstrap --commits 80 --preset strict-type-safety .",
      "  pulsar elicit review .",
      "  pulsar elicit accept proposal-ai-assisted-mode .",
      "  pulsar elicit reject proposal-abc123def456 .",
      "  pulsar glossary extract --sha HEAD .",
      "  pulsar glossary confirm --auto-accept-above-frequency 3 .",
      "  pulsar glossary confirm .",
      "  pulsar conventions extract --sha HEAD .",
      "  pulsar conventions confirm .",
    ],
  ],
]

export const renderHelp = (): string =>
  [
    `pulsar — Pulsar CLI v${CLI_VERSION}`,
    "",
    ...HELP_SECTIONS.flatMap(([title, lines]) => [`${title}:`, ...lines, ""]),
  ].join("\n")

export const printHelp = (): void => {
  console.log(renderHelp())
}
