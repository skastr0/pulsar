//! Decision-block facts for the coupled-path count: `BL`, `BW`, `BR`, `BC` (FACTS.md).
//!
//! Over the same walk as the control tree. A decision block is a CT branch, multi-branch or loop.
//! For each: a hash of its normalized condition, the variables written anywhere in its region,
//! the variables its own condition reads, and one row per atomic predicate. Variables are
//! numbered densely per function by first occurrence; a member chain (`event.type`) is one
//! variable, and a write to a chain also writes its root. Nothing here sees a name in the output.

use super::*;
use std::collections::BTreeSet;

/// Per-function bookkeeping for decision blocks.
#[derive(Default)]
pub(super) struct BlockAcc {
    /// Variable key to dense id (first occurrence).
    vars: HashMap<String, u32>,
    keys: Vec<String>,
    lits: HashMap<String, u32>,
    /// Blocks whose region is being walked, outermost first, with the variables written so far.
    open: Vec<(u32, BTreeSet<u32>)>,
    /// Finished blocks: node and the variables written in the region.
    done: Vec<(u32, BTreeSet<u32>)>,
    bl: Vec<(u32, u32)>,
    br: Vec<(u32, u32)>,
    bc: Vec<(u32, u32, u8, u32)>,
}

const FNV32_OFFSET: u32 = 0x811c_9dc5;
const FNV32_PRIME: u32 = 0x0100_0193;

fn fnv32(s: &str) -> u32 {
    let mut h = FNV32_OFFSET;
    for b in s.bytes() {
        h = (h ^ b as u32).wrapping_mul(FNV32_PRIME);
    }
    h
}

/// `op` codes of `BC`.
fn cmp_op(op: BinaryOperator) -> Option<u8> {
    Some(match op {
        BinaryOperator::Equality | BinaryOperator::StrictEquality => 1,
        BinaryOperator::Inequality | BinaryOperator::StrictInequality => 2,
        BinaryOperator::LessThan => 3,
        BinaryOperator::LessEqualThan => 4,
        BinaryOperator::GreaterThan => 5,
        BinaryOperator::GreaterEqualThan => 6,
        _ => return None,
    })
}

/// The operator seen from the other side (`1 < x` is `x > 1`).
fn mirror(op: u8) -> u8 {
    match op {
        3 => 5,
        4 => 6,
        5 => 3,
        6 => 4,
        o => o,
    }
}

/// The operator under a leading `!`.
fn negate(op: u8) -> u8 {
    match op {
        1 => 2,
        2 => 1,
        3 => 6,
        4 => 5,
        5 => 4,
        6 => 3,
        o => o,
    }
}

impl<'s> Walker<'s> {
    fn sym_key(sid: SymbolId) -> String {
        format!("{sid:?}")
    }

    /// The variable an identifier or member chain names: a local, a parameter, or a free name.
    /// Imports are constants, not variables, and `undefined` is a literal.
    fn var_key(&self, e: &Expression<'_>) -> Option<String> {
        let c = self.chain(e)?;
        let root = if c.root == "this" && c.rid.is_none() {
            "this".to_string()
        } else {
            let sc = self.scoping?;
            match c.rid.and_then(|r| sc.get_reference(r).symbol_id()) {
                Some(sid) if self.import_binds.contains_key(&sid) => return None,
                Some(sid) => Self::sym_key(sid),
                None if c.root == "undefined" || c.root == "NaN" || c.root == "Infinity" => return None,
                None => format!("g:{}", c.root),
            }
        };
        Some(c.path.iter().fold(root, |k, seg| format!("{k}.{seg}")))
    }

    fn var_id(&mut self, key: &str) -> Option<u32> {
        let acc = &mut self.frames.last_mut()?.blocks;
        if let Some(&i) = acc.vars.get(key) {
            return Some(i);
        }
        let i = acc.keys.len() as u32;
        acc.keys.push(key.to_string());
        acc.vars.insert(key.to_string(), i);
        Some(i)
    }

    fn lit_id(&mut self, text: &str) -> u32 {
        let Some(f) = self.frames.last_mut() else { return 0 };
        let n = f.blocks.lits.len() as u32 + 1;
        *f.blocks.lits.entry(text.to_string()).or_insert(n)
    }

