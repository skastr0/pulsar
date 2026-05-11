import { Effect, Option } from "effect"
import {
  CalibrationContextTag,
  type CalibrationProcessorError,
  type CalibrationSlotOutput,
  type SourceCategory,
} from "./calibration.js"

interface FileTaxonomyOptions {
  readonly sourceExtensions?: ReadonlyArray<string>
}

const classifyFilePathDefault = (
  filePath: string,
  options?: FileTaxonomyOptions,
): ReadonlyArray<SourceCategory> => {
  const normalized = normalizePath(filePath)
  const pathSegments = normalized.split("/")
  const categories = new Set(
    DEFAULT_FILE_TAXONOMY_RULES.filter((rule) =>
      rule.matches(normalized, pathSegments),
    ).map((rule) => rule.category),
  )

  if (
    options?.sourceExtensions !== undefined &&
    options.sourceExtensions.some((extension) => normalized.endsWith(extension)) &&
    !hasNonProductionCategory(categories)
  ) {
    categories.add("production_source")
  }

  if (categories.size === 0) categories.add("unknown")
  return [...categories].sort()
}

export const classifyFilePath = (
  filePath: string,
  options?: FileTaxonomyOptions,
): Effect.Effect<
  CalibrationSlotOutput<"taxonomy.file-classifier">,
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    const defaultCategories = classifyFilePathDefault(filePath, options)
    const calibration = yield* Effect.serviceOption(CalibrationContextTag)
    const input = {
      path: filePath,
      categories: defaultCategories,
    }
    if (Option.isNone(calibration)) {
      return { value: input, decisions: [] }
    }
    const calibrated = yield* calibration.value.runSlot("taxonomy.file-classifier", input)
    return {
      ...calibrated,
      value: {
        ...calibrated.value,
        categories: mergeCategories(defaultCategories, calibrated.value.categories),
      },
    }
  })

export const isProductionSourcePath = (
  filePath: string,
  options?: FileTaxonomyOptions,
): Effect.Effect<boolean, CalibrationProcessorError, never> =>
  classifyFilePath(filePath, options).pipe(
    Effect.map((result) => {
      const categories = new Set(result.value.categories)
      return categories.has("production_source") && !hasNonProductionCategory(categories)
    }),
  )

const normalizePath = (filePath: string): string => filePath.replaceAll("\\", "/")

type FileTaxonomyRule = {
  readonly category: SourceCategory
  readonly matches: (filePath: string, pathSegments: ReadonlyArray<string>) => boolean
}

const includesPathSegment = (pathSegments: ReadonlyArray<string>, segment: string): boolean =>
  pathSegments.includes(segment)

const includesAnyPathSegment = (
  pathSegments: ReadonlyArray<string>,
  segments: ReadonlySet<string>,
): boolean => pathSegments.some((segment) => segments.has(segment))

const hasAnySuffix = (filePath: string, suffixes: ReadonlyArray<string>): boolean =>
  suffixes.some((suffix) => filePath.endsWith(suffix))

const hasNonProductionCategory = (categories: ReadonlySet<SourceCategory>): boolean =>
  [...categories].some((category) => category !== "unknown" && category !== "production_source")

const mergeCategories = (
  left: ReadonlyArray<SourceCategory>,
  right: ReadonlyArray<SourceCategory>,
): ReadonlyArray<SourceCategory> => [...new Set([...left, ...right])].sort()

const isHiddenPathSegment = (segment: string): boolean =>
  segment.startsWith(".") && segment.length > 1

const DEFAULT_FILE_TAXONOMY_RULES: ReadonlyArray<FileTaxonomyRule> = [
  {
    category: "dependency",
    matches: (_filePath, pathSegments) => includesPathSegment(pathSegments, "node_modules"),
  },
  {
    category: "build_artifact",
    matches: (_filePath, pathSegments) =>
      includesAnyPathSegment(pathSegments, BUILD_ARTIFACT_SEGMENTS),
  },
  {
    category: "generated",
    matches: (filePath, pathSegments) =>
      includesAnyPathSegment(pathSegments, GENERATED_SEGMENTS) ||
      hasAnySuffix(filePath, GENERATED_SUFFIXES),
  },
  {
    category: "example",
    matches: (_filePath, pathSegments) => includesAnyPathSegment(pathSegments, EXAMPLE_SEGMENTS),
  },
  {
    category: "test_code",
    matches: (filePath, pathSegments) =>
      includesAnyPathSegment(pathSegments, TEST_CODE_SEGMENTS) ||
      hasAnySuffix(filePath, TEST_CODE_SUFFIXES),
  },
  {
    category: "test_utility",
    matches: (filePath, pathSegments) =>
      includesAnyPathSegment(pathSegments, TEST_UTILITY_SEGMENTS) ||
      hasAnySuffix(filePath, TEST_UTILITY_SUFFIXES),
  },
  {
    category: "stories",
    matches: (filePath, pathSegments) =>
      hasAnySuffix(filePath, STORY_SUFFIXES) || includesPathSegment(pathSegments, ".storybook"),
  },
  {
    category: "declaration",
    matches: (filePath) => hasAnySuffix(filePath, DECLARATION_SUFFIXES),
  },
  {
    category: "config_tooling",
    matches: (filePath) => hasAnySuffix(filePath, TOOLING_SUFFIXES),
  },
  {
    category: "hidden_tooling",
    matches: (_filePath, pathSegments) => pathSegments.some(isHiddenPathSegment),
  },
  {
    category: "documentation",
    matches: (_filePath, pathSegments) => includesAnyPathSegment(pathSegments, DOCUMENTATION_SEGMENTS),
  },
]

const BUILD_ARTIFACT_SEGMENTS = new Set([
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
])

const GENERATED_SEGMENTS = new Set(["gen", "_generated"])
const GENERATED_SUFFIXES = [
  ".gen.ts",
  ".gen.tsx",
  ".generated.ts",
  ".generated.tsx",
  "sst-env.d.ts",
]

const EXAMPLE_SEGMENTS = new Set([
  "example",
  "examples",
  "demo",
  "demos",
  "private-demos",
  "sample",
  "samples",
  "sdk-samples",
  "google_samples",
  "fixture",
  "fixtures",
])

const TEST_CODE_SEGMENTS = new Set(["__tests__", "test", "tests", "spec", "specs"])
const TEST_CODE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
]

const TEST_UTILITY_SEGMENTS = new Set([
  "test-support",
  "test-utils",
  "test-helpers",
  "test-mocks",
  "test-harness",
])
const TEST_UTILITY_SUFFIXES = [
  "test-support.ts",
  "test-support.tsx",
  "test-utils.ts",
  "test-utils.tsx",
  "test-helpers.ts",
  "test-helpers.tsx",
  "test-mocks.ts",
  "test-mocks.tsx",
  "test-harness.ts",
  "test-harness.tsx",
  "happydom.ts",
]

const STORY_SUFFIXES = [".stories.ts", ".stories.tsx"]
const DECLARATION_SUFFIXES = [".d.ts"]
const TOOLING_SUFFIXES = [
  "astro.config.ts",
  "drizzle.config.ts",
  "eslint.config.ts",
  "next.config.ts",
  "nuxt.config.ts",
  "playwright.config.ts",
  "postcss.config.ts",
  "svelte.config.ts",
  "tailwind.config.ts",
  "vite.config.ts",
]
const DOCUMENTATION_SEGMENTS = new Set(["docs", "documentation"])
