# lang/rust

Rust adapter. Owner: pulsar-rs. Emits `FN`, `FK`, `CT` (and the `.fns` rows) for fn items, impl and
trait methods and closures; `TF` for test code; `I` and `U` for the `use` graph over the module tree
(form 0, or 2 for a re-export), plus crate-level `I` rows from `cargo metadata`. The contract is
FACTS.md ("Rust" under CT kinds, "Rust module graph").

- `cargo.rs`: workspaces, packages, targets and member dependencies from `cargo metadata --no-deps --offline`.
- `graph.rs`: one module tree per target, `use` resolution, test-only files.
- `parse.rs`: one `syn` walk per file. Chosen over tree-sitter-rust by measurement (research/rust-types.md and the #657 evidence).
- `tests.rs`: diffs the emitter against `fixtures/rust-fn` (hand-checked by pulsar-cov) and resolves `use` paths in a throwaway crate. The `corpus` test is a measurement harness, run with `--ignored`.

The lane returns data (`analyze`): per-file `FileFns` with local ids, test flags, and `I`/`U` rows over
global file ids. The driver owns file ids and function numbering and writes every row through
`crate::facts::FactWriter`.
