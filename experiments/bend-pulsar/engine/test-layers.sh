#!/bin/bash
# Run pulsar-layers over engine/fixtures/layers. Each *.facts must print exactly
# the matching .expected; fixtures/layers/invalid/*.facts must exit 2, no stdout.
# (Separate from test.sh until main.bend reads the v1 relations.)
cd "$(dirname "$0")"
BIN=${LAYERS:-./pulsar-layers}
pass=0; fail=0
for f in fixtures/layers/*.facts; do
  n=${f%.facts}
  if out=$($BIN "$f" 2>/dev/null) && [ "$out" == "$(cat "$n.expected")" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); echo "FAIL $n"; echo "$out" | head -8
  fi
done
for f in fixtures/layers/invalid/*.facts; do
  out=$($BIN "$f" 2>/dev/null); code=$?
  if [ "$code" == 2 ] && [ -z "$out" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $f (exit $code)"; fi
done
echo "pass=$pass fail=$fail"
[ "$fail" == 0 ]
