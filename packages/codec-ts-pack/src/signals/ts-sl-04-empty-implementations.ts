import {
  SignalContextTag,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { Node, SyntaxKind } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  getFunctionBody,
  getFunctionLikeIndex,
  getFunctionName,
  type TsFunctionLike as FnLike,
} from "./shared-function-index.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"

export const TsSl04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  hard_gate_production: Schema.Boolean,
  include_test_stubs: Schema.Boolean,
})
export type TsSl04Config = typeof TsSl04Config.Type

type StubKind = "throw-not-implemented" | "empty-body" | "todo-comment" | "mock-return"
type StubConfidence = "high" | "medium" | "low"

export interface Stub {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly kind: StubKind
  readonly confidence: StubConfidence
  readonly penaltyWeight: number
  readonly inTestPath: boolean
  readonly message: string | undefined
}

export interface TsSl04Output {
  readonly stubs: ReadonlyArray<Stub>
  readonly byKind: ReadonlyMap<StubKind, number>
  readonly productionStubs: ReadonlyArray<Stub>
  readonly testStubs: ReadonlyArray<Stub>
  readonly totalFunctions: number
  readonly hardGateProduction: boolean
}

export const TsSl04: Signal<TsSl04Config, TsSl04Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-04",
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "framework-contract-unsupported-hooks-v1",
  configSchema: TsSl04Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/.storybook/**",
      "**/sst-env.d.ts",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "fixture/**",
      "**/fixture/**",
      "fixtures/**",
      "**/fixtures/**",
      "sample/**",
      "**/sample/**",
      "samples/**",
      "**/samples/**",
      "sdk-samples/**",
      "**/sdk-samples/**",
      "template/**",
      "**/template/**",
      "templates/**",
      "**/templates/**",
    ],
    test_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/test-helpers/**",
      "**/test-mocks/**",
      "**/test-harness/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*mock.ts",
      "**/*mock.tsx",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*mocks.ts",
      "**/*mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*harness.ts",
      "**/*harness.tsx",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.harness.ts",
      "**/*.harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/test-runtime.ts",
      "**/*test-runtime.ts",
      "**/*test-runtime.tsx",
      "**/*.test-runtime.ts",
      "**/*.test-runtime.tsx",
      "**/*test-runtime*.ts",
      "**/*test-runtime*.tsx",
      "**/happydom.ts",
    ],
    top_n_diagnostics: 20,
    hard_gate_production: true,
    include_test_stubs: false,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.try({
        try: (): TsSl04Output => {
          const stubs: Array<Stub> = []
          let totalFunctions = 0

          for (const { path, fn } of getFunctionLikeIndex(project)) {
            if (isExcluded(path, config.exclude_globs)) continue

            const isTestPath = matchesAnyGlob(path, config.test_globs)
            if (isTestPath && !config.include_test_stubs) continue

            if (!lineRangeOverlapsHunks(path, fn, context.worktreePath, context.changedHunks)) {
              continue
            }

            // Skip abstract methods — they intentionally have no body
            if (isAbstractMethod(fn)) {
              continue
            }

            totalFunctions++

            const body = getFunctionBody(fn)
            if (body === undefined) {
              continue
            }

            if (isIntentionalNoop(path, fn, body)) {
              continue
            }

            const stubKind = classifyStub(fn, body)
            if (stubKind !== undefined) {
              stubs.push(createStub(path, fn, stubKind.kind, stubKind.message, isTestPath))
            }
          }

          const byKind = new Map<StubKind, number>()
          for (const stub of stubs) {
            byKind.set(stub.kind, (byKind.get(stub.kind) ?? 0) + 1)
          }

          return {
            stubs: stubs.sort(compareStubs),
            byKind,
            productionStubs: stubs.filter((s) => !s.inTestPath),
            testStubs: stubs.filter((s) => s.inTestPath),
            totalFunctions,
            hardGateProduction: config.hard_gate_production,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-04", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    if (out.productionStubs.length === 0) return 1
    const expectedCleanBudget = Math.max(10, out.totalFunctions * 0.01)
    const weightedProductionStubs = out.productionStubs.reduce(
      (sum, stub) => sum + stub.penaltyWeight,
      0,
    )
    return Math.max(0, 1 - Math.min(1, weightedProductionStubs / expectedCleanBudget))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    const topN = out.stubs.slice(0, 20)

    for (const stub of topN) {
      const severity =
        out.hardGateProduction && !stub.inTestPath && stub.confidence === "high"
          ? ("block" as const)
          : !stub.inTestPath
            ? ("warn" as const)
          : stub.inTestPath
            ? ("info" as const)
            : ("info" as const)

      diagnostics.push({
        severity,
        message: `${stub.name}: ${stub.kind} (${stub.confidence} confidence)${stub.message ? ` — "${stub.message}"` : ""}`,
        location: { file: stub.file, line: stub.line },
        data: {
          hash: computeDiagnosticHash(`${stub.file}:${stub.line}:${stub.kind}`),
          kind: stub.kind,
          confidence: stub.confidence,
          penaltyWeight: stub.penaltyWeight,
          inTestPath: stub.inTestPath,
          message: stub.message,
        },
      })
    }

    return diagnostics
  },
}

const isAbstractMethod = (fn: FnLike): boolean => {
  return Node.isMethodDeclaration(fn) && fn.isAbstract()
}

const createStub = (
  file: string,
  fn: FnLike,
  kind: StubKind,
  message: string | undefined,
  inTestPath: boolean,
): Stub => ({
  file,
  name: getFunctionName(fn),
  line: fn.getStartLineNumber(),
  kind,
  confidence: confidenceForStubKind(kind),
  penaltyWeight: penaltyWeightForStubKind(kind),
  inTestPath,
  message,
})

const compareStubs = (a: Stub, b: Stub): number =>
  confidencePriority(a.confidence) - confidencePriority(b.confidence) ||
  b.penaltyWeight - a.penaltyWeight ||
  a.file.localeCompare(b.file) ||
  a.line - b.line

const confidencePriority = (confidence: StubConfidence): number => {
  if (confidence === "high") return 0
  if (confidence === "medium") return 1
  return 2
}

const confidenceForStubKind = (kind: StubKind): StubConfidence => {
  if (kind === "throw-not-implemented" || kind === "todo-comment") return "high"
  if (kind === "mock-return") return "medium"
  return "low"
}

const penaltyWeightForStubKind = (kind: StubKind): number => {
  if (kind === "throw-not-implemented" || kind === "todo-comment") return 1
  if (kind === "mock-return") return 0.6
  return 0.25
}

const isIntentionalNoop = (filePath: string, fn: FnLike, bodyText: string): boolean => {
  if (!isEmptyBodyText(bodyText) && !isNoopImplementationFile(filePath)) {
    return false
  }

  if (isNoopImplementationFile(filePath)) {
    return true
  }

  if (isPromiseSwallowHandler(fn)) {
    return true
  }

  if (isNeverSettlingPromiseExecutor(fn)) {
    return true
  }

  if (isEffectFallbackNoop(fn)) {
    return true
  }

  if (isReturnedNoop(fn)) {
    return true
  }

  if (isJsxEventNoop(fn)) {
    return true
  }

  if (isUiPlaceholderCallback(fn)) {
    return true
  }

  if (isEventTerminalNoop(fn)) {
    return true
  }

  if (isDisposableNoop(fn)) {
    return true
  }

  if (isFrameworkLifecycleNoop(filePath, fn)) {
    return true
  }

  if (isDeferredResolverPlaceholder(fn)) {
    return true
  }

  if (isMutablePlaceholderInitializer(fn)) {
    return true
  }

  if (isEmptyObjectMemberOnEmptyConstant(fn)) {
    return true
  }

  if (isIgnoredParameterInterfaceHook(fn)) {
    return true
  }

  if (isParameterPropertyConstructor(fn)) {
    return true
  }

  if (isProtectedHookNoop(fn)) {
    return true
  }

  if (isYargsParentCommandHandler(fn)) {
    return true
  }

  if (isInterfaceResetNoop(fn)) {
    return true
  }

  if (isObjectLifecycleNoop(fn)) {
    return true
  }

  if (isNullObjectLifecycleFallback(fn)) {
    return true
  }

  if (isIgnoredErrorHandler(fn)) {
    return true
  }

  if (isNoopFactoryObjectMember(fn)) {
    return true
  }

  if (isExplicitNoopObjectMember(fn)) {
    return true
  }

  if (isTerminalLifecycleCallback(fn)) {
    return true
  }

  if (isFallbackLoggerNoop(fn)) {
    return true
  }

  if (isFallbackCallbackInitializer(fn)) {
    return true
  }

  if (isExpressionBodyReturnedNoop(fn)) {
    return true
  }

  if (isCapabilityAbsentContractStub(fn)) {
    return true
  }

  if (isBorrowedResourceCloseNoop(fn)) {
    return true
  }

  if (isCommonEmptyContractCallback(fn)) {
    return true
  }

  if (isTimerKeepAliveNoop(fn)) {
    return true
  }

  if (isRegistrationMarkerNoop(fn)) {
    return true
  }

  if (isConditionalNoopBranch(fn)) {
    return true
  }

  if (isUnavailableCapabilitySetterNoop(fn)) {
    return true
  }

  return hasNoopName(getFunctionName(fn))
}

const isEmptyBodyText = (bodyText: string): boolean => {
  const normalized = bodyText.replace(/\s+/g, " ").trim()
  return normalized === "{}" || normalized === "{ }" || normalized === "{  }"
}

const isNoopImplementationFile = (filePath: string): boolean => {
  const fileName = filePath.split(/[\\/]/).at(-1) ?? filePath
  return /(?:^|[._-])noop(?:[._-]|$)/i.test(fileName)
}

const hasNoopName = (name: string): boolean => /(?:^|[^a-z0-9])no[-_]?op(?:$|[^a-z0-9]|[A-Z])/i.test(name)

const isPromiseSwallowHandler = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) {
    return false
  }

  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) {
    return false
  }

  const expression = parent.getExpression()
  return Node.isPropertyAccessExpression(expression) && ["catch", "finally", "then"].includes(expression.getName())
}

