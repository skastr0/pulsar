import { Node } from "ts-morph"
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

export const isExplicitNoopObjectMember = (fn: FnLike): boolean => {
  const object = objectLiteralParentOfFunctionMember(fn)
  if (object === undefined) return false
  const declaration = object.getParent()
  return Node.isVariableDeclaration(declaration) && hasNoopFactoryName(declaration.getName())
}

export const isFallbackLoggerNoop = (fn: FnLike): boolean => {
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

export const isUnavailableCapabilitySetterNoop = (fn: FnLike): boolean => {
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

const hasNoopFactoryName = (name: string): boolean => /(?:^|[^a-z0-9]|[a-z])no[-_]?op/i.test(name)
