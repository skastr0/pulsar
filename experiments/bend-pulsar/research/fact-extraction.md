# Fact extraction for Pulsar Bend: parsers, indexers, resolution

Clean room: docs, papers, READMEs and release notes only. No implementation source was read. **(inf.)** marks my inference. "No figure found" means I looked and none was published.

## Headlines

1. One Rust binary, three lanes: oxc for TS/JS, tree-sitter for every other language, and optional external resolution lanes (SCIP indexers, tsrs).
2. Do not build on stack-graphs. It is archived and covers 4 languages.
3. SCIP is a good optional input for resolved references. It is not a fact interchange format.
4. Module graphs come from each ecosystem's own tool, not from parsing: `cargo metadata`, `go list -json`, `compile_commands.json`, `oxc_resolver`.
5. The syntax lane is cheap and uniform. Cross-file name resolution and types are the expensive, language-specific part.

## What each component is

**tree-sitter** is an incremental parser generator with a dependency-free C11 runtime, MIT licensed (https://github.com/tree-sitter/tree-sitter). Queries are S-expression patterns with fields and captures (https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html). Tags queries give a uniform vocabulary, `@definition.{class,function,interface,method,module}` and `@reference.{call,class,implementation}`, with `tree-sitter tags` as the driver (https://tree-sitter.github.io/tree-sitter/4-code-navigation.html). `locals.scm` marks `@local.scope`, `@local.definition` and `@local.reference`. A reference "*may* refer" to an earlier definition, so this is heuristic scoping (https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html). Published speed: tree-sitter-rust parsed a 9.9 KB, 2,157-line file at 9,908 bytes/ms, 2 to 3 times slower than rustc's parser (https://github.com/tree-sitter/tree-sitter-rust). No memory figure found.

**oxc** parses JS and TS: 3.4 to 4.0 ms for cal.com.tsx and 26 to 30 ms for typescript.js, 3x faster than swc, with peak RSS 11.5 MB and 68.8 MB (https://github.com/oxc-project/bench-javascript-parser-written-in-rust). It passes 99.86% of TypeScript's parser tests (https://oxc.rs/docs/learn/architecture/parser.html) and returns ESM import/export info directly (https://oxc.rs/docs/guide/usage/parser.html). The AST is arena-allocated and distinguishes `BindingIdentifier` from `IdentifierReference` (https://oxc.rs/docs/learn/architecture/parser.html). `oxc_semantic` is a second pass that builds scopes, symbols, resolved references and unresolved references, within one file (https://docs.rs/oxc_semantic/latest/oxc_semantic/). Licence MIT (https://github.com/oxc-project/oxc). `oxc_resolver` implements the Node ESM and CJS algorithms plus tsconfig `extends`, `paths` and `references`. It takes an in-memory filesystem trait and supports Yarn PnP. It is 28x faster than enhanced-resolve (https://github.com/oxc-project/oxc-resolver, https://oxc.rs/docs/guide/usage/resolver.html). Licence MIT.

**stack-graphs** gives file-incremental name resolution on tree-sitter, from syntax alone, with no build (https://arxiv.org/abs/2211.01224). Definitions exist for Java, JavaScript, Python and TypeScript only (https://github.com/github/stack-graphs/tree/main/languages). The repo is archived and "no longer supported or updated by GitHub" (https://github.com/github/stack-graphs). Licence MIT or Apache-2.0. For other languages GitHub's navigation is search-based, a tree-sitter name match across the repo (https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github). I found no published accuracy figures.

**SCIP** is a Protobuf schema, Apache-2.0, meant for transmission, not storage or querying (https://github.com/scip-code/scip, https://github.com/scip-code/scip/blob/main/docs/DESIGN.md). It replaced LSIF, which Sourcegraph has deprecated and removed (same DESIGN.md). Symbols are human-readable strings: `<scheme> <manager> <package> <version> <descriptors>`, or `local <id>` (https://github.com/scip-code/scip/blob/main/scip.proto). Occurrences carry roles: Definition, Import, ReadAccess, Generated, Test, ForwardDefinition (same file). The schema has documents, symbol information, relationships and diagnostics, and no function, branch or complexity records. **(inf.)** from the message list in the same file. Reported gains over LSIF: indexes about 5x smaller uncompressed, 10x faster CI for scip-typescript (https://sourcegraph.com/blog/announcing-scip).

**tsrs** (Rust port of TypeScript 7, Apache-2.0, repo created 2026-10-01, 0.20.0 line) is a pre-stable "drop-in" compiler and language server (https://github.com/oxc-project/tsrs). It matches 13,458 of 13,462 error baselines and all 12,779 `.types`/`.symbols` baselines (https://github.com/oxc-project/tsrs/blob/main/docs/COMPATIBILITY.md). On a 16 vCPU runner it type-checks vscode in 0.82 s at 2.10 GiB peak, webpack in 0.14 s at 536 MiB, and the small Compiler project at 100 MiB. tsgo needs 7.48 GiB for vscode (https://github.com/oxc-project/tsrs/blob/main/bench/RESULTS.md). The programmatic surface is `tsrs --api`, with MessagePack or JSON-RPC over stdio or a pipe. It exposes `resolveModuleName`, `getSymbolAtLocation`, `getTypeAtLocation` and `getReferencesToSymbolInFile`. The last three are marked "partial", and the docs call protocol coverage incomplete (https://github.com/oxc-project/tsrs/blob/main/docs/NODE_API.md). Pull requests are closed (https://github.com/oxc-project/tsrs).

## Best option per language

| Language | Syntax | Resolution or types, if any | Licences | Published speed or memory |
|---|---|---|---|---|
| TypeScript, JS | oxc (above) | scopes: `oxc_semantic`; types: tsrs `--api`; alt `scip-typescript` (Node, OOM flags documented) https://github.com/sourcegraph/scip-typescript | MIT; Apache-2.0 | oxc and tsrs figures above |
| Rust | tree-sitter-rust https://github.com/tree-sitter/tree-sitter-rust | rust-analyzer emits SCIP https://github.com/scip-code/scip | MIT; MIT and Apache-2.0 https://github.com/rust-lang/rust-analyzer | 9,908 B/ms; analyzer figure none found |
| Go | tree-sitter-go https://github.com/tree-sitter/tree-sitter-go | `scip-go` (types, via `go` and the packages driver) https://github.com/sourcegraph/scip-go | MIT; Apache-2.0 | none found |
| Python | tree-sitter-python https://github.com/tree-sitter/tree-sitter-python; Ruff's hand-written parser is >2x faster than its predecessor https://astral.sh/blog/ruff-v0.4.0 | `scip-python` (Pyright fork, Node 16+, OOM flag documented) https://github.com/sourcegraph/scip-python | MIT; MIT (LICENSE.txt, Pyright copyright) | none found |
| Ruby | tree-sitter-ruby https://github.com/tree-sitter/tree-sitter-ruby; Prism (C99, no dependencies) https://github.com/ruby/prism | `scip-ruby` on Sorbet, experimental https://github.com/sourcegraph/scip-ruby | MIT; MIT; scip-ruby not verified | none found |
| Elixir | tree-sitter-elixir, used by GitHub for navigation https://github.com/elixir-lang/tree-sitter-elixir | none listed | Apache-2.0 | none found |
| C, C++ | tree-sitter-c, tree-sitter-cpp https://github.com/tree-sitter/tree-sitter-cpp | `scip-clang`, beta, needs a compilation database https://github.com/sourcegraph/scip-clang | MIT; Apache-2.0 | about 2 MB temp per TU, 2 GB RAM per core |
| Zig | tree-sitter-zig (community grammar) https://github.com/tree-sitter-grammars/tree-sitter-zig | none listed | MIT | none found |
| Bend | tree-sitter-bend 0.2.37, archived https://github.com/HigherOrderCO-archive/tree-sitter-bend | none | MIT (https://github.com/HigherOrderCO-archive/tree-sitter-bend/blob/main/Cargo.toml) | none found |

The tree-sitter Bend grammar follows the same 0.2.37 line as Bend 1's tooling. Whether it parses Bend 2 is **unverified**. PRODUCT.md already leaves Bend's own scanner open. No SCIP indexer is listed for Elixir, Zig or Bend (https://github.com/scip-code/scip).

## Answers

### (1) Adapter architecture

One Rust binary, `bend-facts`, with a stable fact schema and three lanes. This design is **(inf.)**.

- **Lane A, syntax (always on).** oxc for TS and JS, tree-sitter for everything else, all linked statically. Per-language `.scm` queries emit the same record types, starting from the tags vocabulary. This is the only lane with uniform cost and coverage, and it needs no build, network or runtime. It also covers Elixir, Zig and Bend, where no better tool exists.
- **Lane B, project model (on by default, per ecosystem).** Run `cargo metadata`, `go list -json` and read `tsconfig` and `compile_commands.json`. See (2).
- **Lane C, resolution and types (opt-in, external).** Read `index.scip` from rust-analyzer, `scip-go`, `scip-python`, `scip-clang` and `scip-ruby`, using the Rust bindings in the SCIP repo (https://github.com/scip-code/scip). For TS types, spawn `tsrs --api` as a child process.

Why not SCIP only: it has no functions, branches or import edges, and it has indexers for 6 of the 9 non-TS targets (Rust, Go, Python, Ruby, C, C++). Each indexer needs the project built or its dependencies installed, and several run on Node. Why not stack-graphs: archived, 4 languages. Use SCIP's symbol-string scheme as the model for stable finding identity.

Output should be a line format. Bend has no JSON and costs 16 bytes per character, so intern paths and symbols into a string table and ship numeric ids. Keep names out of Bend's hot path.

### (2) Module resolution per language

| Language | Approach |
|---|---|
| TS, JS | `oxc_resolver` with a per-file tsconfig. The algorithm depends on `moduleResolution` (`node10`, `node16`, `nodenext`, `bundler`, `classic`), because TypeScript models the host (https://www.typescriptlang.org/docs/handbook/modules/theory.html). `exports` conditions must be set (https://github.com/oxc-project/oxc-resolver). Optional exact answer from tsrs `resolveModuleName`. |
| Rust | `cargo metadata` gives packages, targets with `src_path`, and the resolved dependency graph. Pin `--format-version`, since the output "is subject to change" (https://doc.rust-lang.org/cargo/commands/cargo-metadata.html). Inside a crate, follow `mod x;` through the file layout rules and `#[path]` (https://doc.rust-lang.org/reference/items/modules.html). |
| Go | `go list -json`: `Imports`, `ImportMap`, `Deps`, `GoFiles`, `IgnoredGoFiles` (build constraints) (https://pkg.go.dev/cmd/go#hdr-List_packages_or_modules). |
| Python | Static approximation only. Resolution runs at runtime through `sys.meta_path` finders, regular and namespace packages (https://docs.python.org/3/reference/import.html). Take roots from project config and mark unresolved imports as "dynamic", not as errors. |
| Ruby | `require` searches `$LOAD_PATH` (https://docs.ruby-lang.org/en/master/Kernel.html). Take load-path roots from config and mark the rest dynamic. |
| C, C++ | `compile_commands.json` replays each compilation (https://clang.llvm.org/docs/JSONCompilationDatabase.html). Resolve `#include` using its `-I` flags. |
| Elixir | `alias`, `import` and `require` are lexically scoped directives (https://hexdocs.pm/elixir/alias-require-and-import.html). **(inf.)** Build a project-wide index of `defmodule` names. |
| Zig | `@import` takes a named module registered in `build.zig` or a relative path (secondary source: https://learningzig.org/lessons/25-packaging-and-modules). |
| Bend | Unresearched. |

### (3) Cheap versus expensive facts

| Needs | Facts |
|---|---|
| Syntax only | Module identity (path). Import and export statements. Definitions (tags queries). Call-site names, textual. Functions and branch nodes, for cyclomatic-style counts and duplication **(inf.)**. |
| Module resolution only | Import edges: cycles, boundaries, fan-in and fan-out. |
| Single-file scopes | Local definition to reference, unused locals and imports. oxc does this exactly. tree-sitter `locals.scm` is heuristic. |
| Cross-file name resolution | Reference to definition across files, unused exports, stable symbol identity. Stack-graphs, SCIP, or oxc plus the resolver for TS. |
| Types | Receiver-typed calls, interface implementations and dynamic dispatch, type-only edges, type-level coupling. tsrs, SCIP indexers. |

The stack-graphs paper shows that syntax alone can handle type-directed lookups, but only where someone wrote and maintains the rules (https://arxiv.org/abs/2211.01224).

### (4) Licences (listed only)

- MIT: tree-sitter and its grammars (TypeScript, Rust, C, C++, Python, Go, Ruby, Zig, Bend); oxc; oxc_resolver; Ruff; Prism; scip-python.
- Apache-2.0: tsrs (derivative of TypeScript, see its NOTICE); SCIP; scip-typescript; scip-go; scip-clang; tree-sitter-elixir.
- MIT and Apache-2.0: stack-graphs (either); rust-analyzer (both).
- BSD-3-Clause: the Go toolchain (https://github.com/golang/go).
- Not verified: scip-ruby, Cargo.

## Open gaps

- No published memory figure for tree-sitter, stack-graphs, or any SCIP indexer except scip-clang's per-TU numbers.
- Stack-graphs accuracy is unpublished.
- tsrs is about five weeks old per its repo creation date and its API is partial. Treat the type lane as experimental.
- Next step: measure tree-sitter and oxc fact emission on the repo's own fixtures (`experiments/bend-pulsar/fixtures`) before fixing the schema.
