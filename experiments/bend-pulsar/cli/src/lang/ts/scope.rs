//! Production scope: which repo files count as production code.
//!
//! Mirrors the exclusions in `baseline/TS-AD-02-semantics.md` section 1, but matches on
//! repo-relative paths (old Pulsar matched the signal globs on absolute paths).

/// Path segments (any position, filename included) that make a file non-production.
const NON_PROD_SEGMENTS: &[&str] = &[
    // session selection
    "node_modules", "dist", "build", ".next", ".nuxt", ".output", "coverage", ".turbo",
    ".cache", "vendor", "gen", "_generated", "__tests__", "test", "tests", "test-support",
    "test-utils",
    // file taxonomy
    "example", "examples", "demo", "demos", "private-demos", "sample", "samples",
    "sdk-samples", "google_samples", "fixture", "fixtures", "spec", "specs", "docs",
    "documentation", "test-helpers", "test-mocks", "test-harness", ".storybook",
];

/// Directory segments (filename excluded) from the signal's `exclude_globs` that the lists
/// above do not already cover.
const NON_PROD_DIR_SEGMENTS: &[&str] = &["generated"];

/// File-name suffixes that make a file non-production.
const NON_PROD_SUFFIXES: &[&str] = &[
    ".gen.ts", ".gen.tsx", ".generated.ts", ".generated.tsx", "sst-env.d.ts", "happydom.ts",
    ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".stories.ts", ".stories.tsx",
    "test-support.ts", "test-support.tsx", "test-utils.ts", "test-utils.tsx",
    "test-helpers.ts", "test-helpers.tsx", "test-mocks.ts", "test-mocks.tsx",
    "test-harness.ts", "test-harness.tsx", ".d.ts",
    "astro.config.ts", "drizzle.config.ts", "eslint.config.ts", "next.config.ts",
    "nuxt.config.ts", "playwright.config.ts", "postcss.config.ts", "svelte.config.ts",
    "tailwind.config.ts", "vite.config.ts",
];

/// True if `rel` (repo-relative, `/`-separated) is production code.
///
/// Old Pulsar only admits `.ts` and `.tsx` as production; `.mts`/`.cts` files are parsed and
/// resolved but never production (kept for fidelity, see report).
pub fn is_prod(rel: &str) -> bool {
    if !(rel.ends_with(".ts") || rel.ends_with(".tsx")) {
        return false;
    }
    if NON_PROD_SUFFIXES.iter().any(|s| rel.ends_with(s)) {
        return false;
    }
    let mut it = rel.split('/').peekable();
    while let Some(seg) = it.next() {
        let is_dir = it.peek().is_some();
        if NON_PROD_SEGMENTS.contains(&seg) {
            return false;
        }
        if seg.len() > 1 && seg.starts_with('.') {
            return false;
        }
        if is_dir && NON_PROD_DIR_SEGMENTS.contains(&seg) {
            return false;
        }
    }
    true
}