    /// A literal operand: its text, for interning. A member of an import (`Kind.A`) is a constant.
    fn literal_text(&self, e: &Expression<'_>) -> Option<String> {
        match e.get_inner_expression() {
            Expression::StringLiteral(l) => Some(format!("s:{}", l.value.display())),
            Expression::NumericLiteral(n) => Some(format!("n:{}", n.value)),
            Expression::BooleanLiteral(b) => Some(format!("b:{}", b.value)),
            Expression::NullLiteral(_) => Some("null".to_string()),
            Expression::Identifier(i) if i.name == "undefined" => Some("undefined".to_string()),
            Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
                Some(format!("s:{}", t.quasis.first().map_or("", |q| q.value.raw.as_str())))
            }
            other => {
                let c = self.chain(other)?;
                let sid = c.rid.and_then(|r| self.scoping?.get_reference(r).symbol_id())?;
                self.import_binds.contains_key(&sid).then(|| format!("c:{}.{}", c.root, c.path.join(".")))
            }
        }
    }

    /// Open a decision block at CT node `node`: its condition's hash, reads and predicates.
    /// `test` is the condition (hashed, read, and split into atoms when `predicates`: a switch
    /// discriminant is not a predicate, its `case` literals are); `iter` is an iterated
    /// expression that only contributes reads (`for ... of`).
    pub(super) fn begin_block(
        &mut self,
        node: u32,
        test: Option<&Expression<'_>>,
        iter: Option<&Expression<'_>>,
        predicates: bool,
    ) {
        let Some(f) = self.frames.last_mut() else { return };
        f.blocks.open.push((node, BTreeSet::new()));
        let cond = test.map_or(0, |t| self.cond_hash(t).max(1));
        self.frames.last_mut().unwrap().blocks.bl.push((node, cond));
        let mut reads = Vec::new();
        for e in test.into_iter().chain(iter) {
            self.collect_reads(e, &mut reads);
        }
        for key in reads {
            if let Some(v) = self.var_id(&key) {
                self.frames.last_mut().unwrap().blocks.br.push((node, v));
            }
        }
        if let (Some(t), true) = (test, predicates) {
            self.atoms(node, t, false);
        }
    }

    pub(super) fn end_block(&mut self) {
        if let Some(f) = self.frames.last_mut() {
            if let Some(b) = f.blocks.open.pop() {
                f.blocks.done.push(b);
            }
        }
    }

    /// A `case` literal against the discriminant: `disc == literal` for the disjointness proof.
    pub(super) fn case_atom(&mut self, node: u32, disc: &Expression<'_>, case: &Expression<'_>) {
        let (Some(key), Some(lit)) = (self.var_key(disc), self.literal_text(case)) else { return };
        let (Some(v), l) = (self.var_id(&key), self.lit_id(&lit)) else { return };
        self.frames.last_mut().unwrap().blocks.bc.push((node, v, 1, l));
    }

    /// Record a write to the variable `key` (and to its root) in every open block.
    pub(super) fn note_write(&mut self, key: &str) {
        if self.frames.last().is_none_or(|f| f.blocks.open.is_empty()) {
            return;
        }
        let mut ids = Vec::new();
        ids.extend(self.var_id(key));
        if let Some((root, _)) = key.split_once('.') {
            ids.extend(self.var_id(root));
        }
        for (_, writes) in &mut self.frames.last_mut().unwrap().blocks.open {
            writes.extend(ids.iter().copied());
        }
    }

    /// The key of an assignment target that names a variable or a member chain.
    pub(super) fn target_key(&self, t: &AssignmentTarget<'_>) -> Option<String> {
        self.simple_key(t.as_simple_assignment_target()?)
    }

    pub(super) fn simple_key(&self, t: &SimpleAssignmentTarget<'_>) -> Option<String> {
        match t {
            SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => {
                let sid = id.reference_id.get().and_then(|r| self.scoping?.get_reference(r).symbol_id());
                match sid {
                    Some(s) if self.import_binds.contains_key(&s) => None,
                    Some(s) => Some(Self::sym_key(s)),
                    None => Some(format!("g:{}", id.name)),
                }
            }
            other => match other.as_member_expression()? {
                MemberExpression::StaticMemberExpression(m) => {
                    let c = self.chain_static(m)?;
                    self.var_key_of(&c)
                }
                _ => None,
            },
        }
    }

    pub(super) fn var_key_of(&self, c: &Chain) -> Option<String> {
        let root = if c.root == "this" && c.rid.is_none() {
            "this".to_string()
        } else {
            let sc = self.scoping?;
            match c.rid.and_then(|r| sc.get_reference(r).symbol_id()) {
                Some(sid) if self.import_binds.contains_key(&sid) => return None,
                Some(sid) => Self::sym_key(sid),
                None => format!("g:{}", c.root),
            }
        };
        Some(c.path.iter().fold(root, |k, seg| format!("{k}.{seg}")))
    }

    /// A method call on a variable's chain counts as a write to its root (an accumulator).
    pub(super) fn note_call_write(&mut self, call: &CallExpression<'_>) {
        if self.frames.last().is_none_or(|f| f.blocks.open.is_empty()) {
            return;
        }
        if let Expression::StaticMemberExpression(m) = call.callee.get_inner_expression() {
            if let Some(key) = self.var_key(&m.object) {
                self.note_write(&key);
            }
        }
    }

    /// The variables an expression reads (member chains whole, call arguments and receivers).
    fn collect_reads(&self, e: &Expression<'_>, out: &mut Vec<String>) {
        let e = e.get_inner_expression();
        if let Some(k) = self.var_key(e) {
            out.push(k);
            return;
        }
        match e {
            Expression::BinaryExpression(b) => {
                self.collect_reads(&b.left, out);
                self.collect_reads(&b.right, out);
            }
            Expression::LogicalExpression(b) => {
                self.collect_reads(&b.left, out);
                self.collect_reads(&b.right, out);
            }
            Expression::UnaryExpression(u) => self.collect_reads(&u.argument, out),
            Expression::AwaitExpression(a) => self.collect_reads(&a.argument, out),
            Expression::ConditionalExpression(c) => {
                self.collect_reads(&c.test, out);
                self.collect_reads(&c.consequent, out);
                self.collect_reads(&c.alternate, out);
            }
            Expression::TemplateLiteral(t) => t.expressions.iter().for_each(|x| self.collect_reads(x, out)),
            Expression::CallExpression(c) => {
                if let Expression::StaticMemberExpression(m) = c.callee.get_inner_expression() {
                    self.collect_reads(&m.object, out);
                }
                for a in &c.arguments {
                    if let Some(x) = a.as_expression() {
                        self.collect_reads(x, out);
                    }
                }
            }
            _ => {}
        }
    }

    /// The atomic predicates of a condition: comparisons with a variable on one side, and any
    /// other test of a variable as "other". `!` flips the operator.
    fn atoms(&mut self, node: u32, e: &Expression<'_>, negated: bool) {
        match e.get_inner_expression() {
            Expression::LogicalExpression(l) => {
                self.atoms(node, &l.left, negated);
                self.atoms(node, &l.right, negated);
            }
            Expression::UnaryExpression(u) if u.operator == UnaryOperator::LogicalNot => {
                self.atoms(node, &u.argument, !negated)
            }
            Expression::BinaryExpression(b) if cmp_op(b.operator).is_some() => {
                self.comparison(node, b, negated);
            }
            other => {
                let mut reads = Vec::new();
                self.collect_reads(other, &mut reads);
                if let Some(v) = reads.first().and_then(|k| self.var_id(k)) {
                    self.frames.last_mut().unwrap().blocks.bc.push((node, v, 7, 0));
                }
            }
        }
    }

    fn comparison(&mut self, node: u32, b: &BinaryExpression<'_>, negated: bool) {
        let op = cmp_op(b.operator).unwrap_or(7);
        let (lk, rk) = (self.var_key(&b.left), self.var_key(&b.right));
        let (key, lit_side, op) = match (lk, rk) {
            (Some(k), _) if self.literal_text(&b.right).is_some() => (k, Some(&b.right), op),
            (_, Some(k)) if self.literal_text(&b.left).is_some() => (k, Some(&b.left), mirror(op)),
            (Some(k), _) => (k, None, op),
            (_, Some(k)) => (k, None, mirror(op)),
            _ => return,
        };
        let lit = lit_side.and_then(|e| self.literal_text(e)).map_or(0, |t| self.lit_id(&t));
        let op = if negated { negate(op) } else { op };
        if let Some(v) = self.var_id(&key) {
            self.frames.last_mut().unwrap().blocks.bc.push((node, v, op, lit));
        }
    }

    /// A 32-bit FNV-1a of the condition with variables as their dense ids and literals as text.
    fn cond_hash(&mut self, e: &Expression<'_>) -> u32 {
        let sig = self.signature(e);
        fnv32(&sig)
    }

    fn signature(&mut self, e: &Expression<'_>) -> String {
        let e = e.get_inner_expression();
        if let Some(k) = self.var_key(e) {
            return self.var_id(&k).map_or_else(|| "?".to_string(), |v| format!("v{v}"));
        }
        if let Some(l) = self.literal_text(e) {
            return format!("L[{l}]");
        }
        match e {
            Expression::BinaryExpression(b) => {
                format!("({} {:?} {})", self.signature(&b.left), b.operator, self.signature(&b.right))
            }
            Expression::LogicalExpression(b) => {
                format!("({} {:?} {})", self.signature(&b.left), b.operator, self.signature(&b.right))
            }
            Expression::UnaryExpression(u) => format!("({:?} {})", u.operator, self.signature(&u.argument)),
            Expression::CallExpression(c) => {
                let args: Vec<String> =
                    c.arguments.iter().filter_map(|a| a.as_expression()).map(|x| self.signature(x)).collect();
                format!("call({} ; {})", self.signature(&c.callee), args.join(","))
            }
            other => format!("src[{}]", self.text(other.span()).split_whitespace().collect::<Vec<_>>().join(" ")),
        }
    }

    /// Turn a finished function's block bookkeeping into rows.
    pub(super) fn finish_blocks(&mut self, local: u32, acc: BlockAcc) {
        let rows = &mut self.out.blocks;
        for (node, cond) in &acc.bl {
            rows.bl.push([local, *node, *cond]);
        }
        for (node, var) in &acc.br {
            rows.br.push([local, *node, *var]);
        }
        for (node, var, op, lit) in &acc.bc {
            rows.bc.push([local, *node, *var, *op as u32, *lit]);
        }
        for (node, writes) in &acc.done {
            let mut all = writes.clone();
            // A write to `a` writes every chain `a.x...` the function names.
            for w in writes {
                let prefix = format!("{}.", acc.keys[*w as usize]);
                all.extend(acc.keys.iter().enumerate().filter(|(_, k)| k.starts_with(&prefix)).map(|(i, _)| i as u32));
            }
            rows.bw.extend(all.into_iter().map(|v| [local, *node, v]));
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::lang::ts::builtin::all_index;
    use crate::lang::ts::extract::extract;
    use oxc_allocator::Allocator;
    use std::path::Path;

    fn rows(src: &str) -> crate::lang::functions::BlockRows {
        let alloc = Allocator::default();
        extract(&alloc, "b.ts", Path::new("b.ts"), src, &all_index(), 0, None).functions.blocks
    }

    fn sorted<const N: usize>(mut v: Vec<[u32; N]>) -> Vec<[u32; N]> {
        v.sort();
        v.dedup();
        v
    }

    /// Hand-derived: control-tree nodes 1 if, 2 its `&&`, 3 its arm, 4 switch, 5 and 6 its
    /// arms, 7 while, 8 for-of, 9 the ternary; vars a=0, e.type=1, problems=2, xs=3 by first
    /// occurrence; literals n:1=1, s:x=2, s:a=3, s:b=4, n:3=5.
    #[test]
    fn decision_blocks_carry_conditions_reads_writes_and_predicates() {
        let src = "export function f(a: number, e: { type: string }, xs: string[]) {\n  const problems: string[] = [];\n  if (a > 1 && e.type === \"x\") { problems.push(\"p\"); }\n  switch (e.type) { case \"a\": a = 2; break; case \"b\": break; }\n  while (a < 3) { a++; }\n  for (const x of xs) { }\n  return a ? 1 : 2;\n}\n";
        let r = rows(src);
        let nodes: Vec<u32> = sorted(r.bl.clone()).iter().map(|x| x[1]).collect();
        assert_eq!(nodes, [1, 4, 7, 8, 9]);
        let cond = |n: u32| r.bl.iter().find(|x| x[1] == n).unwrap()[2];
        assert_ne!(cond(1), 0);
        assert_eq!(cond(8), 0, "for-of has no condition");
        assert_ne!(cond(1), cond(7));
        assert_eq!(sorted(r.br.clone()), [[0, 1, 0], [0, 1, 1], [0, 4, 1], [0, 7, 0], [0, 8, 3], [0, 9, 0]]);
        assert_eq!(sorted(r.bw.clone()), [[0, 1, 2], [0, 4, 0], [0, 7, 0]]);
        assert_eq!(
            sorted(r.bc.clone()),
            [[0, 1, 0, 5, 1], [0, 1, 1, 1, 2], [0, 4, 1, 1, 3], [0, 4, 1, 1, 4], [0, 7, 0, 3, 5], [0, 9, 0, 7, 0]]
        );
    }

    /// The same condition in two functions hashes alike; a different one does not.
    #[test]
    fn a_condition_hashes_by_structure_not_by_name() {
        let r = rows("function f(a: number) { if (a > 1) {} }\nfunction g(zz: number) { if (zz > 1) {} }\nfunction h(a: number) { if (a > 2) {} }\n");
        let cond = |f: u32| r.bl.iter().find(|x| x[0] == f).unwrap()[2];
        assert_eq!(cond(0), cond(1));
        assert_ne!(cond(0), cond(2));
    }
}
