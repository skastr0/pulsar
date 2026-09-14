import { describe, expect, test } from "bun:test"
import { loadSourceFile } from "../source-file-loader.js"
import type { SourceFile } from "../tsgo-api.js"

const source = (fileName: string): SourceFile => ({ fileName }) as SourceFile

describe("concurrent source-file loading", () => {
  test("simultaneous readers share one cold fetch and the identical AST", async () => {
    const deferred = Promise.withResolvers<SourceFile | undefined>()
    let requests = 0
    const program = {
      getSourceFile: () => {
        requests += 1
        return deferred.promise
      },
    }
    const readers = Array.from({ length: 64 }, () => loadSourceFile(program, "/repo/a.ts"))
    expect(requests).toBe(1)
    expect(readers.every((reader) => reader === readers[0])).toBe(true)

    const ast = source("/repo/a.ts")
    deferred.resolve(ast)
    expect((await Promise.all(readers)).every((result) => result === ast)).toBe(true)
  })

  test("completed requests defer to the Program cache instead of retaining another AST cache", async () => {
    let current: SourceFile | undefined = source("/repo/a.ts")
    let requests = 0
    const program = {
      getSourceFile: async () => {
        requests += 1
        return current
      },
    }
    expect(await loadSourceFile(program, "/repo/a.ts")).toBe(current)
    current = source("/repo/replaced.ts")
    expect(await loadSourceFile(program, "/repo/a.ts")).toBe(current)
    current = undefined
    expect(await loadSourceFile(program, "/repo/a.ts")).toBeUndefined()
    current = source("/repo/recreated.ts")
    expect(await loadSourceFile(program, "/repo/a.ts")).toBe(current)
    expect(requests).toBe(4)
  })

  test("failed requests are shared then released so retry can succeed", async () => {
    const deferred = Promise.withResolvers<SourceFile | undefined>()
    const ast = source("/repo/a.ts")
    let requests = 0
    const program = {
      getSourceFile: () => ++requests === 1 ? deferred.promise : Promise.resolve(ast),
    }
    const first = loadSourceFile(program, "/repo/a.ts")
    const second = loadSourceFile(program, "/repo/a.ts")
    const results = Promise.allSettled([first, second])
    const error = new Error("native fetch failed")
    deferred.reject(error)
    expect(await results).toEqual([
      { status: "rejected", reason: error },
      { status: "rejected", reason: error },
    ])
    expect(await loadSourceFile(program, "/repo/a.ts")).toBe(ast)
    expect(requests).toBe(2)
  })

  test("different files and Programs never share requests or checker-bound ASTs", async () => {
    const first = Promise.withResolvers<SourceFile | undefined>()
    const second = Promise.withResolvers<SourceFile | undefined>()
    const requested: Array<string> = []
    const program: Parameters<typeof loadSourceFile>[0] = {
      getSourceFile: (path) => {
        requested.push(String(path))
        return String(path) === "/repo/a.ts" ? first.promise : second.promise
      },
    }
    const otherAst = source("/repo/a.ts")
    const otherProgram = { getSourceFile: async () => otherAst }
    const a = loadSourceFile(program, "/repo/a.ts")
    const b = loadSourceFile(program, "/repo/b.ts")
    expect(await loadSourceFile(otherProgram, "/repo/a.ts")).toBe(otherAst)
    expect(requested).toEqual(["/repo/a.ts", "/repo/b.ts"])
    const aAst = source("/repo/a.ts")
    const bAst = source("/repo/b.ts")
    second.resolve(bAst)
    first.resolve(aAst)
    expect(await a).toBe(aAst)
    expect(await b).toBe(bAst)
  })
})
