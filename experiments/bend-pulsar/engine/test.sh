#!/bin/bash
# Run the engine over every fixture. engine/fixtures/*.facts must print exactly
# the matching .expected; engine/fixtures/invalid/*.facts must exit 2 with no stdout.
cd "$(dirname "$0")"
ENGINE=${ENGINE:-./pulsar-engine}
pass=0; fail=0
for f in fixtures/*.facts; do
  n=${f%.facts}
  if out=$($ENGINE "$f" 2>/dev/null) && [ "$out" == "$(cat "$n.expected")" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); echo "FAIL $n"; echo "$out" | head -8
  fi
done
for f in fixtures/invalid/*.facts; do
  out=$($ENGINE "$f" 2>/dev/null); code=$?
  if [ "$code" == 2 ] && [ -z "$out" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $f (exit $code)"; fi
done
echo "pass=$pass fail=$fail"
[ "$fail" == 0 ]
