//! Bend 2 lane: per-file syntax facts for `.bend` sources (FACTS.md `I`/`U`, `FN`/`FK`/`CT`,
//! `MK`, and the law relations `L`/`LW`/`LR`).
//!
//! Written from `bend guide` (the language's own documentation), not from Bend's parser. The
//! `bend` CLI cannot dump a syntax tree: `-o x.bendtt` writes the elaborated kernel term, with no
//! source positions and with `match` already lowered to eliminators, so this lane parses the
//! surface syntax itself. It is small because the surface is: a file is a list of top-level
//! `import`, `type`, `def` and `law` blocks, and a body is indentation-structured lines.
//!
//! What the syntax says, and only that:
//! - **imports:** `import ./x.bend as M` is an import of a repo file; `import Base`, a hash
//!   (`0x..`) or a hub name (`n@v/..`) is a package. `import "./e.c"` inside a def body is
//!   foreign code, not a module edge.
//! - **functions:** every top-level `def` (kind 0) and every lambda `x => e` (kind 2). Bend has no
//!   other function form; a law is a claim, not a function.
//! - **control tree:** `match` is a multi-branch (3) with one arm (2) per `case`, and a flag (9)
//!   when a case's patterns are all `_` or plain binders. `&&` and `||` are short-circuit nodes
//!   (6). Bend has no `if` (the guide: match on `True{}`/`False{}`), no loops and no early exits;
//!   recursion is a call, not a loop. A lambda is a nested-function leaf (8).
//! - **markers (`MK`):** class 1 for `@unsafe def` and its sugar `def f?(..)`, class 2 for each
//!   open proof hole `?name` (including `?TODO`), class 3 for each foreign `import "..."` line.
//! - **laws:** each `law name:` block, the defs it names (through this file's import aliases or
//!   by an exact same-file name), and whether some def fills it (`def name(..)` beside it, or
//!   `def A.name(..)` where `A` aliases the law's file).
//!
//! Known limit: a lambda whose body is a statement block written *inside* brackets is read as
//! tokens, so a `match` in such a body is not seen as a control node. The guide's forms and this
//! repo's sources write those bodies on indented lines, which are handled.

#![allow(dead_code)] // wired into the driver once lang::Files lands (pulsar-cli)

use crate::lang::functions::{ct, fk, fnv_parts, CtRec, FileFns, FnRec};
use std::collections::HashMap;

/// `MK` marker classes (FACTS.md).
pub mod mk {
    pub const UNSAFE: u8 = 1;
    pub const PROOF_HOLE: u8 = 2;
    pub const FOREIGN: u8 = 3;
}

/// What an `import` line names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// `./x.bend`, `../y/z.bend`: a path relative to the importing file's directory.
    Relative(String),
    /// `Base`, `0x<hash>/main.bend`, `name@version/main.bend`: not a repo file.
    Package(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Import {
    pub target: Target,
    pub alias: Option<String>,
    pub line: u32,
}

/// One top-level `def`, by its index in `BendFile::fns`.
#[derive(Debug, Clone)]
pub struct Def {
    pub name: String,
    pub fn_local: u32,
    /// No `-> T` return type: by the guide's syntax, `def f(x, y):` fills the law named `f`.
    pub untyped: bool,
    /// Returns a proposition or a type (`-> {..}`, `-> Type`, `-> Data`, `-> Kind(..)`):
    /// a lemma or a type-level def, not code that runs.
    pub spec: bool,
}

#[derive(Debug, Clone)]
pub struct Law {
    pub name: String,
    pub line: u32,
    /// Names in the law's statement, as written (`M.Trees.of`, `Helper`), minus keywords and the
    /// law's own name; linking keeps the ones that name repo defs.
    pub names: Vec<String>,
}

#[derive(Debug, Default)]
pub struct BendFile {
    pub imports: Vec<Import>,
    pub fns: FileFns,
    pub defs: Vec<Def>,
    pub laws: Vec<Law>,
    /// `(fn_local, class, count)`, count > 0, sorted.
    pub markers: Vec<(u32, u8, u32)>,
}

impl BendFile {
    /// A scope hint, syntactic only: the file states no law, fills none (no untyped def), and has
    /// at least one def that is not a lemma or type-level def. Lemmas typed by a named
    /// proposition (`-> Walk(..)`) look like code; the repo's scope config decides production.
    pub fn is_code(&self) -> bool {
        self.laws.is_empty() && !self.defs.iter().any(|d| d.untyped) && self.defs.iter().any(|d| !d.spec)
    }
}

// ---- lexer ---------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum K {
    Ident,
    Num,
    Str,
    Char,
    Op,
    Open,
    Close,
    /// `?name`: an open proof hole.
    Hole,
}

