//! Decision-block facts for the coupled-path metric (#700): `BL`, `BW`, `BR`, `BC`.
//!
//! A decision block is a `CT` node of kind 1 (branch), 3 (multi-branch) or 4 (loop). Per function:
//! - `BL block cond`: a 32-bit FNV-1a hash of the normalised condition (variables become their
//!   dense ids, literals their text); 0 when the block has no condition.
//! - `BW block var`: a variable written anywhere in the block's region (arms or body, nested blocks
//!   included, pattern bindings introduced by the block included).
//! - `BR block var`: a variable read by the block's own condition (a guard counts as part of it).
//! - `BC block var op lit`: one row per atomic predicate `var op literal`; `op` is 1 eq, 2 neq,
//!   3 lt, 4 le, 5 gt, 6 ge, 7 other; `lit` is a literal id (dense per function, 1-based), 0 when
//!   the operand is not a literal.
//!
//! A variable is a local, a parameter, `self`, or a member chain on one of them (`self.count`),
//! interned by text; ids are dense per function in order of first occurrence. A write to a chain
//! writes the chain and its root, and a write to a root writes every chain seen on it, so the
//! facts over-link (safe for the metric: coupled-path never exceeds NPath). Writes are
//! assignments (also compound), `&mut` borrows, a method call on a receiver rooted in a variable
//! (the accumulator), `let` bindings and pattern bindings. Interior mutability through `&self`
//! (`RefCell`, `Mutex`) is invisible, so the facts can under-link there. Macro bodies emit nothing.

use std::collections::{BTreeSet, HashMap};
use crate::lang::functions::BlockRows;
use syn::{BinOp, Expr, Lit, Member, Pat, UnOp};

#[derive(Default)]
pub struct BlockState {
    vars: HashMap<String, u32>,
    /// chain var -> root var.
    chains: HashMap<u32, u32>,
    lits: HashMap<String, u32>,
    open: Vec<u32>,
    bl: Vec<(u32, u32)>,
    bw: BTreeSet<(u32, u32)>,
    br: BTreeSet<(u32, u32)>,
    bc: BTreeSet<(u32, u32, u8, u32)>,
}

fn fnv32(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h = (h ^ b as u32).wrapping_mul(0x0100_0193);
    }
    h.max(1)
}

/// A place expression's chain text and root: `self.a.b` -> ("self.a.b", "self"); `x[i]` -> x.
fn place(e: &Expr) -> Option<(String, String)> {
    match e {
        Expr::Path(p) => place_path(p),
        Expr::Field(f) => {
            let (chain, root) = place(&f.base)?;
            let m = match &f.member {
                Member::Named(i) => i.to_string(),
                Member::Unnamed(i) => i.index.to_string(),
            };
            Some((format!("{chain}.{m}"), root))
        }
        Expr::Index(i) => place(&i.expr),
        Expr::Paren(p) => place(&p.expr),
        Expr::Reference(r) => place(&r.expr),
        Expr::Unary(u) if matches!(u.op, UnOp::Deref(_)) => place(&u.expr),
        Expr::Try(t) => place(&t.expr),
        _ => None,
    }
}

/// A single lower-case identifier path is a variable.
fn place_path(p: &syn::ExprPath) -> Option<(String, String)> {
    if p.qself.is_some() || p.path.segments.len() != 1 {
        return None;
    }
    let n = p.path.segments[0].ident.to_string();
    n.chars().next().is_some_and(|c| c.is_lowercase() || c == '_').then(|| (n.clone(), n))
}

/// Literal-like operand text: a literal, a negated literal, a constant or an enum variant path.
fn literal(e: &Expr) -> Option<String> {
    match e {
        Expr::Lit(l) => Some(lit_text(&l.lit)),
        Expr::Unary(u) if matches!(u.op, UnOp::Neg(_)) => literal(&u.expr).map(|t| format!("-{t}")),
        Expr::Path(p) => {
            let segs = &p.path.segments;
            let last = segs.last()?.ident.to_string();
            let konst = segs.len() > 1 || last.chars().next().is_some_and(|c| c.is_uppercase());
            konst.then(|| segs.iter().map(|s| s.ident.to_string()).collect::<Vec<_>>().join("::"))
        }
        Expr::Paren(p) => literal(&p.expr),
        _ => None,
    }
}

fn lit_text(l: &Lit) -> String {
    match l {
        Lit::Str(s) => format!("{:?}", s.value()),
        Lit::Int(i) => i.base10_digits().to_string(),
        Lit::Bool(b) => b.value.to_string(),
        Lit::Char(c) => format!("{:?}", c.value()),
        Lit::Float(f) => f.base10_digits().to_string(),
        _ => "lit".to_string(),
    }
}

