import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect } from "effect"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import { computePackageDependencyHealth } from "./ts-de-04-compute.js"
import {
  compareDependencyDiagnostics,
  missingDependencyPenaltyWeight,
  packageDependencyDiagnostics,
} from "./ts-de-04-diagnostics.js"
import { TsDe04Config, type TsDe04Output } from "./ts-de-04-model.js"
import type {
  DependencyMismatch,
  PackageDependencyHealth,
  UnusedDeclaredDependency,
} from "./ts-de-04-package-health.js"

export { TsDe04Config } from "./ts-de-04-model.js"
export type { TsDe04Output } from "./ts-de-04-model.js"
export type { DependencyMismatch, PackageDependencyHealth, UnusedDeclaredDependency }

export const TsDe04: Signal<
  TsDe04Config,
  TsDe04Output,
  TsProjectTag | TsPackageInfoTag | SignalContextTag
> = {
  id: "TS-DE-04-package-dependency-health",
  title: "Package dependency health",
  aliases: ["TS-DE-04"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  cacheVersion: "esbuild-bundled-source-v1",
  configSchema: TsDe04Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/example/**",
      "**/examples/**",
      "**/demo/**",
      "**/demos/**",
      "**/private-demos/**",
      "**/sample/**",
      "**/samples/**",
      "**/sdk-samples/**",
      "**/google_samples/**",
      "**/fixture/**",
      "**/fixtures/**",
      "**/template/**",
      "**/templates/**",
    ],
    test_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/test-utils/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*test-utils.ts",
      "**/*test-utils.tsx",
      "**/*.test-utils.ts",
      "**/*.test-utils.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/*.config.ts",
      "**/*.config.tsx",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.cjs",
      "**/vite.js",
      "**/vite.ts",
      "**/vite.mjs",
      "**/happydom.ts",
    ],
    top_n_diagnostics: 20,
    dependency_aliases: {},
    allow_dev_dependency_in_prod: [],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const context = yield* SignalContextTag

      return yield* Effect.tryPromise({
        try: () => computePackageDependencyHealth(project, packages, context, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-04-package-dependency-health",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    const packageCount = Math.max(1, out.packages.length)
    const missingPenaltyWeight = out.packages.reduce(
      (sum, pkg) =>
        sum +
        pkg.importedButNotDeclared.reduce(
          (pkgSum, mismatch) => pkgSum + missingDependencyPenaltyWeight(pkg, mismatch),
          0,
        ),
      0,
    )
    const softViolations = out.packages.reduce(
      (sum, pkg) => sum + pkg.transitiveUsedDirectly.length + pkg.devInProd.length,
      0,
    )
    const dependencyBearingPackageCount = Math.max(1, packageCount - 1)
    const penalty =
      (missingPenaltyWeight / dependencyBearingPackageCount) * 1.25 +
      out.unusedCount / (packageCount * 50) +
      softViolations / (packageCount * 20)
    return Math.max(0, 1 - Math.min(1, penalty))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    [...packageDependencyDiagnostics(out.packages)]
      .sort(compareDependencyDiagnostics)
      .slice(0, out.diagnosticLimit),
}
