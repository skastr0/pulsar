import type { Diagnostic } from "./diagnostic.js"
import { computeDiagnosticHash } from "./diagnostic.js"

export interface TasteAllowBypass {
  readonly ticket: string
  readonly until: string
  readonly reason: string
  readonly line: number
  readonly raw: string
  readonly status: "active" | "expired"
  readonly hash: string
}

const TASTE_ALLOW_PATTERN = /^\s*\/\/\s*taste-allow\s+(\S+)\s+until:(\S+)\s+(.+?)\s*$/

export const parseBypasses = (
  sourceText: string,
  now: Date = new Date(),
): ReadonlyArray<TasteAllowBypass> => {
  const bypasses: Array<TasteAllowBypass> = []
  for (const [index, rawLine] of sourceText.split(/\r?\n/).entries()) {
    const match = TASTE_ALLOW_PATTERN.exec(rawLine)
    if (match === null) continue

    const ticket = match[1]!
    const until = match[2]!
    const reason = match[3]!
    const expiresAt = parseUntil(until)
    const status: "active" | "expired" =
      expiresAt === undefined || expiresAt.getTime() < now.getTime()
        ? "expired"
        : "active"

    bypasses.push({
      ticket,
      until,
      reason,
      line: index + 1,
      raw: rawLine.trim(),
      status,
      hash: computeDiagnosticHash(`${ticket}|${until}|${reason}|${rawLine.trim()}`),
    })
  }
  return bypasses
}

export const hasSuppressingBypass = (
  bypasses: ReadonlyArray<TasteAllowBypass>,
): boolean => bypasses.some((bypass) => bypass.status === "active" || bypass.status === "expired")

export const toExpiredBypassDiagnostic = (
  signalId: string,
  file: string,
  bypass: TasteAllowBypass,
): Diagnostic => ({
  severity: "block",
  message: `Expired taste-allow ${bypass.ticket} (until ${bypass.until}): ${bypass.reason}`,
  location: { file, line: bypass.line },
  data: {
    hash: bypass.hash,
    signalId,
    ticket: bypass.ticket,
    until: bypass.until,
    reason: bypass.reason,
    kind: "taste-allow-expired",
  },
})

const parseUntil = (raw: string): Date | undefined => {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}
