#!/bin/sh
# Runs bend-cycles on every fixtures/<name>/ (copied into a throwaway git repo
# so `git ls-files` works) and diffs stdout against fixtures/<name>/expected.txt.
set -u
here=$(cd "$(dirname "$0")" && pwd)
bin=${BIN:-$here/bend-cycles}
tmp=$(mktemp -d)
fail=0
for d in "$here"/fixtures/*/; do
  name=$(basename "$d")
  rm -rf "$tmp/$name"; mkdir -p "$tmp/$name"
  (cd "$d" && find . -type f ! -name expected.txt -print0 | xargs -0 -I{} sh -c 'mkdir -p "$0/$(dirname {})" && cp {} "$0/{}"' "$tmp/$name")
  git -C "$tmp/$name" init -q && git -C "$tmp/$name" add -A
  "$bin" "$tmp/$name" > "$tmp/$name.out" 2> "$tmp/$name.err"
  if diff -u "$d/expected.txt" "$tmp/$name.out" > "$tmp/$name.diff"; then
    echo "ok   $name"
  else
    echo "FAIL $name"; cat "$tmp/$name.diff"; fail=1
  fi
done
rm -rf "$tmp"
exit $fail
