import type { Node, Project, SourceFile } from "../tsgo-api.js"
import { declarationsAt } from "../type-evidence.js"
import {
  buildOutputFromTables,
  createCouplingTables,
  ensureNestedSet,
  type CouplingTable,
  type TsDe01Output,
} from "./ts-de-01-coupling-output.js"
import {
  collectTypeReferenceLikeNodes,
  declarationKey,
} from "./shared-type-analysis.js"

export const computePreciseTypeCoupling = async (
  project: Project,
  sourceFiles: ReadonlyArray<SourceFile>,
  diagnosticLimit: number,
): Promise<TsDe01Output> => {
  const fileSet = new Set(sourceFiles.map((sourceFile) => sourceFile.fileName))
  const { outgoing, incoming } = createCouplingTables(fileSet)

  for (const sourceFile of sourceFiles) {
    await recordPreciseTypeReferences(project, sourceFile, fileSet, outgoing, incoming)
  }

  return buildOutputFromTables(fileSet, outgoing, incoming, diagnosticLimit)
}

const recordPreciseTypeReferences = async (
  project: Project,
  sourceFile: SourceFile,
  fileSet: ReadonlySet<string>,
  outgoing: CouplingTable,
  incoming: CouplingTable,
): Promise<void> => {
  const src = sourceFile.fileName
  const references = collectTypeReferenceLikeNodes(sourceFile)
  const declarationGroups = await declarationsAt(project, nameNodes(references))

  for (const declarations of declarationGroups) {
    for (const declaration of declarations) {
      const targetFile = declaration.getSourceFile().fileName
      if (!fileSet.has(targetFile) || targetFile === src) continue

      ensureNestedSet(outgoing, src, targetFile).add(declarationKey(declaration))
      ensureNestedSet(incoming, targetFile, src).add(declarationKey(declaration))
    }
  }
}

const nameNodes = (references: ReadonlyArray<Node>): ReadonlyArray<Node> =>
  references.map((reference) => {
    if ("typeName" in reference && reference.typeName !== undefined) return reference.typeName as Node
    if ("expression" in reference && reference.expression !== undefined) return reference.expression as Node
    if ("qualifier" in reference && reference.qualifier !== undefined) return reference.qualifier as Node
    if ("exprName" in reference && reference.exprName !== undefined) return reference.exprName as Node
    return reference
  })
