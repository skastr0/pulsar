import { ancestors, firstAncestor, textOf } from "../ast.js"
import {
  SyntaxKind,
  isArrowFunction,
  isBinaryExpression,
  isCallExpression,
  isClassDeclaration,
  isConditionalExpression,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isJsxAttribute,
  isJsxExpression,
  isMethodDeclaration,
  isNewExpression,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isVariableDeclaration,
  isVariableDeclarationList,
} from "../tsgo-api.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
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
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) {
    return false
  }

  const parent = fn.parent
  if (!isCallExpression(parent)) {
    return false
  }

  const expression = parent.expression
  return isPropertyAccessExpression(expression) && ["catch", "finally", "then"].includes(propertyNameText(expression.name))
}

const isNeverSettlingPromiseExecutor = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  if (fn.parameters.length > 0) return false
  const parent = fn.parent
  if (!isNewExpression(parent)) return false
  return textOf(parent.expression) === "Promise"
}

const isReturnedNoop = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  return isReturnStatement(fn.parent)
}

const isJsxEventNoop = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  if (!isJsxExpression(parent)) return false
  const attribute = parent.parent
  if (!isJsxAttribute(attribute)) return false
  return /^on[A-Z]/.test(textOf(attribute.name))
}

const isUiPlaceholderCallback = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  if (!isPropertyAssignment(parent)) return false
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
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  if (!isPropertyAssignment(parent)) return false
  return propertyNameOf(parent).endsWith(".ended")
}

const isDisposableNoop = (fn: FnLike): boolean => {
  if (isMethodDeclaration(fn) && textOf(fn.name).includes("Symbol.dispose")) {
    return true
  }
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  return isPropertyAssignment(parent) && propertyNameOf(parent).includes("Symbol.dispose")
}

const isDeferredResolverPlaceholder = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  if (!isPropertyAssignment(parent)) return false
  if (!["resolve", "reject"].includes(propertyNameOf(parent))) return false
  return hasOnlyIgnoredParameters(fn)
}

const isMutablePlaceholderInitializer = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  if (!isVariableDeclaration(parent)) return false
  const declarationList = parent.parent
  return isVariableDeclarationList(declarationList) && declarationList.flags !== undefined && textOf(declarationList).trimStart().startsWith("let ")
}

const isEmptyObjectMemberOnEmptyConstant = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const property = fn.parent
  if (!isPropertyAssignment(property)) return false
  const object = property.parent
  if (!isObjectLiteralExpression(object)) return false
  const declaration = object.parent
  if (!isVariableDeclaration(declaration)) return false
  return /^EMPTY(?:_|[A-Z])/.test(variableName(declaration))
}

const isIgnoredParameterInterfaceHook = (fn: FnLike): boolean => {
  if (!isMethodDeclaration(fn) && !isFunctionDeclaration(fn) && !isArrowFunction(fn)) {
    return false
  }
  if (!hasOnlyIgnoredParameters(fn)) return false
  return /^(?:webSocket|on[A-Z])/.test(getFunctionName(fn))
}

const isParameterPropertyConstructor = (fn: FnLike): boolean => {
  if (!isConstructorDeclaration(fn)) return false
  return fn.parameters.some((parameter) =>
    /\b(?:public|private|protected|readonly)\b/.test(textOf(parameter)),
  )
}

const isProtectedHookNoop = (fn: FnLike): boolean => {
  if (!isMethodDeclaration(fn)) return false
  const name = propertyNameText(fn.name)
  if (!name.startsWith("_")) return false
  if (!/\b(?:protected|private)\b/.test(textOf(fn))) return false
  return fn.parameters.every((parameter) => parameterName(parameter).startsWith("_"))
}

const isInterfaceResetNoop = (fn: FnLike): boolean => {
  if (!isMethodDeclaration(fn) || propertyNameText(fn.name) !== "reset") return false
  const parent = fn.parent
  if (!isClassDeclaration(parent)) return false
  return (parent.heritageClauses ?? []).some((clause) => clause.token === SyntaxKind.ImplementsKeyword)
}

const isIgnoredErrorHandler = (fn: FnLike): boolean => {
  const name = getFunctionName(fn)
  return /^ignore[A-Z].*Error$/.test(name)
}

