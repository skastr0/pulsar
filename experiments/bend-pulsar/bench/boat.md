# Running on Boat VMs

Heavy work runs on Boat VMs, not on the Mac: builds, tests, `--verdict`, corpus runs, coverage and benchmarks (charter, Compute section). Every seat starts its VMs from the shared snapshot **`pulsar-base`**.

## Snapshot layers

Each layer starts from the one above it. `boat new --from <name>` starts a VM from any of them.

| Layer | Name | Contents | Owner | Size | VM ready in |
|---|---|---|---|---|---|
| 1 | `pulsar-base` | the toolchains (below) | pulsar-bend | 6.0 GB | 4 s |
| 2 | `pulsar-corpora` | pulsar-base, plus the 18 validation repos at their recorded shas, with full history for junto, effect and one Rust repo | pulsar-fidelity, once the #668 corpora are in place | not built yet | not built yet |
| 3 | `pulsar-<short-sha>` | pulsar-corpora, plus the repo at that commit, with `cli/` built in release, the engine built and cargo deps warm | cut at milestones (the first dogfood run, then after big build changes), not on every commit | not built yet | not built yet |

- **Retention:** keep the newest 2 of each layer and delete older ones with `boat snapshot rm <name>`. A saved snapshot costs about $0.06 a day.
- **Names:** `pulsar-base` is a single name that each rebuild replaces. Keep the previous base as `pulsar-base-prev` while the new one is checked.
- **When a layer is built:** add its row here, then mail every seat the `boat new --from <name>` line.

## What pulsar-base holds

`default` type: 4 vCPU, 8 GB, Ubuntu 24.04, x86-64. It was built by `bench/boat-setup.sh`, and every tool is on PATH for a non-interactive `boat ssh`.

| Tool | Version | Pinned by |
|---|---|---|
| Rust | 1.98.1, with clippy, rustfmt, llvm-tools | the Mac's toolchain (no `rust-toolchain.toml` yet) |
| cargo-llvm-cov | 0.9.1, the prebuilt release (no 13-minute compile) | `boat-setup.sh` |
| Bend | 2.0.40, with the release sha256 checked | `packaging/bend-version` |
| Lean | 4.34.0 through elan, so `--verdict` works | `boat-setup.sh` |
| clang | 20.1.2, plus lld and llvm. Bend's `!` calls need 19+. | `boat-setup.sh` |
| Other | node 24.22, bun 1.3.14, python 3.12, GNU `time`, `jq`, `hyperfine` | the image, plus apt |

The snapshot also includes `/home/user/pulsar`: the repo as of the snapshot, with `cli/target` already built and the cargo registry fetched. A push refreshes it, and the first build is then incremental.

## Use it

```sh
id=$(boat new --no-env --type default --ttl 7200 --from pulsar-base --json | tail -1 | jq -r .id)
boat rename $id <seat>-$id-<purpose>                   # naming rule: seat, boat id, purpose
boat push $id /Users/guilhermecastro/Projects/pulsar --to /home/user/pulsar
boat ssh $id 'cd ~/pulsar/experiments/bend-pulsar/cli && cargo build --release'
boat ssh $id 'cd ~/pulsar/experiments/bend-pulsar/engine && bend main.bend -o /tmp/e.c && clang -O2 -o pulsar-engine /tmp/e.c -lm -lpthread && bash test.sh'
boat ssh $id 'cd ~/pulsar/experiments/bend-pulsar && bend PROOF.bend --verdict'
boat scp $id:/home/user/pulsar/<result> ./<result>      # results back
boat stop $id    # pause, or:
boat delete $id --yes                                  # then check `boat list` is empty
```

- **Always pass `--no-env`**, so no secrets go up.
- **The push carries no `.git`, and drops executable bits.** Call scripts with `bash x.sh`, not `./x.sh`. The CLI's `git ls-files` needs a repo, so before `pulsar facts` or `pulsar cycles` on the pushed tree, run:
  `cd ~/pulsar && git init -q && git add -A && git -c user.name=vm -c user.email=vm@localhost commit -qm vm`.
- **Real git history**, for the history and dogfood lanes. `boat push` drops `.git`, so send the history as a bundle and lay it under the pushed tree. The working files and the warm `cli/target` stay, and uncommitted Mac edits show as changes against `main`:
  ```sh
  git -C /Users/guilhermecastro/Projects/pulsar bundle create /tmp/p.bundle --all   # 5.3 MB, 2 s
  boat scp /tmp/p.bundle $id:/home/user/p.bundle
  boat push $id /Users/guilhermecastro/Projects/pulsar --to /home/user/pulsar
  boat ssh $id 'cd ~/pulsar && rm -rf .git && git init -q && git fetch -q --update-head-ok ~/p.bundle "refs/heads/*:refs/heads/*" && git reset -q main'
  ```
  For a clean checkout without the Mac's working tree, use `git clone -q ~/p.bundle ~/pulsar-clean`. Either way, use this instead of the `git init` line above when history matters.
- **Files deleted on the Mac stay on the VM after a push.** Start a new VM from pulsar-base when that matters.
- **Benchmarks:** only on an idle VM. Name the type and give the load average.

## Measured (2026-11-07)

| Step | Time |
|---|---|
| `boat new --from pulsar-base` until ready | 4 s |
| `boat push` of the repo (9.4 MB, 1,105 files) | 10 to 15 s |
| `cargo build --release` in cli/, cold | 28 s wall (53 s user, 0.53 GB RSS) |
| the same, warm from the snapshot after a push | 11 s |
| `cargo test --no-run`, cold | 10 s |
| `bend main.bend -o` C, then clang -O2 | 1.4 s (0.86 GB RSS), then 1.4 s; 3.9 s for both on a fresh VM |
| `bend PROOF.bend --verdict` (top level) | 18.5 s first run (1.4 GB RSS), 5.9 s after |
| `boat-setup.sh` on a stock VM | about 2 min (apt 40 s, the rest 31 s, after a first try failed) |
| `boat snapshot <id> pulsar-base` | 50 s, 6.0 GB |

The C that Bend emits on the VM has the same sha256 as on the Mac (f7055801 for the engine on 2026-11-07), so packaging can run on either.

## Rebuilding the snapshot

```sh
id=$(boat new --no-env --type default --ttl 7200 --json | tail -1 | jq -r .id)
boat scp experiments/bend-pulsar/bench/boat-setup.sh $id:/home/user/boat-setup.sh
boat ssh $id 'bash /home/user/boat-setup.sh'
boat push $id /Users/guilhermecastro/Projects/pulsar --to /home/user/pulsar
boat ssh $id 'cd ~/pulsar/experiments/bend-pulsar/cli && cargo fetch && cargo build --release && cargo test --no-run'
boat ssh $id 'rm -f /home/user/boat-setup.sh'
boat snapshot $id pulsar-base     # reusing the name replaces the snapshot
boat delete $id --yes
```
