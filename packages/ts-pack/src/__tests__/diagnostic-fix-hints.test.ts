import { describe, expect, test } from "bun:test"
import { Diagnostic as DiagnosticSchema } from "../../../core/src/diagnostic.js"
import { Schema } from "effect"
import { TsAd01 } from "../signals/ts-ad-01-boundary-violations.js"
import { TsAd04 } from "../signals/ts-ad-04-boundary-parser-coverage.js"
import { packageDependencyDiagnostics } from "../signals/ts-de-04-diagnostics.js"
import { TsLd09 } from "../signals/ts-ld-09-error-channel-opacity.js"
import { TsRp02 } from "../signals/ts-rp-02-pr-size.js"
import { TsSl04 } from "../signals/ts-sl-04-empty-implementations.js"

describe("diagnostic fix hints", () => {
  test("requested remediation signals emit schema-valid fix hints", () => {
    const diagnostics = [
      ...TsAd01.diagnose({
        referenceDataStatus: "loaded",
        diagnosticLimit: 1,
        totalImports: 1,
        violationsByPackage: new Map(),
        violations: [{
          kind: "blocked-target",
          specifier: "yaml",
          fromPackage: "app",
          toPackage: "yaml",
          fromFile: "/repo/src/app.ts",
          line: 1,
        }],
      } as any),
      ...TsAd04.diagnose({
        state: "present",
        diagnosticLimit: 1,
        findings: [{
          file: "/repo/src/api/route.ts",
          line: 1,
          symbol: "POST",
          weakParameters: [{ name: "body", typeText: "any", reason: "any" }],
          missingEvidence: "parse/decode evidence",
        }],
      } as any),
      ...packageDependencyDiagnostics([{
        packageName: "app",
        packagePath: "/repo",
        private: false,
        importedButNotDeclared: [{
          dependencyName: "yaml",
          usageKind: "runtime",
          files: ["/repo/src/app.ts"],
        }],
        declaredButUnused: [],
        transitiveUsedDirectly: [],
        devInProd: [],
      } as any]),
      ...TsSl04.diagnose({
        diagnosticLimit: 1,
        stubs: [{
          visible: true,
          severity: "warn",
          name: "loadUser",
          kind: "throw-not-implemented",
          confidence: "high",
          message: "not implemented",
          file: "/repo/src/user.ts",
          relativeFile: "src/user.ts",
          line: 1,
          penaltyWeight: 1,
          scoreCapParticipation: true,
          scoreCap: 0,
          inTestPath: false,
        }],
      } as any),
      ...TsLd09.diagnose({
        topFindings: [{
          severity: "warn",
          kind: "opaque-promise-api",
          symbol: "loadUser",
          boundary: true,
          file: "/repo/src/api.ts",
          line: 1,
          column: 1,
        }],
        densityPerKloc: 1,
        densityThreshold: 18,
        boundaryThreshold: 36,
      } as any),
      ...TsRp02.diagnose({
        diagnosticLimit: 3,
        diffMode: "worktree",
        visible: true,
        severity: "warn",
        linesAdded: 600,
        linesDeleted: 20,
        filesChanged: ["src/a.ts"],
        fileStats: [{ file: "src/a.ts", added: 600, deleted: 20 }],
        packagesTouched: ["app"],
        sizeCategory: "large",
        dependencyDeltaMode: "hunk-only",
        sizePenalty: 0.5,
        calibrationDecisions: [],
        newCrossBoundaryEdges: [{
          file: "/repo/src/a.ts",
          line: 1,
          fromPackage: "app",
          toPackage: "core",
          fromBoundary: "app",
          toBoundary: "core",
        }],
        newCrossPackageEdges: [],
      } as any),
    ]

    expect(diagnostics.length).toBeGreaterThanOrEqual(6)
    for (const diagnostic of diagnostics) {
      expect(diagnostic.fixHints?.length).toBeGreaterThan(0)
      expect(() => Schema.decodeUnknownSync(DiagnosticSchema)(diagnostic)).not.toThrow()
    }
  })
})
