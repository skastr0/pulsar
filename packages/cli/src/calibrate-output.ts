import type { CalibrationSuggestionReport } from "./calibrate-suggestions.js"

export const printHumanReport = (report: CalibrationSuggestionReport): void => {
  console.log("")
  console.log("  Calibration Suggestions")
  console.log(`  Repo:      ${report.repo_root}`)
  console.log(`  SHA:       ${report.head_sha}`)
  console.log(`  Mode:      ${report.mode}`)
  console.log("  Guarantee: pulsar score remains read-only; suggestions require explicit commands.")
  console.log("")
  console.log("  Current repo-owned artifacts:")
  console.log(`    vector            ${report.status.vector}`)
  console.log(`    conventions       ${report.status.conventions}`)
  console.log(`    glossary          ${report.status.glossary}`)
  console.log(`    baseline          ${report.status.baseline}`)
  console.log(`    project modules   ${report.status.project_modules}`)
  console.log("")

  if (report.suggestions.length === 0) {
    console.log("  No missing OOTB calibration steps detected.")
  } else {
    console.log("  Recommended next steps:")
    for (const suggestion of report.suggestions) {
      console.log(`    ${suggestion.id}`)
      console.log(`      ${suggestion.title}`)
      console.log(`      ${suggestion.reason}`)
      for (const command of suggestion.commands) {
        console.log(`      $ ${command}`)
      }
    }
  }

  if (report.suggested_project_modules.length > 0) {
    console.log("")
    console.log("  Suggested project modules:")
    for (const module of report.suggested_project_modules) {
      console.log(`    ${module.packageName}`)
      for (const evidence of module.evidence) {
        console.log(`      evidence: ${evidence}`)
      }
    }
  }

  if (report.write_path !== undefined) {
    console.log("")
    console.log(`  Report written: ${report.write_path}`)
  }
  console.log("")
}
