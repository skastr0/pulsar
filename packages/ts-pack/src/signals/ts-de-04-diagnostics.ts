import { computeDiagnosticHash } from "@skastr0/pulsar-core/signal"
import type { Diagnostic } from "@skastr0/pulsar-core/signal"
import { join, relative } from "node:path"
import type { DependencyMismatch, PackageDependencyHealth } from "./ts-de-04-model.js"
import { isPackageToolingFile } from "./ts-de-04-package-classification.js"

export const packageDependencyDiagnostics = (
  packages: ReadonlyArray<PackageDependencyHealth>,
): ReadonlyArray<Diagnostic> =>
  packages.flatMap((pkg) => [
    ...missingDependencyDiagnostics(pkg),
    ...unusedDependencyDiagnostics(pkg),
    ...transitiveDirectUsageDiagnostics(pkg),
    ...devDependencyInProductionDiagnostics(pkg),
  ])

const missingDependencyDiagnostics = (
  pkg: PackageDependencyHealth,
): ReadonlyArray<Diagnostic> =>
  pkg.importedButNotDeclared.map((mismatch) => {
    const severity = missingDependencySeverity(pkg, mismatch)
    const severityReason = missingDependencySeverityReason(pkg, mismatch)
    return {
      severity,
      message:
        `Missing dependency in ${pkg.packageName}: ${mismatch.dependencyName} ` +
        `imported in ${formatFileExamples(pkg.packagePath, mismatch.files)}`,
      location: { file: mismatch.files[0] ?? pkg.packagePath },
      data: {
        hash: computeDiagnosticHash(`${pkg.packageName}|missing|${mismatch.dependencyName}`),
        issueKind: "missing-dependency",
        packageName: pkg.packageName,
        packagePrivate: pkg.private,
        dependencyName: mismatch.dependencyName,
        usageKind: mismatch.usageKind,
        fileCount: mismatch.files.length,
        files: mismatch.files.slice(),
        severityReason,
      },
      fixHints: [{
        kind: "declare-package-dependency",
        title: "Declare the imported dependency",
        summary:
          "Add the dependency to the importing package's manifest, replace the import with an already declared dependency, or mark the package-specific exception explicitly.",
        confidence: "high",
        autoApplicable: false,
        data: {
          packageName: pkg.packageName,
          dependencyName: mismatch.dependencyName,
          usageKind: mismatch.usageKind,
        },
      }],
    }
  })

const unusedDependencyDiagnostics = (
  pkg: PackageDependencyHealth,
): ReadonlyArray<Diagnostic> => {
  if (pkg.declaredButUnused.length === 0) return []
  const dependencyNames = pkg.declaredButUnused.map((unused) => unused.dependencyName)
  return [{
    severity: "warn",
    message:
      `Unused declared dependencies in ${pkg.packageName}: ` +
      formatDependencyExamples(dependencyNames),
    location: { file: join(pkg.packagePath, "package.json") },
    data: {
      hash: computeDiagnosticHash(`${pkg.packageName}|unused|${dependencyNames.join(",")}`),
      issueKind: "unused-dependencies",
      packageName: pkg.packageName,
      dependencyNames,
      dependencyCount: dependencyNames.length,
    },
    fixHints: [{
      kind: "remove-unused-dependencies",
      title: "Remove unused manifest entries",
      summary:
        "Remove these dependencies from the package manifest unless another generated, runtime, or platform path uses them outside the analyzed source set.",
      confidence: "medium",
      autoApplicable: false,
      data: { packageName: pkg.packageName, dependencyNames },
    }],
  }]
}

const transitiveDirectUsageDiagnostics = (
  pkg: PackageDependencyHealth,
): ReadonlyArray<Diagnostic> =>
  pkg.transitiveUsedDirectly.map((mismatch) => ({
    severity: "warn",
    message:
      `Transitive dependency used directly in ${pkg.packageName}: ` +
      `${mismatch.dependencyName} via ${formatFileExamples(pkg.packagePath, mismatch.files)}`,
    location: { file: mismatch.files[0] ?? pkg.packagePath },
    data: {
      issueKind: "transitive-direct-usage",
      packageName: pkg.packageName,
      dependencyName: mismatch.dependencyName,
      fileCount: mismatch.files.length,
      files: mismatch.files.slice(),
    },
    fixHints: [{
      kind: "declare-or-replace-transitive-dependency",
      title: "Stop relying on a transitive dependency",
      summary:
        "Declare the dependency directly in this package or import through the direct dependency that owns the API.",
      confidence: "high",
      autoApplicable: false,
      data: { packageName: pkg.packageName, dependencyName: mismatch.dependencyName },
    }],
  }))

