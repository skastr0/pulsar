import { ancestors, textOf } from "../ast.js"
import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isSourceFile,
  isVariableDeclaration,
} from "../tsgo-api.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import type { TsFunctionLike as FnLike } from "./shared-function-index.js"
import {
  hasFallbackAncestor,
  hasOnlyIgnoredParameters,
  objectLiteralParentOfFunctionMember,
  objectMemberNameForFunction,
  objectMemberNames,
  propertyNameOf,
} from "./ts-sl-04-noop-ast.js"

export const isObjectLifecycleNoop = (fn: FnLike): boolean => {
  if (!isMethodDeclaration(fn)) return false
  if (!["remove", "dispose", "destroy", "cleanup", "stop"].includes(propertyNameText(fn.name))) return false
  if (!hasOnlyIgnoredParameters(fn)) return false

  const parent = fn.parent
  if (!isObjectLiteralExpression(parent)) return false

  const siblingNames = objectMemberNames(parent)

  return ["create", "configure", "setup", "start", "target"].some((name) =>
    siblingNames.has(name),
  )
}

export const isNullObjectLifecycleFallback = (fn: FnLike): boolean => {
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

export const isNoopFactoryObjectMember = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  for (const ancestor of ancestors(object)) {
    if (isFunctionDeclaration(ancestor) || isFunctionExpression(ancestor)) {
      return hasNoopFactoryName(ancestor.name === undefined ? "" : propertyNameText(ancestor.name))
    }
    if (isArrowFunction(ancestor) || isSourceFile(ancestor)) {
      return false
    }
  }

  return false
}

export const isExplicitNoopObjectMember = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  const declaration = object.parent
  return isVariableDeclaration(declaration) && hasNoopFactoryName(
    isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name),
  )
}

export const isFallbackLoggerNoop = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  const loggerMethods = new Set(["debug", "trace", "info", "warn", "error"])
  const propertyName = objectMemberNameForFunction(fn)
  if (!loggerMethods.has(propertyName)) return false

  const memberNames = object.properties.flatMap((property) => {
    if (isMethodDeclaration(property)) return [propertyNameText(property.name)]
    if (isPropertyAssignment(property)) return [propertyNameOf(property)]
    return []
  })
  if (memberNames.length === 0 || memberNames.some((name) => !loggerMethods.has(name))) {
    return false
  }

  return hasFallbackAncestor(object)
}

export const isUnavailableCapabilitySetterNoop = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false

  const propertyName = objectMemberNameForFunction(fn)
  if (!/^set[A-Z].*Value$/.test(propertyName)) return false

  return object.properties.some((property) => {
    if (!isPropertyAssignment(property)) return false
    const name = propertyNameOf(property)
    const value = property.initializer === undefined ? undefined : textOf(property.initializer).trim()
    return (
      (name === "requiresCredential" && value === "false") ||
      (name === "credentialPath" && /^["']{2}$/.test(value ?? ""))
    )
  })
}

const hasNoopFactoryName = (name: string): boolean => /(?:^|[^a-z0-9]|[a-z])no[-_]?op/i.test(name)
