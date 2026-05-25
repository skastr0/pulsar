import { Effect } from "effect"
import {
  classifyTypeScriptNoop,
  defineProcessor,
  defineProjectModule,
  nameTypeScriptCallbackContext,
  type TypeScriptCallbackContextNameValue,
  type TypeScriptNoopClassificationValue,
} from "@skastr0/pulsar-project-module-sdk"

export const EFFECT_PROJECT_MODULE_ID = "@skastr0/pulsar-project-module-effect" as const
export const EFFECT_TECHNOLOGY_PACK_ID = "@skastr0/pulsar-effect-pack" as const
export const EFFECT_OR_ELSE_SUCCEED_NOOP_RULE_ID = "effect.orElseSucceed.fallback-noop.v1" as const
export const EFFECT_CALLBACK_CONTEXT_NAME_RULE_ID = "effect.callback-context-name.v1" as const
export const EFFECT_SERVER_REACTIVE_CONTRACT_NOOP_RULE_ID = "effect.server-reactive.contract-noop.v1" as const
export const EFFECT_PROTOTYPE_FACTORY_NOOP_RULE_ID = "effect.prototype-factory.noop.v1" as const

export interface TechnologyPackSignalDescriptor {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly enforcementCeiling: ReadonlyArray<string>
  readonly activationEvidence: ReadonlyArray<string>
}

export const effectPackSignals: ReadonlyArray<TechnologyPackSignalDescriptor> = [
  {
    id: "EFFECT-TS-01-effect-gen-yield-shape",
    title: "Effect.gen yield shape",
    category: "behavior-preservation",
    enforcementCeiling: ["review-route"],
    activationEvidence: ["package dependency: effect", "source import: effect/Effect"],
  },
]

export const effectProjectModule = defineProjectModule({
  id: EFFECT_PROJECT_MODULE_ID,
  version: "0.1.1",
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
    defineProcessor({
      id: "effect-server-reactive-contract-noops",
      slot: "typescript.noop-classifier",
      role: "normalizer",
      priority: 20,
      fingerprint: "effect-server-reactive-contract-noops-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isEffectServerReactiveContractNoopCandidate(current.value)) return current
          return classifyTypeScriptNoop(current, runtime, {
            classification: "intentional_noop",
            confidence: "high",
            ruleId: EFFECT_SERVER_REACTIVE_CONTRACT_NOOP_RULE_ID,
            reason: "Effect server reactive contract exposes intentionally empty server-side lifecycle hooks",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "symbol", value: current.value.name },
            ],
            metadata: { technology: "effect", framework: "server-reactive" },
          })
        }),
    }),
    defineProcessor({
      id: "effect-prototype-factory-noops",
      slot: "typescript.noop-classifier",
      role: "normalizer",
      priority: 20,
      fingerprint: "effect-prototype-factory-noops-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          if (!isEffectPrototypeFactoryNoopCandidate(current.value)) return current
          return classifyTypeScriptNoop(current, runtime, {
            classification: "intentional_noop",
            confidence: "high",
            ruleId: EFFECT_PROTOTYPE_FACTORY_NOOP_RULE_ID,
            reason: "Effect prototype factory declares an empty callable shell and attaches runtime behavior immediately afterward",
            evidence: [
              { kind: "path", value: current.value.file },
              { kind: "symbol", value: current.value.name },
            ],
            metadata: { technology: "effect", pattern: "prototype-factory" },
          })
        }),
    }),
    defineProcessor({
      id: "effect-callback-context-names",
      slot: "typescript.callback-context-namer",
      role: "enricher",
      priority: 20,
      fingerprint: "effect-callback-context-names-v1",
      process: (current, _context, runtime) =>
        Effect.sync(() => {
          const resolvedName = resolveEffectCallbackContextName(current.value)
          if (resolvedName === undefined || resolvedName === current.value.resolvedName) {
            return current
          }

          return nameTypeScriptCallbackContext(current, runtime, {
            resolvedName,
            confidence: "high",
            ruleId: EFFECT_CALLBACK_CONTEXT_NAME_RULE_ID,
            reason: "Effect callback context provides a more precise operation name",
            evidence: effectCallbackContextEvidence(current.value),
            metadata: { technology: "effect" },
          })
        }),
    }),
  ],
})

export const effectTechnologyPack = {
  id: EFFECT_TECHNOLOGY_PACK_ID,
  projectModule: effectProjectModule,
  signals: effectPackSignals,
} as const

