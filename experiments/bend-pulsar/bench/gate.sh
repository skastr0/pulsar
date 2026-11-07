#!/bin/bash
# Memory and speed gate for the Bend rewrite (charter: "the memory and speed gate").
#
# Runs `pulsar facts` then `pulsar-engine` on every corpus in ../corpora.md,
# median of --runs (default 3), records load average, and compares against the
# committed baseline (default bench/baseline.json).
#
#   bench/gate.sh record [--runs N] [--only name[,name...]]
#   bench/gate.sh check  [--runs N] [--only name[,name...]]
#
# Gate metrics (lead ruling 2026-11-07): peak RSS and user+sys CPU time —
# both hold up under machine load. Wall time and load average are recorded
# as information only and never fail a check: the Bend runtime's io_loop
# sleeps between work chunks (junto facts: 5.7 s wall vs 0.46 s CPU), so
# wall measures scheduler luck, not the binary.
#
# check exits 1 when any stage's median RSS or CPU regresses past the
# margin, when a corpus has no baseline entry, or when a corpus could not
# be measured. Margins (stated): RSS +25%, CPU +25% — override with
# --rss-margin/--cpu-margin (percent).
#
# bench/baseline.json is tagged with the repo HEAD sha and the CLI/engine
# binary sha256s at record time; re-record after engine or CLI changes.
#
# Env: PULSAR_CLI (default <repo>/cli/target/release/pulsar),
#      PULSAR_ENGINE (default <repo>/engine/pulsar-engine).
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)                      # experiments/bend-pulsar
REPO=$(cd "$ROOT/../.." && pwd)                   # pulsar checkout
CORPORA=${CORPORA:-$ROOT/corpora.md}
BASELINE=${BASELINE:-$HERE/baseline.json}
RUNS=3
ONLY=""
MODE=""
RSS_MARGIN=25
CPU_MARGIN=25

while [ $# -gt 0 ]; do
  case "$1" in
    record|check) MODE=$1 ;;
    --runs) RUNS=$2; shift ;;
    --only) ONLY=$2; shift ;;
    --corpora) CORPORA=$2; shift ;;
    --baseline) BASELINE=$2; shift ;;
    --rss-margin) RSS_MARGIN=$2; shift ;;
    --cpu-margin) CPU_MARGIN=$2; shift ;;
    -h|--help) sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "gate.sh: unknown arg $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$MODE" ] || { echo "usage: gate.sh record|check [--runs N] [--only a,b]" >&2; exit 2; }

CLI=${PULSAR_CLI:-$ROOT/cli/target/release/pulsar}
ENGINE=${PULSAR_ENGINE:-$ROOT/engine/pulsar-engine}
for b in "$CLI" "$ENGINE"; do
  [ -x "$b" ] || { echo "gate.sh: not executable: $b (set PULSAR_CLI/PULSAR_ENGINE)" >&2; exit 2; }
done
[ -f "$CORPORA" ] || { echo "gate.sh: no corpora file $CORPORA" >&2; exit 2; }

# --- parse the ```corpus fenced block: name path sha kind note (TSV) ---
ROWS=$(awk '/^```corpus$/{f=1;next} /^```$/{if(f)exit} f' "$CORPORA" | grep -v '^name')
[ -n "$ROWS" ] || { echo "gate.sh: no corpus rows in $CORPORA" >&2; exit 2; }

want() { # $1=name -> 0 if selected
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; esac
  return 1
}

loadavg() { sysctl -n vm.loadavg | tr -d '{}' | awk '{print $1}'; }

TIMEDIR=$(mktemp -d /tmp/pulsar-gate.XXXXXX)
trap 'rm -rf "$TIMEDIR"' EXIT
CAP_OUT=$TIMEDIR/cap.out; CAP_ERR=$TIMEDIR/cap.err
RESULTS=$TIMEDIR/results.jsonl
: >"$RESULTS"

# timed <out> <err> <cmd...> : run under /usr/bin/time -l; sets T_WALL T_CPU T_RSS T_RC
# /usr/bin/time -l prints "<r> real <u> user <s> sys" on one line and
# "<bytes>  maximum resident set size" on another.
T_WALL=""; T_CPU=""; T_RSS=""; T_RC=0
timed() {
  local out=$1 err=$2; shift 2
  "$@" >"$out" 2>"$err"
  T_RC=$?
  read T_WALL T_CPU T_RSS <<<"$(awk '
    / real / && / user / && / sys / {
      for (i = 1; i <= NF; i++) {
        if ($i == "real") w = $(i-1)
        if ($i == "user") u = $(i-1)
        if ($i == "sys")  s = $(i-1)
      }
    }
    /maximum resident set size/ { r = $1 }
    END { printf "%.3f %.3f %d", w+0, u+s, r+0 }
  ' "$err")"
}

