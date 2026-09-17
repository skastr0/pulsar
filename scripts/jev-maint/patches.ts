import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildShapeCandidates } from "../jev-spike/shape-candidates.ts"

/**
 * Candidate maintenance patches for the maintenance-utility research workstream.
 *
 * These are research fixtures, not adopted changes. Each patch is a real source
 * transformation applied to a disposable copy of the repository so that the
 * declared outcome (compiles / satisfies the requirement / violates an
 * obligation) can be checked with a compiler and a runtime probe rather than
 * asserted in prose.
 */

export const RUNNER = "packages/core/src/runner.ts"
export const OBSERVER = "packages/core/src/observer-execution.ts"
export const ENFORCEMENT = "packages/core/src/enforcement.ts"
export const OBSERVER_CACHE = "packages/core/src/scoring-engine-observer-cache.ts"

export type Variant = "a" | "b"
export type TaskId = "shared-contract" | "caller-failure" | "delegated-rule" | "missing-output"
export type Files = Record<string, string>

export type PatchId =
  | "r1_contract_and_all_sites"
  | "r1_contract_interface_only"
  | "r1_optional_field_one_entry_point"
  | "r2_observer_failure_branch_only"
  | "r2_share_failure_policy_both_entry_points"
  | "r2_no_source_change"
  | "r3_enforcement_rule_only"
  | "r3_enforcement_plus_call_site_rechecks"
  | "r3_call_sites_only"
  | "r4_runner_missing_output_branch_only"
  | "r4_both_entry_points_report_missing_output"
  | "r4_no_source_change"

const lines = (...parts: ReadonlyArray<string>): string => parts.join("\n")

const occurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) throw new Error("empty anchor")
  let count = 0
  let from = 0
  while (true) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return count
    count += 1
    from = at + needle.length
  }
}

export const requireUnique = (source: string, path: string, anchor: string, label: string): void => {
  const count = occurrences(source, anchor)
  if (count !== 1) {
    throw new Error(`Anchor drift (${label}) in ${path}: expected 1 occurrence, found ${count}`)
  }
}

export const replaceUnique = (
  source: string,
  path: string,
  anchor: string,
  replacement: string,
  label: string,
): string => {
  requireUnique(source, path, anchor, label)
  if (replacement === anchor) throw new Error(`No-op replacement (${label}) in ${path}`)
  return source.replace(anchor, replacement)
}

// --- anchors -----------------------------------------------------------------

const INTERFACE_TAIL = lines(
  "  readonly metadata?: SignalOutputMetadata",
  "  readonly factorLedger?: SignalFactorLedger",
  "}",
)

const RUNNER_SUCCESS_A = lines(
  "    return {",
  "      signalId: target.id,",
  "      score: target.score(out),",
  "      output: out,",
  "      diagnostics: enforceSeverityCeiling(target, target.diagnose(out)),",
  "      ...(metadata !== undefined ? { metadata } : {}),",
  "      ...(factorLedger !== undefined ? { factorLedger } : {}),",
  "    }",
  "  })",
)

const HELPER_LITERAL_B = lines(
  "  return {",
  "    signalId: signal.id,",
  "    score: signal.score(out),",
  "    output: out,",
  "    diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out)),",
  "    ...(metadata !== undefined ? { metadata } : {}),",
  "    ...(factorLedger !== undefined ? { factorLedger } : {}),",
  "  }",
)

const OBSERVER_SUCCESS_A = lines(
  "    return {",
  "      signalId: signal.id,",
  "      score: signal.score(out),",
  "      output: out,",
  "      diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out)),",
  "      ...(metadata !== undefined ? { metadata } : {}),",
  "      ...(factorLedger !== undefined ? { factorLedger } : {}),",
  "    }",
  "  })",
)

const OBSERVER_FAILURE_BRANCH = lines(
  "      const failureDiagnostic: Diagnostic = {",
  '        severity: "warn",',
  "        message: `Signal ${signal.id} failed: ${message}`,",
  "      }",
)

