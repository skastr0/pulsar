export const nowMs = (): number => {
  if (typeof performance !== "undefined") return performance.now()
  return Date.now()
}

export const roundRuntimeMs = (value: number): number => Math.max(0, Number(value.toFixed(2)))