#[derive(Debug, Clone, Copy)]
struct Tok {
    k: K,
    start: u32,
    end: u32,
    line: u32,
}

/// A logical line: physical lines joined while brackets are open.
#[derive(Debug, Clone)]
struct LLine {
    indent: u32,
    first: u32,
    last: u32,
    /// Token range in `Lexed::toks`.
    lo: usize,
    hi: usize,
}

struct Lexed<'s> {
    src: &'s str,
    toks: Vec<Tok>,
    lines: Vec<LLine>,
}

impl<'s> Lexed<'s> {
    fn text(&self, t: &Tok) -> &'s str {
        &self.src[t.start as usize..t.end as usize]
    }
}

const OPS: [&str; 17] =
    ["<&>", ".&.", ".|.", ".^.", "=>", "->", "<-", "==", "!=", "&&", "||", "++", "<>", "<=", ">=", "<<", ">>"];

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'.'
}

fn lex(src: &str) -> Lexed<'_> {
    let b = src.as_bytes();
    let mut toks: Vec<Tok> = Vec::new();
    let mut lines: Vec<LLine> = Vec::new();
    let (mut i, mut line, mut col) = (0usize, 1u32, 0u32);
    let mut depth = 0u32;
    let mut cur: Option<LLine> = None;
    let push = |toks: &mut Vec<Tok>, cur: &mut Option<LLine>, k: K, s: usize, e: usize, line: u32, col: u32| {
        let c = cur.get_or_insert(LLine { indent: col, first: line, last: line, lo: toks.len(), hi: toks.len() });
        toks.push(Tok { k, start: s as u32, end: e as u32, line });
        c.hi = toks.len();
        c.last = line;
    };
    while i < b.len() {
        let c = b[i];
        if c == b'\n' {
            if depth == 0 {
                if let Some(l) = cur.take() {
                    lines.push(l);
                }
            }
            i += 1;
            line += 1;
            col = 0;
            continue;
        }
        if c == b' ' || c == b'\t' || c == b'\r' {
            i += 1;
            col += 1;
            continue;
        }
        let s = i;
        let scol = col;
        if c == b'#' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        let k = if c == b'"' {
            i += 1;
            while i < b.len() && b[i] != b'"' && b[i] != b'\n' {
                i += if b[i] == b'\\' { 2 } else { 1 };
            }
            i = (i + 1).min(b.len());
            K::Str
        } else if c == b'\'' && i + 2 < b.len() && (b[i + 2] == b'\'' || (b[i + 1] == b'\\' && i + 3 < b.len() && b[i + 3] == b'\'')) {
            i += if b[i + 1] == b'\\' { 4 } else { 3 };
            K::Char
        } else if is_ident_start(c) || (c == b'@' && i + 1 < b.len() && is_ident_start(b[i + 1])) {
            i += 1;
            while i < b.len() && is_ident_char(b[i]) {
                i += 1;
            }
            // `def f?(..)` is the unsafe sugar: the `?` belongs to the name.
            if i < b.len() && b[i] == b'?' {
                i += 1;
            }
            K::Ident
        } else if c.is_ascii_digit() {
            while i < b.len() && (b[i].is_ascii_alphanumeric() || (b[i] == b'.' && i + 1 < b.len() && b[i + 1].is_ascii_digit())) {
                i += 1;
            }
            K::Num
        } else if c == b'?' && i + 1 < b.len() && is_ident_start(b[i + 1]) {
            i += 1;
            while i < b.len() && is_ident_char(b[i]) {
                i += 1;
            }
            K::Hole
        } else if matches!(c, b'(' | b'[' | b'{') {
            depth += 1;
            i += 1;
            K::Open
        } else if matches!(c, b')' | b']' | b'}') {
            depth = depth.saturating_sub(1);
            i += 1;
            K::Close
        } else {
            let rest = &src[i..];
            let n = OPS.iter().find(|o| rest.starts_with(**o)).map_or(1, |o| o.len());
            // Stay on a char boundary for non-ASCII bytes.
            let mut n = n;
            while !src.is_char_boundary(i + n) {
                n += 1;
            }
            i += n;
            K::Op
        };
        col += (i - s) as u32;
        push(&mut toks, &mut cur, k, s, i, line, scol);
    }
    if let Some(l) = cur.take() {
        lines.push(l);
    }
    Lexed { src, toks, lines }
}

