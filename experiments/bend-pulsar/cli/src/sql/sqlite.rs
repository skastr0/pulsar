//! The SQLite front-end: walks `sqlite3-parser`'s syntax tree and feeds the dialect-neutral
//! [`Builder`]. DDL is replayed into the schema; `SELECT`, `INSERT`, `UPDATE` and `DELETE`
//! become query sites with their tables, column uses and index-defeating predicates. Subqueries
//! are flattened into the site of their statement, each with its own name scope, so a correlated
//! reference resolves outward. Trigger bodies are not walked in this version.

use super::model::*;
use sqlite3_parser::ast::*;

/// Where the text came from, for the sites it produces.
#[derive(Clone, Copy)]
pub struct Cx {
    pub file: u32,
    pub fn_id: u32,
    pub node: u32,
    pub line: u32,
}

/// Strip identifier quoting (`"x"`, `` `x` ``, `[x]`, `'x'`) and lower-case ASCII.
pub fn norm(s: &str) -> String {
    let b = s.as_bytes();
    let inner = match (b.first(), b.last()) {
        (Some(b'"'), Some(b'"')) | (Some(b'`'), Some(b'`')) | (Some(b'\''), Some(b'\'')) if b.len() >= 2 => &s[1..s.len() - 1],
        (Some(b'['), Some(b']')) if b.len() >= 2 => &s[1..s.len() - 1],
        _ => s,
    };
    inner.to_ascii_lowercase()
}

pub struct Fe<'b> {
    pub b: &'b mut Builder,
}

/// Is this statement DDL the schema replay models?
fn is_ddl(s: &Stmt) -> bool {
    matches!(
        s,
        Stmt::CreateTable { .. }
            | Stmt::CreateIndex { .. }
            | Stmt::CreateView { .. }
            | Stmt::CreateVirtualTable { .. }
            | Stmt::CreateTrigger { .. }
            | Stmt::AlterTable(..)
            | Stmt::DropTable { .. }
            | Stmt::DropIndex { .. }
            | Stmt::DropView { .. }
            | Stmt::DropTrigger { .. }
    )
}

impl<'b> Fe<'b> {
    pub fn new(b: &'b mut Builder) -> Self {
        Fe { b }
    }

    fn name(&mut self, s: &str) -> u32 {
        let n = norm(s);
        self.b.names.intern(&n)
    }

    /// One parsed command.
    pub fn command(&mut self, cx: &Cx, cmd: &Cmd) {
        let (Cmd::Explain(s) | Cmd::ExplainQueryPlan(s) | Cmd::Stmt(s)) = cmd;
        if is_ddl(s) {
            self.ddl(cx.file, s);
        } else {
            self.dml(cx, s);
        }
    }

    // ---- DDL --------------------------------------------------------------------------

    fn ddl(&mut self, file: u32, s: &Stmt) {
        match s {
            Stmt::CreateTable { if_not_exists, tbl_name, body, .. } => {
                self.create_table(file, tbl_name, body, *if_not_exists)
            }
            Stmt::CreateIndex { unique, idx_name, tbl_name, columns, where_clause, .. } => {
                self.create_index(*unique, idx_name, tbl_name, columns, where_clause.is_some())
            }
            Stmt::AlterTable(name, body) => self.alter(name, body),
            Stmt::DropTable { tbl_name, .. } | Stmt::DropView { view_name: tbl_name, .. } => {
                let t = self.name(tbl_name.name.0);
                self.b.drop_table(t);
            }
            Stmt::DropIndex { idx_name, .. } => {
                let i = self.name(idx_name.name.0);
                self.b.drop_index(i);
            }
            Stmt::CreateView { view_name, .. } => {
                let t = self.name(view_name.name.0);
                self.b.create_opaque_table(file, t, T_VIEW);
            }
            Stmt::CreateVirtualTable { tbl_name, .. } => {
                let t = self.name(tbl_name.name.0);
                self.b.create_opaque_table(file, t, T_VIRTUAL);
            }
            _ => {}
        }
        self.b.ddl_ok += 1;
    }

