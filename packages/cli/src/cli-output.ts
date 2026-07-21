export const writeStdout = (contents: string): Promise<void> =>
  new Promise((resolve, reject) => {
    process.stdout.write(contents, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })

export const writeJsonToStdout = (value: unknown): Promise<void> =>
  writeStdout(`${JSON.stringify(value, null, 2)}\n`)
