//! Parse one file, decide each import-like statement's binding usage, drop the AST.

use super::calls::CatalogIndex;
use super::functions::{PackHook, Walker};
use crate::lang::functions::FileFns;
use oxc_allocator::Allocator;
use oxc_ast::ast::{ExportAllDeclaration, ExportFromDeclaration, ImportDeclaration, ImportDeclarationSpecifier};
use oxc_ast::AstKind;
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::SourceType;
use oxc_syntax::symbol::SymbolId;
use std::path::Path;

/// One import-like statement as the syntax says it (FACTS.md `I`/`U` input).
#[derive(Debug, Clone)]
pub struct RawImport {
    pub spec: String,
    /// 0 = `import ... from`, 1 = `import "x"`, 2 = `export ... from`
    pub form: u8,
    pub hv: bool,
    pub ht: bool,
    /// `export { a } from` specifiers (local names) whose type-ness depends on the target file.
    /// The caller settles them with `type_only_exports` and folds them into `hv`/`ht`.
    pub pending: Vec<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Use {
    /// Never referenced. Old Pulsar counts this as a value import (`undefined !== "type-only"`).
    Unused,
    Value,
    TypeOnly,
}

fn binding_use(scoping: &Scoping, sid: SymbolId) -> Use {
    let mut any = false;
    for rid in scoping.get_resolved_reference_ids(sid) {
        any = true;
        let r = scoping.get_reference(*rid);
        let f = r.flags();
        let type_pos = f.is_type() || f.is_value_as_type();
        if !type_pos && (r.is_read() || r.is_write()) {
            return Use::Value;
        }
    }
    if any {
        Use::TypeOnly
    } else {
        Use::Unused
    }
}

pub struct Extracted {
    pub imports: Vec<RawImport>,
    /// Functions and control trees, ids local to the file.
    pub functions: FileFns,
    /// Parser hit a fatal error and returned an empty program.
    pub fatal: bool,
}

pub fn extract(
    alloc: &Allocator,
    rel: &str,
    path: &Path,
    source: &str,
    index: &CatalogIndex,
    file_ctx: u8,
    hook: Option<&mut dyn PackHook>,
) -> Extracted {
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::ts());
    let ret = Parser::new(alloc, source, source_type).parse();
    if ret.fatal_error {
        return Extracted { imports: Vec::new(), functions: FileFns::default(), fatal: true };
    }
    let built = SemanticBuilder::new().with_build_nodes(true).build(&ret.program);
    let sem = built.semantic;
    let scoping = sem.scoping();
    let imports = import_like(&sem, scoping);
    let walker = Walker::new(rel, source);
    let walker = walker.with_calls(scoping, index, file_ctx);
    let walker = match hook {
        Some(h) => walker.with_hook(h),
        None => walker,
    };
    let functions = walker.run(&ret.program);
    Extracted { imports, functions, fatal: false }
}

/// Every import-like statement of the file, in node order.
fn import_like(sem: &oxc_semantic::Semantic<'_>, scoping: &Scoping) -> Vec<RawImport> {
    sem.nodes()
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::ImportDeclaration(d) => Some(import_declaration(d, scoping)),
            AstKind::ExportAllDeclaration(d) => Some(export_all(d)),
            AstKind::ExportFromDeclaration(d) => Some(export_from(d)),
            _ => None,
        })
        .collect()
}

/// `import ... from`, `import "x"`: form and the value/type use of its bindings.
fn import_declaration(d: &ImportDeclaration<'_>, scoping: &Scoping) -> RawImport {
    let spec = d.source.value.display().to_string();
    let (form, hv, ht) = match &d.specifiers {
        None => (1, true, false),
        Some(_) if d.import_kind.is_type() => (0, false, true),
        Some(list) if list.is_empty() => (0, false, false),
        Some(list) => {
            let (hv, ht) = binding_flags(list, scoping);
            (0, hv, ht)
        }
    };
    RawImport { spec, form, hv, ht, pending: Vec::new() }
}