    fn create_table(&mut self, file: u32, qn: &QualifiedName, body: &CreateTableBody, if_not_exists: bool) {
        let t = self.name(qn.name.0);
        let CreateTableBody::ColumnsAndConstraints { columns, constraints, flags } = body else {
            self.b.create_opaque_table(file, t, 0);
            return;
        };
        let mut spec = TableSpec::default();
        if flags.contains(TabFlags::WithoutRowid) {
            spec.flags |= T_WITHOUT_ROWID;
        }
        if flags.contains(TabFlags::Strict) {
            spec.flags |= T_STRICT;
        }
        for def in columns.iter() {
            let c = self.col_spec(def);
            spec.cols.push(c);
        }
        if let Some(cs) = constraints {
            for nc in cs.iter() {
                self.table_constraint(&nc.constraint, &mut spec);
            }
        }
        self.b.create_table(file, t, spec, if_not_exists);
    }

    fn col_spec(&mut self, def: &ColumnDefinition) -> ColSpec {
        let mut c = ColSpec {
            name: self.name(def.col_name.0),
            integer: def.col_type.as_ref().is_some_and(|t| t.name.eq_ignore_ascii_case("integer")),
            ..ColSpec::default()
        };
        for nc in def.constraints.iter() {
            match &nc.constraint {
                ColumnConstraint::PrimaryKey { .. } => c.pk = true,
                ColumnConstraint::NotNull { nullable, .. } => c.not_null = !*nullable,
                ColumnConstraint::Unique(_) => c.unique = true,
                ColumnConstraint::Default(_) => c.default = true,
                ColumnConstraint::Generated { .. } => c.generated = true,
                ColumnConstraint::ForeignKey { clause, .. } => c.fk = Some(self.fk_target(clause)),
                _ => {}
            }
        }
        c
    }

    fn fk_target(&mut self, clause: &ForeignKeyClause) -> (u32, u32) {
        let t = self.name(clause.tbl_name.0);
        let rc = match clause.columns.and_then(|cs| cs.first()) {
            Some(ic) => self.name(ic.col_name.0),
            None => NONE,
        };
        (t, rc)
    }

    fn sorted_names(&mut self, cols: &[SortedColumn]) -> Vec<u32> {
        cols.iter().map(|c| self.simple_col(&c.expr).map_or(NONE, |(_, n)| n)).collect()
    }

    fn indexed_names(&mut self, cols: &[IndexedColumn]) -> Vec<u32> {
        cols.iter().map(|c| self.name(c.col_name.0)).collect()
    }

    fn table_constraint(&mut self, tc: &TableConstraint, spec: &mut TableSpec) {
        match tc {
            TableConstraint::PrimaryKey { columns, .. } => spec.pk = self.sorted_names(columns),
            TableConstraint::Unique { columns, .. } => spec.uniques.push(self.sorted_names(columns)),
            TableConstraint::ForeignKey { columns, clause, .. } => {
                let cols = self.indexed_names(columns);
                let (rt, _) = self.fk_target(clause);
                let rcols = clause.columns.map(|cs| self.indexed_names(cs)).unwrap_or_default();
                spec.fks.push((cols, rt, rcols));
            }
            TableConstraint::Check(..) => {}
        }
    }

    fn create_index(&mut self, unique: bool, idx: &QualifiedName, tbl: &Name, columns: &[SortedColumn], partial: bool) {
        let (i, t) = (self.name(idx.name.0), self.name(tbl.0));
        let cols = self.sorted_names(columns);
        let mut flags = 0;
        for (on, bit) in [(unique, I_UNIQUE), (partial, I_PARTIAL), (cols.contains(&NONE), I_EXPR)] {
            if on {
                flags |= bit;
            }
        }
        self.b.create_index(i, t, flags, cols);
    }

    fn alter(&mut self, qn: &QualifiedName, body: &AlterTableBody) {
        let t = self.name(qn.name.0);
        match body {
            AlterTableBody::AddColumn(def) => {
                let c = self.col_spec(def);
                self.b.add_column(t, c);
            }
            AlterTableBody::RenameTo(n) => {
                let to = self.name(n.0);
                self.b.rename_table(t, to);
            }
            AlterTableBody::RenameColumn { old, new } => {
                let (o, n) = (self.name(old.0), self.name(new.0));
                self.b.rename_column(t, o, n);
            }
            AlterTableBody::DropColumn(n) => {
                let c = self.name(n.0);
                self.b.drop_column(t, c);
            }
            AlterTableBody::AddConstraint(nc) => self.alter_constraint(t, &nc.constraint),
            _ => {}
        }
    }

