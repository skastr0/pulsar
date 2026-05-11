export interface DiagnosticOrderKey {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly label: string
}

export const compareDiagnosticOrderKeys = (
  left: DiagnosticOrderKey,
  right: DiagnosticOrderKey,
): number => {
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  if (left.line !== right.line) return left.line - right.line
  if (left.kind !== right.kind) return left.kind.localeCompare(right.kind)
  return left.label.localeCompare(right.label)
}
