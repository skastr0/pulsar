# Rust parser choice: syn vs tree-sitter-rust (#657)

Decision: `syn` 2 (features `full`, `visit`) with `proc-macro2` `span-locations`. Measured on two
unrelated Rust corpora, same walk written for both parsers (`tools` not committed; the bench crate
counts functions, closures, `if`, `match`, loops, `?` and `&&`/`||` over every `.rs` file).

Machine: Boat `default` VM from `pulsar-base`, x86_64, 4 vCPU, 8 GB, rustc 1.98.1, release build.
The VM's load average was 14 at the start of the run (a neighbour was building), so wall times are
noisy; three runs per cell are within 3% of each other except the first `none` run. Peak RSS is
GNU `time -v`.

Corpora: `asupersync` (cf192475: 821 files, 19.7 MB, 594k LOC) and `codex-rs` (6111791d0b: 2,026 files,
32.2 MB, 923k LOC). "none" = read and discard, the I/O floor.

| corpus | parser | 1 thread wall / RSS | 4 threads wall / RSS |
|---|---|---|---|
| asupersync | none | 0.006 s / 3 MiB | 0.002 s / 3 MiB |
| asupersync | syn | 0.84 s / 33 MiB | 0.23 s / 52 to 62 MiB |
| asupersync | tree-sitter | 1.33 s / 11 MiB | 0.35 s / 23 to 25 MiB |
| codex-rs | none | 0.011 s / 3 MiB | 0.003 s / 3 MiB |
| codex-rs | syn | 1.27 s / 57 MiB | 0.32 s / 78 to 88 MiB |
| codex-rs | tree-sitter | 2.12 s / 15 MiB | 0.55 s / 31 to 37 MiB |

Counts over the same files (4-thread runs):

| corpus | parser | fns | closures | if | match | loops | `?` | `&&`/`||` | files with errors |
|---|---|---|---|---|---|---|---|---|---|
| asupersync | syn | 27,526 | 5,873 | 7,279 | 2,572 | 4,836 | 2,846 | 982 | 0 |
| asupersync | tree-sitter | 27,526 | 5,873 | 7,279 | 2,572 | 4,836 | 2,846 | 973 | 0 |
| codex-rs | syn | 31,418 | 13,297 | 15,576 | 5,798 | 3,556 | 22,795 | 4,538 | 0 |
| codex-rs | tree-sitter | 31,418 | 13,297 | 15,576 | 5,798 | 3,556 | 22,795 | 3,539 | 1 |

Reading it:
- Everything except short-circuit operators agrees exactly. tree-sitter counts 9 fewer `&&`/`||` on
  asupersync and 999 fewer on codex-rs, and reports a parse error in one codex-rs file where syn
  parses all of them. I did not establish why. A guess is `let` chains (`if a && let Some(x) = b`),
  which codex-rs uses (526 lines contain `&& let `); unverified, and 526 lines do not account for 999.
  Since `&&` is a `CT` kind-6 node, the missing ones would change complexity.
- syn is 1.5 to 1.7 times faster, at about 3 times the peak memory (4 threads, codex-rs: 78 to 88 MiB
  against 31 to 37 MiB). Both are small against the lane's later costs; the 4-thread peak is
  bounded by the largest file's syntax tree per thread, since each tree is dropped after its walk.
- tree-sitter stays the planned route for languages with no `syn`-class parser.

Not measured: stack use on pathologically nested code (the lane runs syn on 64 MiB thread stacks and
syn itself stops at its recursion limit with an error, which the lane reports as a failed parse).