    fn alter_constraint(&mut self, t: u32, tc: &TableConstraint) {
        match tc {
            TableConstraint::Unique { columns, .. } => {
                let cols = self.sorted_names(columns);
                self.b.add_unique(t, cols);
            }
            TableConstraint::ForeignKey { columns, clause, .. } => {
                let cols = self.indexed_names(columns);
                let (rt, _) = self.fk_target(clause);
                let rcols = clause.columns.map(|cs| self.indexed_names(cs)).unwrap_or_default();
                self.b.add_fk(t, cols, rt, rcols);
            }
            _ => {}
        }
    }

    // ---- statements -------------------------------------------------------------------

    fn site(&mut self, cx: &Cx, kind: u32) {
        self.b.begin_site(cx.file, cx.fn_id, cx.node, cx.line, kind);
    }

    fn dml(&mut self, cx: &Cx, s: &Stmt) {
        match s {
            Stmt::Select(sel) => {
                self.site(cx, K_SELECT);
                self.select(sel, None);
                if let Some(l) = sel.limit {
                    self.limit(l);
                }
            }
            Stmt::Insert { tbl_name, columns, body, .. } => {
                self.site(cx, K_INSERT);
                self.insert(tbl_name, columns.as_ref(), body);
            }
            Stmt::Update { tbl_name, sets, from, where_clause, limit, .. } => {
                self.site(cx, K_UPDATE);
                self.update(tbl_name, sets, from.as_ref(), where_clause.as_ref());
                if let Some(l) = limit {
                    self.limit(l);
                }
            }
            Stmt::Delete { tbl_name, where_clause, limit, .. } => {
                self.site(cx, K_DELETE);
                let sc = self.target(tbl_name, M_DELETE);
                if let Some(w) = where_clause {
                    self.pred(w, sc, false);
                }
                if let Some(l) = limit {
                    self.limit(l);
                }
            }
            _ => return,
        }
        self.b.end_site();
    }

    /// The statement's target table: a table reference and a scope that holds it.
    fn target(&mut self, qn: &QualifiedName, mode: u8) -> usize {
        let t = self.name(qn.name.0);
        let alias = qn.alias.as_ref().map_or(t, |a| self.name(a.0));
        self.b.table_ref(t, mode);
        let sc = self.b.new_scope(None);
        self.b.scope_entry(sc, alias, t);
        sc
    }

    fn insert(&mut self, qn: &QualifiedName, columns: Option<&DistinctNames>, body: &InsertBody) {
        let sc = self.target(qn, M_INSERT);
        if let Some(cols) = columns {
            for n in cols.iter() {
                let c = self.name(n.0);
                self.b.col_use(sc, None, c, R_INSERT_COL);
            }
        }
        if let InsertBody::Select(sel, upsert) = body {
            self.select(sel, None);
            if let Some(u) = upsert {
                self.upsert(u, sc);
            }
        }
    }

    fn upsert(&mut self, u: &Upsert, sc: usize) {
        if let UpsertDo::Set { sets, where_clause } = &u.do_clause {
            self.sets(sets, sc);
            if let Some(w) = where_clause {
                self.pred(w, sc, false);
            }
        }
        if let Some(next) = u.next {
            self.upsert(next, sc);
        }
    }

    fn sets(&mut self, sets: &[Set], sc: usize) {
        for s in sets {
            for n in s.col_names.iter() {
                let c = self.name(n.0);
                self.b.col_use(sc, None, c, R_SET);
            }
            self.expr(&s.expr, sc, None);
        }
    }

    fn update(&mut self, qn: &QualifiedName, sets: &[Set], from: Option<&FromClause>, w: Option<&Expr>) {
        let sc = self.target(qn, M_UPDATE);
        if let Some(f) = from {
            self.from(f, sc);
        }
        self.sets(sets, sc);
        if let Some(w) = w {
            self.pred(w, sc, false);
        }
    }

