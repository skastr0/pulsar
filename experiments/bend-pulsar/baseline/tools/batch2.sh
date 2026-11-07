#!/bin/bash
S=/private/tmp/claude-501/-Users-guilhermecastro-Projects-pulsar/5af48335-7823-44bc-b7c1-56f913ba168f/scratchpad
cd /Users/guilhermecastro/Projects/pulsar
CLI="bun packages/cli/src/bin.ts"
for corpus in pulsar junto; do
  R=$S/work/$corpus
  while read sig; do
    export PULSAR_STATE_HOME=$S/state/b2-$corpus
    python3 $S/tools/treerun.py --interval 0.1 --out $S/runs/b2/$corpus/$sig-1 -- $CLI score --signal $sig --no-progress $R >/dev/null
  done < $S/runs/signal-ids.txt
done
echo DONE > $S/runs/b2/DONE