const RUNNER_MISSING_OUTPUT = lines(
  "      return {",
  "        signalId: target.id,",
  "        score: 0,",
  "        output: undefined,",
  "        diagnostics: [",
  "          {",
  '            severity: "warn" as const,',
  "            message: `Signal ${target.id} did not produce an output (inactive?)`,",
  "          },",
  "        ],",
  "      }",
)

const CACHE_RESTORE_TAIL = lines(
  "          diagnostics: result.diagnostics,",
  "          ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),",
  "          ...(result.factorLedger !== undefined ? { factorLedger: result.factorLedger } : {}),",
  "        }",
)

const OBSERVER_FAILURE_LITERAL = lines(
  "      return {",
  "        signalId: signal.id,",
  "        score: 0,",
  "        output: undefined,",
  "        diagnostics: [failureDiagnostic],",
  '        metadata: { applicability: "failed" },',
  "      }",
)

const ENFORCEMENT_PARAM = lines(
  "  signal: {",
  "    readonly evidenceClass: SignalEvidenceClass",
  "    readonly enforcement: EnforcementCeiling",
  "  },",
)

const ENFORCEMENT_TIER_IMPORT = 'import type { SignalKind, Tier } from "./tier.js"'

const ENFORCEMENT_CONDITION = lines(
  '    diagnostic.severity === "block" &&',
  '    (!signal.enforcement.includes("hard-gate") ||',
  "      !evidenceClassAllowsHardGate(diagnostic.evidenceClass ?? signal.evidenceClass))",
)

const RUNNER_CEILING_CALL = "      diagnostics: enforceSeverityCeiling(target, target.diagnose(out)),"
const OBSERVER_CEILING_CALL = "      diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out)),"

const OBSERVER_SUCCESS_HEAD_A = lines(
  "    const out = result.success",
  "    const metadata = signal.outputMetadata?.(out)",
)

const OBSERVER_SUCCESS_HEAD_B = lines(
  "    const out = result.success",
  "    return finalizeSignalResult(signal, out, factorPolicy)",
)

const RUNNER_TAIL_B = lines(
  "    return finalizeSignalResult(target, out, makeSignalFactorPolicyContext(target, vector))",
  "  })",
)

// --- insertion helpers -------------------------------------------------------

const insertBeforeFinalBrace = (source: string, field: string): string => {
  const at = source.lastIndexOf("\n}")
  if (at < 0) throw new Error("final brace anchor missing")
  return `${source.slice(0, at)}\n${field}${source.slice(at)}`
}

const insertBeforeFinalLine = (source: string, field: string): string => {
  const at = source.lastIndexOf("\n")
  if (at < 0) throw new Error("final line anchor missing")
  return `${source.slice(0, at)}\n${field}${source.slice(at)}`
}

const insertBeforeMetadataSpread = (literal: string, field: string): string => {
  const anchor = "...(metadata !== undefined ? { metadata } : {}),"
  const at = literal.indexOf(anchor)
  if (at < 0) throw new Error("metadata spread anchor missing")
  const lineStart = literal.lastIndexOf("\n", at) + 1
  const indent = literal.slice(lineStart, at)
  return `${literal.slice(0, lineStart)}${indent}${field}\n${literal.slice(lineStart)}`
}

// --- edits -------------------------------------------------------------------

const runnerLiteralAnchor = (variant: Variant): string => (variant === "a" ? RUNNER_SUCCESS_A : HELPER_LITERAL_B)

const editRunnerLiteral = (variant: Variant, files: Files, field: string, label: string): Files => {
  const anchor = runnerLiteralAnchor(variant)
  return {
    ...files,
    [RUNNER]: replaceUnique(
      files[RUNNER]!,
      RUNNER,
      anchor,
      insertBeforeMetadataSpread(anchor, field),
      label,
    ),
  }
}

const editObserverLiteral = (files: Files, field: string, label: string): Files => ({
  ...files,
  [OBSERVER]: replaceUnique(
    files[OBSERVER]!,
    OBSERVER,
    OBSERVER_SUCCESS_A,
    insertBeforeMetadataSpread(OBSERVER_SUCCESS_A, field),
    label,
  ),
})

