# Metrics differential: engine cyclomatic vs ESLint `complexity` (TS)

Engine: `engine/Metrics.bend` at 50fc2ce, reading FN/CT rows through `Rows.bend` and
`MetricsIn.bend`. CLI: `pulsar facts` built from `git archive` of e29f72c. Oracle:
`bench/oracle/ts_oracle.mjs` (ESLint 9 `complexity`, `max: 0`). Corpus: Junto
(`junto-full`, 3,832 TS files). VM: Boat pulsar-base, 4 vCPU, 8 GB.

## Result

| | count |
|---|---|
| engine functions (FN) | 78,941 |
| CT nodes | 206,225 |
| oracle functions | 68,237 |
| matched by `diff_metrics.py` identity join | 68,212 |
| cyclomatic agrees | **62,138 (91.1%)** |
| engine lower | 6,003 |
| engine higher | 71 |

**Engine lower (6,003).** 4,385 of these have at least as many `?.` occurrences in the
function's span as the gap. ESLint 9 counts optional chaining as a decision, but FACTS.md
CT kind 6 is only `&& || ?? &&= ||= ??=`. Default parameter values, which ESLint also
counts, explain cases like `repoMetadata` (`extra = {}`, oracle 2, engine 1). Both are
definitional choices in the CT encoding, not Metrics errors. Counting `?.` and default
values would be a CT change (pulsar-ts, FACTS.md kind 6) and then needs no engine change.

**Engine higher (71).** These are join artifacts. ESLint scores a class-field initializer
as a function of its own (complexity 1), and the join pairs it with the arrow function
that the field holds. Example: `BoundedCollector>append`, oracle 1, engine 5. The arrow
has 4 decisions: `?:` ×2, `if` ×2.

The `core.cyclomatic` threshold (10) is McCabe's bound (`research/thresholds.md`). It is
not fitted to ESLint counts, so the `?.` gap does not move it.

NPath has no published TS oracle (`bench/oracle/ORACLE.md`). It is checked against hand
derivations instead: `fixtures/ts-fns` f/g/h give 6/56/12, and the laws prove printed
NPath = min(Nejmeh's recurrence, 16777215).

## Cost on the same corpus

| step | time | peak RSS |
|---|---|---|
| `pulsar facts` | 0.14 s | 38 MB |
| Rows reader alone | 0.12 s | 41 MB |
| Rows + Metrics (FM/FX out) | 0.25 s | 73 MB |

Rows.bend holds all 394k rows. Metrics adds about 31 MB, because it holds the decoded
lists, every tree and every output line at once. Fusing measurement into the tree walk
would cut that share.

## Reproduce

```
pulsar facts <repo> -o j.facts                      # writes j.facts, .paths, .fns
<engine-with-Metrics> j.facts > j.fm                # FM/FX lines
NODE_OPTIONS=--max-old-space-size=6500 node bench/oracle/ts_oracle.mjs --repo <repo> -o j.oracle.jsonl
python3 research/metrics-differential/fm2jsonl.py j.facts j.fm \
  | sed 's/"cyclomatic":/"eslint.cyclomatic":/' > j.engine.jsonl
python3 bench/oracle/diff_metrics.py j.oracle.jsonl j.engine.jsonl
```

The rename is there because `diff_metrics.py` parses `--metric a=b` but compares only
metrics with the same name. The oracle needs the larger heap on Junto: the default heap
aborts after 2.3 GB.