    fn limit(&mut self, l: &Limit) {
        self.b.flag(Q_LIMIT);
        if matches!(&l.expr, Expr::Literal(Literal::Numeric(n)) if *n == "1") {
            self.b.flag(Q_LIMIT_ONE);
        }
        match &l.offset {
            Some(Expr::Literal(Literal::Numeric(_))) => self.b.flag(Q_OFFSET_LITERAL),
            Some(_) => self.b.flag(Q_OFFSET_PARAM),
            None => {}
        }
    }

    // ---- SELECT -----------------------------------------------------------------------

    fn select(&mut self, sel: &Select, parent: Option<usize>) {
        if let Some(w) = &sel.with {
            for c in w.ctes.iter() {
                let n = self.name(c.tbl_name.0);
                self.b.cte(n);
            }
            for c in w.ctes.iter() {
                self.select(c.select, None);
            }
        }
        let first = self.one_select(&sel.body.select, parent);
        if let Some(cs) = &sel.body.compounds {
            for c in cs.iter() {
                self.one_select(&c.select, parent);
            }
        }
        if let Some(order) = sel.order_by {
            for t in order {
                self.term(&t.expr, first, R_ORDER);
            }
        }
    }

    fn one_select(&mut self, os: &OneSelect, parent: Option<usize>) -> usize {
        let sc = self.b.new_scope(parent);
        match os {
            OneSelect::Select { columns, from, where_clause, group_by, having, .. } => {
                if let Some(f) = from {
                    self.from(f, sc);
                }
                for c in columns.iter() {
                    self.result_col(c, sc);
                }
                if let Some(w) = where_clause {
                    self.pred(w, sc, false);
                }
                for e in group_by.iter().flat_map(|g| g.iter()) {
                    self.term(e, sc, R_GROUP);
                }
                if let Some(h) = having {
                    self.pred(h, sc, false);
                }
            }
            OneSelect::Values(rows) => {
                for e in rows.iter().flat_map(|r| r.iter()) {
                    self.expr(e, sc, None);
                }
            }
        }
        sc
    }

    fn result_col(&mut self, c: &ResultColumn, sc: usize) {
        match c {
            ResultColumn::Expr(e, _) => self.expr(e, sc, Some(R_PROJ)),
            ResultColumn::Star => self.b.flag(Q_STAR),
            ResultColumn::TableStar(_) => self.b.flag(Q_TABLE_STAR),
        }
    }

    fn from(&mut self, f: &FromClause, sc: usize) {
        if let Some(t) = f.select {
            self.select_table(t, sc);
        }
        for j in f.joins.iter().flat_map(|js| js.iter()) {
            self.select_table(&j.table, sc);
            match &j.constraint {
                Some(JoinConstraint::On(e)) => self.pred(e, sc, true),
                Some(JoinConstraint::Using(names)) => {
                    for n in names.iter() {
                        let c = self.name(n.0);
                        self.b.col_use(sc, None, c, R_JOIN);
                    }
                }
                None => {}
            }
        }
    }

    fn select_table(&mut self, t: &SelectTable, sc: usize) {
        match t {
            SelectTable::Table(qn, alias, _) => {
                let tid = self.name(qn.name.0);
                let a = self.alias(alias.as_ref(), tid);
                if self.b.is_cte(tid) {
                    self.b.scope_entry(sc, a, DERIVED);
                } else {
                    self.b.scope_entry(sc, a, tid);
                    self.b.table_ref(tid, M_READ);
                }
            }
            SelectTable::TableCall(qn, args, alias) => {
                let tid = self.name(qn.name.0);
                let a = self.alias(alias.as_ref(), tid);
                self.b.scope_entry(sc, a, DERIVED);
                for e in args.iter().flat_map(|a| a.iter()) {
                    self.expr(e, sc, None);
                }
            }
            SelectTable::Select(sub, alias) => {
                let a = self.alias(alias.as_ref(), NONE);
                self.b.scope_entry(sc, a, DERIVED);
                self.select(sub, None);
            }
            SelectTable::Sub(from, _) => self.from(from, sc),
        }
    }

    fn alias(&mut self, a: Option<&As>, default: u32) -> u32 {
        match a {
            Some(As::As(n) | As::Elided(n)) => self.name(n.0),
            None => default,
        }
    }

    // ---- expressions ------------------------------------------------------------------

