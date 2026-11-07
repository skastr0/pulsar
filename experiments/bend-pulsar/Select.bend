# Select.bend - optional "production source" file selection (pure core).
#
# Approximates which files Pulsar's scoring entry points hand to TS-AD-02
# (`productionOnly: true` file membership plus the signal's default
# exclude_globs). Enabled with `bend-cycles <repo> --production`; the default
# run keeps every .ts/.tsx/.mts/.cts file except .d.ts.
#
# Rules mirrored (packages/ts-pack/src/source-membership.ts and
# packages/core/src/file-taxonomy.ts):
#  - only .ts and .tsx
#  - no path segment in the non-production set, no hidden (.x) segment
#  - no generated / test / stories / test-helper / config-tooling / .d.ts suffix
# Not modelled: tsconfig include/exclude coverage, untracked-but-not-ignored
# files, and the absolute-path matching of the glob dialect.

import Base

# Directory or file-name segments that disqualify a path.
def Select.seg_bad(seg: String) -> Bool:
  match seg:
    case SCon{'n', SCon{'o', SCon{'d', SCon{'e', SCon{'_', SCon{'m', SCon{'o', SCon{'d', SCon{'u', SCon{'l', SCon{'e', SCon{'s', SNil{}}}}}}}}}}}}}:
      True{}
    case SCon{'d', SCon{'i', SCon{'s', SCon{'t', SNil{}}}}}:
      True{}
    case SCon{'b', SCon{'u', SCon{'i', SCon{'l', SCon{'d', SNil{}}}}}}:
      True{}
    case SCon{'.', SCon{'n', SCon{'e', SCon{'x', SCon{'t', SNil{}}}}}}:
      True{}
    case SCon{'.', SCon{'n', SCon{'u', SCon{'x', SCon{'t', SNil{}}}}}}:
      True{}
    case SCon{'.', SCon{'o', SCon{'u', SCon{'t', SCon{'p', SCon{'u', SCon{'t', SNil{}}}}}}}}:
      True{}
    case SCon{'c', SCon{'o', SCon{'v', SCon{'e', SCon{'r', SCon{'a', SCon{'g', SCon{'e', SNil{}}}}}}}}}:
      True{}
    case SCon{'.', SCon{'t', SCon{'u', SCon{'r', SCon{'b', SCon{'o', SNil{}}}}}}}:
      True{}
    case SCon{'.', SCon{'c', SCon{'a', SCon{'c', SCon{'h', SCon{'e', SNil{}}}}}}}:
      True{}
    case SCon{'v', SCon{'e', SCon{'n', SCon{'d', SCon{'o', SCon{'r', SNil{}}}}}}}:
      True{}
    case SCon{'g', SCon{'e', SCon{'n', SNil{}}}}:
      True{}
    case SCon{'_', SCon{'g', SCon{'e', SCon{'n', SCon{'e', SCon{'r', SCon{'a', SCon{'t', SCon{'e', SCon{'d', SNil{}}}}}}}}}}}:
      True{}
    case SCon{'g', SCon{'e', SCon{'n', SCon{'e', SCon{'r', SCon{'a', SCon{'t', SCon{'e', SCon{'d', SNil{}}}}}}}}}}:
      True{}
    case SCon{'_', SCon{'_', SCon{'t', SCon{'e', SCon{'s', SCon{'t', SCon{'s', SCon{'_', SCon{'_', SNil{}}}}}}}}}}:
      True{}
    case SCon{'t', SCon{'e', SCon{'s', SCon{'t', SNil{}}}}}:
      True{}
    case SCon{'t', SCon{'e', SCon{'s', SCon{'t', SCon{'s', SNil{}}}}}}:
      True{}
    case SCon{'t', SCon{'e', SCon{'s', SCon{'t', SCon{'-', SCon{'s', SCon{'u', SCon{'p', SCon{'p', SCon{'o', SCon{'r', SCon{'t', SNil{}}}}}}}}}}}}}:
      True{}
    case SCon{'t', SCon{'e', SCon{'s', SCon{'t', SCon{'-', SCon{'u', SCon{'t', SCon{'i', SCon{'l', SCon{'s', SNil{}}}}}}}}}}}:
      True{}
    case SCon{'t', SCon{'e', SCon{'s', SCon{'t', SCon{'-', SCon{'h', SCon{'e', SCon{'l', SCon{'p', SCon{'e', SCon{'r', SCon{'s', SNil{}}}}}}}}}}}}}:
      True{}
    case SCon{'t', SCon{'e', SCon{'s', SCon{'t', SCon{'-', SCon{'m', SCon{'o', SCon{'c', SCon{'k', SCon{'s', SNil{}}}}}}}}}}}:
      True{}
    case SCon{'t', SCon{'e', SCon{'s', SCon{'t', SCon{'-', SCon{'h', SCon{'a', SCon{'r', SCon{'n', SCon{'e', SCon{'s', SCon{'s', SNil{}}}}}}}}}}}}}:
      True{}
    case SCon{'e', SCon{'x', SCon{'a', SCon{'m', SCon{'p', SCon{'l', SCon{'e', SNil{}}}}}}}}:
      True{}
    case SCon{'e', SCon{'x', SCon{'a', SCon{'m', SCon{'p', SCon{'l', SCon{'e', SCon{'s', SNil{}}}}}}}}}:
      True{}
    case SCon{'d', SCon{'e', SCon{'m', SCon{'o', SNil{}}}}}:
      True{}
    case SCon{'d', SCon{'e', SCon{'m', SCon{'o', SCon{'s', SNil{}}}}}}:
      True{}
    case SCon{'p', SCon{'r', SCon{'i', SCon{'v', SCon{'a', SCon{'t', SCon{'e', SCon{'-', SCon{'d', SCon{'e', SCon{'m', SCon{'o', SCon{'s', SNil{}}}}}}}}}}}}}}:
      True{}
    case SCon{'s', SCon{'a', SCon{'m', SCon{'p', SCon{'l', SCon{'e', SNil{}}}}}}}:
      True{}
    case SCon{'s', SCon{'a', SCon{'m', SCon{'p', SCon{'l', SCon{'e', SCon{'s', SNil{}}}}}}}}:
      True{}
    case SCon{'s', SCon{'d', SCon{'k', SCon{'-', SCon{'s', SCon{'a', SCon{'m', SCon{'p', SCon{'l', SCon{'e', SCon{'s', SNil{}}}}}}}}}}}}:
      True{}
    case SCon{'g', SCon{'o', SCon{'o', SCon{'g', SCon{'l', SCon{'e', SCon{'_', SCon{'s', SCon{'a', SCon{'m', SCon{'p', SCon{'l', SCon{'e', SCon{'s', SNil{}}}}}}}}}}}}}}}:
      True{}
    case SCon{'f', SCon{'i', SCon{'x', SCon{'t', SCon{'u', SCon{'r', SCon{'e', SNil{}}}}}}}}:
      True{}
    case SCon{'f', SCon{'i', SCon{'x', SCon{'t', SCon{'u', SCon{'r', SCon{'e', SCon{'s', SNil{}}}}}}}}}:
      True{}
    case SCon{'s', SCon{'p', SCon{'e', SCon{'c', SNil{}}}}}:
      True{}
    case SCon{'s', SCon{'p', SCon{'e', SCon{'c', SCon{'s', SNil{}}}}}}:
      True{}
    case SCon{'d', SCon{'o', SCon{'c', SCon{'s', SNil{}}}}}:
      True{}
    case SCon{'d', SCon{'o', SCon{'c', SCon{'u', SCon{'m', SCon{'e', SCon{'n', SCon{'t', SCon{'a', SCon{'t', SCon{'i', SCon{'o', SCon{'n', SNil{}}}}}}}}}}}}}}:
      True{}
    case SCon{'.', SCon{_, _}}:
      True{}
    case _:
      False{}

