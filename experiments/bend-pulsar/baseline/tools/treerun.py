#!/usr/bin/env python3
"""Run a command in its own process group; sample process-tree RSS (pgid members + descendants) every ~200ms;
kill the group if tree RSS exceeds limit. Writes metrics JSON. Usage:
treerun.py --out DIR [--limit-gib 24] [--timeout 1800] [--cwd D] -- cmd args..."""
import argparse, json, os, signal, subprocess, sys, time
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--limit-gib", type=float, default=24)
ap.add_argument("--timeout", type=float, default=1800)
ap.add_argument("--interval", type=float, default=0.2)
ap.add_argument("--cwd", default=None)
ap.add_argument("cmd", nargs=argparse.REMAINDER)
a = ap.parse_args()
cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
os.makedirs(a.out, exist_ok=True)
so = open(os.path.join(a.out, "stdout"), "wb"); se = open(os.path.join(a.out, "stderr"), "wb")
t0 = time.perf_counter()
p = subprocess.Popen(cmd, cwd=a.cwd, stdout=so, stderr=se, stdin=subprocess.DEVNULL, start_new_session=True)
pgid = p.pid
def snap():
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,pgid=,rss=,comm="], capture_output=True, text=True).stdout
    rows = []
    for l in out.splitlines():
        f = l.split(None, 4)
        if len(f) < 5: continue
        rows.append((int(f[0]), int(f[1]), int(f[2]), int(f[3]), f[4]))
    kids = {}
    for r in rows: kids.setdefault(r[1], []).append(r[0])
    tree = {pgid}; st = [pgid]
    while st:
        for c in kids.get(st.pop(), []):
            if c not in tree: tree.add(c); st.append(c)
    sel = [r for r in rows if r[2] == pgid or r[0] in tree]
    return sel
peak = 0; peak_t = 0; peak_procs = []; n = 0; fired = False; timed_out = False
timeline = []
peak_by_comm = {}  # max over time of rss per comm-class (bun/tsgo...)
while True:
    sel = snap(); n += 1
    tot = sum(r[3] for r in sel)
    el = time.perf_counter() - t0
    if tot > peak:
        peak = tot; peak_t = el
        peak_procs = sorted([(r[3] // 1024, os.path.basename(r[4])) for r in sel], reverse=True)[:6]
    cls = {}
    for r in sel:
        k = os.path.basename(r[4]); cls[k] = cls.get(k, 0) + r[3]
    timeline.append((round(el,2), round(sum(v for k,v in cls.items() if 'bun' in k and '(' not in k or k=='(bun)')/1024), round(sum(v for k,v in cls.items() if 'tsc' in k and k!='(tsc)')/1024) , round(tot/1024)))
    for k, v in cls.items():
        peak_by_comm[k] = max(peak_by_comm.get(k, 0), v)
    if tot > a.limit_gib * 1024 * 1024:
        fired = True; os.killpg(pgid, signal.SIGKILL); break
    if el > a.timeout:
        timed_out = True; os.killpg(pgid, signal.SIGKILL); break
    if p.poll() is not None: break
    time.sleep(a.interval)
rc = p.wait(); wall = time.perf_counter() - t0
try: os.killpg(pgid, signal.SIGKILL)
except Exception: pass
m = dict(cmd=cmd, exit=rc, wall_s=round(wall, 3), peak_tree_rss_mib=round(peak / 1024, 1), peak_at_s=round(peak_t, 2),
         peak_procs_mib=peak_procs, peak_by_comm_mib={k: round(v / 1024, 1) for k, v in sorted(peak_by_comm.items(), key=lambda kv: -kv[1])[:5]},
         samples=n, watchdog_fired_24GiB=fired, timed_out=timed_out, limit_gib=a.limit_gib)
m["timeline_s_bun_tsc_total_mib"]=timeline
json.dump(m, open(os.path.join(a.out, "metrics.json"), "w"), indent=1)
m2=dict(m); m2.pop("timeline_s_bun_tsc_total_mib"); print(json.dumps(m2))
