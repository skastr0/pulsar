import { constants } from "node:fs"
import { access, readFile } from "node:fs/promises"

export const countFileLoc = async (absolutePath: string): Promise<number> => {
  const raw = await readFile(absolutePath, "utf8")
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length
}

export const fileExists = async (absolutePath: string): Promise<boolean> => {
  try {
    await access(absolutePath, constants.F_OK)
    return true
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return false
    throw error
  }
}

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
