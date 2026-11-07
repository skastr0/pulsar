# pulsar-rust-types

Opt-in Rust type lane (#685): rust-analyzer's libraries in-process, workspace bodies only.
A separate crate and binary, so the `pulsar` CLI never links `ra_ap_*`.

```
pulsar-rust-types <workspace-dir> [--repo <repo-root>] [--facts <facts-file>]
                  [--out <file>] [--shard <crate>] [--rss-limit-mb <n>]
```

Reads the syntax lane's `<facts>.fns` and joins on (repo-relative path, start line), so type
facts carry the same function ids. Without `--facts` it numbers functions itself and writes
`<out>.fnspots` for a later join; that mode exists so the lane can be measured before the
Rust syntax lane wires `.fns` for a workspace.

## Facts

Explained in the design note "Type lane facts: encoding proposal (#685)". Current output:

| Tag | Fields | State |
|---|---|---|
| `IM` | `impl tr self_ty` | emitted; `tr` is 4294967295 for an inherent impl |
| `IF` | `fn impl` | emitted for methods and associated functions |
| `CM` | `fn expr callee mode` | emitted; mode 0 inherent, 1 trait, 2 free |
| `RT` | `fn expr ty flags` | emitted with flags 16 (receiver) and 32 (reference or pointer) |

Side tables: `<out>.syms` (`kind<TAB>rendered`) and `<out>.exprs` (`fn<TAB>expr<TAB>path<TAB>line`).

Not yet emitted, and therefore not claimed: `RT` flags 1 and 2 (`Result`/`Option`), because the
ADT path needs `AdtId` lookup this version exposes differently, and 4 and 8 (discarded,
unwrapped), which need the expression's AST context. Until they exist, error-swallowing
detectors have `CM`/`IF` but not typed `Result` evidence.

## Pins and the load

`ra_ap_*` are pinned `=0.0.349`, and the `salsa` family must be `0.28.2` (`0.28.5` breaks
`ra_ap_span`); `Cargo.lock` is committed for both, and it is pulsar-rs's lock from
`research/rust-types-harness`, which measured the options (#658). Loading mirrors their
harness: sysroot discovered, no proc-macro server, `prefill_caches=false`, one worker.

Measured on a Boat large VM (8 vCPU, 16 GB), `pulsar`'s own `cli/` workspace, idle machine:

| Measure | Value |
|---|---|
| wall | 6.91 s (workspace load 0.38 s) |
| peak RSS | 1,066 MB |
| crates | 158 total, 1 local |
| impls / methods | 28 / 194 |
| functions joined | 313 matched, 188 unmatched |
| typed expressions | 23,438, unknown 0 |
| method calls | 3,313 |

The 188 unmatched are function-shaped items whose (path, start line) has no `.fns` row:
trait items without bodies, macro-generated items, and anything whose span the syntax lane
does not emit. They are counted, never guessed.

RSS climbs with bodies analysed (salsa memoizes and nothing evicts), so the lane takes
`--rss-limit-mb` (default 4096) and exits 3 with a message naming the limit rather than being
killed, and `--shard <crate>` to analyse one crate per run.
