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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SiteKind {
    /// A call site of catalog symbol `sym` (an index into [`FileFns::syms`]).
    Call { sym: u32, loop_depth: u32, ctx: u8 },
    /// An error handler of the given shape.
    Handler { shape: u8 },
}

/// A `CS` or `HD` row before numbering: `fn_local` is the owning function's local index. Sites
/// are in source order; the driver numbers them globally, one id space for both relations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
}

/// Number the call sites and handlers of every file. `files` is `(first function id, rows)` in
/// file-id order; site ids are one space for `CS` and `HD`, in (file, source) order. `classes`
/// gives each symbol's catalog classes.
pub fn number_sites(
    files: &[(u32, &FileFns)],
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
        for class in classes(name) {
            out.cl.push([id as u32, class]);
        }
    }
    let mut site = 0u32;
    for (base, f) in files {
        for s in &f.sites {
            let fnid = base + s.fn_local;
            match s.kind {
                SiteKind::Call { sym, loop_depth, ctx } => {
                    out.cs.push([site, fnid, ids[f.syms[sym as usize].as_str()], loop_depth, ctx as u32]);
                }
                SiteKind::Handler { shape } => out.hd.push([site, fnid, shape as u32]),
            }
            site += 1;
        }
    }
    out.syms = names.iter().map(|n| n.to_string()).collect();
    out
}
