import type { SignalContext } from "@skastr0/pulsar-core/signal"
import { Project } from "ts-morph"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import { dependencyNamesOf, workspacePackageNames } from "./shared-workspace.js"
import { readBundledInfoByPackage } from "./ts-de-04-bundled-info.js"
import { createPackagePathMatcher } from "./ts-de-04-package-classification.js"
import {
  analyzePackageHealth,
  type PackageDependencyHealth,
} from "./ts-de-04-package-health.js"
import {
  readPathAliasesByPackage,
} from "./ts-de-04-path-aliases.js"
import { dependencySourceFiles } from "./ts-de-04-source-files.js"
import { readResolvedPackageNames } from "./ts-de-04-lockfiles.js"
import { collectDependencyUsage } from "./ts-de-04-usage.js"
import type {
  DependencyAnalysisFacts,
  DependencyUsageSummary,
  TsDe04Config,
  TsDe04Output,
} from "./ts-de-04-model.js"
import { isExcluded } from "./shared-globs.js"

export const computePackageDependencyHealth = async (
  project: Project,
  packages: ReadonlyArray<PackageInfo>,
  context: SignalContext,
  config: TsDe04Config,
): Promise<TsDe04Output> => {
  const facts = await loadDependencyAnalysisFacts(project, packages, context, config)
  const usage = collectDependencyUsage(facts, context, config)
  const packageHealth = summarizePackageHealth(facts, usage, config)
  return {
    packages: packageHealth,
    missingCount: packageHealth.reduce(
      (sum, pkg) => sum + pkg.importedButNotDeclared.length,
      0,
    ),
    unusedCount: packageHealth.reduce((sum, pkg) => sum + pkg.declaredButUnused.length, 0),
    diagnosticLimit: config.top_n_diagnostics,
  }
}

const loadDependencyAnalysisFacts = async (
  project: Project,
  packages: ReadonlyArray<PackageInfo>,
  context: SignalContext,
  config: TsDe04Config,
): Promise<DependencyAnalysisFacts> => {
  const activePackages = packages.filter((pkg) => !isExcluded(pkg.path, config.exclude_globs))
  const rootManifest = packages.find((pkg) => pkg.name === "(root)")?.manifest
  return {
    resolvedPackageNames: await readResolvedPackageNames(context.worktreePath),
    activePackages,
    pathAliasesByPackage: await readPathAliasesByPackage(activePackages),
    bundledInfoByPackage: await readBundledInfoByPackage(activePackages),
    workspaceNames: workspacePackageNames(activePackages),
    sourceFiles: await dependencySourceFiles(project, activePackages, config.exclude_globs),
    packageForPath: createPackagePathMatcher(packages),
    rootDevDependencyNames: dependencyNamesOf(rootManifest, ["devDependencies"]),
    rootToolingDependencyNames: dependencyNamesOf(rootManifest, [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]),
  }
}

const summarizePackageHealth = (
  facts: DependencyAnalysisFacts,
  usage: DependencyUsageSummary,
  config: TsDe04Config,
): ReadonlyArray<PackageDependencyHealth> =>
  facts.activePackages
    .filter((pkg): pkg is PackageInfo & { manifest: PackageManifest } => pkg.manifest !== undefined)
    .map((pkg) =>
      analyzePackageHealth(
        pkg,
        usage.usageByPackage.get(pkg.path),
        facts.workspaceNames,
        facts.resolvedPackageNames,
        facts.rootDevDependencyNames,
        facts.rootToolingDependencyNames,
        usage.rootToolingUsedDependencyNames,
        config.dependency_aliases,
        new Set(config.allow_dev_dependency_in_prod),
      ),
    )
    .sort((left, right) => left.packageName.localeCompare(right.packageName))