const isNeverSettlingPromiseExecutor = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  if (fn.getParameters().length > 0) return false
  const parent = fn.getParent()
  if (!Node.isNewExpression(parent)) return false
  return parent.getExpression().getText() === "Promise"
}

const isEffectFallbackNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return false
  const expression = parent.getExpression()
  return Node.isPropertyAccessExpression(expression) && expression.getName() === "orElseSucceed"
}

const isReturnedNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  return Node.isReturnStatement(fn.getParent())
}

const isJsxEventNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isJsxExpression(parent)) return false
  const attribute = parent.getParent()
  if (!Node.isJsxAttribute(attribute)) return false
  return /^on[A-Z]/.test(attribute.getNameNode().getText())
}

const isUiPlaceholderCallback = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return false
  const propertyName = propertyNameOf(parent)
  return [
    "onClose",
    "onDispose",
    "onDragMove",
    "onDragReset",
    "onDragStart",
    "onFlush",
    "onRedirect",
    "onSelect",
    "onSuccess",
  ].includes(propertyName)
}

const isEventTerminalNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return false
  return propertyNameOf(parent).endsWith(".ended")
}

const isDisposableNoop = (fn: FnLike): boolean => {
  if (Node.isMethodDeclaration(fn) && fn.getNameNode().getText().includes("Symbol.dispose")) {
    return true
  }
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  return Node.isPropertyAssignment(parent) && propertyNameOf(parent).includes("Symbol.dispose")
}

