import type { CalibrationWriteResult } from "./types.js"

// Persistence is the handoff beat's completion condition. An error remains on
// the handoff screen so the TUI can never imply that a failed write completed.
export const canAdvanceFromHandoff = (
  written: CalibrationWriteResult | null,
  writeError: string | null,
): boolean => written !== null && writeError === null
