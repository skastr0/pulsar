# lang/rust

Rust adapter. Owner: pulsar-rs (`cargo metadata`, the module tree, syntax facts, later the type lane). It will emit the same function relations as the TypeScript lane (`M`, `FN`, `FK`, `CT`, plus `.fns` rows), `I` and `U` for the `mod`/`use` graph, and `CS` call sites. It uses `crate::facts::FactWriter` and tree-sitter or `syn`-class parsing, never its own fact printer.