    /// `Some((qualifier, column))` for a bare column reference.
    fn simple_col(&mut self, e: &Expr) -> Option<(Option<u32>, u32)> {
        match e {
            Expr::Id(i) => Some((None, self.name(i.0))),
            Expr::Name(n) => Some((None, self.name(n.0))),
            Expr::Qualified(q, c) => Some((Some(self.name(q.0)), self.name(c.0))),
            Expr::DoublyQualified(_, t, c) => Some((Some(self.name(t.0)), self.name(c.0))),
            Expr::Parenthesized(v) if v.len() == 1 => self.simple_col(&v[0]),
            _ => None,
        }
    }

    /// The first column buried inside a function call, arithmetic or cast.
    fn first_col(&mut self, e: &Expr) -> Option<(Option<u32>, u32)> {
        if let Some(c) = self.simple_col(e) {
            return Some(c);
        }
        match e {
            Expr::FunctionCall { args, .. } => self.first_in(args.iter().flat_map(|a| a.iter())),
            Expr::Binary(l, _, r) => self.first_in([&**l, &**r].into_iter()),
            Expr::Cast { expr, .. } | Expr::Collate(expr, _) | Expr::Unary(_, expr) => self.first_col(expr),
            Expr::Parenthesized(v) => self.first_in(v.iter()),
            _ => None,
        }
    }

    fn first_in<'e>(&mut self, mut it: impl Iterator<Item = &'e Expr<'e>>) -> Option<(Option<u32>, u32)> {
        it.find_map(|e| self.first_col(e))
    }

    /// Record every column in `e` with `role` (when given) and walk into subqueries.
    fn expr(&mut self, e: &Expr, sc: usize, role: Option<u8>) {
        if let Some((q, c)) = self.simple_col(e) {
            if let Some(r) = role {
                self.b.col_use(sc, q, c, r);
            }
            return;
        }
        match e {
            Expr::Exists(sel) | Expr::Subquery(sel) => self.select(sel, Some(sc)),
            Expr::InSelect { lhs, rhs, .. } => {
                self.expr(lhs, sc, role);
                self.select(rhs, Some(sc));
            }
            _ => self.children(e, sc, role),
        }
    }

    fn children(&mut self, e: &Expr, sc: usize, role: Option<u8>) {
        for x in child_exprs(e) {
            self.expr(x, sc, role);
        }
    }

    /// `ORDER BY` or `GROUP BY` term: a bare column gets the role, anything else is only walked.
    fn term(&mut self, e: &Expr, sc: usize, role: u8) {
        let role = self.simple_col(e).map(|_| role);
        self.expr(e, sc, role);
    }

    // ---- predicates -------------------------------------------------------------------

    fn pred(&mut self, e: &Expr, sc: usize, on: bool) {
        match e {
            Expr::Binary(l, Operator::And, r) => {
                self.pred(l, sc, on);
                self.pred(r, sc, on);
            }
            Expr::Binary(l, Operator::Or, r) => self.or(l, r, sc, on),
            Expr::Binary(l, op, r) => self.compare(l, *op, r, sc),
            Expr::Unary(_, x) => self.pred(x, sc, on),
            Expr::Parenthesized(v) => {
                for x in v.iter() {
                    self.pred(x, sc, on);
                }
            }
            _ => self.pred_atom(e, sc),
        }
    }

    /// A predicate that is not a boolean combination: range, membership, pattern or null test.
    fn pred_atom(&mut self, e: &Expr, sc: usize) {
        match e {
            Expr::Between { lhs, start, end, .. } => {
                self.side(lhs, R_RANGE, sc);
                self.expr(start, sc, None);
                self.expr(end, sc, None);
            }
            Expr::InList { lhs, rhs, .. } => {
                self.side(lhs, R_IN, sc);
                for x in rhs.iter().flat_map(|v| v.iter()) {
                    self.expr(x, sc, None);
                }
            }
            Expr::InSelect { lhs, rhs, .. } => {
                self.side(lhs, R_IN, sc);
                self.select(rhs, Some(sc));
            }
            Expr::Like { lhs, rhs, .. } => {
                self.side(lhs, R_LIKE, sc);
                self.leading_wildcard(lhs, rhs, sc);
            }
            Expr::IsNull(x) | Expr::NotNull(x) => self.side(x, R_NULL, sc),
            _ => self.expr(e, sc, None),
        }
    }

    /// One side of a comparison: a bare column gets the role; a column inside a function or
    /// arithmetic defeats an index on it; anything else is only walked for subqueries.
    fn side(&mut self, e: &Expr, role: u8, sc: usize) {
        if let Some((q, c)) = self.simple_col(e) {
            self.b.col_use(sc, q, c, role);
            return;
        }
        if let Some((q, c)) = self.first_col(e) {
            self.b.defeat(sc, q, c, D_WRAPPED);
        }
        self.expr(e, sc, None);
    }

    fn compare(&mut self, l: &Expr, op: Operator, r: &Expr, sc: usize) {
        // `x IS NULL` and `x IS NOT NULL` are null tests, not equalities.
        if matches!(op, Operator::Is | Operator::IsNot) {
            if is_null(r) {
                return self.side(l, R_NULL, sc);
            }
            if is_null(l) {
                return self.side(r, R_NULL, sc);
            }
        }
        let role = match op {
            Operator::Equals | Operator::Is => R_EQ,
            Operator::Greater | Operator::GreaterEquals | Operator::Less | Operator::LessEquals => R_RANGE,
            _ => {
                self.expr(l, sc, None);
                self.expr(r, sc, None);
                return;
            }
        };
        let both = self.simple_col(l).is_some() && self.simple_col(r).is_some();
        let role = if both && role == R_EQ && self.b.scope_len(sc) > 1 { R_JOIN } else { role };
        self.side(l, role, sc);
        self.side(r, role, sc);
    }

    fn leading_wildcard(&mut self, lhs: &Expr, rhs: &Expr, sc: usize) {
        let Expr::Literal(Literal::String(s)) = rhs else { return };
        if !s.trim_matches('\'').starts_with(['%', '_']) {
            return;
        }
        if let Some((q, c)) = self.simple_col(lhs) {
            self.b.defeat(sc, q, c, D_LEADING_WILDCARD);
        }
    }

    /// `a OR b`: when the two sides filter on different columns, one index cannot serve both.
    fn or(&mut self, l: &Expr, r: &Expr, sc: usize, on: bool) {
        let from = self.b.use_count();
        self.pred(l, sc, on);
        self.pred(r, sc, on);
        let cols = self.b.predicate_cols_since(from);
        let mut distinct: Vec<(Option<u32>, u32)> = cols.iter().map(|(_, q, c)| (*q, *c)).collect();
        distinct.sort();
        distinct.dedup();
        if distinct.len() < 2 {
            return;
        }
        for (scope, q, c) in cols {
            self.b.defeat(scope, q, c, D_OR);
        }
    }
}