const addInterfaceContractField = (files: Files, optional: boolean): Files => ({
  ...files,
  [RUNNER]: replaceUnique(
    files[RUNNER]!,
    RUNNER,
    INTERFACE_TAIL,
    insertBeforeFinalBrace(INTERFACE_TAIL, `  readonly contractVersion${optional ? "?" : ""}: number`),
    "r1 interface contract field",
  ),
})

const addCacheContractField = (files: Files): Files => ({
  ...files,
  [OBSERVER_CACHE]: replaceUnique(
    files[OBSERVER_CACHE]!,
    OBSERVER_CACHE,
    CACHE_RESTORE_TAIL,
    insertBeforeFinalLine(CACHE_RESTORE_TAIL, "          contractVersion: 1,"),
    "r1 cache restore field",
  ),
})

const addRunnerMissingOutputField = (files: Files, field: string, label: string): Files => ({
  ...files,
  [RUNNER]: replaceUnique(
    files[RUNNER]!,
    RUNNER,
    RUNNER_MISSING_OUTPUT,
    insertBeforeFinalLine(RUNNER_MISSING_OUTPUT, field),
    label,
  ),
})

const addObserverFailureField = (files: Files, field: string): Files => ({
  ...files,
  [OBSERVER]: replaceUnique(
    files[OBSERVER]!,
    OBSERVER,
    OBSERVER_FAILURE_LITERAL,
    insertBeforeFinalLine(OBSERVER_FAILURE_LITERAL, field),
    "r1 observer failure contract field",
  ),
})

/**
 * A required field on the shared result contract must be set at every site that
 * constructs a `SignalRunResult`. The compiler enumerates them: the runner's
 * successful and missing-output branches, the observer's successful and
 * failure branches, and the observer cache-restore path.
 */
const addRequiredContractFieldEverywhere = (variant: Variant, files: Files): Files => {
  let out = addInterfaceContractField(files, false)
  out = addCacheContractField(out)
  out = addRunnerMissingOutputField(out, "        contractVersion: 1,", "r1 runner missing-output contract field")
  out = addObserverFailureField(out, "        contractVersion: 1,")
  out = editRunnerLiteral(variant, out, "contractVersion: 1,", "r1 runner success contract field")
  if (variant === "a") out = editObserverLiteral(out, "contractVersion: 1,", "r1 observer success contract field")
  return out
}

const addObserverFailureData = (files: Files): Files => ({
  ...files,
  [OBSERVER]: replaceUnique(
    files[OBSERVER]!,
    OBSERVER,
    OBSERVER_FAILURE_BRANCH,
    OBSERVER_FAILURE_BRANCH.replace(
      '        message: `Signal ${signal.id} failed: ${message}`,',
      '        message: `Signal ${signal.id} failed: ${message}`,\n        data: { failureKind: "compute_error" },',
    ),
    "r2 observer failure data",
  ),
})

const RUNNER_FAILURE_CATCH = lines(
  "  }).pipe(",
  "    Effect.catch((error) =>",
  "      Effect.succeed({",
  "        signalId,",
  "        score: 0,",
  "        output: undefined,",
  "        diagnostics: [",
  "          {",
  '            severity: "warn" as const,',
  "            message: `Signal ${signalId} failed: ${(error as { message?: string }).message ?? String(error)}`,",
  '            data: { failureKind: "compute_error" },',
  "          },",
  "        ],",
  '        metadata: { applicability: "failed" as const },',
  "      }),",
  "    ),",
  "  )",
)

const addRunnerFailureCatch = (variant: Variant, files: Files): Files => {
  const anchor = variant === "a" ? RUNNER_SUCCESS_A : RUNNER_TAIL_B
  return {
    ...files,
    [RUNNER]: replaceUnique(
      files[RUNNER]!,
      RUNNER,
      anchor,
      anchor.replace(/\n  \}\)$/, `\n${RUNNER_FAILURE_CATCH}`),
      "r2 runner failure catch",
    ),
  }
}