// ---- functions and control trees ------------------------------------------------------------

/// Line starts and a non-blank prefix count, for `loc`.
struct Lines {
    nonblank: Vec<u32>,
}

impl Lines {
    fn new(src: &str) -> Lines {
        let mut nonblank = vec![0u32];
        let mut count = 0;
        for l in src.split('\n') {
            if !l.trim().is_empty() {
                count += 1;
            }
            nonblank.push(count);
        }
        Lines { nonblank }
    }
    fn loc(&self, first: u32, last: u32) -> u32 {
        self.nonblank[last as usize] - self.nonblank[first as usize - 1]
    }
}

struct Frame {
    local: u32,
    next_node: u32,
    /// The chain of this function, for nested names.
    chain: String,
    /// Container names joined by 0x1f, for nested keys.
    key_prefix: Vec<u8>,
}

struct Walker<'a, 's> {
    lx: &'a Lexed<'s>,
    rel: &'a str,
    lines: Lines,
    out: FileFns,
    frames: Vec<Frame>,
    markers: HashMap<(u32, u8), u32>,
    /// Ordinals: (key prefix, name, kind) -> next.
    ordinals: HashMap<(Vec<u8>, String, u8), u32>,
}

impl<'a, 's> Walker<'a, 's> {
    fn ordinal(&mut self, prefix: &[u8], name: &str, kind: u8) -> u32 {
        let n = self.ordinals.entry((prefix.to_vec(), name.to_string(), kind)).or_insert(0);
        *n += 1;
        *n - 1
    }

    fn mark(&mut self, class: u8) {
        if let Some(f) = self.frames.last() {
            *self.markers.entry((f.local, class)).or_insert(0) += 1;
        }
    }

    fn node(&mut self, parent: u32, kind: u8) -> u32 {
        let f = self.frames.last_mut().expect("a node outside a function");
        let id = f.next_node;
        f.next_node += 1;
        self.out.ct.push(CtRec { fn_local: f.local, node: id, parent, kind });
        id
    }

    /// Open a function. `name = None` is a lambda, named by its ordinal in the parent.
    fn enter(&mut self, name: Option<&str>, kind: u8, first: u32, last: u32, ct_parent: u32) -> u32 {
        let (prefix, parent_chain) = match self.frames.last() {
            Some(f) => (f.key_prefix.clone(), Some(f.chain.clone())),
            None => (Vec::new(), None),
        };
        let (element, ord, key_name) = match name {
            Some(n) => (n.to_string(), self.ordinal(&prefix, n, kind), n.to_string()),
            None => {
                let o = self.ordinal(&prefix, "", kind);
                (format!("#{o}"), o, String::new())
            }
        };
        let chain = match &parent_chain {
            Some(c) => format!("{c}>{element}"),
            None => element.clone(),
        };
        let key = fnv_parts(&[self.rel.as_bytes(), &prefix, key_name.as_bytes(), &[kind], ord.to_string().as_bytes()]);
        let parent = self.frames.last().map(|f| f.local);
        if parent.is_some() {
            self.node(ct_parent, ct::NESTED_FN);
        }
        let local = self.out.fns.len() as u32;
        self.out.fns.push(FnRec {
            start_line: first,
            end_line: last,
            parent,
            loc: self.lines.loc(first, last),
            kind,
            chain: chain.clone(),
            key,
        });
        let mut key_prefix = prefix;
        if !key_prefix.is_empty() {
            key_prefix.push(0x1f);
        }
        key_prefix.extend_from_slice(element.as_bytes());
        self.frames.push(Frame { local, next_node: 1, chain, key_prefix });
        local
    }

    fn leave(&mut self) {
        self.frames.pop();
    }

