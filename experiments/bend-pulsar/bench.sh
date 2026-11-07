#!/bin/sh
# usage: bench.sh <binary> <repo> <threads> <runs>
# Prints one line per run: wall_s max_rss_bytes, then medians.
bin=$1; repo=$2; threads=$3; runs=${4:-5}
tmp=$(mktemp)
i=0
while [ $i -lt "$runs" ]; do
  /usr/bin/time -l "$bin" "$repo" +RTS --threads "$threads" 2>&1 >/dev/null | awk '/ real /{w=$1} /maximum resident/{r=$1} END{print w, r}' >> "$tmp"
  i=$((i+1))
done
sort -n "$tmp" | awk '{w[NR]=$1} END{print "wall_median_s", w[int((NR+1)/2)]}'
sort -k2 -n "$tmp" | awk '{r[NR]=$2} END{print "rss_median_MB", r[int((NR+1)/2)]/1048576}'
echo "runs: $(tr '\n' ';' < "$tmp")"
rm -f "$tmp"
