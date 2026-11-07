#!/bin/sh
# usage: runone.sh <label> <corpus> [extra args]
label=$1; shift
mkdir -p /home/user/ra-harness/results
out=/home/user/ra-harness/results/$label
echo "loadavg_before: $(cat /proc/loadavg)" > $out.txt
echo "mem_before: $(free -m | sed -n 2p)" >> $out.txt
/usr/bin/time -v /home/user/ra-harness/target/release/ra-harness "$@" >> $out.txt 2> $out.err
echo "exit: $?" >> $out.txt
