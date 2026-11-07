#!/usr/bin/env python3
# Synthetic Effect facts for the layer-graph detectors' memory and time gate.
# gen-layers.py <layers> <services> <seed>: about 2 LQ per layer, 1.5 LP per
# composite layer (a forest of compositions under 3 roots), 10 US per service.
import random, sys
nl, ns, seed = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
R = random.Random(seed)
sv = sorted((s, R.randrange(nl), 1 if R.random() < 0.02 else 0) for s in range(ns))
ly = sorted({(l, R.randrange(nl), l % ns) for l in range(nl)} | {(R.randrange(nl), 0, R.randrange(ns)) for _ in range(nl // 20)})
lq = sorted({(l, R.randrange(ns)) for l in range(nl) for _ in range(2)})
# compositions: layer l (l >= 50) composes 1-2 layers with larger ids
lp = sorted({(o, R.randrange(o + 1, nl), R.choice((1, 2, 3))) for o in range(0, nl - 1) if o % 3 == 0 for _ in range(2)})
lr = [(r, r * 3) for r in range(3)]
lc = sorted({(l, l) for l in range(nl)})
nf = nl * 6
us = sorted({(R.randrange(nf), R.randrange(ns)) for _ in range(ns * 10)})
lo = sorted({R.randrange(nl) for _ in range(nl // 200)})
out = ["pulsar-facts 0", f"E {nl} {ns} 3"]
out += [f"SV {a} {b} {c}" for a, b, c in sv] + [f"LY {a} {b} {c}" for a, b, c in ly]
out += [f"LQ {a} {b}" for a, b in lq] + [f"LP {a} {b} {c}" for a, b, c in lp]
out += [f"LR {a} {b}" for a, b in lr] + [f"LC {a} {b}" for a, b in lc]
out += [f"LO {a}" for a in lo] + [f"US {a} {b}" for a, b in us]
print("\n".join(out))
