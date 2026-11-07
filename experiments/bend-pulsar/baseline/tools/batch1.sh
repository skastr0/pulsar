#!/bin/bash
S=/private/tmp/claude-501/-Users-guilhermecastro-Projects-pulsar/5af48335-7823-44bc-b7c1-56f913ba168f/scratchpad
cd /Users/guilhermecastro/Projects/pulsar-legacy   # a checkout of tag v0.3.0: the legacy CLI left main in #717
CLI="bun packages/cli/src/bin.ts"
for corpus in pulsar junto; do
  R=$S/work/$corpus
  for i in 1 2 3; do
    export PULSAR_STATE_HOME=$S/state/b1-$corpus-$i; rm -rf $PULSAR_STATE_HOME
    python3 $S/tools/treerun.py --interval 0.1 --out $S/runs/b1/$corpus/ad02-$i -- $CLI score --signal TS-AD-02-circular-dependencies --no-progress $R >/dev/null
    python3 $S/tools/treerun.py --interval 0.1 --out $S/runs/b1/$corpus/agent-$i -- $CLI agent score $R >/dev/null
    python3 $S/tools/treerun.py --interval 0.1 --out $S/runs/b1/$corpus/profile-$i -- $CLI score --profile --json --no-progress $R >/dev/null
    for m in load map cycles; do
      python3 $S/tools/treerun.py --interval 0.1 --out $S/runs/b1/$corpus/drv-$m-$i -- bun $S/tools/driver.ts $m $R $S/runs/b1/$corpus/drv-cycles-$i.txt >/dev/null
    done
  done
done
echo DONE > $S/runs/b1/DONE
