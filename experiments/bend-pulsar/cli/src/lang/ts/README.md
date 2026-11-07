# lang/ts

TypeScript adapter. Owner: pulsar-ts (oxc facts, `oxc_resolver`, later the tsrs type lane). Today it emits `N`, `F`, `K`, `I` and `U`; function facts `M`, `FN`, `FK`, `CT` and the `.fns` side table come next. It pushes rows through `crate::facts::FactWriter` and never formats a fact line itself. `extract.rs` parses one file, `resolve.rs` resolves specifiers, `scope.rs` decides production scope.