    /// Walk a block: logical lines `ls` (indices into `lx.lines`), all inside the current
    /// function, under control node `parent`.
    fn block(&mut self, ls: &[usize], parent: u32) {
        // Control nodes opened by `match`/`case` lines: (indent, node). A line closes every
        // entry at its indent or deeper.
        let mut stack: Vec<(u32, u32)> = Vec::new();
        let mut i = 0;
        while i < ls.len() {
            let l = &self.lx.lines[ls[i]];
            while stack.last().is_some_and(|&(ind, _)| ind >= l.indent) {
                stack.pop();
            }
            let here = stack.last().map_or(parent, |&(_, n)| n);
            let t0 = self.lx.toks[l.lo];
            let w0 = self.lx.text(&t0);
            if w0 == "match" {
                let m = self.node(here, ct::MULTI);
                stack.push((l.indent, m));
                self.tokens(l.lo + 1, l.hi, m);
            } else if w0 == "case" {
                // The enclosing multi-branch is `here`; the arm opens under it.
                if self.case_is_default(l) {
                    self.node(here, ct::DEFAULT_FLAG);
                }
                let a = self.node(here, ct::ARM);
                stack.push((l.indent, a));
            } else if w0 == "import" && l.hi > l.lo + 1 && self.lx.toks[l.lo + 1].k == K::Str {
                self.mark(mk::FOREIGN);
            } else if self.lx.text(&self.lx.toks[l.hi - 1]) == "=>" {
                // A lambda whose body is the indented block below this line.
                self.tokens(l.lo, l.hi - 1, here);
                let mut j = i + 1;
                while j < ls.len() && self.lx.lines[ls[j]].indent > l.indent {
                    j += 1;
                }
                let start = self.lambda_start(l.lo, l.hi - 1);
                let last = if j > i + 1 { self.lx.lines[ls[j - 1]].last } else { l.last };
                self.enter(None, fk::ARROW, self.lx.toks[start].line, last, here);
                self.block(&ls[i + 1..j], 0);
                self.leave();
                i = j;
                continue;
            } else {
                self.tokens(l.lo, l.hi, here);
            }
            i += 1;
        }
    }

    /// Every pattern of a `case` line is `_` or a plain binder: the arm catches all values.
    fn case_is_default(&self, l: &LLine) -> bool {
        let toks = &self.lx.toks[l.lo + 1..l.hi];
        let pats = match toks.last().map(|t| self.lx.text(t)) {
            Some(":") => &toks[..toks.len() - 1],
            _ => toks,
        };
        !pats.is_empty()
            && pats.iter().all(|t| {
                let s = self.lx.text(t);
                t.k == K::Ident && !s.contains('.') && s.chars().next().is_some_and(|c| c == '_' || c.is_ascii_lowercase())
            })
    }

    /// The first token of the lambda whose `=>` is at `arrow`: its parameter, with a quantity
    /// sign, or a parenthesized parameter list.
    fn lambda_start(&self, lo: usize, arrow: usize) -> usize {
        if arrow == lo {
            return lo;
        }
        let mut s = arrow - 1;
        if self.lx.toks[s].k == K::Close {
            let mut d = 0i32;
            loop {
                match self.lx.toks[s].k {
                    K::Close => d += 1,
                    K::Open => d -= 1,
                    _ => {}
                }
                if d == 0 || s == lo {
                    break;
                }
                s -= 1;
            }
        }
        if s > lo && matches!(self.lx.text(&self.lx.toks[s - 1]), "+" | "-") {
            s -= 1;
        }
        s
    }