const isFrameworkLifecycleNoop = (filePath: string, fn: FnLike): boolean => {
  if (getFunctionName(fn) !== "deactivate") return false
  return /(?:^|[\\/])extension\.tsx?$/.test(filePath)
}

const isDeferredResolverPlaceholder = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return false
  if (!["resolve", "reject"].includes(propertyNameOf(parent))) return false
  return hasOnlyIgnoredParameters(fn)
}

const isMutablePlaceholderInitializer = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isVariableDeclaration(parent)) return false
  const declarationList = parent.getParent()
  return Node.isVariableDeclarationList(declarationList) && declarationList.getText().trimStart().startsWith("let ")
}

const isEmptyObjectMemberOnEmptyConstant = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const property = fn.getParent()
  if (!Node.isPropertyAssignment(property)) return false
  const object = property.getParent()
  if (!Node.isObjectLiteralExpression(object)) return false
  const declaration = object.getParent()
  if (!Node.isVariableDeclaration(declaration)) return false
  return /^EMPTY(?:_|[A-Z])/.test(declaration.getName())
}

const isIgnoredParameterInterfaceHook = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn) && !Node.isFunctionDeclaration(fn) && !Node.isArrowFunction(fn)) {
    return false
  }
  if (!hasOnlyIgnoredParameters(fn)) return false
  return /^(?:webSocket|on[A-Z])/.test(getFunctionName(fn))
}