const devDependencyInProductionDiagnostics = (
  pkg: PackageDependencyHealth,
): ReadonlyArray<Diagnostic> =>
  pkg.devInProd.map((mismatch) => ({
    severity: "warn",
    message:
      `Production code imports devDependency in ${pkg.packageName}: ` +
      `${mismatch.dependencyName} via ${formatFileExamples(pkg.packagePath, mismatch.files)}`,
    location: { file: mismatch.files[0] ?? pkg.packagePath },
    data: {
      issueKind: "dev-dependency-in-production",
      packageName: pkg.packageName,
      dependencyName: mismatch.dependencyName,
      fileCount: mismatch.files.length,
      files: mismatch.files.slice(),
    },
    fixHints: [{
      kind: "move-dev-dependency",
      title: "Move runtime dependency out of devDependencies",
      summary:
        "Move this dependency to production dependencies, remove the production import, or add an explicit allowlist rule when the runtime path is misclassified.",
      confidence: "high",
      autoApplicable: false,
      data: { packageName: pkg.packageName, dependencyName: mismatch.dependencyName },
    }],
  }))

export const compareDependencyDiagnostics = (
  left: Diagnostic,
  right: Diagnostic,
): number => {
  const kindDelta = issueKindRank(left) - issueKindRank(right)
  if (kindDelta !== 0) return kindDelta
  const missingDependencyDelta = missingDependencyRank(left) - missingDependencyRank(right)
  if (missingDependencyDelta !== 0) return missingDependencyDelta
  const leftPackage = packageNameOf(left)
  const rightPackage = packageNameOf(right)
  const packageDelta = leftPackage.localeCompare(rightPackage)
  if (packageDelta !== 0) return packageDelta
  return left.message.localeCompare(right.message)
}

const issueKindRank = (diagnostic: Diagnostic): number => {
  switch (diagnostic.data?.issueKind) {
    case "missing-dependency":
      return 0
    case "transitive-direct-usage":
      return 1
    case "dev-dependency-in-production":
      return 2
    case "unused-dependencies":
      return 3
    default:
      return 4
  }
}

const missingDependencyRank = (diagnostic: Diagnostic): number => {
  if (diagnostic.data?.issueKind !== "missing-dependency") return 0
  switch (diagnostic.data.severityReason) {
    case "published-runtime-missing-dependency":
      return 0
    case "private-runtime-missing-dependency":
      return 1
    case "tooling-only-missing-dependency":
      return 2
    case "dynamic-missing-dependency":
      return 3
    case "type-only-missing-dependency":
      return 4
    default:
      return 5
  }
}

const packageNameOf = (diagnostic: Diagnostic): string =>
  typeof diagnostic.data?.packageName === "string" ? diagnostic.data.packageName : ""

const missingDependencySeverity = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): Diagnostic["severity"] =>
  missingDependencyPenaltyWeight(pkg, mismatch) < 1 ? "warn" : "block"

export const missingDependencyPenaltyWeight = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): number => {
  if (isToolingOnlyMissingDependency(pkg, mismatch)) return 0.2
  if (mismatch.usageKind === "dynamic") return 0.45
  if (mismatch.usageKind === "type-only") return 0.2
  if (pkg.private) return 0.45
  return 1
}

const missingDependencySeverityReason = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): string => {
  if (isToolingOnlyMissingDependency(pkg, mismatch)) return "tooling-only-missing-dependency"
  if (mismatch.usageKind === "dynamic") return "dynamic-missing-dependency"
  if (mismatch.usageKind === "type-only") return "type-only-missing-dependency"
  if (pkg.private) return "private-runtime-missing-dependency"
  return "published-runtime-missing-dependency"
}

const isToolingOnlyMissingDependency = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): boolean =>
  mismatch.files.length > 0 &&
  mismatch.files.every((file) => isPackageToolingFile(pkg.packagePath, file))

const formatDependencyExamples = (
  dependencies: ReadonlyArray<string>,
  maxExamples = 5,
): string => {
  const examples = dependencies.slice(0, maxExamples)
  const remaining = dependencies.length - examples.length
  return remaining > 0 ? `${examples.join(", ")} (+${remaining} more)` : examples.join(", ")
}

const formatFileExamples = (
  packagePath: string,
  files: ReadonlyArray<string>,
  maxExamples = 3,
): string => {
  const examples = files.slice(0, maxExamples).map((file) => formatRelativeFile(packagePath, file))
  const remaining = files.length - examples.length
  return remaining > 0
    ? `${examples.join(", ")} (+${remaining} more)`
    : examples.join(", ")
}

const formatRelativeFile = (packagePath: string, file: string): string => {
  const rel = relative(packagePath, file)
  return rel.startsWith("..") ? file : rel
}
