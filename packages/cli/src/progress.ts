export interface CliProgressOptions {
  readonly label: string
  readonly enabled: boolean
  readonly stream?: NodeJS.WriteStream
}

const progressFrames = ["-", "\\", "|", "/"] as const

export const withCliProgress = async <A>(
  run: () => Promise<A>,
  options: CliProgressOptions,
): Promise<A> => {
  const stream = options.stream ?? process.stderr
  if (!options.enabled || stream.isTTY !== true) {
    return await run()
  }

  const started = Date.now()
  let frameIndex = 0
  let lastLength = 0

  const clear = (): void => {
    stream.write(`\r${" ".repeat(lastLength)}\r`)
  }

  const render = (): void => {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000))
    const text = `${progressFrames[frameIndex % progressFrames.length]} ${options.label} (${elapsedSeconds}s)`
    frameIndex += 1
    lastLength = text.length
    stream.write(`\r${text}`)
  }

  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn
  const clearBeforeConsoleWrite = <Args extends ReadonlyArray<unknown>>(
    write: (...args: Args) => void,
  ) =>
    (...args: Args): void => {
      clear()
      write(...args)
    }

  console.log = clearBeforeConsoleWrite(originalLog.bind(console))
  console.error = clearBeforeConsoleWrite(originalError.bind(console))
  console.warn = clearBeforeConsoleWrite(originalWarn.bind(console))

  render()
  const timer = setInterval(render, 120)

  try {
    return await run()
  } finally {
    clearInterval(timer)
    console.log = originalLog
    console.error = originalError
    console.warn = originalWarn
    clear()
  }
}