    /// Walk tokens `[lo, hi)` of one logical line under control node `parent`: short-circuit
    /// operators, proof holes, and inline lambdas (each body runs to the closing bracket, comma
    /// or line end that ends its expression).
    fn tokens(&mut self, lo: usize, hi: usize, parent: u32) {
        let mut i = lo;
        while i < hi {
            let t = self.lx.toks[i];
            let s = self.lx.text(&t);
            match t.k {
                K::Hole => self.mark(mk::PROOF_HOLE),
                K::Op if s == "&&" || s == "||" => {
                    self.node(parent, ct::SHORT_CIRCUIT);
                }
                K::Op if s == "=>" => {
                    let start = self.lambda_start(lo, i);
                    let mut end = i + 1;
                    let mut d = 0i32;
                    while end < hi {
                        let e = self.lx.toks[end];
                        match e.k {
                            K::Open => d += 1,
                            K::Close => {
                                if d == 0 {
                                    break;
                                }
                                d -= 1;
                            }
                            K::Op if d == 0 && self.lx.text(&e) == "," => break,
                            _ => {}
                        }
                        end += 1;
                    }
                    let last = if end > i + 1 { self.lx.toks[end - 1].line } else { t.line };
                    self.enter(None, fk::ARROW, self.lx.toks[start].line, last, parent);
                    self.tokens(i + 1, end, 0);
                    self.leave();
                    i = end;
                    continue;
                }
                _ => {}
            }
            i += 1;
        }
    }
}

// ---- top level -----------------------------------------------------------------------------

/// Parse one `import` line's text (comments already outside the token range).
fn parse_import(text: &str, line: u32) -> Option<Import> {
    let mut it = text.split_whitespace();
    if it.next()? != "import" {
        return None;
    }
    let target = it.next()?;
    let alias = match (it.next(), it.next()) {
        (Some("as"), Some(a)) => Some(a.to_string()),
        _ => None,
    };
    let target = if target.starts_with("./") || target.starts_with("../") {
        Target::Relative(target.to_string())
    } else {
        Target::Package(target.to_string())
    };
    Some(Import { target, alias, line })
}

/// Extract one file's facts. `rel` is the repo-relative path (hashed into `FK`).
pub fn extract(rel: &str, src: &str) -> BendFile {
    let lx = lex(src);
    let mut w = Walker {
        lx: &lx,
        rel,
        lines: Lines::new(src),
        out: FileFns::default(),
        frames: Vec::new(),
        markers: HashMap::new(),
        ordinals: HashMap::new(),
    };
    let mut file = BendFile::default();
    let n = lx.lines.len();
    let mut i = 0;
    while i < n {
        let l = &lx.lines[i];
        // A top-level block: this line and every following line indented deeper.
        let mut j = i + 1;
        while j < n && lx.lines[j].indent > l.indent {
            j += 1;
        }
        let body: Vec<usize> = (i + 1..j).collect();
        let last = lx.lines[j - 1].last;
        let first_tok = lx.toks[l.lo];
        let head = lx.text(&first_tok);
        let tok = |k: usize| lx.toks.get(l.lo + k).filter(|_| l.lo + k < l.hi).map(|t| lx.text(t));
        match head {
            "import" if l.indent == 0 => {
                let text = &src[first_tok.start as usize..lx.toks[l.hi - 1].end as usize];
                if let Some(imp) = parse_import(text, l.first) {
                    file.imports.push(imp);
                }
            }
            "law" if l.indent == 0 => {
                if let Some(name) = tok(1) {
                    // Every name in the statement; linking keeps those that are repo defs.
                    let mut names: Vec<String> = Vec::new();
                    for li in i..j {
                        let ll = &lx.lines[li];
                        for t in &lx.toks[ll.lo..ll.hi] {
                            let s = lx.text(t);
                            if t.k == K::Ident && s != name && !matches!(s, "law" | "for" | "exs" | "where") {
                                names.push(s.to_string());
                            }
                        }
                    }
                    names.sort();
                    names.dedup();
                    file.laws.push(Law { name: name.to_string(), line: l.first, names });
                }
            }
            "def" | "@unsafe" if l.indent == 0 => {
                let off = if head == "@unsafe" { 1 } else { 0 };
                if tok(off) == Some("def") {
                    if let Some(raw) = tok(off + 1) {
                        let sugar = raw.ends_with('?');
                        let name = raw.trim_end_matches('?').to_string();
                        // The return type: the tokens after a depth-0 `->` in the header.
                        let header = &lx.toks[l.lo..l.hi];
                        let mut d = 0i32;
                        let mut ret: Option<usize> = None;
                        for (k, t) in header.iter().enumerate() {
                            match t.k {
                                K::Open => d += 1,
                                K::Close => d -= 1,
                                K::Op if d == 0 && lx.text(t) == "->" => {
                                    ret = Some(k + 1);
                                    break;
                                }
                                _ => {}
                            }
                        }
                        let spec = ret.and_then(|k| header.get(k)).is_some_and(|t| {
                            let s = lx.text(t);
                            s == "{" || s == "Type" || s == "Data" || s == "Kind"
                        });
                        let local = w.enter(Some(&name), fk::DECL, l.first, last, 0);
                        if head == "@unsafe" || sugar {
                            w.mark(mk::UNSAFE);
                        }
                        w.block(&body, 0);
                        w.leave();
                        file.defs.push(Def { name, fn_local: local, untyped: ret.is_none(), spec });
                    }
                }
            }
            _ => {}
        }
        i = j;
    }
    let mut markers: Vec<(u32, u8, u32)> = w.markers.iter().map(|(&(f, c), &n)| (f, c, n)).collect();
    markers.sort_unstable();
    file.markers = markers;
    // Functions are already in start order (preorder of the source); keep CT in (fn, node) order.
    let mut fns = w.out;
    fns.ct.sort_unstable_by_key(|c| (c.fn_local, c.node));
    file.fns = fns;
    file
}

