#!/usr/bin/env bash
# Build the static linux-x64 CLI (x86_64-unknown-linux-musl) in a Debian Rust container.
#
#   bash packaging/build-cli-linux.sh [--out <file>]     (default dist/cli/linux-x64/pulsar)
#
# Run it on an x86-64 Linux host with docker, from a clean git checkout: the whole repo is
# mounted so build.rs embeds the commit sha that `pulsar version` prints. Why a glibc image
# cross-compiling to musl: pg_query's build script runs bindgen, which must dlopen libclang, and a
# static-musl host (an Alpine image) cannot. bindgen gets clang's builtin headers and musl's.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
REPO=$(git -C "$ROOT" rev-parse --show-toplevel)
OUT=$ROOT/dist/cli/linux-x64/pulsar
[ "${1:-}" == "--out" ] && OUT=$2
IMAGE=rust:1.98-bookworm
[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] || { echo "build-cli-linux: the checkout has uncommitted changes" >&2; exit 1; }
REL=${ROOT#"$REPO"/}
docker run --rm -v "$REPO:/repo" -v "$HOME/.cargo/registry:/usr/local/cargo/registry" -w "/repo/$REL/cli" "$IMAGE" sh -c '
  set -e
  git config --global --add safe.directory /repo
  apt-get update -qq >/dev/null && apt-get install -y -qq musl-tools libclang-dev clang >/dev/null
  rustup target add x86_64-unknown-linux-musl >/dev/null 2>&1
  export BINDGEN_EXTRA_CLANG_ARGS="-I$(clang -print-resource-dir)/include -I/usr/include/x86_64-linux-musl"
  CARGO_TARGET_DIR=target-musl cargo build --release --locked --target x86_64-unknown-linux-musl
'
mkdir -p "$(dirname "$OUT")"
install -m 755 "$ROOT/cli/target-musl/x86_64-unknown-linux-musl/release/pulsar" "$OUT"
file "$OUT"
"$OUT" version | head -1
