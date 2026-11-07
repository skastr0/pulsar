#!/bin/bash
# boat-setup.sh - provision a fresh Boat VM (Ubuntu 24.04, x86-64, user `user`)
# into the pulsar-base image. Idempotent: re-running only fills what is missing.
#
#   boat scp experiments/bend-pulsar/bench/boat-setup.sh <id>:/home/user/boat-setup.sh
#   boat ssh <id> 'bash /home/user/boat-setup.sh'
#
# Pins: Rust (what the CLI builds with on the Mac), Bend (packaging/bend-version,
# checked against the release sha256 that bend-lang.com/install.sh carries), Lean
# (the toolchain `--verdict` was run with). Every tool is linked into
# /usr/local/bin, so non-interactive `boat ssh '<cmd>'` finds it with no profile.
set -euo pipefail

RUST=1.98.1
BEND=2.0.40
BEND_SHA_LINUX_X64=c9ff8d67bd903fb6ad9a26b43d8a62c01021de82a44d55ce4a3dcd4732113d6b
LEAN=v4.34.0
LLVM=20
LLVM_COV=0.9.1

# The image keeps rustup and cargo under /usr/local, but a non-interactive ssh
# session does not export CARGO_HOME, so rustup would look in ~/.cargo.
export CARGO_HOME=${CARGO_HOME:-/usr/local/cargo} RUSTUP_HOME=${RUSTUP_HOME:-/usr/local/rustup}
grep -q '^CARGO_HOME=' /etc/environment 2>/dev/null \
  || printf 'CARGO_HOME=%s\nRUSTUP_HOME=%s\n' "$CARGO_HOME" "$RUSTUP_HOME" | sudo tee -a /etc/environment >/dev/null

step() { printf '\n== %s (%ss)\n' "$1" "$SECONDS"; }

step "apt: clang-$LLVM, lld, llvm, time, jq, hyperfine"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  "clang-$LLVM" "lld-$LLVM" "llvm-$LLVM" time jq hyperfine >/dev/null
for t in clang clang++ ld.lld llvm-profdata llvm-cov; do
  src=/usr/bin/$t-$LLVM; [ -e "$src" ] || src=/usr/lib/llvm-$LLVM/bin/$t
  sudo ln -sf "$src" /usr/local/bin/$t
done

step "rust $RUST"
rustup toolchain install "$RUST" --profile minimal -c llvm-tools-preview,clippy,rustfmt >/dev/null
rustup default "$RUST" >/dev/null

step "cargo-llvm-cov $LLVM_COV"
if ! cargo llvm-cov --version 2>/dev/null | grep -q "$LLVM_COV"; then
  curl -fsSL "https://github.com/taiki-e/cargo-llvm-cov/releases/download/v$LLVM_COV/cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xz -C "$(dirname "$(command -v cargo)")"
fi

step "bend $BEND"
if [ "$(~/.bend/bin/bend version 2>/dev/null)" != "bend $BEND" ]; then
  tmp=$(mktemp -d); name=bend-$BEND-linux-x64.tar.gz
  curl -fsSL -o "$tmp/$name" "https://github.com/bendlang/bend/releases/download/v$BEND/$name"
  echo "$BEND_SHA_LINUX_X64  $tmp/$name" | sha256sum -c - >/dev/null
  tar -xzf "$tmp/$name" -C "$tmp"
  mkdir -p ~/.bend/bin
  rm -rf ~/.bend/bend2 ~/.bend/guide
  mv "$tmp/bend/bend2" "$tmp/bend/guide" ~/.bend/
  mv -f "$tmp/bend/bin/bend" ~/.bend/bin/bend
  rm -rf "$tmp"
fi
sudo ln -sf ~/.bend/bin/bend /usr/local/bin/bend
# The daily version check is off on shared VMs.
grep -q BEND_NO_TELEMETRY /etc/environment || echo BEND_NO_TELEMETRY=1 | sudo tee -a /etc/environment >/dev/null

step "elan + lean $LEAN"
if [ ! -x ~/.elan/bin/elan ]; then
  curl -fsSL https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh \
    | sh -s -- -y --no-modify-path --default-toolchain "leanprover/lean4:$LEAN" >/dev/null
fi
~/.elan/bin/elan toolchain install "leanprover/lean4:$LEAN" >/dev/null 2>&1 || true
~/.elan/bin/elan default "leanprover/lean4:$LEAN" >/dev/null
for t in elan lean lake; do sudo ln -sf ~/.elan/bin/$t /usr/local/bin/$t; done

step "versions"
clang --version | head -1
rustc --version
cargo llvm-cov --version
bend version
lean --version
node --version
echo "bun $(bun --version)"
python3 --version
echo "done in ${SECONDS}s"
