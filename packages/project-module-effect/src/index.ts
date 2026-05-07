import { Effect } from "effect"
import {
  classifyTypeScriptNoop,
  defineProcessor,
  defineProjectModule,
  type TypeScriptNoopClassificationValue,
} from "@skastr0/pulsar-project-module-sdk"

export const EFFECT_PROJECT_MODULE_ID = "@skastr0/pulsar-project-module-effect" as const
export const EFFECT_OR_ELSE_SUCCEED_NOOP_RULE_ID = "effect.orElseSucceed.fallback-noop.v1" as const

export const effectProjectModule = defineProjectModule({
  id: EFFECT_PROJECT_MODULE_ID,
  version: "0.0.0",
  scope: "technology",
  source: "package",
  processors: [
    defineProcessor({
      id: "effect-or-else-succeed-noops",
      slot: "typescript.noop-classifier",
      role: "normalizer",
      priority: 20,
      fingerprint: "effect-or-else-succeed-noops-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isEffectOrElseSucceedNoopCandidate(current.value)) return current
          return classifyTypeScriptNoop(current, runtime, {
            classification: "intentional_noop",
            confidence: "high",
            ruleId: EFFECT_OR_ELSE_SUCCEED_NOOP_RULE_ID,
            reason: "Effect.orElseSucceed fallback callback intentionally swallows the error path",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "symbol", value: current.value.name },
            ],
            metadata: { technology: "effect" },
          })
        }),
    }),
  ],
})

export const isEffectOrElseSucceedNoopCandidate = (
  value: TypeScriptNoopClassificationValue,
): boolean => {
  if (value.classification === "intentional_noop") return false
  if (!isEmptyFunctionText(value.functionText)) return false
  return /(?:^|[.\s])orElseSucceed\s*\(/.test(value.parentText ?? "")
}

const isEmptyFunctionText = (text: string | undefined): boolean => {
  if (text === undefined) return false
  return /^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}$/.test(text.trim()) ||
    /^function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{\s*\}$/.test(text.trim())
}

export default effectProjectModule
