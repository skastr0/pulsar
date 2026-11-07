#!/usr/bin/env bash
# Commit your own paths to main in the shared checkout, safely.
#
#   bash experiments/bend-pulsar/tools/commit.sh <seat> "<message>" -- <paths...>
#
# For a file several seats are editing at once (a shared working-tree file
# holding other seats' hunks), commit a blob you built yourself instead of the
# working-tree file:
#
#   ... -- --base <sha> --blob <repo-path>=<file> [--blob ...]
#
# Build <file> from `git show <sha>:<repo-path>` plus only your change, and
# pass that same <sha> as --base (required with --blob). At commit time your
# change is replayed onto main's current version of the file with a three-way
# merge (base = <sha>'s version), so anything committed to that file since
# <sha> is kept. A conflict aborts with nothing written. Plain paths and
# --blob entries can be mixed. The working tree is not touched.
#
# - Builds the commit in a private index (.git/index.<seat>) from HEAD,
#   with only <paths> taken from the working tree. Other seats' staged or
#   unstaged files are never included.
# - Moves main with a compare-and-swap (git update-ref new old). If another
#   seat committed in between, nothing is written: it rebuilds on the new
#   HEAD and retries, so a commit can never revert someone else's work.
# - Then syncs the shared index for <paths> only, and prints the commit
#   stat so you can check it lists only your paths.
#
# Deletions inside <paths> are committed too (git add -A on the pathspec).
# The message may span lines. There are no repo hooks to skip.
set -euo pipefail

if [ $# -lt 4 ] || [ "$3" != "--" ]; then
  echo "usage: commit.sh <seat> \"<message>\" -- <paths...> [--blob <repo-path>=<file>...]" >&2
  exit 2
fi
seat=$1
msg=$2
shift 3
paths=()
blobs=()
base=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--base" ]; then
    [ $# -ge 2 ] || { echo "commit.sh: --base needs a sha" >&2; exit 2; }
    base=$2
    shift 2
  elif [ "$1" = "--blob" ]; then
    [ $# -ge 2 ] && [[ "$2" == *=* ]] || { echo "commit.sh: --blob needs <repo-path>=<file>" >&2; exit 2; }
    src=${2#*=}
    [ -f "$src" ] || { echo "commit.sh: blob source $src not found" >&2; exit 2; }
    blobs+=("${2%%=*}=$(cd "$(dirname "$src")" && pwd)/$(basename "$src")")
    shift 2
  else
    paths+=("$1")
    shift
  fi
done

cd "$(git rev-parse --show-toplevel)"
if [ -n "${blobs[*]+x}" ]; then
  [ -n "$base" ] || { echo "commit.sh: --blob needs --base <sha> (the commit you built the blob from)" >&2; exit 2; }
  base=$(git rev-parse --verify -q "$base^{commit}") || { echo "commit.sh: --base is not a commit" >&2; exit 2; }
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
idx="$(git rev-parse --absolute-git-dir)/index.$seat"
branch=$(git symbolic-ref -q HEAD || true)
if [ "$branch" != "refs/heads/main" ]; then
  echo "commit.sh: HEAD is not main ($branch); refusing" >&2
  exit 2
fi

for try in 1 2 3 4 5 6 7 8; do
  old=$(git rev-parse HEAD)
  GIT_INDEX_FILE=$idx git read-tree "$old"
  if [ -n "${paths[*]+x}" ]; then GIT_INDEX_FILE=$idx git add -A -- "${paths[@]}"; fi
  for b in ${blobs[@]+"${blobs[@]}"}; do
    rp=${b%%=*}
    mine=${b#*=}
    git show "$base:$rp" > "$tmp/base" 2>/dev/null || : > "$tmp/base"
    git show "$old:$rp" > "$tmp/cur" 2>/dev/null || : > "$tmp/cur"
    if cmp -s "$tmp/base" "$tmp/cur"; then
      sha=$(git hash-object -w -- "$mine")
    else
      cp "$tmp/cur" "$tmp/merged"
      if ! git merge-file -q "$tmp/merged" "$tmp/base" "$mine"; then
        echo "commit.sh: $rp changed on main since --base and your change conflicts with it; rebuild your blob from HEAD" >&2
        exit 1
      fi
      echo "commit.sh: $rp moved since --base; replayed your change onto main's version" >&2
      sha=$(git hash-object -w -- "$tmp/merged")
    fi
    mode=$(git ls-tree "$old" -- "$rp" | awk '{print $1}')
    GIT_INDEX_FILE=$idx git update-index --add --cacheinfo "${mode:-100644},$sha,$rp"
  done
  tree=$(GIT_INDEX_FILE=$idx git write-tree)
  if [ "$tree" = "$(git rev-parse "$old^{tree}")" ]; then
    echo "commit.sh: nothing to commit in those paths" >&2
    exit 0
  fi
  new=$(printf '%s\n' "$msg" | git commit-tree "$tree" -p "$old" -F -)
  if git update-ref -m "commit.sh ($seat)" refs/heads/main "$new" "$old" 2>/dev/null; then
    synced=("${paths[@]+"${paths[@]}"}")
    for b in ${blobs[@]+"${blobs[@]}"}; do synced+=("${b%%=*}"); done
    git reset -q -- "${synced[@]}"
    git --no-pager show --stat --format='%h %s' "$new"
    exit 0
  fi
  echo "commit.sh: main moved under us, rebuilding on the new HEAD (try $try)" >&2
  sleep 0.$((RANDOM % 9 + 1))
done
echo "commit.sh: could not land after 8 tries; ask the lead" >&2
exit 1