const isParameterPropertyConstructor = (fn: FnLike): boolean => {
  if (!Node.isConstructorDeclaration(fn)) return false
  return fn.getParameters().some((parameter) =>
    /\b(?:public|private|protected|readonly)\b/.test(parameter.getText()),
  )
}

const isProtectedHookNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn)) return false
  const name = fn.getName()
  if (!name.startsWith("_")) return false
  if (!/\b(?:protected|private)\b/.test(fn.getText())) return false
  return fn.getParameters().every((parameter) => parameter.getName().startsWith("_"))
}

const isYargsParentCommandHandler = (fn: FnLike): boolean => {
  const parent = fn.getParent()
  let object: import("ts-morph").ObjectLiteralExpression | undefined

  if (Node.isMethodDeclaration(fn) && fn.getName() === "handler") {
    const methodParent = fn.getParent()
    if (Node.isObjectLiteralExpression(methodParent)) object = methodParent
  }

  if ((Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) && Node.isPropertyAssignment(parent)) {
    if (propertyNameOf(parent) !== "handler") return false
    const propertyParent = parent.getParent()
    if (Node.isObjectLiteralExpression(propertyParent)) object = propertyParent
  }

  if (object === undefined) return false

  return object.getProperties().some((property) => {
    if (Node.isShorthandPropertyAssignment(property)) return property.getName() === "builder"
    if (!Node.isPropertyAssignment(property)) return false
    const name = property.getNameNode().getText().replace(/^["']|["']$/g, "")
    return name === "builder"
  })
}

const isInterfaceResetNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn) || fn.getName() !== "reset") return false
  const parent = fn.getParent()
  if (!Node.isClassDeclaration(parent)) return false
  return parent.getImplements().length > 0
}

const isObjectLifecycleNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn)) return false
  if (!["remove", "dispose", "destroy", "cleanup", "stop"].includes(fn.getName())) return false
  if (!hasOnlyIgnoredParameters(fn)) return false

  const parent = fn.getParent()
  if (!Node.isObjectLiteralExpression(parent)) return false

  const siblingNames = objectMemberNames(parent)

  return ["create", "configure", "setup", "start", "target"].some((name) =>
    siblingNames.has(name),
  )
}

const isNullObjectLifecycleFallback = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  const propertyName = objectMemberNameForFunction(fn)
  if (
    ![
      "attachLifecycle",
      "detachLifecycle",
      "dispose",
      "remove",
      "cleanup",
      "stop",
      "destroy",
      "shutdown",
    ].includes(propertyName)
  ) {
    return false
  }

  const siblingNames = objectMemberNames(object)

  const hasNullObjectShape =
    siblingNames.has("emitter") ||
    siblingNames.has("app") ||
    siblingNames.has("signal") ||
    siblingNames.has("drainPending") ||
    siblingNames.has("isAvailable") ||
    siblingNames.has("available") ||
    siblingNames.has("enabled")
  if (!hasNullObjectShape) return false

  return hasFallbackAncestor(object)
}

const isIgnoredErrorHandler = (fn: FnLike): boolean => {
  const name = getFunctionName(fn)
  return /^ignore[A-Z].*Error$/.test(name)
}

const isNoopFactoryObjectMember = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  for (const ancestor of object.getAncestors()) {
    if (Node.isFunctionDeclaration(ancestor) || Node.isFunctionExpression(ancestor)) {
      return hasNoopFactoryName(ancestor.getName() ?? "")
    }
    if (Node.isArrowFunction(ancestor) || Node.isSourceFile(ancestor)) {
      return false
    }
  }

  return false
}

const hasNoopFactoryName = (name: string): boolean => /(?:^|[^a-z0-9]|[a-z])no[-_]?op/i.test(name)

const isExplicitNoopObjectMember = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  const declaration = object.getParent()
  return Node.isVariableDeclaration(declaration) && hasNoopFactoryName(declaration.getName())
}

const isTerminalLifecycleCallback = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const property = nearestPropertyAssignment(fn)
  if (property === undefined) return false
  return /^on(?=[A-Z])(?=.*(?:End|Settled|Complete|Close)$)/.test(propertyNameOf(property))
}

