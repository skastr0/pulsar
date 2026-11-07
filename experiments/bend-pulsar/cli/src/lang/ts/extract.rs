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
    test: bool,
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
    let walker = walker.with_calls(scoping, index, test);
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
        extract(&alloc, "a.ts", Path::new("a.ts"), src, &ix, false, Some(&mut rec));
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
}