/// Names a pattern binds (identifiers that are not unit variants or constants).
pub fn bindings(p: &Pat, out: &mut Vec<String>) {
    match p {
        Pat::Ident(i) => {
            let n = i.ident.to_string();
            if n.chars().next().is_some_and(|c| c.is_lowercase() || c == '_') {
                out.push(n);
            }
            if let Some((_, sub)) = &i.subpat {
                bindings(sub, out);
            }
        }
        Pat::Reference(r) => bindings(&r.pat, out),
        Pat::Paren(p) => bindings(&p.pat, out),
        Pat::Type(t) => bindings(&t.pat, out),
        Pat::Struct(s) => s.fields.iter().for_each(|f| bindings(&f.pat, out)),
        _ => bindings_seq(p, out),
    }
}

/// Patterns made of a list of sub-patterns.
fn bindings_seq(p: &Pat, out: &mut Vec<String>) {
    let elems: Vec<&Pat> = match p {
        Pat::Tuple(t) => t.elems.iter().collect(),
        Pat::TupleStruct(t) => t.elems.iter().collect(),
        Pat::Slice(s) => s.elems.iter().collect(),
        Pat::Or(o) => o.cases.iter().collect(),
        _ => return,
    };
    elems.into_iter().for_each(|x| bindings(x, out));
}

/// The literal a pattern pins its scrutinee to: `0`, `None`, `Kind::A`, the variant of `Some(..)`.
fn pat_literal(p: &Pat) -> Option<String> {
    match p {
        Pat::Lit(l) => Some(lit_text(&l.lit)),
        Pat::Path(p) => Some(p.path.segments.iter().map(|s| s.ident.to_string()).collect::<Vec<_>>().join("::")),
        Pat::Ident(i) if i.ident.to_string().chars().next().is_some_and(|c| c.is_uppercase()) => Some(i.ident.to_string()),
        Pat::TupleStruct(t) => Some(t.path.segments.iter().map(|s| s.ident.to_string()).collect::<Vec<_>>().join("::")),
        Pat::Struct(s) => Some(s.path.segments.iter().map(|x| x.ident.to_string()).collect::<Vec<_>>().join("::")),
        Pat::Paren(p) => pat_literal(&p.pat),
        _ => None,
    }
}

impl BlockState {
    fn var(&mut self, chain: &str, root: &str) -> u32 {
        let id = self.intern_var(chain);
        if chain != root {
            let r = self.intern_var(root);
            self.chains.insert(id, r);
        }
        id
    }

    fn intern_var(&mut self, text: &str) -> u32 {
        let n = self.vars.len() as u32;
        *self.vars.entry(text.to_string()).or_insert(n)
    }

    fn lit(&mut self, text: &str) -> u32 {
        let n = self.lits.len() as u32 + 1;
        *self.lits.entry(text.to_string()).or_insert(n)
    }

    /// Intern a binding or a plain name as a variable.
    pub fn name_var(&mut self, name: &str) -> u32 {
        self.var(name, name)
    }

    /// Normalised text of `e`; every variable read on the way is recorded in `reads`.
    fn norm(&mut self, e: &Expr, reads: &mut Vec<u32>) -> String {
        if let Some((chain, root)) = place(e) {
            if !matches!(e, Expr::Index(_) | Expr::Reference(_) | Expr::Try(_) | Expr::Unary(_)) {
                let v = self.var(&chain, &root);
                reads.push(v);
                return format!("v{v}");
            }
        }
        match literal(e) {
            Some(l) => format!("l:{l}"),
            None => self.norm_compound(e, reads),
        }
    }

    fn norm_compound(&mut self, e: &Expr, reads: &mut Vec<u32>) -> String {
        match e {
            Expr::Binary(b) => {
                let (l, r) = (self.norm(&b.left, reads), self.norm(&b.right, reads));
                format!("({l} {} {r})", op_text(&b.op))
            }
            Expr::Unary(u) => format!("({}{})", if matches!(u.op, UnOp::Not(_)) { "!" } else { "-" }, self.norm(&u.expr, reads)),
            Expr::Paren(p) => self.norm(&p.expr, reads),
            Expr::Reference(r) => self.norm(&r.expr, reads),
            Expr::Try(t) => format!("{}?", self.norm(&t.expr, reads)),
            Expr::Cast(c) => self.norm(&c.expr, reads),
            Expr::Let(l) => format!("let {}", self.norm(&l.expr, reads)),
            _ => self.norm_other(e, reads),
        }
    }