/// `(hv, ht)` over an import's specifiers: an explicit `type` specifier is type-only, and an
/// unused binding counts as a value (old Pulsar's rule).
fn binding_flags(list: &[ImportDeclarationSpecifier<'_>], scoping: &Scoping) -> (bool, bool) {
    let (mut hv, mut ht) = (false, false);
    for s in list {
        if matches!(s, ImportDeclarationSpecifier::ImportSpecifier(i) if i.import_kind.is_type()) {
            ht = true;
            continue;
        }
        match binding_use(scoping, s.symbol_id()) {
            Use::Value | Use::Unused => hv = true,
            Use::TypeOnly => ht = true,
        }
    }
    (hv, ht)
}

fn export_all(d: &ExportAllDeclaration<'_>) -> RawImport {
    let spec = d.source.value.display().to_string();
    let ty = d.export_kind.is_type();
    RawImport { spec, form: 2, hv: !ty, ht: ty, pending: Vec::new() }
}

/// `export { a } from "./x"`: type-ness of each specifier waits for the target file.
fn export_from(d: &ExportFromDeclaration<'_>) -> RawImport {
    let spec = d.source.value.display().to_string();
    let mut pending = Vec::new();
    let (hv, ht) = if d.export_kind.is_type() {
        (false, true)
    } else if d.specifiers.is_empty() {
        (false, false)
    } else {
        let mut ht = false;
        for s in d.specifiers.iter() {
            if s.export_kind.is_type() {
                ht = true;
            } else {
                pending.push(s.local.name().to_string());
            }
        }
        (false, ht)
    };
    RawImport { spec, form: 2, hv, ht, pending }
}

/// Set `found[i]` for every wanted name equal to `name`.
fn flag(found: &mut [bool], wanted: &[&str], name: &str) {
    for (f, w) in found.iter_mut().zip(wanted) {
        if *w == name {
            *f = true;
        }
    }
}

/// Old-Pulsar-compatible "is this exported name type-only in the target" check for
/// `export { a } from "./x"`: true for each `wanted` name that the file declares as an
/// interface or type alias (anywhere), or exports with `export type { a }`, and never
/// exports as a value with `export { a }`.
pub fn type_only_exports(alloc: &Allocator, path: &Path, source: &str, wanted: &[&str]) -> Vec<bool> {
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::ts());
    let ret = Parser::new(alloc, source, source_type).parse();
    let mut found_type = vec![false; wanted.len()];
    let mut found_value = vec![false; wanted.len()];
    if ret.fatal_error {
        return found_type;
    }
    let sem = SemanticBuilder::new().with_build_nodes(true).build(&ret.program).semantic;
    for node in sem.nodes().iter() {
        match node.kind() {
            AstKind::TSInterfaceDeclaration(d) => flag(&mut found_type, wanted, d.id.name.as_str()),
            AstKind::TSTypeAliasDeclaration(d) => flag(&mut found_type, wanted, d.id.name.as_str()),
            AstKind::ExportNamedDeclaration(d) => {
                for s in d.specifiers.iter() {
                    let ty = s.export_kind.is_type() || d.export_kind.is_type();
                    flag(if ty { &mut found_type } else { &mut found_value }, wanted, s.local.name().as_str());
                }
            }
            _ => {}
        }
    }
    (0..wanted.len()).map(|i| found_type[i] && !found_value[i]).collect()
}

/// A function's span and stable key, for callers that parse a historical blob (CFN: lines a
/// commit touched inside each head function). Same walker as the head parse, so the key for
/// `key_path` is the key `FK` carries; pass the file's head path to follow renames.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FnSpan {
    pub key: u64,
    pub start_line: u32,
    pub end_line: u32,
}