const addEnforcementCategory = (files: Files): Files => {
  const withImport = replaceUnique(
    files[ENFORCEMENT]!,
    ENFORCEMENT,
    ENFORCEMENT_TIER_IMPORT,
    `import type { Category } from "./category.js"\n${ENFORCEMENT_TIER_IMPORT}`,
    "r3 category import",
  )
  const withParam = replaceUnique(
    withImport,
    ENFORCEMENT,
    ENFORCEMENT_PARAM,
    ENFORCEMENT_PARAM.replace(
      "    readonly enforcement: EnforcementCeiling",
      "    readonly enforcement: EnforcementCeiling\n    readonly category: Category",
    ),
    "r3 enforcement param",
  )
  return {
    ...files,
    [ENFORCEMENT]: replaceUnique(
      withParam,
      ENFORCEMENT,
      ENFORCEMENT_CONDITION,
      ENFORCEMENT_CONDITION.replace(
        "      !evidenceClassAllowsHardGate(diagnostic.evidenceClass ?? signal.evidenceClass))",
        '      !evidenceClassAllowsHardGate(diagnostic.evidenceClass ?? signal.evidenceClass) ||\n      signal.category === "generated-slop")',
      ),
      "r3 enforcement condition",
    ),
  }
}

const recheckCall = (subject: string): string =>
  lines(
    "      diagnostics: enforceSeverityCeiling(",
    `        ${subject},`,
    `        ${subject}.diagnose(out).map((diagnostic) =>`,
    `          diagnostic.severity === "block" && ${subject}.category === "generated-slop"`,
    '            ? { ...diagnostic, severity: "warn" as const }',
    "            : diagnostic,",
    "        ),",
    "      ),",
  )

const HELPER_CEILING_CALL = "    diagnostics: enforceSeverityCeiling(signal, signal.diagnose(out)),"

const addCallSiteRechecks = (variant: Variant, files: Files): Files => {
  if (variant === "a") {
    return {
      ...files,
      [RUNNER]: replaceUnique(files[RUNNER]!, RUNNER, RUNNER_CEILING_CALL, recheckCall("target"), "r3 runner recheck"),
      [OBSERVER]: replaceUnique(files[OBSERVER]!, OBSERVER, OBSERVER_CEILING_CALL, recheckCall("signal"), "r3 observer recheck"),
    }
  }
  return {
    ...files,
    [RUNNER]: replaceUnique(files[RUNNER]!, RUNNER, HELPER_CEILING_CALL, recheckCall("signal"), "r3 helper recheck"),
  }
}

const addRunnerMissingOutput = (files: Files): Files =>
  addRunnerMissingOutputField(files, '        metadata: { applicability: "not_applicable" as const },', "r4 runner missing output metadata")

const OBSERVER_MISSING_OUTPUT = lines(
  "    if (out === undefined) {",
  "      return {",
  "        signalId: signal.id,",
  "        score: 0,",
  "        output: undefined,",
  "        diagnostics: [",
  "          {",
  '            severity: "warn" as const,',
  "            message: `Signal ${signal.id} did not produce an output (inactive?)`,",
  "          },",
  "        ],",
  '        metadata: { applicability: "not_applicable" as const },',
  "      }",
  "    }",
)

const addObserverMissingOutput = (variant: Variant, files: Files): Files => {
  const anchor = variant === "a" ? OBSERVER_SUCCESS_HEAD_A : OBSERVER_SUCCESS_HEAD_B
  const head = "    const out = result.success"
  if (!anchor.startsWith(`${head}\n`)) throw new Error("observer success head drift")
  return {
    ...files,
    [OBSERVER]: replaceUnique(
      files[OBSERVER]!,
      OBSERVER,
      anchor,
      `${head}\n${OBSERVER_MISSING_OUTPUT}\n${anchor.slice(head.length + 1)}`,
      "r4 observer missing output",
    ),
  }
}

