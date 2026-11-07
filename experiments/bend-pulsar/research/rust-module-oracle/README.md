# Rust module tree against rustc's dep-info (#657)

Oracle: after `cargo check --workspace --all-targets --locked` on stable, every `target/debug/deps/*.d`
lists the source files rustc loaded for one crate; its first `.rs` entry is the crate root.
`oracle.py <corpus root> <trees file> <target dir>` compares that set with the file set of the same
root in the Rust lane's module tree (`PULSAR_RS_TREES=<file> cargo test --release lang::rust::tests::corpus -- --ignored`).

Boat default VM, x86_64, rustc 1.97.1, corpora as in `rust-types.md`. Files "missing" would be a lane defect
(rustc compiled a file the tree does not reach); files "extra" are in the tree but not compiled in this build.

| corpus | targets compared | exact | missing | extra |
|---|---|---|---|---|
| pulsar-cli | 1 | 1 | 0 | 0 |
| convex-rs | 1 | 1 | 0 | 0 |
| codex-rs | 88 | 51 | 0 | 231 files in 37 targets |

Limits, stated plainly:
- `cargo check` did not finish on convex-rs (a `mod` file missing in the snapshot: one target compiled)
  or on codex-rs (a build script failed in `codex-bwrap`), so only the crates that compiled are compared:
  88 of codex-rs's 209 targets. The other 121 targets have no oracle here.
- The 231 extra files are `cfg`-gated modules this Linux build did not load. By file name 33 of the 37
  affected targets list test modules (`*_tests.rs`, `tests.rs`, `test_support.rs`) and 4 list
  `windows_*`, `macos.rs` or `dummy.rs`; I did not classify each file against its `cfg` attribute.
- The oracle checks which files are in the tree, not that each `use` resolves to the right file. That is
  covered by the throwaway-crate test in `cli/src/lang/rust/tests.rs`.
