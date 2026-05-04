import type { InputOutputs, ResolvedSignal } from "./signal.js"

export const buildInputOutputs = (
  signal: ResolvedSignal,
  outputs: ReadonlyMap<string, unknown>,
): InputOutputs => {
  const map = new Map<string, unknown>()
  for (const input of signal.inputs) {
    const value = outputs.get(input.id)
    if (value !== undefined) map.set(input.id, value)
  }
  return map
}
