import { Effect } from "effect"
import {
  defineProcessor,
  defineProjectModule,
  tuneTypeScriptDependencyVersion,
  tuneTypeScriptUnsafeType,
  type TypeScriptDependencyVersionPolicyValue,
  type TypeScriptUnsafeTypePolicyValue,
} from "@skastr0/pulsar-project-module-sdk"

const DELIBERATE_EXISTENTIAL_RULE_ID = "pulsar.deliberate-existential-boundary.v1"
const OPENCODE_HOST_SDK_DUPLICATE_RULE_ID = "pulsar.opencode-host-sdk-duplicate-chain.v1"

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
    defineProcessor({
      id: "opencode-host-sdk-duplicate-versions",
      slot: "typescript.dependency-version-policy",
      role: "factor-policy",
      priority: 20,
      fingerprint: "opencode-host-sdk-duplicate-versions-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isOpencodeHostSdkDuplicate(current.value)) return current

          return tuneTypeScriptDependencyVersion(current, runtime, {
            visible: false,
            severity: "info",
            penaltyWeight: 0,
            ruleId: OPENCODE_HOST_SDK_DUPLICATE_RULE_ID,
            reason:
              "The opencode plugin workspace depends on the real opencode host SDK for boundary types; that SDK currently carries an isolated Effect 4 beta dependency chain while Pulsar itself intentionally remains on Effect 3.",
            evidence: [
              { kind: "package", value: current.value.packageName },
              { kind: "versions", value: current.value.versions.join(",") },
              { kind: "host-sdk", value: "@opencode-ai/plugin" },
            ],
            metadata: {
              repository: "pulsar",
              technology: "opencode",
              policy: "host-sdk-isolated-transitive-duplicate",
            },
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

const isOpencodeHostSdkDuplicate = (
  value: TypeScriptDependencyVersionPolicyValue,
): boolean =>
  value.evidenceKind === "transitive-lockfile-duplicate" &&
  OPENCODE_HOST_SDK_DUPLICATE_PACKAGES.has(value.packageName) &&
  value.pullInChains.some((entry) =>
    entry.chain.some((part) => part.startsWith("@opencode-ai/plugin")),
  )

const OPENCODE_HOST_SDK_DUPLICATE_PACKAGES = new Set([
  "effect",
  "fast-check",
  "pure-rand",
])