    fn norm_other(&mut self, e: &Expr, reads: &mut Vec<u32>) -> String {
        match e {
            Expr::Index(i) => format!("{}[{}]", self.norm(&i.expr, reads), self.norm(&i.index, reads)),
            Expr::MethodCall(m) => self.norm_call(&m.method.to_string(), Some(&m.receiver), m.args.iter().collect(), reads),
            Expr::Call(c) => {
                let head = literal(&c.func).unwrap_or_else(|| "f".into());
                self.norm_call(&head, None, c.args.iter().collect(), reads)
            }
            _ => "?".to_string(),
        }
    }

    fn norm_call(&mut self, name: &str, recv: Option<&Expr>, args: Vec<&Expr>, reads: &mut Vec<u32>) -> String {
        let mut s = String::new();
        if let Some(r) = recv {
            s.push_str(&self.norm(r, reads));
            s.push('.');
        }
        s.push_str(name);
        s.push('(');
        for a in args {
            s.push_str(&self.norm(a, reads));
            s.push(',');
        }
        s.push(')');
        s
    }

    /// Atomic predicates of a condition: flatten `&&`, `||`, `!` and parentheses.
    fn atoms(&mut self, e: &Expr, negated: bool, block: u32) {
        match e {
            Expr::Binary(b) if matches!(b.op, BinOp::And(_) | BinOp::Or(_)) => {
                self.atoms(&b.left, negated, block);
                self.atoms(&b.right, negated, block);
            }
            Expr::Unary(u) if matches!(u.op, UnOp::Not(_)) => self.atoms(&u.expr, !negated, block),
            Expr::Paren(p) => self.atoms(&p.expr, negated, block),
            Expr::Let(l) => self.let_atom(&l.pat, &l.expr, block),
            Expr::Binary(b) => self.compare_atom(b, negated, block),
            _ => self.other_atom(e, block),
        }
    }

    fn let_atom(&mut self, pat: &Pat, scrutinee: &Expr, block: u32) {
        let Some((chain, root)) = place(scrutinee) else { return };
        let v = self.var(&chain, &root);
        match pat_literal(pat) {
            Some(t) => {
                let l = self.lit(&t);
                self.bc.insert((block, v, 1, l));
            }
            None => {
                self.bc.insert((block, v, 7, 0));
            }
        }
    }

    fn compare_atom(&mut self, b: &syn::ExprBinary, negated: bool, block: u32) {
        let op = cmp_code(&b.op, negated);
        let (l, r) = (&*b.left, &*b.right);
        // var op literal, or literal op var (mirror the ordering operators).
        let pair = match (place(l), literal(r), place(r), literal(l)) {
            (Some(p), Some(t), _, _) => Some((p, t, op)),
            (_, _, Some(p), Some(t)) => Some((p, t, mirror(op))),
            _ => None,
        };
        match pair {
            Some(((chain, root), t, op)) => {
                let v = self.var(&chain, &root);
                let lit = self.lit(&t);
                self.bc.insert((block, v, op, lit));
            }
            None => self.other_atom(&Expr::Binary(b.clone()), block),
        }
    }

    /// An atom that is not `var op literal`: one `other` row per variable it reads.
    fn other_atom(&mut self, e: &Expr, block: u32) {
        let mut reads = Vec::new();
        self.norm(e, &mut reads);
        for v in reads {
            self.bc.insert((block, v, 7, 0));
        }
    }

    // ---- driven by the walker -------------------------------------------------------

    /// Open a decision block. `cond` is its condition (if any), `extra` expressions read as part of
    /// it (an iterated expression, a match guard), `binds` the names its patterns bind (written in
    /// its region), `arms` the patterns of a multi-branch with its scrutinee.
    pub fn begin(&mut self, block: u32, cond: Option<&Expr>, extra: &[&Expr], binds: &[String]) {
        self.open_block(block, cond, extra, binds, true);
    }

    /// A `match`: like `begin`, but its atomic predicates come from `match_arms`, not the scrutinee.
    pub fn begin_match(&mut self, block: u32, scrutinee: &Expr, guards: &[&Expr], binds: &[String]) {
        self.open_block(block, Some(scrutinee), guards, binds, false);
    }

