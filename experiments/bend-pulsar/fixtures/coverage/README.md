# Coverage fixtures

Golden coverage reports for the coverage lane (`cli/src/coverage/`, `CV` facts). The tests
read the committed reports, so they need neither vitest nor llvm-cov installed; `regen.sh`
regenerates a report when a toolchain version changes.

## `ts/` — Vitest, both providers

Three sources, five tests, run under Vitest 3.2.7 with `@vitest/coverage-v8` and
`@vitest/coverage-istanbul`, `json` and `lcov` reporters each. The reports in `reports/v8/`
and `reports/istanbul/` have absolute paths rewritten to fixture-relative paths.

`fns.tsv` is the `.fns` side table for this fixture, written by hand because the TS lane
does not emit `FN` yet. Function ids follow FACTS.md: files in byte-wise sorted order, then
functions by start offset. Delete it once `pulsar facts` writes a real `.fns`.

`expected-v8.txt` and `expected-istanbul.txt` are `path<TAB>chain<TAB>covered/coverable`,
sorted by path then function id. `render_cv.py` renders `CV` facts into that shape.

### Hand check, `src/math.ts`

Lines (1-based): `add` 1-3, `classify` 5-13, `unreached` 15-17. Only `add(1, 2)` and
`classify(1)` are called.

| Provider | `add` | `classify` | `unreached` | Lines the report gives |
|---|---|---|---|---|
| istanbul | 1/1 (line 2) | 2/5 (6, 7 hit; 9, 10, 12 not) | 0/1 (16) | 2, 6, 7, 9, 10, 12, 16 |
| v8 | 3/3 (1, 2, 3) | 4/9 (5, 6, 7, 8 hit; 9-13 not) | 1/3 (15 hit; 16, 17 not) | 1, 2, 3, 5-13, 15, 16, 17 |

v8 marks every physical line of a function, signature and closing brace included; istanbul
marks statement starts. That is the providers' own line model, and `CV` follows the report
as written. A covered function therefore reads slightly higher under v8, so a CRAP
threshold has to be considered per provider, not blended.

### Hand check, `src/widget.tsx` (JSX and a nested closure)

`Widget` 3-11, its `items.map` callback 6-8, `Empty` 13-15. The widget test passes
`items: []`, so the callback never runs.

| Provider | `Widget` | `Widget>#1` (callback) | `Empty` |
|---|---|---|---|
| istanbul | 2/2 (3, 4) | 0/1 (7) | 1/1 (14) |
| v8 | 5/5 (3, 4, 5, 9, 11) | 2/3 (6, 8 hit; 7 not) | 3/3 (13, 14, 15) |

Under the innermost rule the callback owns lines 6-8, so `Widget` loses them: that is why
its `v8` count is 5 and not 8.
