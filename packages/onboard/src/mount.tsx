import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { OnboardApp } from "./app.js"
import { palette } from "./palette.js"
import type { OnboardInput } from "./types.js"

// Launch the onboarding TUI. Resolves when the user exits.
export const runOnboardTui = async (input: OnboardInput): Promise<void> => {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    consoleMode: "disabled",
    backgroundColor: palette.bg,
  })
  const root = createRoot(renderer)
  await new Promise<void>((resolve) => {
    const close = () => {
      root.unmount()
      renderer.stop()
      renderer.destroy()
      resolve()
    }
    root.render(<OnboardApp input={{ ...input, onExit: close }} />)
  })
}