export const isEffectOrElseSucceedNoopCandidate = (
  value: TypeScriptNoopClassificationValue,
): boolean => {
  if (value.classification === "intentional_noop") return false
  if (!isEmptyFunctionText(value.functionText)) return false
  return /(?:^|[.\s])orElseSucceed\s*\(/.test(value.parentText ?? "")
}

export const isEffectServerReactiveContractNoopCandidate = (
  value: TypeScriptNoopClassificationValue,
): boolean => {
  if (value.classification === "intentional_noop") return false
  if (!isEmptyNoopValue(value)) return false

  const file = value.file.replace(/\\/g, "/")
  if (/(?:^|\/)server\/reactive\.tsx?$/.test(file)) {
    return SERVER_REACTIVE_EMPTY_CONTRACT_NAMES.has(value.name)
  }
  if (/(?:^|\/)server\/rendering\.tsx?$/.test(file)) {
    return SERVER_RENDERING_EMPTY_CONTRACT_NAMES.has(value.name)
  }
  return false
}

export const isEffectPrototypeFactoryNoopCandidate = (
  value: TypeScriptNoopClassificationValue,
): boolean => {
  if (value.classification === "intentional_noop") return false
  if (!isEmptyNoopValue(value)) return false

  if (isAnonymousObjectAssignPrototypeShell(value)) return true

  const name = escapedRegExp(value.name)
  const parentText = value.parentText ?? ""
  if (name === undefined || parentText.length === 0) return false

  return [
    new RegExp(`Object\\.setPrototypeOf\\s*\\(\\s*${name}\\s*,`),
    new RegExp(`${name}\\.prototype\\s*=`),
    new RegExp(`Object\\.defineProperty\\s*\\(\\s*${name}\\s*,`),
    new RegExp(`Object\\.assign\\s*\\(\\s*${name}\\s*,`),
    new RegExp(`${name}\\s*\\[[^\\]]+\\]\\s*=`),
    new RegExp(`${name}\\.[A-Za-z_$][\\w$]*\\s*=`),
  ].some((pattern) => pattern.test(parentText))
}

const isAnonymousObjectAssignPrototypeShell = (
  value: TypeScriptNoopClassificationValue,
): boolean => {
  const text = value.parentText ?? ""
  if (!/Object\.assign\s*\(\s*function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{\s*\}\s*,/.test(text)) {
    return false
  }
  return /,\s*(?:Proto|Prototype|[A-Za-z_$][\w$]*Proto|[A-Za-z_$][\w$]*Prototype)\b/.test(text) ||
    /,\s*\{[^}]*[A-Za-z_$][\w$]*\s*[:=]/s.test(text)
}

const isEmptyFunctionText = (text: string | undefined): boolean => {
  if (text === undefined) return false
  return /^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}$/.test(text.trim()) ||
    /^function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{\s*\}$/.test(text.trim())
}

const isEmptyNoopValue = (value: TypeScriptNoopClassificationValue): boolean =>
  /^\{\s*\}$/.test((value.bodyText ?? "").trim()) || isEmptyFunctionText(value.functionText)

const escapedRegExp = (value: string): string | undefined => {
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) return undefined
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const SERVER_REACTIVE_EMPTY_CONTRACT_NAMES = new Set([
  "cancelCallback",
  "createEffect",
  "enableExternalSource",
  "fn",
  "onMount",
])

const SERVER_RENDERING_EMPTY_CONTRACT_NAMES = new Set([
  "enableHydration",
  "enableScheduling",
  "f callback",
  "resetErrorBoundaries",
])

export const resolveEffectCallbackContextName = (
  value: TypeScriptCallbackContextNameValue,
): string | undefined => {
  const metadata = value.metadata ?? {}
  const label = nonEmptyString(metadata.effectFnLabel)
  if (label !== undefined) return label

  const calleeText = nonEmptyString(metadata.calleeText)
  if (calleeText === undefined || !isEffectCallee(calleeText)) return undefined

  const ownerName = nonEmptyString(metadata.ownerName)
  const propertyName = nonEmptyString(metadata.propertyName)
  const argumentRole = effectArgumentRole(calleeText, numericMetadata(metadata.argumentIndex))

  const tail = [normalizedEffectCallee(calleeText), propertyName ?? argumentRole]
    .filter((part): part is string => part !== undefined)
    .join("/")

  if (tail.length === 0) return undefined
  return ownerName === undefined ? tail : `${ownerName}/${tail}`
}

const effectCallbackContextEvidence = (
  value: TypeScriptCallbackContextNameValue,
) => {
  const evidence = [
    { kind: "path", value: value.file },
    { kind: "line", value: String(value.line) },
  ]
  const calleeText = nonEmptyString(value.metadata?.calleeText)
  if (calleeText !== undefined) {
    evidence.push({ kind: "symbol", value: calleeText })
  }
  const label = nonEmptyString(value.metadata?.effectFnLabel)
  if (label !== undefined) {
    evidence.push({ kind: "symbol", value: label })
  }
  return evidence
}

const EFFECT_CALLEE_NAMES = new Set([
  "Effect.acquireUseRelease",
  "Effect.all",
  "Effect.async",
  "Effect.fn",
  "Effect.forEach",
  "Effect.gen",
  "Effect.promise",
  "Effect.sync",
  "Effect.try",
  "Effect.tryPromise",
  "Layer.effect",
  "Layer.scoped",
  "Layer.sync",
])

const isEffectCallee = (calleeText: string): boolean =>
  EFFECT_CALLEE_NAMES.has(normalizedEffectCallee(calleeText))

const normalizedEffectCallee = (calleeText: string): string =>
  calleeText.replace(/\s+/g, "")

const effectArgumentRole = (
  calleeText: string,
  argumentIndex: number | undefined,
): string | undefined => {
  const callee = normalizedEffectCallee(calleeText)
  if (callee === "Effect.forEach" && argumentIndex === 1) return "each"
  if (callee === "Effect.acquireUseRelease") {
    if (argumentIndex === 0) return "acquire"
    if (argumentIndex === 1) return "use"
    if (argumentIndex === 2) return "release"
  }
  if (callee === "Effect.async" || callee === "Effect.promise") return "register"
  return undefined
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined

const numericMetadata = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined

export default effectProjectModule