const isFallbackLoggerNoop = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  const loggerMethods = new Set(["debug", "trace", "info", "warn", "error"])
  const propertyName = objectMemberNameForFunction(fn)
  if (!loggerMethods.has(propertyName)) return false

  const memberNames = object.getProperties().flatMap((property) => {
    if (Node.isMethodDeclaration(property)) return [property.getName()]
    if (Node.isPropertyAssignment(property)) return [propertyNameOf(property)]
    return []
  })
  if (memberNames.length === 0 || memberNames.some((name) => !loggerMethods.has(name))) {
    return false
  }

  return hasFallbackAncestor(object)
}

const isFallbackCallbackInitializer = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const binary = fn.getAncestors().find(Node.isBinaryExpression)
  if (binary === undefined || binary.getOperatorToken().getText() !== "??") return false
  const declaration = binary.getAncestors().find(Node.isVariableDeclaration)
  if (declaration === undefined) return false
  return /^(?:log|logger|debug|trace|warn|error|noop|fallback)/i.test(declaration.getName())
}

const isExpressionBodyReturnedNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isArrowFunction(parent)) return false
  return parent.getBody() === fn
}

const isCapabilityAbsentContractStub = (fn: FnLike): boolean => {
  if (!Node.isFunctionDeclaration(fn) && !Node.isMethodDeclaration(fn)) return false
  const sourceFile = fn.getSourceFile()
  const beforeFunction = sourceFile.getFullText().slice(0, fn.getStart()).slice(-400)
  return /(?:does not expose|no .*surfaces|without .*surfaces)/i.test(beforeFunction)
}

const isBorrowedResourceCloseNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn) || fn.getName() !== "close") return false
  const classDeclaration = fn.getFirstAncestorByKind(SyntaxKind.ClassDeclaration)
  return classDeclaration?.getName()?.startsWith("Borrowed") === true
}

const isConditionalNoopBranch = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isConditionalExpression(parent)) return false
  const otherBranch =
    parent.getWhenTrue() === fn ? parent.getWhenFalse() : parent.getWhenTrue()
  return !isEmptyBodyText(otherBranch.getText())
}

const isUnavailableCapabilitySetterNoop = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  const propertyName = objectMemberNameForFunction(fn)
  if (!/^set[A-Z].*Value$/.test(propertyName)) return false

  return object.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property)) return false
    const name = propertyNameOf(property)
    const value = property.getInitializer()?.getText().trim()
    return (
      (name === "requiresCredential" && value === "false") ||
      (name === "credentialPath" && /^["']{2}$/.test(value ?? ""))
    )
  })
}

const COMMON_EMPTY_CONTRACT_CALLBACKS = new Set([
  "ack",
  "acknowledge",
  "cleanup",
  "clearSetupPromotionRuntimeModuleCache",
  "clearProviderRuntimeHookCache",
  "close",
  "dispose",
  "log",
  "markDispatchIdle",
  "markRunComplete",
  "notifyStarted",
  "onReplyStart",
  "prepareProviderDynamicModel",
  "refreshTypingTtl",
  "release",
  "sendPairingReply",
  "startTypingLoop",
  "startTypingOnText",
  "stop",
  "[Symbol.asyncIterator]",
])

const isCommonEmptyContractCallback = (fn: FnLike): boolean => {
  if (
    !Node.isArrowFunction(fn) &&
    !Node.isFunctionExpression(fn) &&
    !Node.isFunctionDeclaration(fn) &&
    !Node.isMethodDeclaration(fn)
  ) {
    return false
  }
  if (fn.getParameters().length > 0) return false
  if (Node.isMethodDeclaration(fn) && !Node.isObjectLiteralExpression(fn.getParent())) return false
  return COMMON_EMPTY_CONTRACT_CALLBACKS.has(objectMemberNameForFunction(fn))
}

const isTimerKeepAliveNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  if (fn.getParameters().length > 0) return false
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return false
  const expression = parent.getExpression().getText()
  return expression === "setInterval" || expression === "setTimeout"
}

const isRegistrationMarkerNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  if (fn.getParameters().length > 0) return false
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return false
  const firstArg = parent.getArguments()[0]
  if (firstArg !== fn) return false
  return /\.register[A-Z]/.test(parent.getExpression().getText())
}

const nearestPropertyAssignment = (
  node: Node,
): import("ts-morph").PropertyAssignment | undefined => {
  for (const ancestor of [node, ...node.getAncestors()]) {
    if (Node.isPropertyAssignment(ancestor)) return ancestor
    if (Node.isSourceFile(ancestor)) return undefined
  }
  return undefined
}

