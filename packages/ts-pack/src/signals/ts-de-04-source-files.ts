import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { Project, type SourceFile } from "ts-morph"
import { mapWithConcurrency } from "../concurrency.js"
import type { PackageInfo } from "../discovery.js"
import { isExcluded } from "./shared-globs.js"

const PACKAGE_ROOT_DEPENDENCY_FILES = [
  "astro.config.cjs",
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.mts",
  "astro.config.ts",
  "drizzle.config.cjs",
  "drizzle.config.js",
  "drizzle.config.mjs",
  "drizzle.config.mts",
  "drizzle.config.ts",
  "eslint.config.cjs",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.mts",
  "eslint.config.ts",
  "next.config.cjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.mts",
  "next.config.ts",
  "nuxt.config.cjs",
  "nuxt.config.js",
  "nuxt.config.mjs",
  "nuxt.config.mts",
  "nuxt.config.ts",
  "playwright.config.cjs",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.mts",
  "playwright.config.ts",
  "postcss.config.cjs",
  "postcss.config.js",
  "postcss.config.mjs",
  "postcss.config.mts",
  "postcss.config.ts",
  "sst.config.js",
  "sst.config.mjs",
  "sst.config.mts",
  "sst.config.ts",
  "svelte.config.cjs",
  "svelte.config.js",
  "svelte.config.mjs",
  "svelte.config.mts",
  "svelte.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.mts",
  "tailwind.config.ts",
  "vite.config.cjs",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.ts",
  "vite.cjs",
  "vite.js",
  "vite.mjs",
  "vite.mts",
  "vite.ts",
] as const

export const dependencySourceFiles = async (
  project: Project,
  activePackages: ReadonlyArray<PackageInfo>,
  excludeGlobs: ReadonlyArray<string>,
): Promise<ReadonlyArray<SourceFile>> => {
  const existing = project
    .getSourceFiles()
    .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), excludeGlobs))
  const existingPaths = new Set(existing.map((sourceFile) => sourceFile.getFilePath()))
  const extraPaths = await packageRootDependencyFiles(activePackages, excludeGlobs, existingPaths)
  if (extraPaths.length === 0) return existing

  const extraProject = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  })
  for (const filePath of extraPaths) {
    extraProject.addSourceFileAtPathIfExists(filePath)
  }
  return [
    ...existing,
    ...extraProject.getSourceFiles().filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), excludeGlobs)),
  ]
}

const packageRootDependencyFiles = async (
  activePackages: ReadonlyArray<PackageInfo>,
  excludeGlobs: ReadonlyArray<string>,
  existingPaths: ReadonlySet<string>,
): Promise<ReadonlyArray<string>> => {
  const dependencyFilenames = new Set<string>(PACKAGE_ROOT_DEPENDENCY_FILES)
  const existing = await mapWithConcurrency(
    activePackages,
    8,
    async (pkg) => {
      try {
        const entries = await readdir(pkg.path, { withFileTypes: true })
        return entries
          .filter((entry) => entry.isFile() && dependencyFilenames.has(entry.name))
          .map((entry) => join(pkg.path, entry.name))
          .filter((filePath) => !existingPaths.has(filePath) && !isExcluded(filePath, excludeGlobs))
      } catch {
        return []
      }
    },
  )
  return existing.flat().sort((left, right) => left.localeCompare(right))
}
