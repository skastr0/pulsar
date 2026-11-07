# lang/ts

TypeScript adapter. Owner: pulsar-ts (oxc facts, `oxc_resolver`, later the tsrs type lane). Today it emits `N`, `F`, `K`, `I` and `U`; it also emits function facts `M`, `FN`, `FK`, `CT` and the `.fns` side table (`functions.rs` walks the AST once per file; the shared row types and kind tables live in `lang/functions.rs`). It pushes rows through `crate::facts::FactWriter` and never formats a fact line itself. `extract.rs` parses one file, `resolve.rs` resolves specifiers, `scope.rs` decides production scope.
