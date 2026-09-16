import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { sha256, type Case } from "./model.ts"

// Explicit egress allowlist. No recursive repository walk, home files, or environment values.
const selections: ReadonlyArray<readonly [string, number, number]> = [
  ["AGENTS.md", 1, 130],
  ["packages/ts-pack/src/signals/ts-de-02-fan-in-out.ts", 1, 1000],
  ["packages/rs-pack/src/signals/rs-de-04-fan-in-fan-out.ts", 1, 1000],
  ["packages/rs-pack/src/signals/rs-de-04-analysis.ts", 1, 1000],
  ["packages/ts-pack/src/graph/module-graph.ts", 1, 100],
  ["packages/ts-pack/src/pack.ts", 1, 90],
  ["packages/rs-pack/src/pack.ts", 1, 85],
  ["packages/ts-pack/src/__tests__/signal-contracts.ts", 292, 313],
  ["packages/rs-pack/src/__tests__/signal-contracts.ts", 169, 192],
  ["packages/ts-pack/src/__tests__/ts-de-02.test.ts", 230, 286],
  ["packages/rs-pack/src/__tests__/rs-de-signals.test.ts", 2947, 3040],
]

export function pulsarCase(root: string, includeSelfCalibration = false): Case {
  const selected = includeSelfCalibration ? [...selections,
    [".pulsar/project-modules.json", 1, 100] as const,
    [".pulsar/modules/pulsar-self.ts", 151, 180] as const,
    [".pulsar/modules/pulsar-self.ts", 448, 604] as const,
  ] : selections
  const sources = selected.map(([path, start, end]) => {
    const full = readFileSync(resolve(root, path), "utf8")
    const lines = full.split("\n")
    const content = lines.slice(start - 1, end).join("\n")
    return { path, start, end: Math.min(end, lines.length), content, sha256: sha256(content), fileSha256: sha256(full) }
  })
  return {
    id: includeSelfCalibration ? "pulsar-fan-in-out-with-self-calibration" : "pulsar-fan-in-out",
    lineage: "pulsar-fan-in-out",
    questionIds: ["JQ-04", "JQ-08", "JQ-10", "JQ-16"],
    proposedExpectations: {},
    state: {
      focus: {
        subject: "TypeScript TS-DE-02 and Rust RS-DE-04 fan-in/out signals and the existing Rust analysis helper",
        criterion: "Whether the existing separate language-specific signal implementations represent coherent responsibilities, and whether their similar hub detection establishes a common scoring rule.",
      },
      policy: {
        source: sources[0]!,
        ...(includeSelfCalibration ? { selfCalibration: sources.slice(11) } : {}),
        application: "Apply the supplied repository-owned policy to the current implementations. Do not infer empirical optimality of score formulas from their existence.",
      },
      code: { subject: sources[3]!, related: sources.slice(1, 3) },
      relationships: { sources: sources.slice(4, 7), unresolved: ["Transitive parser and graph implementation details beyond the supplied excerpts"] },
      contracts: { sources: sources.slice(7, 9), implementationContracts: "See exact implementations in code.subject and code.related, including both score formulas." },
      tests: { sources: sources.slice(9, 11), execution: "Not supplied in this packet; test source is not evidence of a passing run." },
      context_manifest: {
        included: sources.map(({ content: _, ...reference }) => reference),
        missing: [],
        omitted: ["Full transitive dependency implementations", "Change history", "Empirical justification of numerical scoring constants"],
        selection: "Explicit reviewed source allowlist v1. Scope is current separation of responsibilities, not full behavioral correctness or score validity.",
        dataClass: "Public Pulsar source; repository owner authorized evaluation.",
      },
    },
  }
}

export function pulsarRegressionCase(root: string): Case {
  const tsPath = "packages/ts-pack/src/signals/ts-de-02-fan-in-out.ts"
  const rsPath = "packages/rs-pack/src/signals/rs-de-04-fan-in-fan-out.ts"
  const ts = readFileSync(resolve(root, tsPath), "utf8")
  const rs = readFileSync(resolve(root, rsPath), "utf8")
  const scoreSlice = (source: string) => {
    const start = source.indexOf("  score: (out) => {")
    const end = source.indexOf("  diagnose:", start)
    if (start < 0 || end < 0) throw new Error("Score source selection changed")
    return source.slice(start, end).trim().replace(/,$/, "")
  }
  const before = scoreSlice(rs)
  const after = scoreSlice(ts).replaceAll("out.totalModules", "out.moduleCount").replaceAll("out.hubs.length", "out.hubCount")
  const testPath = "packages/rs-pack/src/__tests__/rs-de-signals.test.ts"
  const test = readFileSync(resolve(root, testPath), "utf8").split("\n").slice(2946, 2994).join("\n")
  return {
    id: "pulsar-score-unification-regression", lineage: "pulsar-fan-in-out",
    questionIds: ["JQ-15", "JQ-17", "JQ-18"], proposedExpectations: {},
    state: {
      focus: {
        subject: "Replace RS-DE-04 score with the TS-DE-02 hub-share scoring formula, adapting field names",
        criterion: "Preserve the existing RS-DE-04 numerical scoring behavior during a deduplication refactor",
        obligation: "For the existing 14-module Rust fixture with 7 resolved uses, one hub and totalHubPressure=3, score remains approximately 0.8357142857, as asserted by the supplied repository test.",
        candidate: "b",
      },
      policy: {
        scope: "Experimental behavior-preserving refactor; not a new repository scoring policy",
        minimum: "A refactor must preserve the current numerical outputs required by existing tests. Reducing duplication or using the other language's formula does not authorize score semantics changes.",
        source: { path: "AGENTS.md", content: readFileSync(resolve(root, "AGENTS.md"), "utf8") },
      },
      code: {
        before: { path: rsPath, symbol: "RsDe04.score", content: before, sha256: sha256(before), fileSha256: sha256(rs) },
        after: { path: rsPath, symbol: "RsDe04.score", content: after, sha256: sha256(after), origin: "Proposed uncommitted candidate copied from TS-DE-02, field names adapted. Not applied to production." },
      },
      alternatives: {
        a: { content: before, status: "Current Rust implementation; no change" },
        b: { content: after, status: "Proposed reuse of TypeScript score formula" },
      },
      contracts: { scoreInput: { moduleCount: 14, resolvedUseCount: 7, hubCount: 1, totalHubPressure: 3 }, scope: "The score function only. Graph construction and diagnostics remain unchanged." },
      tests: { path: testPath, start: 2947, end: 2994, content: test, sha256: sha256(test), execution: "Source only; execution evidence not supplied." },
      context_manifest: { missing: [], omitted: ["Graph construction: unchanged and out of scope"], dataClass: "Owner-authorized public source and explicitly hypothetical patch", source: { path: tsPath, sha256: sha256(ts) } },
    },
  }
}