emit_result() { # record fields on argv -> append one JSON line to $RESULTS
  python3 - "$@" <<'PY' >>"$RESULTS"
import json, sys
a = sys.argv[1:]
if a[0] == "__error__":
    print(json.dumps({"name": a[1], "path": a[2], "error": a[3]})); sys.exit(0)
(name, path, sha, kind, la, stats, eng_s, fw, fc, fr, ew, ec, er, actual, dirty) = a
flt = lambda xs: [x for x in xs.split(",") if x]
med = lambda xs, f=float: sorted(f(x) for x in flt(xs))[len(flt(xs))//2] if flt(xs) else None
rec = {
  "name": name, "path": path, "sha": sha, "kind": kind,
  "loadavg": float(la), "actual_sha": actual or None, "dirty": int(dirty or 0),
  "facts": {"wall_runs": [float(x) for x in flt(fw)],
            "cpu_runs":  [float(x) for x in flt(fc)],
            "rss_runs":  [int(x) for x in flt(fr)],
            "stats": stats or None},
  "engine": {"wall_runs": [float(x) for x in flt(ew)],
             "cpu_runs":  [float(x) for x in flt(ec)],
             "rss_runs":  [int(x) for x in flt(er)],
             "summary": eng_s or None},
}
for stage, w, c, r in (("facts", fw, fc, fr), ("engine", ew, ec, er)):
    rec[stage]["wall_s"] = med(w); rec[stage]["cpu_s"] = med(c); rec[stage]["rss_bytes"] = med(r, int)
print(json.dumps(rec))
PY
}

run_corpus() { # $1=name $2=path $3=sha $4=kind
  local name=$1 path=$2 sha=$3 kind=$4
  local facts=$TIMEDIR/facts-$name.txt
  local fw="" fc="" fr="" ew="" ec="" er="" i la stats="" eng_s="" wall cpu rss rc
  la=$(loadavg)
  echo "gate: $name ($kind) loadavg=$la" >&2

  for i in $(seq 1 "$RUNS"); do
    rm -f "$facts" "$facts.paths"
    timed "$CAP_OUT" "$CAP_ERR" /usr/bin/time -l "$CLI" facts "$path" -o "$facts"
    rc=$T_RC; wall=$T_WALL; cpu=$T_CPU; rss=$T_RSS
    stats=$(grep '^pulsar:' "$CAP_ERR" | tail -1)
    [ "$rc" = 0 ] || echo "gate: WARN $name facts run $i exit $rc: $(tail -1 "$CAP_ERR")" >&2
    fw="$fw,$wall"; fc="$fc,$cpu"; fr="$fr,$rss"
  done

  if [ ! -f "$facts" ]; then
    emit_result __error__ "$name" "$path" "no facts file produced"
    return 1
  fi
  for i in $(seq 1 "$RUNS"); do
    timed "$CAP_OUT" "$CAP_ERR" /usr/bin/time -l "$ENGINE" "$facts"
    rc=$T_RC; wall=$T_WALL; cpu=$T_CPU; rss=$T_RSS
    eng_s=$(grep '^S ' "$CAP_OUT" | tail -1)
    [ "$rc" = 0 ] || echo "gate: WARN $name engine run $i exit $rc" >&2
    ew="$ew,$wall"; ec="$ec,$cpu"; er="$er,$rss"
  done

  local actual="" dirty=""
  if [ -d "$path/.git" ]; then
    actual=$(git -C "$path" rev-parse HEAD 2>/dev/null || echo "")
    if [ -n "$actual" ] && [ "$actual" != "$sha" ]; then
      echo "gate: WARN $name sha drift: recorded ${sha:0:12} actual ${actual:0:12}" >&2
    fi
    dirty=$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    [ "$dirty" != 0 ] && echo "gate: WARN $name dirty=$dirty (numbers reflect the working tree, not $sha)" >&2
  fi

  emit_result "$name" "$path" "$sha" "$kind" "$la" "$stats" "$eng_s" \
    "${fw#,}" "${fc#,}" "${fr#,}" "${ew#,}" "${ec#,}" "${er#,}" "$actual" "$dirty"
}

while IFS=$'\t' read -r name path sha kind note; do
  want "$name" || continue
  if [ ! -d "$path" ]; then
    echo "gate: FAIL $name — missing $path" >&2
    emit_result __error__ "$name" "$path" "missing directory"
    continue
  fi
  run_corpus "$name" "$path" "$sha" "$kind" || true
done <<EOF
$ROWS
EOF

CLI_SHA=$(shasum -a 256 "$CLI" | awk '{print $1}')
ENG_SHA=$(shasum -a 256 "$ENGINE" | awk '{print $1}')
SOURCE_SHA=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo "")
MODEL=$(sysctl -n hw.model)
OSV=$(sw_vers -productVersion)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$MODE" = record ]; then
  python3 - "$RESULTS" "$BASELINE" "$RUNS" "$RSS_MARGIN" "$CPU_MARGIN" \
    "$CLI" "$CLI_SHA" "$ENGINE" "$ENG_SHA" "$SOURCE_SHA" "$MODEL" "$OSV" "$NOW" <<'PY'
