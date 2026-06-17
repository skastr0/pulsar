// Pulsar onboarding TUI palette. Instrument, not toy: muted slate ground,
// a single amber accent, band colors reserved for the verdict.
export const palette = {
  bg: "#0b0e14",
  panel: "#11151c",
  panelRaised: "#161b22",
  border: "#2a313c",
  borderFocus: "#3b82f6",
  text: "#cdd6e4",
  textDim: "#9aa5b5",
  muted: "#6b7687",
  cyan: "#56b6c2",
  amber: "#e5b567",
  green: "#7fd88f",
  yellow: "#e5c07b",
  red: "#e06c75",
} as const

export const bandColor = (band: string): string => {
  switch (band) {
    case "green":
      return palette.green
    case "yellow":
      return palette.yellow
    case "red":
      return palette.red
    default:
      return palette.muted
  }
}

export const scoreBand = (score: number): "green" | "yellow" | "red" =>
  score >= 0.6 ? "green" : score >= 0.35 ? "yellow" : "red"
