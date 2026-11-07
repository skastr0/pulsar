# bend-cycles

Import-cycle detector (TS-AD-02 equivalent) written end to end in Bend 2.0.40.
`bend main.bend -o bend-cycles && ./bend-cycles <repo> [--production]`.

Pure core: `Lex.bend` (tokens), `Extract.bend` (specifiers), `Resolve.bend`
(edges), `Graph.bend` (SCC), `Select.bend` (optional production-file filter).
Shell: `main.bend`. Laws: `LAWS.bend` / `PROOF.bend`. Tests: `./test-fixtures.sh`.

## Deliberate differences from Pulsar's TS-AD-02

- Files come from `git ls-files` (tracked only), `.ts .tsx .mts .cts` minus `.d.ts`.
  Pulsar uses the tsconfig program, `--cached --others`, and a production-only
  filter. `--production` approximates that filter (not tsconfig coverage).
- Not resolved: tsconfig `paths`/`baseUrl`, workspace package names, bare
  specifiers (counted as unresolved). `/abs` specifiers never match.
- Type-only elision is syntactic only: `import type`, `export type`, and
  clauses whose bindings are all inline `type`. Pulsar also drops an import
  whose value bindings are only used in type positions, and `export { A } from`
  when A is only an interface/alias in the target. We keep those edges.
- `import()` and `require()` literals are scanned and counted but are not edges
  (Pulsar only walks Import/ExportDeclaration).
- Resolution candidate order is Pulsar's (index file before sibling file,
  tsx before ts), not TypeScript's. See the comment in `Resolve.bend`.
- Regex-vs-division is a previous-token heuristic; JSX text is not modelled
  (an apostrophe in JSX text opens a string closed at end of line); string and
  template text is kept only after `from`, `import` or `(`.
- Output order is by file index, which equals sorted path order.
