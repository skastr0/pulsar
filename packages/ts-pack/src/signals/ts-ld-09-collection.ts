import { collectLocalExportedNames } from "./ts-ld-07-boundary.js"
import { type SourceFile, ts } from "./ts-ld-09-ast.js"
import { collectEffectOpacity } from "./ts-ld-09-effect-opacity.js"
import {
  collectOpaquePromiseApi,
  collectPromiseCatchCollapse,
} from "./ts-ld-09-promise-opacity.js"
import {
  collectBroadThrow,
  collectCatchCollapse,
} from "./ts-ld-09-throw-catch.js"
import type {
  LocalErrorChannelFinding,
  TsLd09Config,
} from "./ts-ld-09-types.js"

export const collectErrorChannelOpacityFindings = (
  sourceFile: SourceFile,
  config: TsLd09Config,
): ReadonlyArray<LocalErrorChannelFinding> => {
  const compilerSourceFile = sourceFile.compilerNode
  const typeChecker = sourceFile.getProject().getTypeChecker().compilerObject
  const exportedNames = collectLocalExportedNames(compilerSourceFile)
  const findings: Array<LocalErrorChannelFinding> = []

  const visit = (node: ts.Node): void => {
    const finding =
      collectBroadThrow(node, compilerSourceFile, exportedNames) ??
      collectCatchCollapse(node, compilerSourceFile, exportedNames) ??
      collectOpaquePromiseApi(node, compilerSourceFile, exportedNames, config, typeChecker) ??
      collectEffectOpacity(node, compilerSourceFile, exportedNames, config, typeChecker) ??
      collectPromiseCatchCollapse(node, compilerSourceFile, exportedNames, typeChecker)

    if (finding !== undefined) findings.push(finding)
    ts.forEachChild(node, visit)
  }

  visit(compilerSourceFile)
  return findings
}
