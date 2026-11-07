#!/bin/bash
# Run pulsar-classctx over engine/fixtures/classctx. Each *.facts must print exactly
# the matching .expected; fixtures/classctx/invalid/*.facts must exit 2, no stdout.
# (Separate from test.sh until the pipeline runs ClassCtx.)
cd "$(dirname "$0")"
BIN=${CLASSCTX:-./pulsar-classctx}
pass=0; fail=0
for f in fixtures/classctx/*.facts; do
  n=${f%.facts}
  if out=$($BIN "$f" 2>/dev/null) && [ "$out" == "$(cat "$n.expected")" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1)); echo "FAIL $n"; echo "$out" | head -8
  fi
done
for f in fixtures/classctx/invalid/*.facts; do
  out=$($BIN "$f" 2>/dev/null); code=$?
  if [ "$code" == 2 ] && [ -z "$out" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $f (exit $code)"; fi
done
echo "pass=$pass fail=$fail"
[ "$fail" == 0 ]
