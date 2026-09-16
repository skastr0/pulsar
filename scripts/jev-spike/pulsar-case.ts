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

export function pulsarCase(root: string): Case {
  const sources = selections.map(([path, start, end]) => {
    const full = readFileSync(resolve(root, path), "utf8")
    const lines = full.split("\n")
    const content = lines.slice(start - 1, end).join("\n")
    return { path, start, end: Math.min(end, lines.length), content, sha256: sha256(content), fileSha256: sha256(full) }
  })
  return {
    id: "pulsar-fan-in-out",
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
        application: "Apply the supplied repository-owned policy to the current implementations. Do not infer empirical optimality of score formulas from their existence.",
      },
      code: { subject: sources[3]!, related: sources.slice(1, 3) },
      relationships: { sources: sources.slice(4, 7), unresolved: ["Transitive parser and graph implementation details beyond the supplied excerpts"] },
      contracts: { sources: sources.slice(7, 9), implementationContracts: "See exact implementations in code.subject and code.related, including both score formulas." },
      tests: { sources: sources.slice(9), execution: "Not supplied in this packet; test source is not evidence of a passing run." },
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
