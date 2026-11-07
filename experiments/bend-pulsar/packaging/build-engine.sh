#!/bin/bash
# build-engine.sh - per-platform pulsar-engine binaries from the C that Bend emits.
#
#   packaging/build-engine.sh [--out DIR] [--targets "T ..."] [--test]
#
#   targets: darwin-arm64 darwin-x64 linux-x64 linux-arm64 (default: all four)
#   --out    output directory (default: experiments/bend-pulsar/dist/engine)
#   --test   run engine/test.sh with every binary, and check every binary prints
#            byte-identical output to the first target on every fixture
#
# Steps:
#   1. refuse unless `bend version` is the version pinned in packaging/bend-version
#   2. bend engine/main.bend -o pulsar-engine.c (one C file, no Bend needed after)
#   3. darwin-*: host clang -O2 per -target; linux-*: clang -O2 -static against
#      musl in the pinned Alpine image (packaging/linux.Dockerfile), under docker
#      --platform, so the binary needs no libc on the target machine
#   4. write MANIFEST (bend version, sha256 of the C, sha256/size/compiler per binary)
#   5. stage npm/pulsar-<target>/engine/pulsar-engine, the path the CLI looks for
#      next to its own bin/ (cli/src/engine.rs: <exe dir>/../engine/pulsar-engine)
#
# Needs: bend (pinned version), clang (Xcode CLT) on macOS, docker for linux-*.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
BEND=${BEND:-$HOME/.bend/bin/bend}
OUT=$ROOT/dist/engine
TARGETS="darwin-arm64 darwin-x64 linux-x64 linux-arm64"
TEST=0
IMAGE=pulsar-engine-builder:alpine3.22-clang20

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT=$2; shift 2 ;;
    --targets) TARGETS=$2; shift 2 ;;
    --test) TEST=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "build-engine: unknown argument $1" >&2; exit 2 ;;
  esac
done

die() { echo "build-engine: $*" >&2; exit 1; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
size() { wc -c <"$1" | tr -d ' '; }

# 1. the pinned Bend
PIN=$(tr -d '[:space:]' <"$HERE/bend-version")
HAVE=$("$BEND" version 2>/dev/null | awk '{print $2}') || die "cannot run $BEND"
[ "$HAVE" == "$PIN" ] || die "bend $HAVE found, the engine is pinned to bend $PIN (packaging/bend-version)"

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
C=$OUT/pulsar-engine.c

# 2. emit C
echo "emit   bend $PIN engine/main.bend -> $C"
(cd "$ROOT/engine" && "$BEND" main.bend -o "$C") || die "bend failed to emit C"

docker_ready=0
need_docker() {
  [ $docker_ready == 1 ] && return
  command -v docker >/dev/null || die "linux targets need docker"
  for p in linux/amd64 linux/arm64; do
    docker build -q --platform "$p" -t "$IMAGE-${p#linux/}" -f "$HERE/linux.Dockerfile" "$HERE" >/dev/null \
      || die "cannot build the $p builder image"
  done
  docker_ready=1
}

# run CMD... inside the builder for a linux target, with $OUT mounted at /w and
# the engine fixtures at /fx
in_linux() {
  local t=$1; shift
  local p=amd64; [ "$t" == linux-arm64 ] && p=arm64
  docker run --rm --platform "linux/$p" -v "$OUT:/w" -v "$ROOT/engine:/fx:ro" -w /w "$IMAGE-$p" "$@"
}

# 3. build
: >"$OUT/MANIFEST.tmp"
for t in $TARGETS; do
  bin=$OUT/$t/pulsar-engine
  mkdir -p "$OUT/$t"
  case $t in
    darwin-arm64|darwin-x64)
      arch=${t#darwin-}; [ "$arch" == x64 ] && arch=x86_64
      clang -O2 -target "$arch-apple-macos11" -o "$bin" "$C"
      strip "$bin"
      cc=$(clang --version | head -1)
      ;;
    linux-x64|linux-arm64)
      need_docker
      in_linux "$t" clang -O2 -static -s -o "$t/pulsar-engine" pulsar-engine.c
      cc=$(in_linux "$t" clang --version | head -1)
      ;;
    *) die "unknown target $t" ;;
  esac
  echo "build  $t $(size "$bin") bytes"
  printf '%s %s %s %s\n' "$t" "$(sha "$bin")" "$(size "$bin")" "$cc" >>"$OUT/MANIFEST.tmp"
done

# 4. manifest
{
  echo "bend $PIN"
  echo "c $(sha "$C") $(size "$C") pulsar-engine.c"
  cat "$OUT/MANIFEST.tmp"
} >"$OUT/MANIFEST"
rm -f "$OUT/MANIFEST.tmp"

# 5. npm staging
for t in $TARGETS; do
  mkdir -p "$OUT/npm/pulsar-$t/engine"
  cp "$OUT/$t/pulsar-engine" "$OUT/npm/pulsar-$t/engine/pulsar-engine"
done

# --test: the fixture suite per binary, then cross-target byte equality
if [ $TEST == 1 ]; then
  ref=""; bad=0
  for t in $TARGETS; do
    mkdir -p "$OUT/out/$t"
    case $t in
      darwin-*)
        run=(); [ "$t" == darwin-x64 ] && run=(arch -x86_64)
        ENGINE="$OUT/$t/pulsar-engine" ${run[@]+"${run[@]}"} "$ROOT/engine/test.sh" | tail -1 | sed "s/^/test   $t /"
        for f in "$ROOT"/engine/fixtures/*.facts "$ROOT"/engine/fixtures/invalid/*.facts; do
          n=${f#"$ROOT"/engine/fixtures/}; mkdir -p "$OUT/out/$t/$(dirname "$n")"
          code=0; ${run[@]+"${run[@]}"} "$OUT/$t/pulsar-engine" "$f" >"$OUT/out/$t/$n.out" 2>/dev/null || code=$?
          echo "$code" >"$OUT/out/$t/$n.code"
        done
        ;;
      linux-*)
        in_linux "$t" bash -c "cp -R /fx /tmp/e && ENGINE=/w/$t/pulsar-engine /tmp/e/test.sh | tail -1" | sed "s/^/test   $t /"
        in_linux "$t" bash -c "cd /fx/fixtures && for f in *.facts invalid/*.facts; do mkdir -p /w/out/$t/\$(dirname \$f); code=0; /w/$t/pulsar-engine \$f >/w/out/$t/\$f.out 2>/dev/null || code=\$?; echo \$code >/w/out/$t/\$f.code; done"
        ;;
    esac
    if [ -z "$ref" ]; then ref=$t
    elif diff -r "$OUT/out/$ref" "$OUT/out/$t" >/dev/null; then echo "same   $t == $ref on every fixture (stdout and exit code)"
    else echo "DIFF   $t != $ref"; diff -r "$OUT/out/$ref" "$OUT/out/$t" | head -20; bad=1
    fi
  done
  [ $bad == 0 ] || die "binaries disagree"
fi

echo "manifest $OUT/MANIFEST"
cat "$OUT/MANIFEST"