const objectLiteralParentOfFunctionMember = (
  fn: FnLike,
): import("ts-morph").ObjectLiteralExpression | undefined => {
  if (Node.isMethodDeclaration(fn)) {
    const parent = fn.getParent()
    return Node.isObjectLiteralExpression(parent) ? parent : undefined
  }

  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return undefined
  const object = parent.getParent()
  return Node.isObjectLiteralExpression(object) ? object : undefined
}

const objectMemberNameForFunction = (fn: FnLike): string => {
  if (Node.isMethodDeclaration(fn)) return fn.getName()
  const parent = fn.getParent()
  return Node.isPropertyAssignment(parent) ? propertyNameOf(parent) : getFunctionName(fn)
}

const objectMemberNames = (
  object: import("ts-morph").ObjectLiteralExpression,
): ReadonlySet<string> =>
  new Set(
    object.getProperties().flatMap((property) => {
      if (Node.isMethodDeclaration(property)) return [property.getName()]
      if (Node.isPropertyAssignment(property)) return [propertyNameOf(property)]
      if (Node.isShorthandPropertyAssignment(property)) return [property.getName()]
      return []
    }),
  )

const hasFallbackAncestor = (node: Node): boolean => {
  for (const ancestor of node.getAncestors()) {
    if (Node.isIfStatement(ancestor)) return true
    if (Node.isConditionalExpression(ancestor)) return true
    if (Node.isBinaryExpression(ancestor) && ancestor.getOperatorToken().getText() === "??") return true
    if (
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor) ||
      Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isSourceFile(ancestor)
    ) {
      return false
    }
  }
  return false
}

