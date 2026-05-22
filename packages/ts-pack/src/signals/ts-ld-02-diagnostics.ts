import type { Diagnostic } from "@skastr0/pulsar-core/signal"
import type { FileSize, FunctionSize, TsLd02Output } from "./ts-ld-02-model.js"
import { functionDiagnosticKey } from "./ts-ld-02-model.js"

export const diagnoseTsLd02 = (out: TsLd02Output): ReadonlyArray<Diagnostic> => {
  const outlierFunctionKeys = new Set(out.outlierFunctions.map(functionDiagnosticKey))
  const outlierFileKeys = new Set(out.outlierFiles.map((file) => file.file))
  const thresholdFunctions = out.oversizedFunctions.filter(
    (fn) => !outlierFunctionKeys.has(functionDiagnosticKey(fn)),
  )
  const thresholdFiles = out.oversizedFiles.filter((file) => !outlierFileKeys.has(file.file))

  const diagnostics = [
    ...out.outlierFunctions.map((fn) => functionOutlierDiagnostic(fn, out)),
    ...out.outlierFiles.map((file) => fileOutlierDiagnostic(file, out)),
    ...thresholdFunctions.map((fn) => functionThresholdDiagnostic(fn, out)),
    ...thresholdFiles.map((file) => fileThresholdDiagnostic(file, out)),
  ]
  return diagnostics.slice(0, out.diagnosticLimit ?? diagnostics.length)
}

const functionOutlierDiagnostic = (
  fn: FunctionSize,
  out: TsLd02Output,
): Diagnostic => ({
  severity: fn.policy?.severity ?? "warn",
  message: `Function outlier \`${fn.name}\` — ${fn.loc} LOC`,
  location: { file: fn.file, line: fn.line },
  data: {
    kind: "function",
    name: fn.name,
    loc: fn.loc,
    cutoff: out.functionSizes.p95 + (fn.threshold ?? (out.functionOutlierCutoff - out.functionSizes.p95)),
    p95: out.functionSizes.p95,
    ...pressureData(out),
  },
})

const fileOutlierDiagnostic = (
  file: FileSize,
  out: TsLd02Output,
): Diagnostic => ({
  severity: file.policy?.severity ?? "warn",
  message: `File outlier ${file.file} — ${file.loc} LOC`,
  location: { file: file.file },
  data: {
    kind: "file",
    loc: file.loc,
    cutoff: out.fileSizes.p95 + (file.threshold ?? (out.fileOutlierCutoff - out.fileSizes.p95)),
    p95: out.fileSizes.p95,
    ...pressureData(out),
  },
})

const functionThresholdDiagnostic = (
  fn: FunctionSize,
  out: TsLd02Output,
): Diagnostic => ({
  severity: fn.policy?.severity ?? "warn",
  message: `Function exceeds max_function_loc \`${fn.name}\` — ${fn.loc} LOC`,
  location: { file: fn.file, line: fn.line },
  data: {
    kind: "function-threshold",
    name: fn.name,
    loc: fn.loc,
    threshold: fn.threshold ?? (out.functionOutlierCutoff - out.functionSizes.p95),
    p95: out.functionSizes.p95,
    ...pressureData(out),
  },
})

const fileThresholdDiagnostic = (
  file: FileSize,
  out: TsLd02Output,
): Diagnostic => ({
  severity: file.policy?.severity ?? "warn",
  message: `File exceeds max_file_loc ${file.file} — ${file.loc} LOC`,
  location: { file: file.file },
  data: {
    kind: "file-threshold",
    loc: file.loc,
    threshold: file.threshold ?? (out.fileOutlierCutoff - out.fileSizes.p95),
    p95: out.fileSizes.p95,
    ...pressureData(out),
  },
})

const pressureData = (out: TsLd02Output) => ({
  ratioPressure: out.ratioPressure,
  maxFunctionPressure: out.maxFunctionPressure,
  maxFilePressure: out.maxFilePressure,
})
