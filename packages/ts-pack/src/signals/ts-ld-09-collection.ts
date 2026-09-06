import type { Project, SourceFile } from "../tsgo-api.js"
import { collectLocalExportedNames } from "./ts-ld-07-boundary.js"
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

export const collectErrorChannelOpacityFindings = async (
  sourceFile: SourceFile,
  project: Project,
  config: TsLd09Config,
): Promise<ReadonlyArray<LocalErrorChannelFinding>> => {
  const exportedNames = collectLocalExportedNames(sourceFile)
  const findings: Array<LocalErrorChannelFinding> = []

  const visit = async (node: import("../tsgo-api.js").Node): Promise<void> => {
    const finding =
      collectBroadThrow(node, sourceFile, exportedNames) ??
      collectCatchCollapse(node, sourceFile, exportedNames) ??
      await collectOpaquePromiseApi(node, sourceFile, exportedNames, config, project) ??
      collectEffectOpacity(node, sourceFile, exportedNames, config, project) ??
      await collectPromiseCatchCollapse(node, sourceFile, exportedNames, project)

    if (finding !== undefined) findings.push(finding)
    const children: Array<import("../tsgo-api.js").Node> = []
    node.forEachChild((child) => {
      children.push(child)
    })
    for (const child of children) {
      await visit(child)
    }
  }

  await visit(sourceFile)
  return findings
}
