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

#[derive(Debug, Default)]
pub struct FileFns {
    pub fns: Vec<FnRec>,
    pub ct: Vec<CtRec>,
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
