import { Node, SyntaxKind } from "ts-morph"
import { getFunctionName, type TsFunctionLike as FnLike } from "./shared-function-index.js"

export const isIntentionalNoop = (filePath: string, fn: FnLike, bodyText: string): boolean => {
  if (!isEmptyBodyText(bodyText) && !isNoopImplementationFile(filePath)) {
    return false
  }

  if (isNoopImplementationFile(filePath)) {
    return true
  }

  return (
    hasBuiltinIntentionalNoopShape(fn) ||
    hasNoopName(getFunctionName(fn))
  )
}

export const isEmptyBodyText = (bodyText: string): boolean => {
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

const hasBuiltinIntentionalNoopShape = (fn: FnLike): boolean => {
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

export const propertyNameOf = (property: import("ts-morph").PropertyAssignment): string => {
  return property.getNameNode().getText().replace(/^["']|["']$/g, "")
}

const hasOnlyIgnoredParameters = (fn: FnLike): boolean => {
  const parameters = fn.getParameters()
  return parameters.length > 0 && parameters.every((parameter) => parameter.getName().startsWith("_"))
}