    fn open_block(&mut self, block: u32, cond: Option<&Expr>, extra: &[&Expr], binds: &[String], atoms: bool) {
        let mut reads = Vec::new();
        let hash = match cond {
            Some(c) => {
                let t = self.norm(c, &mut reads);
                if atoms {
                    self.atoms(c, false, block);
                }
                fnv32(&t)
            }
            None => 0,
        };
        for e in extra {
            self.norm(e, &mut reads);
        }
        self.bl.push((block, hash));
        self.br.extend(reads.into_iter().map(|v| (block, v)));
        self.open.push(block);
        for b in binds {
            let v = self.name_var(b);
            self.write_var(v);
        }
    }

    /// Record the arms of a multi-branch: each pattern pins the scrutinee to a literal.
    pub fn match_arms(&mut self, block: u32, scrutinee: &Expr, patterns: &[&Pat]) {
        let Some((chain, root)) = place(scrutinee) else { return };
        let v = self.var(&chain, &root);
        for p in patterns {
            let alternatives: Vec<&Pat> = match p {
                Pat::Or(o) => o.cases.iter().collect(),
                other => vec![*other],
            };
            for a in alternatives {
                if let Some(t) = pat_literal(a) {
                    let l = self.lit(&t);
                    self.bc.insert((block, v, 1, l));
                }
            }
        }
    }

    pub fn end(&mut self, block: u32) {
        if self.open.last() == Some(&block) {
            self.open.pop();
        }
    }

    fn write_var(&mut self, v: u32) {
        for b in self.open.clone() {
            self.bw.insert((b, v));
        }
    }

    /// A write to the place `e` (assignment target, `&mut` borrow, method-call receiver).
    pub fn write_place(&mut self, e: &Expr) {
        let Some((chain, root)) = place(e) else { return };
        let v = self.var(&chain, &root);
        self.write_var(v);
        if chain != root {
            let r = self.intern_var(&root);
            self.write_var(r);
        }
    }

    pub fn write_name(&mut self, name: &str) {
        let v = self.name_var(name);
        self.write_var(v);
    }

    /// Resolve the kill rule and emit rows with this function's local index.
    pub fn finish(mut self, fn_local: u32) -> BlockRows {
        // A write to a root writes every chain seen on it.
        let roots: Vec<(u32, u32)> = self.chains.iter().map(|(c, r)| (*c, *r)).collect();
        let writes: Vec<(u32, u32)> = self.bw.iter().copied().collect();
        for (b, v) in writes {
            for (c, r) in &roots {
                if *r == v {
                    self.bw.insert((b, *c));
                }
            }
        }
        BlockRows {
            bl: self.bl.iter().map(|(b, h)| [fn_local, *b, *h]).collect(),
            bw: self.bw.iter().map(|(b, v)| [fn_local, *b, *v]).collect(),
            br: self.br.iter().map(|(b, v)| [fn_local, *b, *v]).collect(),
            bc: self.bc.iter().map(|(b, v, o, l)| [fn_local, *b, *v, *o as u32, *l]).collect(),
        }
    }
}

fn mirror(op: u8) -> u8 {
    match op {
        3 => 5,
        4 => 6,
        5 => 3,
        6 => 4,
        o => o,
    }
}

fn op_text(op: &BinOp) -> &'static str {
    arith_text(op).or_else(|| logic_text(op)).unwrap_or("op")
}

fn arith_text(op: &BinOp) -> Option<&'static str> {
    Some(match op {
        BinOp::Add(_) => "+",
        BinOp::Sub(_) => "-",
        BinOp::Mul(_) => "*",
        BinOp::Div(_) => "/",
        BinOp::Rem(_) => "%",
        _ => return None,
    })
}

fn logic_text(op: &BinOp) -> Option<&'static str> {
    Some(match op {
        BinOp::And(_) => "&&",
        BinOp::Or(_) => "||",
        BinOp::Eq(_) => "==",
        BinOp::Ne(_) => "!=",
        BinOp::Lt(_) => "<",
        BinOp::Le(_) => "<=",
        BinOp::Gt(_) => ">",
        BinOp::Ge(_) => ">=",
        _ => return None,
    })
}

/// `BC` operator code of a comparison; negation turns eq into neq and back.
fn cmp_code(op: &BinOp, negated: bool) -> u8 {
    match (op, negated) {
        (BinOp::Eq(_), false) | (BinOp::Ne(_), true) => 1,
        (BinOp::Ne(_), false) | (BinOp::Eq(_), true) => 2,
        (BinOp::Lt(_), _) => 3,
        (BinOp::Le(_), _) => 4,
        (BinOp::Gt(_), _) => 5,
        (BinOp::Ge(_), _) => 6,
        _ => 7,
    }
}