import json, sys
results, out, runs, rm, cm, cli, cs, eng, es, src, model, osv, now = sys.argv[1:]
corpora = {}
errors = []
for line in open(results):
    r = json.loads(line)
    if "error" in r:
        errors.append(r); continue
    corpora[r["name"]] = {k: r[k] for k in ("path","sha","kind","loadavg","actual_sha","dirty","facts","engine")}
doc = {"version": 2, "created": now, "machine": model, "os": osv,
       "source_sha": src,
       "runs": int(runs),
       "gate_metrics": ["rss_bytes", "cpu_s"],
       "informational": ["wall_s", "loadavg"],
       "margins": {"rss_pct": int(rm), "cpu_pct": int(cm),
       "note": "lead ruling 2026-11-07: gate on RSS + user/sys CPU (load-stable); wall+loadavg informational only — Bend io_loop sleeps between work chunks"},
       "cli": {"path": cli, "sha256": cs}, "engine": {"path": eng, "sha256": es},
       "corpora": corpora}
if errors:
    doc["errors"] = errors
json.dump(doc, open(out, "w"), indent=1, sort_keys=True)
open(out, "a").write("\n")
print(f"gate: wrote {out} ({len(corpora)} corpora, {runs} runs, src {src[:12]})")
for e in errors: print(f"gate: recorded error for {e['name']}: {e['error']}")
PY
  exit 0
fi

# check mode
python3 - "$RESULTS" "$BASELINE" "$RSS_MARGIN" "$CPU_MARGIN" <<'PY'
import json, sys, os
results, baseline, rm, cm = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
now, errs = {}, []
for line in open(results):
    r = json.loads(line)
    if "error" in r: errs.append(r)
    else: now[r["name"]] = r
if not os.path.exists(baseline):
    print(f"gate: FAIL no baseline at {baseline} — run `gate.sh record` first"); sys.exit(1)
base = json.load(open(baseline))
fails, warns = [], []
for e in errs: fails.append(f"{e['name']}: {e['error']}")
for e in base.get("errors", []): warns.append(f"baseline recorded error for {e['name']}: {e['error']}")
for name, r in sorted(now.items()):
    b = base.get("corpora", {}).get(name)
    if not b:
        fails.append(f"{name}: no baseline entry"); continue
    for stage in ("facts", "engine"):
        for metric, margin in (("rss_bytes", rm), ("cpu_s", cm)):
            cur, old = r[stage].get(metric), b[stage].get(metric)
            if cur is None or old is None: continue
            if cur > old * (1 + margin / 100):
                fails.append(f"{name}/{stage}/{metric}: {cur} > baseline {old} +{margin}%")
    fs, bs = (r["facts"].get("stats") or ""), (b["facts"].get("stats") or "")
    if "files=0" in fs and "files=0" not in bs:
        warns.append(f"{name}: facts now files=0 (baseline had files)")
    if r.get("actual_sha") and r["actual_sha"] != r.get("sha"):
        warns.append(f"{name}: sha drift {r['sha'][:12]} -> {r['actual_sha'][:12]}")
for w in warns: print(f"gate: WARN {w}")
for f in fails: print(f"gate: FAIL {f}")
print(f"gate: check {'PASS' if not fails else 'FAIL'} — {len(now)} corpora vs {baseline}")
sys.exit(1 if fails else 0)
PY