/// The direct sub-expressions of `e` that a column can hide in. Subqueries are not children here:
/// `expr` handles those.
fn child_exprs<'a, 'b>(e: &'a Expr<'b>) -> Vec<&'a Expr<'b>> {
    match e {
        Expr::Between { lhs, start, end, .. } => vec![&**lhs, &**start, &**end],
        Expr::Binary(l, _, r) => vec![&**l, &**r],
        Expr::Case { base, when_then_pairs, else_expr } => {
            let mut v: Vec<&Expr> = base.iter().copied().chain(else_expr.iter().copied()).collect();
            v.extend(when_then_pairs.iter().flat_map(|(w, t)| [w, t]));
            v
        }
        Expr::Cast { expr, .. } | Expr::Collate(expr, _) | Expr::Unary(_, expr) | Expr::IsNull(expr) | Expr::NotNull(expr) => {
            vec![&**expr]
        }
        Expr::FunctionCall { args, .. } => args.iter().flat_map(|a| a.iter()).collect(),
        Expr::InList { lhs, rhs, .. } => std::iter::once(&**lhs).chain(rhs.iter().flat_map(|a| a.iter())).collect(),
        Expr::Like { lhs, rhs, escape, .. } => [&**lhs, &**rhs].into_iter().chain(escape.iter().copied()).collect(),
        Expr::Parenthesized(v) => v.iter().collect(),
        _ => Vec::new(),
    }
}

fn is_null(e: &Expr) -> bool {
    matches!(e, Expr::Literal(Literal::Null))
}
