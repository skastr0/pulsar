//! Function and control-tree rows every language lane produces (FACTS.md `FN`, `FK`, `CT`).
//!
//! A lane returns one [`FileFns`] per file with ids local to the file; the driver numbers
//! functions globally in (file id, start offset) order and pushes the rows. The kind numbers
//! below are the contract's tables, shared so TypeScript, Rust and Bend agree.

/// `FN.parent` of a top-level function.
pub const NO_PARENT: u32 = u32::MAX;

/// `FK` kind numbers (FACTS.md).
pub mod fk {
    pub const DECL: u8 = 0;
    pub const FN_EXPR: u8 = 1;
    pub const ARROW: u8 = 2;
    pub const METHOD: u8 = 3;
    pub const GETTER: u8 = 4;
    pub const SETTER: u8 = 5;
    pub const CTOR: u8 = 6;
    pub const STATIC_BLOCK: u8 = 7;
}

/// `CT` kind numbers (FACTS.md).
pub mod ct {
    pub const BRANCH: u8 = 1;
    pub const ARM: u8 = 2;
    pub const MULTI: u8 = 3;
    pub const LOOP: u8 = 4;
    pub const TRY: u8 = 5;
    pub const SHORT_CIRCUIT: u8 = 6;
    pub const EXIT: u8 = 7;
    pub const NESTED_FN: u8 = 8;
    pub const DEFAULT_FLAG: u8 = 9;
    pub const FINALLY: u8 = 10;
}

/// One function, with ids local to its file (index = order of start offset).
#[derive(Debug, Clone)]
pub struct FnRec {
    pub start_line: u32,
    pub end_line: u32,
    /// Enclosing function, as a local index.
    pub parent: Option<u32>,
    /// Non-blank lines in the span, nested functions included.
    pub loc: u32,
    pub kind: u8,
    /// Container names outermost first, ending with the function itself, joined by `>`.
    pub chain: String,
    /// 64-bit stable key; `FK` writes its two U32 halves.
    pub key: u64,
}

/// One control-tree node, `fn_local` being the owning function's local index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CtRec {
    pub fn_local: u32,
    pub node: u32,
    pub parent: u32,
    pub kind: u8,
}

/// `CO` operator codes for a kind-6 node (FACTS.md).
pub mod op {
    pub const AND: u8 = 1;
    pub const OR: u8 = 2;
    pub const NULLISH: u8 = 3;
    pub const AND_ASSIGN: u8 = 4;
    pub const OR_ASSIGN: u8 = 5;
    pub const NULLISH_ASSIGN: u8 = 6;
}

/// Which boolean operator a kind-6 control node stands for (`CO fn node op`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoRec {
    pub fn_local: u32,
    pub node: u32,
    pub op: u8,
}

/// `CS.ctx` bits (FACTS.md).
pub mod ctx {
    pub const ASYNC: u8 = 1;
    pub const EFFECT: u8 = 2;
    pub const TEST: u8 = 4;
}

/// `HD.shape` values (FACTS.md).
pub mod shape {
    pub const OTHER: u8 = 0;
    pub const EMPTY: u8 = 1;
    pub const ONLY_LOGS: u8 = 2;
    pub const CONSTANT: u8 = 3;
    pub const RETHROW_CAUSE: u8 = 4;
    pub const RETHROW_NO_CAUSE: u8 = 5;
}

/// `CU` reasons: why a call could not be turned into an edge to a repo function. Calls that
/// leave the repo (an external package, a runtime global) are not unresolved: they have no
/// callee to find.
pub mod unres {
    /// The callee is not a plain name path: a call result, an element access, a computed key.
    pub const DYNAMIC: u8 = 1;
    /// The callee is rooted at a parameter or a local binding that is not a module-level
    /// function, class or object.
    pub const LOCAL_BINDING: u8 = 2;
    /// The callee is a member of a repo object or class whose method set is not known (a path
    /// deeper than one member, or a method the class does not define).
    pub const UNKNOWN_MEMBER: u8 = 3;
    /// An import of a repo file that exports no function by that name.
    pub const NOT_FOUND: u8 = 4;
}

/// The callee of a call edge, before and after linking.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Callee {
    /// A function of this file, by its `.fns` chain (`f`, `Class>method`, `api>m`): an index
    /// into [`FileFns::names`].
    Local(u32),
    /// An export of an imported repo module: `spec` indexes [`FileFns::specs`], `path` indexes
    /// [`FileFns::names`] and is the exported name and the members after it, dot-joined
    /// (`api.m`, `default`).
    Import { spec: u32, path: u32 },
    /// Linked: global file id and local function index of the target.
    Resolved { file: u32, fn_local: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SiteKind {
    /// A call site of catalog symbol `sym` (an index into [`FileFns::syms`]).
    Call { sym: u32, loop_depth: u32, ctx: u8 },
    /// An error handler of the given shape.
    Handler { shape: u8 },
    /// A call of a repo function (`CE`); `node` is the innermost enclosing control-tree node.
    Edge { to: Callee, node: u32, loop_depth: u32, ctx: u8 },
}

/// An `export ... from` of a module, resolved by the lane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reexport {
    pub spec: u32,
    /// The name taken from the module; `None` for `export * from`.
    pub imported: Option<String>,
    /// The name this file exports it as (unused for a star).
    pub exported: String,
}

/// A `CS` or `HD` row before numbering: `fn_local` is the owning function's local index. Sites
/// are in source order; the driver numbers them globally, one id space for both relations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Site {
    pub fn_local: u32,
    pub kind: SiteKind,
}

/// How a query call's SQL text is known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SqlTextKind {
    /// A string literal, or a template with no interpolation.
    Literal,
    /// A template with interpolation: each `${expr}` is a `?` in the text.
    Template,
    /// Neither (a variable or a concatenation): the text is empty.
    Dynamic,
}

