import { Node, SyntaxKind } from "ts-morph"
import { getFunctionName, type TsFunctionLike as FnLike } from "./shared-function-index.js"
import {
  hasOnlyIgnoredParameters,
  isEmptyBodyText,
  nearestPropertyAssignment,
  objectMemberNameForFunction,
  propertyNameOf,
} from "./ts-sl-04-noop-ast.js"
import {
  isExplicitNoopObjectMember,
  isFallbackLoggerNoop,
  isNoopFactoryObjectMember,
  isNullObjectLifecycleFallback,
  isObjectLifecycleNoop,
  isUnavailableCapabilitySetterNoop,
} from "./ts-sl-04-noop-object-predicates.js"

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

const isInterfaceResetNoop = (fn: FnLike): boolean => {
  if (!Node.isMethodDeclaration(fn) || fn.getName() !== "reset") return false
  const parent = fn.getParent()
  if (!Node.isClassDeclaration(parent)) return false
  return parent.getImplements().length > 0
}

const isIgnoredErrorHandler = (fn: FnLike): boolean => {
  const name = getFunctionName(fn)
  return /^ignore[A-Z].*Error$/.test(name)
}

const isTerminalLifecycleCallback = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const property = nearestPropertyAssignment(fn)
  if (property === undefined) return false
  return /^on(?=[A-Z])(?=.*(?:End|Settled|Complete|Close)$)/.test(propertyNameOf(property))
}

const isFallbackCallbackInitializer = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const binary = fn.getAncestors().find(Node.isBinaryExpression)
  if (binary === undefined || binary.getOperatorToken().getText() !== "??") return false
  const declaration = binary.getAncestors().find(Node.isVariableDeclaration)
  if (declaration === undefined) return false
  return /^(?:log|logger|debug|trace|warn|error|noop|fallback)/i.test(declaration.getName())
}

const isConsoleMethodSilencingNoop = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false
  const parent = fn.getParent()
  if (!Node.isBinaryExpression(parent) || parent.getOperatorToken().getText() !== "=") return false
  if (parent.getRight() !== fn) return false
  const left = parent.getLeft()
  if (!Node.isPropertyAccessExpression(left)) return false
  if (left.getExpression().getText() !== "console") return false
  return ["debug", "error", "info", "log", "trace", "warn"].includes(left.getName())
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
  "releaseRetryTokens",
  "sendPairingReply",
  "startTypingLoop",
  "startTypingOnText",
  "stop",
  "unsubscribe",
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

export const hasBuiltinIntentionalNoopShape = (fn: FnLike): boolean => {
  const predicates: ReadonlyArray<(fn: FnLike) => boolean> = [
    isPromiseSwallowHandler,
    isNeverSettlingPromiseExecutor,
    isReturnedNoop,
    isJsxEventNoop,
    isUiPlaceholderCallback,
    isEventTerminalNoop,
    isDisposableNoop,
    isDeferredResolverPlaceholder,
    isMutablePlaceholderInitializer,
    isEmptyObjectMemberOnEmptyConstant,
    isIgnoredParameterInterfaceHook,
    isParameterPropertyConstructor,
    isProtectedHookNoop,
    isInterfaceResetNoop,
    isObjectLifecycleNoop,
    isNullObjectLifecycleFallback,
    isIgnoredErrorHandler,
    isNoopFactoryObjectMember,
    isExplicitNoopObjectMember,
    isTerminalLifecycleCallback,
    isFallbackLoggerNoop,
    isFallbackCallbackInitializer,
    isConsoleMethodSilencingNoop,
    isExpressionBodyReturnedNoop,
    isCapabilityAbsentContractStub,
    isBorrowedResourceCloseNoop,
    isCommonEmptyContractCallback,
    isTimerKeepAliveNoop,
    isRegistrationMarkerNoop,
    isConditionalNoopBranch,
    isUnavailableCapabilitySetterNoop,
  ]
  return predicates.some((predicate) => predicate(fn))
}