const propertyNameOf = (property: import("ts-morph").PropertyAssignment): string => {
  return property.getNameNode().getText().replace(/^["']|["']$/g, "")
}

const hasOnlyIgnoredParameters = (fn: FnLike): boolean => {
  const parameters = fn.getParameters()
  return parameters.length > 0 && parameters.every((parameter) => parameter.getName().startsWith("_"))
}

const classifyStub = (fn: FnLike, bodyText: string): { kind: StubKind; message: string } | undefined => {
  if (isEmptyBodyText(bodyText)) {
    return { kind: "empty-body", message: "Empty implementation" }
  }

  if (MAYBE_THROW_STUB_PATTERN.test(bodyText)) {
    const throwStubMessage = directStubThrowMessage(fn)
    if (throwStubMessage !== undefined) {
      if (isExplicitUnsupportedCapabilityMessage(throwStubMessage)) return undefined
      if (isFrameworkContractUnsupportedHook(fn, throwStubMessage)) return undefined
      const message = throwStubMessage.toLowerCase()
      if (/not\s*implemented|todo|fixme|stub/i.test(message)) {
        return { kind: "throw-not-implemented", message: throwStubMessage }
      }
    }
  }

  if (MAYBE_TODO_COMMENT_PATTERN.test(bodyText)) {
    const commentText = commentOnlyBodyText(bodyText)
    if (commentText !== undefined && /todo|fixme|xxx/i.test(commentText)) {
      return { kind: "todo-comment", message: commentText }
    }
  }

  if (!MAYBE_PLACEHOLDER_RETURN_PATTERN.test(bodyText)) return undefined

  const normalized = bodyText.replace(/\s+/g, " ").trim()
  const returnLiteralMatch = /^\{\s*return\s+(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\d+|true|false|null|undefined|\[\s*\]|\{\s*\})\s*;?\s*\}$/.exec(
    normalized,
  )
  if (returnLiteralMatch) {
    const returnedText = (returnLiteralMatch[1] ?? returnLiteralMatch[2] ?? returnLiteralMatch[3] ?? "").toLowerCase()
    if (/placeholder|mock|todo|fixme|not\s*implemented|stub/.test(returnedText)) {
      return { kind: "mock-return", message: "Returns placeholder literal" }
    }
  }

  return undefined
}

const MAYBE_THROW_STUB_PATTERN = /\bthrow\b[\s\S]*(?:not\s*implemented|todo|fixme|stub)/i
const MAYBE_TODO_COMMENT_PATTERN = /(?:\/\/|\/\*)[\s\S]*(?:todo|fixme|xxx)/i
const MAYBE_PLACEHOLDER_RETURN_PATTERN = /\breturn\b[\s\S]*(?:placeholder|mock|todo|fixme|not\s*implemented|stub)/i

const isExplicitUnsupportedCapabilityMessage = (message: string): boolean =>
  /`[^`]+`\s+on\s+.+\s+is\s+not\s+implemented\s+by\s+[^.]+\./i.test(message) ||
  /^not\s+implemented\s+on\s+.+/i.test(message)

const isFrameworkContractUnsupportedHook = (fn: FnLike, message: string): boolean => {
  if (!/^(?:function\s+)?not\s+(?:yet\s+)?implemented\.?$/i.test(message)) {
    return false
  }

  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  const memberNames = objectMemberNames(object)
  const looksLikeReactHostConfig =
    (memberNames.has("supportsMutation") ||
      memberNames.has("supportsPersistence") ||
      memberNames.has("supportsHydration")) &&
    memberNames.has("getRootHostContext") &&
    memberNames.has("createInstance")

  if (!looksLikeReactHostConfig) return false

  return REACT_HOST_CONFIG_OPTIONAL_UNSUPPORTED_HOOKS.has(objectMemberNameForFunction(fn))
}

const REACT_HOST_CONFIG_OPTIONAL_UNSUPPORTED_HOOKS = new Set([
  "cloneHiddenInstance",
  "cloneHiddenTextInstance",
  "getInstanceFromNode",
  "getInstanceFromScope",
  "prepareScopeUpdate",
])

const directStubThrowMessage = (fn: FnLike): string | undefined => {
  const body = functionBodyNode(fn)
  if (body === undefined) return undefined

  const throwStatement = body
    .getDescendantsOfKind(SyntaxKind.ThrowStatement)
    .find((statement) => nearestFunctionLikeAncestor(statement) === fn)
  if (throwStatement === undefined) return undefined

  const expression = throwStatement.getExpression()
  if (!Node.isNewExpression(expression)) return undefined
  const thrownType = expression.getExpression().getText()
  if (!["Error", "TypeError", "RangeError"].includes(thrownType)) return undefined

  const [messageArg] = expression.getArguments()
  if (
    !Node.isStringLiteral(messageArg) &&
    !Node.isNoSubstitutionTemplateLiteral(messageArg)
  ) {
    return undefined
  }

  return messageArg.getLiteralText()
}

const functionBodyNode = (fn: FnLike): Node | undefined => {
  if (Node.isArrowFunction(fn)) return fn.getBody()
  if ("getBody" in fn && typeof fn.getBody === "function") return fn.getBody()
  return undefined
}

const nearestFunctionLikeAncestor = (node: Node): FnLike | undefined =>
  node.getFirstAncestor((ancestor): ancestor is FnLike =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isMethodDeclaration(ancestor) ||
    Node.isArrowFunction(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isConstructorDeclaration(ancestor) ||
    Node.isGetAccessorDeclaration(ancestor) ||
    Node.isSetAccessorDeclaration(ancestor),
  )

const commentOnlyBodyText = (bodyText: string): string | undefined => {
  const trimmed = bodyText.trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined

  const body = trimmed.slice(1, -1)
  const comments: Array<string> = []
  const withoutBlockComments = body.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
    comments.push(comment.replace(/^\/\*+/, "").replace(/\*+\/$/, "").trim())
    return ""
  })
  const withoutLineComments = withoutBlockComments.replace(/(^|\n)\s*\/\/([^\n]*)/g, (_match, prefix, comment) => {
    comments.push(String(comment).trim())
    return prefix
  })

  if (withoutLineComments.trim().length > 0 || comments.length === 0) {
    return undefined
  }

  return comments.join(" ").replace(/\s+/g, " ").trim()
}

const lineRangeOverlapsHunks = (
  filePath: string,
  fn: FnLike,
  worktreePath: string,
  hunks: ReadonlyArray<{ file: string; oldStart: number; oldLines: number; newStart: number; newLines: number }>,
): boolean => {
  if (hunks.length === 0) return true
  const absoluteFile = filePath.startsWith(worktreePath) ? filePath : `${worktreePath}/${filePath}`
  const startLine = fn.getStartLineNumber()
  const endLine = fn.getEndLineNumber()

  for (const hunk of hunks) {
    const hunkFileAbsolute = hunk.file.startsWith(worktreePath) ? hunk.file : `${worktreePath}/${hunk.file}`
    if (hunkFileAbsolute !== absoluteFile) continue

    const hunkStart = hunk.newStart
    const hunkEnd = hunk.newStart + hunk.newLines

    if (startLine < hunkEnd && endLine >= hunkStart) {
      return true
    }
  }

  return false
}