const isTerminalLifecycleCallback = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const property = nearestPropertyAssignment(fn)
  if (property === undefined) return false
  return /^on(?=[A-Z])(?=.*(?:End|Settled|Complete|Close)$)/.test(propertyNameOf(property))
}

const isFallbackCallbackInitializer = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const binary = ancestors(fn).find(isBinaryExpression)
  if (binary === undefined || operatorText(binary) !== "??") return false
  const declaration = ancestors(binary).find(isVariableDeclaration)
  if (declaration === undefined) return false
  return /^(?:log|logger|debug|trace|warn|error|noop|fallback)/i.test(variableName(declaration))
}

const isConsoleMethodSilencingNoop = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  if (!isBinaryExpression(parent) || operatorText(parent) !== "=") return false
  if (parent.right !== fn) return false
  const left = parent.left
  if (!isPropertyAccessExpression(left)) return false
  if (textOf(left.expression) !== "console") return false
  return ["debug", "error", "info", "log", "trace", "warn"].includes(propertyNameText(left.name))
}

const isExpressionBodyReturnedNoop = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  if (!isArrowFunction(parent)) return false
  return parent.body === fn
}

const isCapabilityAbsentContractStub = (fn: FnLike): boolean => {
  if (!isFunctionDeclaration(fn) && !isMethodDeclaration(fn)) return false
  const sourceFile = fn.getSourceFile()
  const beforeFunction = sourceFile.text.slice(0, fn.getStart(sourceFile)).slice(-400)
  return /(?:does not expose|no .*surfaces|without .*surfaces)/i.test(beforeFunction)
}

const isBorrowedResourceCloseNoop = (fn: FnLike): boolean => {
  if (!isMethodDeclaration(fn) || propertyNameText(fn.name) !== "close") return false
  const classDeclaration = firstAncestor(fn, isClassDeclaration)
  return classDeclaration !== undefined && classDeclaration.name !== undefined && classDeclaration.name.text.startsWith("Borrowed")
}

const isConditionalNoopBranch = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  const parent = fn.parent
  if (!isConditionalExpression(parent)) return false
  const otherBranch =
    parent.whenTrue === fn ? parent.whenFalse : parent.whenTrue
  return !isEmptyBodyText(textOf(otherBranch))
}

const COMMON_EMPTY_CONTRACT_CALLBACKS = new Set([
  "ack",
  "acknowledge",
  "cleanup",
  "close",
  "dispose",
  "log",
  "notifyStarted",
  "release",
  "stop",
  "unsubscribe",
  "[Symbol.asyncIterator]",
])

const isCommonEmptyContractCallback = (fn: FnLike): boolean => {
  if (
    !isArrowFunction(fn) &&
    !isFunctionExpression(fn) &&
    !isFunctionDeclaration(fn) &&
    !isMethodDeclaration(fn)
  ) {
    return false
  }
  if (fn.parameters.length > 0) return false
  if (isMethodDeclaration(fn) && !isObjectLiteralExpression(fn.parent)) return false
  return COMMON_EMPTY_CONTRACT_CALLBACKS.has(objectMemberNameForFunction(fn))
}

const isTimerKeepAliveNoop = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  if (fn.parameters.length > 0) return false
  const parent = fn.parent
  if (!isCallExpression(parent)) return false
  const expression = textOf(parent.expression)
  return expression === "setInterval" || expression === "setTimeout"
}

const isRegistrationMarkerNoop = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false
  if (fn.parameters.length > 0) return false
  const parent = fn.parent
  if (!isCallExpression(parent)) return false
  const firstArg = parent.arguments[0]
  if (firstArg !== fn) return false
  return /\.register[A-Z]/.test(textOf(parent.expression))
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

const parameterName = (parameter: import("../tsgo-api.js").ParameterDeclaration): string =>
  isIdentifier(parameter.name) ? parameter.name.text : textOf(parameter.name)

const variableName = (declaration: import("../tsgo-api.js").VariableDeclaration): string =>
  isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name)

const operatorText = (node: import("../tsgo-api.js").BinaryExpression): string =>
  textOf(node.operatorToken)
