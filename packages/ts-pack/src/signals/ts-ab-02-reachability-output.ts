import { Node } from "ts-morph"
import type { TypeScriptExportReachabilityValue } from "@skastr0/pulsar-core/calibration"
import {
  countSameFileReferences,
  type ExportConsumer,
} from "./shared-export-analysis.js"
import { boundaryOfFile, type BoundaryRule } from "./shared-workspace.js"
import type { ExportBinding } from "./ts-ab-02-reachability-analysis.js"

export type ExportClassification =
  | "unused"
  | "internal-only"
  | "cross-module"
  | "cross-package"
  | "framework-consumed"
type ExportEvidence = "runtime" | "type-only" | "test-hook"

export interface ExportReachability {
  readonly exportFile: string
  readonly exportName: string
  readonly declarationFiles: ReadonlyArray<string>
  readonly classification: ExportClassification
  readonly evidence: ExportEvidence
  readonly penaltyWeight: number
  readonly viaReExport: boolean
  readonly referenceFiles: ReadonlyArray<string>
  readonly sameFileReferenceCount: number
  readonly boundaryStatus: "cross-boundary" | "same-boundary" | "unmapped"
  readonly crossBoundaryFiles: ReadonlyArray<string>
  readonly frameworkConsumer?: NonNullable<TypeScriptExportReachabilityValue["frameworkConsumer"]>
}

export const classifyExportReachability = (
  binding: ExportBinding,
  consumers: ReadonlyArray<ExportConsumer>,
  ownPackage: string | undefined,
  boundaryRules: ReadonlyArray<BoundaryRule>,
  reachability: TypeScriptExportReachabilityValue,
): ExportReachability => {
  const isPublicEntrypoint = reachability.isPublicEntrypoint
  const frameworkConsumer = reachability.frameworkConsumer
  const referenceFiles = consumers
    .map((consumer) => consumer.consumerFile)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right))

  const crossPackage = consumers.some(
    (consumer) =>
      consumer.consumerPackage !== undefined &&
      ownPackage !== undefined &&
      consumer.consumerPackage !== ownPackage,
  )

  const sameFileReferences =
    isPublicEntrypoint || frameworkConsumer !== undefined || referenceFiles.length > 0
      ? 0
      : countSameFileReferences(binding)

  const classification: ExportClassification =
    frameworkConsumer !== undefined
      ? "framework-consumed"
      : isPublicEntrypoint
      ? "cross-package"
      : referenceFiles.length > 0
      ? crossPackage
        ? "cross-package"
        : "cross-module"
      : sameFileReferences > 0
        ? "internal-only"
        : "unused"

  const exportBoundary = boundaryOfFile(binding.exportFile, boundaryRules)
  const crossBoundaryFiles = referenceFiles.filter((file) => {
    const consumerBoundary = boundaryOfFile(file, boundaryRules)
    return exportBoundary !== undefined && consumerBoundary !== undefined && consumerBoundary !== exportBoundary
  })

  const evidence = exportEvidence(binding)

  return {
    exportFile: binding.exportFile,
    exportName: binding.exportName,
    declarationFiles: binding.declarationFiles,
    classification,
    evidence,
    penaltyWeight: evidencePenaltyWeight(evidence),
    viaReExport: binding.viaReExport,
    referenceFiles,
    sameFileReferenceCount: sameFileReferences,
    boundaryStatus:
      exportBoundary === undefined
        ? "unmapped"
        : crossBoundaryFiles.length > 0
          ? "cross-boundary"
          : "same-boundary",
    crossBoundaryFiles,
    ...(frameworkConsumer !== undefined ? { frameworkConsumer } : {}),
  }
}

export const reachabilityPenalty = (entry: ExportReachability): number => {
  if (entry.classification === "unused") return entry.penaltyWeight
  if (entry.classification === "internal-only") return entry.penaltyWeight * 0.5
  return 0
}

export const compareReachability = (
  left: ExportReachability,
  right: ExportReachability,
): number => {
  const rankCompare = reachabilityRank(left) - reachabilityRank(right)
  if (rankCompare !== 0) return rankCompare
  const penaltyCompare = reachabilityPenalty(right) - reachabilityPenalty(left)
  if (penaltyCompare !== 0) return penaltyCompare
  const fileCompare = left.exportFile.localeCompare(right.exportFile)
  if (fileCompare !== 0) return fileCompare
  return left.exportName.localeCompare(right.exportName)
}

const exportEvidence = (binding: ExportBinding): ExportEvidence => {
  if (isTestHookExportName(binding.exportName)) return "test-hook"
  if (binding.localDeclarations.length > 0 && binding.localDeclarations.every(isTypeOnlyDeclaration)) {
    return "type-only"
  }
  return "runtime"
}

const isTestHookExportName = (name: string): boolean =>
  /(?:ForTest|ForTesting|Test|Testing|Fixture|Mock)(?:$|[A-Z_])/u.test(name)

const isTypeOnlyDeclaration = (node: Node): boolean =>
  Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node)

const evidencePenaltyWeight = (evidence: ExportEvidence): number => {
  if (evidence === "runtime") return 1
  if (evidence === "type-only") return 0.35
  return 0.2
}

const reachabilityRank = (entry: ExportReachability): number => {
  switch (entry.classification) {
    case "unused":
      return 0
    case "internal-only":
      return 1
    case "cross-module":
      return 2
    case "cross-package":
      return 3
    case "framework-consumed":
      return 4
  }
}