def Select.any_seg(segs: List<&2, String>, found: Bool) -> Bool:
  match segs:
    case Nil{}:
      found
    case Con{h, t}:
      Select.any_seg(t, Bool.or(found, Select.seg_bad(h)))

# Disqualifying file-name suffixes.
def Select.suffix_bad(+p: String) -> Bool:
  Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(Bool.or(False{}, String.ends_with(p, ".gen.ts")), String.ends_with(p, ".gen.tsx")), String.ends_with(p, ".generated.ts")), String.ends_with(p, ".generated.tsx")), String.ends_with(p, "sst-env.d.ts")), String.ends_with(p, "happydom.ts")), String.ends_with(p, ".test.ts")), String.ends_with(p, ".test.tsx")), String.ends_with(p, ".spec.ts")), String.ends_with(p, ".spec.tsx")), String.ends_with(p, ".stories.ts")), String.ends_with(p, ".stories.tsx")), String.ends_with(p, "test-support.ts")), String.ends_with(p, "test-support.tsx")), String.ends_with(p, "test-utils.ts")), String.ends_with(p, "test-utils.tsx")), String.ends_with(p, "test-helpers.ts")), String.ends_with(p, "test-helpers.tsx")), String.ends_with(p, "test-mocks.ts")), String.ends_with(p, "test-mocks.tsx")), String.ends_with(p, "test-harness.ts")), String.ends_with(p, "test-harness.tsx")), String.ends_with(p, ".d.ts")), String.ends_with(p, "astro.config.ts")), String.ends_with(p, "drizzle.config.ts")), String.ends_with(p, "eslint.config.ts")), String.ends_with(p, "next.config.ts")), String.ends_with(p, "nuxt.config.ts")), String.ends_with(p, "playwright.config.ts")), String.ends_with(p, "postcss.config.ts")), String.ends_with(p, "svelte.config.ts")), String.ends_with(p, "tailwind.config.ts")), String.ends_with(p, "vite.config.ts"))

def Select.ts_or_tsx(+p: String) -> Bool:
  Bool.or(String.ends_with(p, ".ts"), String.ends_with(p, ".tsx"))

def Select.accept(ext_ok: Bool, bad_suffix: Bool, bad_seg: Bool) -> Bool:
  Bool.and(ext_ok, Bool.and(Bool.not(bad_suffix), Bool.not(bad_seg)))

# True when `p` (repo-relative, '/'-separated) is a production source file.
def Select.production(+p: String) -> Bool:
  Select.accept(Select.ts_or_tsx(p), Select.suffix_bad(p), Select.any_seg(String.split(p, '/'), False{}))
