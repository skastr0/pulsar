#!/usr/bin/env bash
# Stage the npm packages for a release, without publishing.
#
#   bash packaging/stage-npm.sh --cli-darwin-arm64 <bin> --cli-linux-x64 <bin> [--engine <dir>] [--out <dir>] [--pack]
#
# --engine  build-engine.sh output: <dir>/<target>/pulsar-engine and <dir>/MANIFEST
#           (default experiments/bend-pulsar/dist/engine)
# --out     default experiments/bend-pulsar/dist/npm
# --pack    also write the .tgz files with `npm pack` (still nothing is published)
#
# Writes <out>/pulsar (the launcher), <out>/pulsar-darwin-arm64 and <out>/pulsar-linux-x64, each
# with LICENSE and THIRD_PARTY_NOTICES (packaging/notices.py --check must pass first). A platform
# package holds bin/pulsar and engine/pulsar-engine plus the engine MANIFEST: the CLI finds the
# engine at <exe dir>/../engine. Checks: every version is the CLI's Cargo version, each binary is
# for its platform, and `npm pack --dry-run` lists the expected files.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
REPO=$(cd "$ROOT/../.." && pwd)
ENGINE=$ROOT/dist/engine
OUT=$ROOT/dist/npm
PACK=0
CLI_DARWIN=""; CLI_LINUX=""
cli_for() { if [ "$1" == darwin-arm64 ]; then echo "$CLI_DARWIN"; else echo "$CLI_LINUX"; fi; }
while [ $# -gt 0 ]; do
  case "$1" in
    --cli-darwin-arm64) CLI_DARWIN=$2; shift 2 ;;
    --cli-linux-x64) CLI_LINUX=$2; shift 2 ;;
    --engine) ENGINE=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --pack) PACK=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "stage-npm: unknown argument $1" >&2; exit 2 ;;
  esac
done
die() { echo "stage-npm: $*" >&2; exit 1; }
TARGETS="darwin-arm64 linux-x64"
for t in $TARGETS; do [ -n "$(cli_for $t)" ] || die "--cli-$t is required"; done

VERSION=$(sed -n 's/^version = "\(.*\)"/\1/p' "$ROOT/cli/Cargo.toml" | head -1)
for p in pulsar $(printf 'pulsar-%s ' $TARGETS); do
  v=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$HERE/npm/$p/package.json")
  [ "$v" == "$VERSION" ] || die "$p/package.json is $v, cli/Cargo.toml is $VERSION"
done
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); bad=[k for k,v in d["optionalDependencies"].items() if v!=sys.argv[2]]; sys.exit(", ".join(bad) if bad else 0)' \
  "$HERE/npm/pulsar/package.json" "$VERSION" || die "launcher optionalDependencies must all be $VERSION"

NOTICES=$ROOT/THIRD_PARTY_NOTICES
# The targets the notices are generated for: the release binaries' Rust targets.
NOTICE_TARGETS="--target aarch64-apple-darwin --target x86_64-unknown-linux-musl"
python3 "$HERE/notices.py" $NOTICE_TARGETS --check "$NOTICES" || die "THIRD_PARTY_NOTICES is stale"
[ -f "$ENGINE/MANIFEST" ] || die "no $ENGINE/MANIFEST: run packaging/build-engine.sh first"

expect() { # binary, target
  local d; d=$(file -b "$1")
  case "$2" in
    darwin-arm64) [[ "$d" == *Mach-O*arm64* ]] ;;
    linux-x64) [[ "$d" == *ELF*x86-64* ]] && [[ "$d" == *static* ]] ;;
  esac || die "$1 is not a $2 binary ($d)"
}

rm -rf "$OUT" && mkdir -p "$OUT"
cp -R "$HERE/npm/pulsar" "$OUT/pulsar"
cp "$REPO/README.md" "$OUT/pulsar/README.md"
for t in $TARGETS; do
  d=$OUT/pulsar-$t
  mkdir -p "$d/bin" "$d/engine"
  cp "$HERE/npm/pulsar-$t/package.json" "$d/"
  expect "$(cli_for $t)" "$t"
  expect "$ENGINE/$t/pulsar-engine" "$t"
  install -m 755 "$(cli_for $t)" "$d/bin/pulsar"
  install -m 755 "$ENGINE/$t/pulsar-engine" "$d/engine/pulsar-engine"
  cp "$ENGINE/MANIFEST" "$d/engine/MANIFEST"
done
for p in pulsar $(printf 'pulsar-%s ' $TARGETS); do
  cp "$REPO/LICENSE" "$OUT/$p/LICENSE"
  cp "$NOTICES" "$OUT/$p/THIRD_PARTY_NOTICES"
  (cd "$OUT/$p" && npm pack --dry-run --json 2>/dev/null) \
    | python3 -c 'import json,sys; r=json.load(sys.stdin)[0]; print(r["id"], r["size"], "bytes:", " ".join(sorted(f["path"] for f in r["files"])))'
  if [ $PACK == 1 ]; then (cd "$OUT" && npm pack "./$p" --silent >/dev/null); fi
done
[ $PACK == 1 ] && ls -l "$OUT"/*.tgz
echo "staged in $OUT; nothing published"
