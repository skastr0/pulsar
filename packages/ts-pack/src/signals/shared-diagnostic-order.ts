interface DiagnosticOrderKey {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly label: string
}

export interface DiagnosticOrderProperties<Item> {
  readonly file: keyof Item
  readonly line: keyof Item
  readonly kind: keyof Item
  readonly label: keyof Item
}

const compareDiagnosticOrderKeys = (
  left: DiagnosticOrderKey,
  right: DiagnosticOrderKey,
): number => {
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  if (left.line !== right.line) return left.line - right.line
  if (left.kind !== right.kind) return left.kind.localeCompare(right.kind)
  return left.label.localeCompare(right.label)
}

export const compareDiagnosticOrderProperties = <Item extends object>(
  left: Item,
  right: Item,
  properties: DiagnosticOrderProperties<Item>,
): number =>
  compareDiagnosticOrderKeys(
    diagnosticOrderKeyFromProperties(left, properties),
    diagnosticOrderKeyFromProperties(right, properties),
  )

const diagnosticOrderKeyFromProperties = <Item extends object>(
  item: Item,
  properties: DiagnosticOrderProperties<Item>,
): DiagnosticOrderKey => ({
  file: item[properties.file] as string,
  line: item[properties.line] as number,
  kind: item[properties.kind] as string,
  label: item[properties.label] as string,
})