/// Parse `source` and return its functions in id order (start offset). No imports, no semantic pass.
pub fn function_spans(alloc: &Allocator, key_path: &str, source: &str) -> Vec<FnSpan> {
    let source_type = SourceType::from_path(key_path).unwrap_or_else(|_| SourceType::ts());
    let ret = Parser::new(alloc, source, source_type).parse();
    if ret.fatal_error {
        return Vec::new();
    }
    Walker::new(key_path, source)
        .run(&ret.program)
        .fns
        .into_iter()
        .map(|f| FnSpan { key: f.key, start_line: f.start_line, end_line: f.end_line })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn span_keys_follow_the_head_path_not_the_blob() {
        let alloc = Allocator::default();
        let old = "function f() {}\n";
        let new = "\n\nfunction f() {}\nfunction g() {}\n";
        let a = function_spans(&alloc, "src/m.ts", old);
        let b = function_spans(&alloc, "src/m.ts", new);
        assert_eq!(a.len(), 1);
        assert_eq!(b.len(), 2);
        assert_eq!(a[0].key, b[0].key);
        assert_eq!((b[0].start_line, b[1].start_line), (3, 4));
    }

    use super::super::builtin::all_index;
    use super::super::functions::HookCx;
    use crate::lang::functions::SiteKind;
    use oxc_ast::ast::{BindingPattern, CallExpression, Class, Expression, VariableDeclarator};

    #[derive(Default)]
    struct Rec(Vec<String>);

    impl PackHook for Rec {
        fn on_call(&mut self, cx: &HookCx<'_>, c: &CallExpression<'_>) {
            self.0.push(format!("call fn={:?} ctx={} sym={:?}", cx.fn_local, cx.ctx, (cx.resolve)(&c.callee)));
        }
        fn on_yield_star(&mut self, cx: &HookCx<'_>, arg: &Expression<'_>) {
            self.0.push(format!("yield* fn={:?} sym={:?}", cx.fn_local, (cx.resolve)(arg)));
        }
        fn on_class(&mut self, _: &HookCx<'_>, c: &Class<'_>) {
            self.0.push(format!("class {:?}", c.id.as_ref().map(|i| i.name.to_string())));
        }
        fn on_declarator(&mut self, cx: &HookCx<'_>, d: &VariableDeclarator<'_>) {
            if let BindingPattern::BindingIdentifier(b) = &d.id {
                let ty = d.type_annotation.as_ref().and_then(|a| match &a.type_annotation {
                    oxc_ast::ast::TSType::TSTypeReference(r) => (cx.resolve_type)(&r.type_name),
                    _ => None,
                });
                self.0.push(format!("decl {} fn={:?} type={:?}", b.name, cx.fn_local, ty));
            }
        }
    }

    #[test]
    fn a_pack_hook_sees_calls_yields_classes_and_declarators_with_resolved_names() {
        let src = "import { Effect } from \"effect\";\nimport { SqlClient } from \"@effect/sql\";\nclass Repo {}\nexport const q = Effect.gen(function* () {\n  const sql = yield* SqlClient.SqlClient;\n  const typed: SqlClient.SqlClient = sql;\n  Effect.runSync(1);\n});\n";
        let alloc = Allocator::default();
        let ix = all_index();
        let mut rec = Rec::default();
        extract(&alloc, "a.ts", Path::new("a.ts"), src, &ix, 0, Some(&mut rec));
        assert_eq!(
            rec.0,
            [
                "class Some(\"Repo\")",
                "decl q fn=None type=None",
                "call fn=None ctx=0 sym=Some(\"effect#Effect.gen\")",
                "decl sql fn=Some(0) type=None",
                "yield* fn=Some(0) sym=Some(\"@effect/sql#SqlClient.SqlClient\")",
                "decl typed fn=Some(0) type=Some(\"@effect/sql#SqlClient.SqlClient\")",
                "call fn=Some(0) ctx=2 sym=Some(\"effect#Effect.runSync\")",
            ]
        );
    }

    /// `(fn, symbol, ctx)` for the syntax and Promise call sites of a file with base ctx `file_ctx`.
    fn promise_sites(src: &str, file_ctx: u8) -> Vec<(u32, String, u8)> {
        let alloc = Allocator::default();
        let ix = all_index();
        let f = extract(&alloc, "a.ts", Path::new("a.ts"), src, &ix, file_ctx, None).functions;
        f.sites
            .iter()
            .filter_map(|s| match s.kind {
                SiteKind::Call { sym, ctx, .. } => Some((s.fn_local, f.syms[sym as usize].clone(), ctx)),
                _ => None,
            })
            .filter(|s| s.1.starts_with("syntax#") || s.1.starts_with("global#Promise"))
            .collect()
    }

    const PROMISES: &str = "import { Effect } from \"effect\";\n\
        async function load(xs) { for await (const x of xs) {} const r = await go(); return r.then((v) => v); }\n\
        function all() { return Promise.all([]).finally(() => {}); }\n\
        function make() { return new Promise((ok) => ok(1)).catch(() => 0); }\n\
        const g = Effect.gen(function* () {\n\
          yield* Effect.tryPromise({ try: async () => { throw new Error(\"x\"); }, catch: (e) => e });\n\
          try { yield* Effect.void; } catch { throw 1; }\n\
          yield* Effect.catch(Effect.void, () => Effect.void);\n\
        });\n";

    fn rows(v: &[(u32, &str, u8)]) -> Vec<(u32, String, u8)> {
        v.iter().map(|(f, s, c)| (*f, s.to_string(), *c)).collect()
    }

    #[test]
    fn syntax_sites_in_an_effect_only_file_carry_their_context() {
        // Bit 8 (the file is in effect_only scope). Function 8, the tryPromise callback, has the
        // interop bit 32, and the generator (7) has bit 2, which the exception-style scope rule
        // excludes, so no rule can fire there and their `async`, `try` and `throw` emit nothing.
        let want = rows(&[
            (0, "syntax#async-fn", 1 | 8),
            (0, "syntax#await", 1 | 8),
            (0, "syntax#await", 1 | 8),
            (0, "syntax#member.then", 1 | 8),
            (2, "syntax#member.finally", 8),
            (2, "global#Promise.all", 8),
            (4, "syntax#member.catch", 8),
            (4, "global#Promise", 8),
        ]);
        assert_eq!(promise_sites(PROMISES, 8), want);
    }

    const ENTRY: &str = "import { Effect } from \"effect\";\n\
        function run() { return 1; }\n\
        const cfg = await load();\n\
        main().catch((e) => e);\n\
        try { run(); } catch { throw 1; }\n\
        const later = () => { return fetch(\"x\").then((r) => r); };\n";

    #[test]
    fn module_level_constructs_land_on_a_module_body_in_a_scoped_file() {
        let alloc = Allocator::default();
        let ix = all_index();
        let f = extract(&alloc, "a.ts", Path::new("a.ts"), ENTRY, &ix, 8, None).functions;
        let module = f.fns.len() as u32 - 1;
        assert_eq!(f.fns[module as usize].kind, crate::lang::functions::fk::MODULE);
        assert_eq!(f.fns[module as usize].parent, None);
        assert_eq!(f.fns[module as usize].loc, 0);
        assert!(f.ct.iter().all(|c| c.fn_local != module), "the module body has no control tree");
        let got: Vec<(u32, String)> = f
            .sites
            .iter()
            .filter_map(|s| match s.kind {
                SiteKind::Call { sym, .. } => Some((s.fn_local, f.syms[sym as usize].clone())),
                _ => None,
            })
            .collect();
        let want: Vec<(u32, String)> = [
            (module, "syntax#await"),
            (module, "syntax#member.catch"),
            (module, "syntax#try"),
            (module, "syntax#throw"),
            (2, "syntax#member.then"), // `later` (run 0, the catch callback 1)
        ]
        .iter()
        .map(|(l, s)| (*l, s.to_string()))
        .collect();
        assert_eq!(got, want);
    }

    #[test]
    fn module_body_needs_a_policy_scope_and_a_rule_that_can_fire() {
        let alloc = Allocator::default();
        let ix = all_index();
        // No policy bits: no module site, no module body, the function ids as before.
        let f = extract(&alloc, "a.ts", Path::new("a.ts"), ENTRY, &ix, 0, None).functions;
        assert!(f.fns.iter().all(|x| x.kind != crate::lang::functions::fk::MODULE));
        assert_eq!(f.fns.len(), 4, "run, the catch callback, later, the then callback");
        // Boundary only (bit 16): both scope rules exclude it, so nothing can fire at module level.
        let f = extract(&alloc, "a.ts", Path::new("a.ts"), ENTRY, &ix, 16, None).functions;
        assert!(f.fns.iter().all(|x| x.kind != crate::lang::functions::fk::MODULE));
    }

    #[test]
    fn without_policy_no_syntax_site_is_emitted() {
        // No bit 8: no shipped rule can fire on a construct, so only the Promise calls remain.
        let want = rows(&[(2, "global#Promise.all", 0), (4, "global#Promise", 0)]);
        assert_eq!(promise_sites(PROMISES, 0), want);
    }
}

