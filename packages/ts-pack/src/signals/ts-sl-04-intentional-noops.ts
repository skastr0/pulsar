import { getFunctionName, type TsFunctionLike as FnLike } from "./shared-function-index.js"
import { hasBuiltinIntentionalNoopShape } from "./ts-sl-04-noop-predicates.js"
import { isEmptyBodyText } from "./ts-sl-04-noop-ast.js"

export { isEmptyBodyText, propertyNameOf } from "./ts-sl-04-noop-ast.js"

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

const isNoopImplementationFile = (filePath: string): boolean => {
  const fileName = filePath.split(/[\\/]/).at(-1) ?? filePath
  return /(?:^|[._-])noop(?:[._-]|$)/i.test(fileName)
}

const hasNoopName = (name: string): boolean => /(?:^|[^a-z0-9])no[-_]?op(?:$|[^a-z0-9]|[A-Z])/i.test(name)