// ---- linking across files -------------------------------------------------------------------

/// Normalise `dir/rel` (forward slashes, `.` and `..` resolved). `None` if it climbs above root.
fn join(dir: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for p in rel.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

/// Where an import of `file` points: a repo path, or `None` with the `U` reason.
pub fn resolve(file: &str, imp: &Import, exists: &dyn Fn(&str) -> bool) -> Result<String, u8> {
    match &imp.target {
        Target::Package(_) => Err(0),
        Target::Relative(p) => {
            let dir = file.rsplit_once('/').map_or("", |(d, _)| d);
            match join(dir, p) {
                Some(path) if exists(&path) => Ok(path),
                _ => Err(1),
            }
        }
    }
}

/// One law, linked: the functions its statement names, and whether a def fills it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkedLaw {
    pub file: usize,
    pub name: String,
    pub line: u32,
    /// `(file index, fn_local)` of each named function, sorted, deduped.
    pub fns: Vec<(usize, u32)>,
    pub filled: bool,
}

/// Link laws across `files` (`(repo-relative path, extraction)`, in file-id order).
pub fn link_laws(files: &[(String, BendFile)]) -> Vec<LinkedLaw> {
    let index: HashMap<&str, usize> = files.iter().enumerate().map(|(i, (p, _))| (p.as_str(), i)).collect();
    let exists = |p: &str| index.contains_key(p);
    // Per file: alias -> imported file index.
    let aliases: Vec<HashMap<&str, usize>> = files
        .iter()
        .map(|(path, f)| {
            f.imports
                .iter()
                .filter_map(|imp| {
                    let a = imp.alias.as_deref()?;
                    let dst = resolve(path, imp, &exists).ok()?;
                    Some((a, index[dst.as_str()]))
                })
                .collect()
        })
        .collect();
    let def_of = |fi: usize, name: &str| files[fi].1.defs.iter().find(|d| d.name == name).map(|d| d.fn_local);
    // Fills: (law file, law name) from `def name` beside the law or `def A.name` through an alias.
    let mut fills: std::collections::HashSet<(usize, String)> = Default::default();
    for (fi, (_, f)) in files.iter().enumerate() {
        for d in &f.defs {
            fills.insert((fi, d.name.clone()));
            if let Some((a, rest)) = d.name.split_once('.') {
                if let Some(&dst) = aliases[fi].get(a) {
                    fills.insert((dst, rest.to_string()));
                }
            }
        }
    }
    let mut out = Vec::new();
    for (fi, (_, f)) in files.iter().enumerate() {
        for law in &f.laws {
            let mut fns: Vec<(usize, u32)> = Vec::new();
            for n in &law.names {
                if let Some(local) = def_of(fi, n) {
                    fns.push((fi, local));
                }
                if let Some((a, rest)) = n.split_once('.') {
                    if let Some(&dst) = aliases[fi].get(a) {
                        if let Some(local) = def_of(dst, rest) {
                            fns.push((dst, local));
                        }
                    }
                }
            }
            fns.sort_unstable();
            fns.dedup();
            out.push(LinkedLaw {
                file: fi,
                name: law.name.clone(),
                line: law.line,
                fns,
                filled: fills.contains(&(fi, law.name.clone())),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests;