/// Every function of one file with its control tree, for a caller that parses a historical blob
/// (per-commit metrics). Same walker as the head parse; `key_path` is the file's head path, so
/// the `FK` keys match the head's. Call sites and edges are not produced here.
pub fn function_facts(alloc: &Allocator, key_path: &str, source: &str) -> FileFns {
    let source_type = SourceType::from_path(key_path).unwrap_or_else(|_| SourceType::ts());
    let ret = Parser::new(alloc, source, source_type).parse();
    if ret.fatal_error {
        return FileFns::default();
    }
    Walker::new(key_path, source).run(&ret.program)
}

#[cfg(test)]
mod facts_tests {
    use super::*;

    /// The blob walk and the head walk are the same walker: same keys, same control trees.
    #[test]
    fn function_facts_matches_the_head_walk() {
        let src = "export function f(a: number) {\n  if (a > 1) { return 1; }\n  for (const x of [a]) { g(x); }\n  return 2;\n}\nconst g = (n: number) => n || 0;\n";
        let alloc = Allocator::default();
        let blob = function_facts(&alloc, "m.ts", src);
        let head = extract(&alloc, "m.ts", Path::new("m.ts"), src, &CatalogIndex::default(), 0, None).functions;
        assert_eq!(blob.fns.iter().map(|f| f.key).collect::<Vec<_>>(), head.fns.iter().map(|f| f.key).collect::<Vec<_>>());
        assert_eq!(blob.ct, head.ct);
        assert_eq!(blob.fns.len(), 2);
        assert!(!blob.ct.is_empty());
    }
}