/// The first argument of a query-class call (or the body of a query-class tagged template).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqlTextRec {
    /// Enclosing function, as a local index; `None` at module level.
    pub fn_local: Option<u32>,
    pub line: u32,
    /// Innermost enclosing control-tree node of `fn_local` at the call (0 = the function body,
    /// and 0 when there is no function).
    pub ct_node: u32,
    pub text: String,
    pub kind: SqlTextKind,
}

#[derive(Debug, Default)]
pub struct FileFns {
    pub fns: Vec<FnRec>,
    pub ct: Vec<CtRec>,
    /// One row per kind-6 node in `ct`.
    pub ops: Vec<CoRec>,
    /// Symbols this file's call sites name, deduplicated, in first-use order.
    pub syms: Vec<String>,
    pub sites: Vec<Site>,
    /// SQL texts of query-class calls, in source order.
    pub sql: Vec<SqlTextRec>,
    /// Module specifiers that callees and re-exports refer to by index.
    pub specs: Vec<String>,
    /// Chains and export paths that callees refer to by index, each stored once.
    pub names: Vec<String>,
    /// Per spec: the repo file (a local file index) it names, once the lane resolved it.
    pub spec_targets: Vec<Option<u32>>,
    /// Edge calls dropped because their import is not a repo file.
    pub external: usize,
    /// `(exported name, local chain)`: an exported function, class or object keeps the chain
    /// of its declaration; an object or class also exports its members as `name.member`.
    pub exports: Vec<(String, String)>,
    pub reexports: Vec<Reexport>,
    /// `(fn_local, reason)` once per call that could not become an edge.
    pub unresolved: Vec<(u32, u8)>,
    /// `(fn_local, kind)`: functions a catalog names as entry points (`EP`).
    pub entries: Vec<(u32, u8)>,
}

/// FNV-1a 64 over parts separated by a zero byte (same constants as the file key).
pub fn fnv_parts(parts: &[&[u8]]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for (i, p) in parts.iter().enumerate() {
        if i > 0 {
            h = (h ^ 0).wrapping_mul(0x0000_0100_0000_01b3);
        }
        for b in *p {
            h = (h ^ *b as u64).wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

/// `SY`, `CL`, `CS` and `HD` rows over global ids, plus the symbol names for `.syms`.
#[derive(Debug, Default)]
pub struct SiteRows {
    /// Symbol names by `SY` id; ids follow byte order of the name, not file order.
    pub syms: Vec<String>,
    /// `(sym, class)`.
    pub cl: Vec<[u32; 2]>,
    /// `(site, fn, callee, loop_depth, ctx)`.
    pub cs: Vec<[u32; 5]>,
    /// `(site, fn, shape)`.
    pub hd: Vec<[u32; 3]>,
    /// `(site, fn, target, node, loop_depth, ctx)`.
    pub ce: Vec<[u32; 6]>,
    /// `(fn, reason, count)`, sorted.
    pub cu: Vec<[u32; 3]>,
}

/// Number the call sites and handlers of every file. `files` is `(first function id, rows)` in
/// file-id order; site ids are one space for `CS` and `HD`, in (file, source) order. `classes`
/// gives each symbol's catalog classes.
pub fn number_sites(
    files: &[(u32, &FileFns)],
    file_base: &dyn Fn(u32) -> Option<u32>,
    classes: &dyn Fn(&str) -> Vec<u32>,
) -> SiteRows {
    let mut names: std::collections::BTreeSet<&str> = Default::default();
    for (_, f) in files {
        names.extend(f.syms.iter().map(String::as_str));
    }
    let ids: std::collections::HashMap<&str, u32> =
        names.iter().enumerate().map(|(i, n)| (*n, i as u32)).collect();
    let mut out = SiteRows::default();
    for (id, name) in names.iter().enumerate() {
        out.cl.extend(classes(name).into_iter().map(|class| [id as u32, class]));
    }
    let mut site = 0u32;
    let mut unresolved: std::collections::BTreeMap<(u32, u8), u32> = Default::default();
    for (base, f) in files {
        number_file(&mut out, &mut site, *base, f, &ids, file_base);
        for (fn_local, reason) in &f.unresolved {
            *unresolved.entry((base + fn_local, *reason)).or_insert(0) += 1;
        }
    }
    out.cu = unresolved.into_iter().map(|((f, r), n)| [f, r as u32, n]).collect();
    out.syms = names.iter().map(|n| n.to_string()).collect();
    out
}

/// One file's sites, numbered from `site` in source order.
fn number_file(
    out: &mut SiteRows,
    site: &mut u32,
    base: u32,
    f: &FileFns,
    ids: &std::collections::HashMap<&str, u32>,
    file_base: &dyn Fn(u32) -> Option<u32>,
) {
    for s in &f.sites {
        let fnid = base + s.fn_local;
        match &s.kind {
            SiteKind::Call { sym, loop_depth, ctx } => {
                out.cs.push([*site, fnid, ids[f.syms[*sym as usize].as_str()], *loop_depth, *ctx as u32]);
            }
            SiteKind::Handler { shape } => out.hd.push([*site, fnid, *shape as u32]),
            SiteKind::Edge { to: Callee::Resolved { file, fn_local }, node, loop_depth, ctx } => {
                let Some(target) = file_base(*file).map(|b| b + fn_local) else { continue };
                out.ce.push([*site, fnid, target, *node, *loop_depth, *ctx as u32]);
            }
            // Linking turns every edge into a resolved one or drops it.
            SiteKind::Edge { .. } => continue,
        }
        *site += 1;
    }
}
