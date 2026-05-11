import { Effect } from "effect"
import {
  defineProcessor,
  defineProjectModule,
  tuneTypeScriptUnsafeType,
  type TypeScriptUnsafeTypePolicyValue,
} from "@skastr0/pulsar-project-module-sdk"

const DELIBERATE_EXISTENTIAL_RULE_ID = "pulsar.deliberate-existential-boundary.v1"

export default defineProjectModule({
  id: "pulsar-self",
  version: "0.0.0",
  scope: "repository",
  processors: [
    defineProcessor({
      id: "deliberate-existential-unsafe-types",
      slot: "typescript.unsafe-type-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "deliberate-existential-unsafe-types-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isDeliberateExistentialBoundary(current.value)) return current

          return tuneTypeScriptUnsafeType(current, runtime, {
            boundary: false,
            severity: "info",
            weight: 0,
            ruleId: DELIBERATE_EXISTENTIAL_RULE_ID,
            reason:
              "Pulsar uses this unsafe type as an explicit existential boundary where TypeScript cannot express the heterogeneous Effect/Signal service set without making downstream types less accurate.",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "symbol", value: current.value.target },
              { kind: "unsafe-kind", value: current.value.kind },
            ],
            metadata: { repository: "pulsar", policy: "deliberate-existential-boundary" },
          })
        }),
    }),
  ],
})

const isDeliberateExistentialBoundary = (
  value: TypeScriptUnsafeTypePolicyValue,
): boolean =>
  deliberateExistentialRules.some((rule) =>
    value.file.endsWith(rule.file) &&
    value.kind === rule.kind &&
    value.target === rule.target,
  )

const deliberateExistentialRules: ReadonlyArray<{
  readonly file: string
  readonly kind: TypeScriptUnsafeTypePolicyValue["kind"]
  readonly target: string
}> = [
  {
    file: "packages/core/src/scoring-engine-contract.ts",
    kind: "return",
    target: "PackLayerFactory",
  },
  {
    file: "packages/core/src/scoring-engine-runtime.ts",
    kind: "return",
    target: "makeEnvLayer",
  },
  {
    file: "packages/core/src/scoring-engine-runtime.ts",
    kind: "return",
    target: "makeEnvironmentLayerFactory",
  },
  {
    file: "packages/core/src/scoring-engine-runtime.ts",
    kind: "parameter",
    target: "envLayer",
  },
  {
    file: "packages/core/src/signal.ts",
    kind: "heritage",
    target: "AnySignal",
  },
  {
    file: "packages/cli/src/runtime.ts",
    kind: "return",
    target: "scoringEngineLayer",
  },
  {
    file: "packages/cli/src/runtime.ts",
    kind: "assertion",
    target: "<expression>",
  },
  {
    file: "apps/opencode-plugin/src/server/pulsar-observer.ts",
    kind: "assertion",
    target: "<expression>",
  },
]