// --- patch registry ----------------------------------------------------------

export type PatchDefinition = {
  readonly id: PatchId
  readonly task: TaskId
  readonly summary: string
  readonly editedOwners: (variant: Variant) => ReadonlyArray<string>
  readonly editedFiles: (variant: Variant) => ReadonlyArray<string>
  readonly apply: (variant: Variant, files: Files) => Files
}

const INTERFACE = "signal_run_result_interface"
const RUN_SIGNAL_PATH = "run_signal_success_path"
const RUN_ONE_PATH = "run_one_signal_success_path"
const CACHE_RESTORE = "from_cached_observer_output"
const HELPER = "finalize_signal_result"

export const PATCHES: ReadonlyArray<PatchDefinition> = [
  {
    id: "r1_contract_and_all_sites",
    task: "shared-contract",
    summary: "Declare the field on the shared result contract and set it in every site that constructs one.",
    editedOwners: (variant) =>
      variant === "a"
        ? [
            INTERFACE,
            RUN_SIGNAL_PATH,
            "run_signal_missing_output_branch",
            RUN_ONE_PATH,
            "run_one_signal_failure_branch",
            CACHE_RESTORE,
          ]
        : [INTERFACE, HELPER, "run_signal_missing_output_branch", "run_one_signal_failure_branch", CACHE_RESTORE],
    editedFiles: () => [RUNNER, OBSERVER, OBSERVER_CACHE],
    apply: (variant, files) => addRequiredContractFieldEverywhere(variant, files),
  },
  {
    id: "r1_contract_interface_only",
    task: "shared-contract",
    summary: "Declare the field on the shared result contract and change no construction site.",
    editedOwners: () => [INTERFACE],
    editedFiles: () => [RUNNER],
    apply: (_variant, files) => addInterfaceContractField(files, false),
  },
  {
    id: "r1_optional_field_one_entry_point",
    task: "shared-contract",
    summary: "Declare the field as optional and set it at exactly one entry point.",
    editedOwners: (variant) => [INTERFACE, variant === "a" ? RUN_SIGNAL_PATH : RUN_ONE_PATH],
    editedFiles: (variant) => (variant === "a" ? [RUNNER] : [RUNNER, OBSERVER]),
    apply: (variant, files) => {
      const withContract = addInterfaceContractField(files, true)
      if (variant === "a") {
        return editRunnerLiteral("a", withContract, "contractVersion: 1,", "r1 runner optional field")
      }
      return {
        ...withContract,
        [OBSERVER]: replaceUnique(
          withContract[OBSERVER]!,
          OBSERVER,
          OBSERVER_SUCCESS_HEAD_B,
          "    const out = result.success\n    return { ...finalizeSignalResult(signal, out, factorPolicy), contractVersion: 1 }",
          "r1 observer-only optional field",
        ),
      }
    },
  },
  {
    id: "r2_observer_failure_branch_only",
    task: "caller-failure",
    summary: "Change only the observer's compute-failure branch; leave the runner's error channel alone.",
    editedOwners: () => ["run_one_signal_failure_branch"],
    editedFiles: () => [OBSERVER],
    apply: (_variant, files) => addObserverFailureData(files),
  },
  {
    id: "r2_share_failure_policy_both_entry_points",
    task: "caller-failure",
    summary: "Give both entry points the observer's failure-to-warn policy.",
    editedOwners: () => ["run_one_signal_failure_branch", RUN_SIGNAL_PATH],
    editedFiles: () => [RUNNER, OBSERVER],
    apply: (variant, files) => addRunnerFailureCatch(variant, addObserverFailureData(files)),
  },
  {
    id: "r2_no_source_change",
    task: "caller-failure",
    summary: "Change no source; rely on the observer's existing score-0 failure result.",
    editedOwners: () => [],
    editedFiles: () => [],
    apply: (_variant, files) => files,
  },
  {
    id: "r3_enforcement_rule_only",
    task: "delegated-rule",
    summary: "Change the engine-level severity rule that both entry points already delegate to.",
    editedOwners: () => ["enforce_severity_ceiling"],
    editedFiles: () => [ENFORCEMENT],
    apply: (_variant, files) => addEnforcementCategory(files),
  },
  {
    id: "r3_enforcement_plus_call_site_rechecks",
    task: "delegated-rule",
    summary: "Change the engine-level rule and duplicate it as a re-check where the ceiling is applied.",
    editedOwners: (variant) =>
      variant === "a"
        ? ["enforce_severity_ceiling", RUN_SIGNAL_PATH, RUN_ONE_PATH]
        : ["enforce_severity_ceiling", HELPER],
    editedFiles: (variant) => (variant === "a" ? [RUNNER, OBSERVER, ENFORCEMENT] : [RUNNER, ENFORCEMENT]),
    apply: (variant, files) => addCallSiteRechecks(variant, addEnforcementCategory(files)),
  },
  {
    id: "r3_call_sites_only",
    task: "delegated-rule",
    summary: "Apply the rule where the ceiling is applied without changing the engine-level rule owner.",
    editedOwners: (variant) => (variant === "a" ? [RUN_SIGNAL_PATH, RUN_ONE_PATH] : [HELPER]),
    editedFiles: (variant) => (variant === "a" ? [RUNNER, OBSERVER] : [RUNNER]),
    apply: (variant, files) => addCallSiteRechecks(variant, files),
  },
  {
    id: "r4_runner_missing_output_branch_only",
    task: "missing-output",
    summary: "Report applicability in the runner's missing-output branch; leave the observer's inactive reporting alone.",
    editedOwners: () => ["run_signal_missing_output_branch"],
    editedFiles: () => [RUNNER],
    apply: (_variant, files) => addRunnerMissingOutput(files),
  },
  {
    id: "r4_both_entry_points_report_missing_output",
    task: "missing-output",
    summary: "Report missing output at both entry points.",
    editedOwners: () => ["run_signal_missing_output_branch", RUN_ONE_PATH],
    editedFiles: () => [RUNNER, OBSERVER],
    apply: (variant, files) => addObserverMissingOutput(variant, addRunnerMissingOutput(files)),
  },
  {
    id: "r4_no_source_change",
    task: "missing-output",
    summary: "Change no source; rely on the runner's existing warn diagnostic and score 0.",
    editedOwners: () => [],
    editedFiles: () => [],
    apply: (_variant, files) => files,
  },
]

