import { type SourceFile } from "ts-morph"
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
  resolveReferenceLikeDeclarations,
} from "./shared-type-analysis.js"

export const computePreciseTypeCoupling = (
  sourceFiles: ReadonlyArray<SourceFile>,
  diagnosticLimit: number,
): TsDe01Output => {
  const fileSet = new Set(sourceFiles.map((sourceFile) => sourceFile.getFilePath()))
  const { outgoing, incoming } = createCouplingTables(fileSet)

  for (const sourceFile of sourceFiles) {
    recordPreciseTypeReferences(sourceFile, fileSet, outgoing, incoming)
  }

  return buildOutputFromTables(fileSet, outgoing, incoming, diagnosticLimit)
}

const recordPreciseTypeReferences = (
  sourceFile: SourceFile,
  fileSet: ReadonlySet<string>,
  outgoing: CouplingTable,
  incoming: CouplingTable,
): void => {
  const src = sourceFile.getFilePath()

  for (const reference of collectTypeReferenceLikeNodes(sourceFile)) {
    for (const declaration of resolveReferenceLikeDeclarations(reference)) {
      const targetFile = declaration.getSourceFile().getFilePath()
      if (!fileSet.has(targetFile) || targetFile === src) continue

      ensureNestedSet(outgoing, src, targetFile).add(declarationKey(declaration))
      ensureNestedSet(incoming, targetFile, src).add(declarationKey(declaration))
    }
  }
}
