#!/usr/bin/env bash
# Check that text about to be committed names nothing that exists only in a
# private repo. This repo is public; the private corpora are not.
#
#   bash experiments/bend-pulsar/tools/private-check.sh <paths...>
#   bash experiments/bend-pulsar/tools/private-check.sh --range <base>..<head>
#
# Configuration lives outside this repo, in ~/.pulsar/private.conf:
#   private <dir>    a private repo or snapshot (its tracked files are scanned)
#   public  <dir>    reference code; a token found here is not private
#   name    <word>   a private repo or product name, never allowed
# A private repo's own .pulsar/ is skipped (it holds Pulsar's output).
# Exit 0 clean, 1 private tokens found, 2 usage or configuration error.
set -euo pipefail
conf=${PULSAR_PRIVATE_CONF:-$HOME/.pulsar/private.conf}
[ -f "$conf" ] || { echo "private-check: no $conf (see the header of this script)" >&2; exit 2; }
privs=(); pubs=(); names=()
while read -r kind val; do
  case "$kind" in
    private) privs+=("${val/#\~/$HOME}") ;;
    public)  pubs+=("${val/#\~/$HOME}") ;;
    name)    names+=("$val") ;;
  esac
done < <(grep -vE '^\s*(#|$)' "$conf")
[ ${#privs[@]} -gt 0 ] || { echo "private-check: no 'private' entries in $conf" >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
if [ "${1:-}" = "--range" ]; then
  git log -p --format='%B' "$2" | grep -E '^\+|^[^-@d]' > "$tmp/text" || true
else
  [ $# -gt 0 ] || { echo "usage: private-check.sh <paths...> | --range a..b" >&2; exit 2; }
  cat -- "$@" > "$tmp/text"
fi

found=0
for n in ${names[@]+"${names[@]}"}; do
  if grep -qiwF -- "$n" "$tmp/text"; then echo "private name: $n"; found=1; fi
done
# Candidate tokens: identifiers and path-like words of 4+ characters.
grep -oE '[A-Za-z_][A-Za-z0-9_]{3,}([./-][A-Za-z0-9_]+)*' "$tmp/text" | sort -u > "$tmp/tok"
for p in "${privs[@]}"; do
  [ -d "$p" ] || continue
  if git -C "$p" rev-parse -q --verify HEAD >/dev/null 2>&1; then
    git -C "$p" ls-files -z -- . ':!.pulsar' | (cd "$p" && xargs -0 cat 2>/dev/null || true)
  else
    find "$p" -type f -not -path '*/node_modules/*' -not -path '*/.pulsar/*' -exec cat {} + 2>/dev/null || true
  fi
done | grep -oE '[A-Za-z_][A-Za-z0-9_]{3,}([./-][A-Za-z0-9_]+)*' | sort -u > "$tmp/priv"
comm -12 "$tmp/tok" "$tmp/priv" > "$tmp/cand"
for p in ${pubs[@]+"${pubs[@]}"}; do
  [ -d "$p" ] || continue
  find "$p" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.md' -o -name '*.json' -o -name '*.bend' -o -name '*.toml' \) \
    -not -path '*/node_modules/*' -not -path '*/target/*' -exec cat {} + 2>/dev/null || true
done | grep -oE '[A-Za-z_][A-Za-z0-9_]{3,}([./-][A-Za-z0-9_]+)*' | sort -u > "$tmp/pub"
comm -23 "$tmp/cand" "$tmp/pub" > "$tmp/hits"
# Keep identifier-shaped tokens only: snake_case, camelCase, or paths and files.
# Plain or capitalised English words and hyphenated words are not reported.
grep -E '_|[a-z][A-Z]|/|\.[a-z]{1,5}$' "$tmp/hits" > "$tmp/hits2" || true
if [ -s "$tmp/hits2" ]; then
  echo "tokens found only in private repos:"; sed 's/^/  /' "$tmp/hits2"; found=1
fi
[ $found -eq 0 ] && echo "private-check: clean"
exit $found