export const patchById = (id: PatchId): PatchDefinition => {
  const patch = PATCHES.find((candidate) => candidate.id === id)
  if (patch === undefined) throw new Error(`Unknown patch ${id}`)
  return patch
}

export const TASK_PATCHES: Record<TaskId, ReadonlyArray<PatchId>> = {
  "shared-contract": ["r1_contract_and_all_sites", "r1_contract_interface_only", "r1_optional_field_one_entry_point"],
  "caller-failure": [
    "r2_observer_failure_branch_only",
    "r2_share_failure_policy_both_entry_points",
    "r2_no_source_change",
  ],
  "delegated-rule": ["r3_enforcement_rule_only", "r3_enforcement_plus_call_site_rechecks", "r3_call_sites_only"],
  "missing-output": [
    "r4_runner_missing_output_branch_only",
    "r4_both_entry_points_report_missing_output",
    "r4_no_source_change",
  ],
}

export function baseFiles(root: string, variant: Variant): Files {
  const candidates = buildShapeCandidates(root)
  const extraction = variant === "a" ? candidates.extraction.a : candidates.extraction.b
  return {
    [RUNNER]: extraction[RUNNER]!,
    [OBSERVER]: extraction[OBSERVER]!,
    [ENFORCEMENT]: readFileSync(resolve(root, ENFORCEMENT), "utf8"),
    [OBSERVER_CACHE]: readFileSync(resolve(root, OBSERVER_CACHE), "utf8"),
  }
}

export function applyPatch(root: string, variant: Variant, id: PatchId): Files {
  return patchById(id).apply(variant, baseFiles(root, variant))
}
