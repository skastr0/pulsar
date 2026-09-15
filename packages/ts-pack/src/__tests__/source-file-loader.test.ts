import { describe, expect, test } from "bun:test"
import {
  loadSourceFile,
  mapSourceFilesInWindows,
  SOURCE_FILE_LOAD_WINDOW_SIZE,
} from "../source-file-loader.js"
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

describe("windowed source-file mapping", () => {
  test("bounds one mapping call while preserving visit and result order", async () => {
    const files = Array.from({ length: 65 }, (_, index) => ({
      path: `/repo/${String(index).padStart(2, "0")}.ts`,
      index,
    }))
    const firstVisit = Promise.withResolvers<void>()
    const releaseFirstVisit = Promise.withResolvers<void>()
    const requested: Array<string> = []
    const visited: Array<string> = []
    let inFlight = 0
    let maxInFlight = 0
    const program = {
      getSourceFile: (path: string) => {
        requested.push(path)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        return Promise.resolve(source(path)).finally(() => {
          inFlight -= 1
        })
      },
    }

    const mapped = mapSourceFilesInWindows(program, files, async (file, sourceFile) => {
      visited.push(sourceFile.fileName)
      if (file.index === 0) {
        firstVisit.resolve()
        await releaseFirstVisit.promise
      }
      return file.index
    })

    await firstVisit.promise
    expect(requested).toHaveLength(SOURCE_FILE_LOAD_WINDOW_SIZE)
    releaseFirstVisit.resolve()

    expect(await mapped).toEqual(files.map((file) => file.index))
    expect(visited).toEqual(files.map((file) => file.path))
    expect(requested).toEqual(files.map((file) => file.path))
    expect(maxInFlight).toBe(SOURCE_FILE_LOAD_WINDOW_SIZE)
  })

  test("keeps input order when fetches resolve out of order and skips missing files", async () => {
    const files = ["a", "b", "c", "d"].map((name) => ({ path: `/repo/${name}.ts` }))
    const requests = new Map<
      string,
      ReturnType<typeof Promise.withResolvers<SourceFile | undefined>>
    >()
    const program = {
      getSourceFile: (path: string) => {
        const request = Promise.withResolvers<SourceFile | undefined>()
        requests.set(path, request)
        return request.promise
      },
    }
    const visited: Array<string> = []
    const mapped = mapSourceFilesInWindows(program, files, async (_file, sourceFile) => {
      visited.push(sourceFile.fileName)
      return sourceFile.fileName
    })

    requests.get("/repo/d.ts")!.resolve(source("/repo/d.ts"))
    requests.get("/repo/c.ts")!.resolve(source("/repo/c.ts"))
    requests.get("/repo/b.ts")!.resolve(undefined)
    requests.get("/repo/a.ts")!.resolve(source("/repo/a.ts"))

    expect(await mapped).toEqual(["/repo/a.ts", "/repo/c.ts", "/repo/d.ts"])
    expect(visited).toEqual(["/repo/a.ts", "/repo/c.ts", "/repo/d.ts"])
  })

  test("propagates a window failure without launching later fetches", async () => {
    const files = Array.from({ length: SOURCE_FILE_LOAD_WINDOW_SIZE + 1 }, (_, index) => ({
      path: `/repo/${index}.ts`,
    }))
    const error = new Error("native fetch failed")
    const requested: Array<string> = []
    const program = {
      getSourceFile: (path: string) => {
        requested.push(path)
        return path === "/repo/5.ts" ? Promise.reject(error) : Promise.resolve(source(path))
      },
    }

    await expect(
      mapSourceFilesInWindows(program, files, async (_file, sourceFile) => sourceFile.fileName),
    ).rejects.toBe(error)
    expect(requested).toHaveLength(SOURCE_FILE_LOAD_WINDOW_SIZE)
  })
})
