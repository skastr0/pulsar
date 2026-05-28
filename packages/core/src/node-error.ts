export const hasNodeErrorCode = (cause: unknown, code: string): boolean => {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return false
  }
  return (cause as { readonly code?: unknown }).code === code
}
