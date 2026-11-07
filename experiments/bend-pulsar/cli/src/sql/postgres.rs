//! The PostgreSQL front-end: walks `pg_query`'s syntax tree (libpg_query, Postgres's own parser)
//! and feeds the same dialect-neutral [`Builder`] as the SQLite front-end. `?` placeholders (what
//! the TS lane writes for `${}`) are turned into `$1`, `$2`, ... before parsing. Postgres has no
//! rowid alias, so no column ever gets the rowid flag. Subqueries are flattened into their
//! statement's site with their own name scope, as in the SQLite front-end.

use super::model::*;
use super::sqlite::Cx;
use pg_query::protobuf as pb;
use pg_query::NodeEnum as N;

type Scoped = usize;

/// Placeholders: `?` outside quotes becomes `$n`.
pub fn pgify(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len() + 8);
    let (mut n, mut quote) = (0u32, None::<char>);
    for c in sql.chars() {
        match (quote, c) {
            (None, '\'' | '"') => {
                quote = Some(c);
                out.push(c);
            }
            (Some(q), c) if c == q => {
                quote = None;
                out.push(c);
            }
            (None, '?') => {
                n += 1;
                out.push_str(&format!("${n}"));
            }
            _ => out.push(c),
        }
    }
    out
}

/// Parse one chunk and walk its statements. `false` = parse failure.
pub fn run(b: &mut Builder, cx: &Cx, chunk: &str) -> bool {
    let Ok(parsed) = pg_query::parse(&pgify(chunk)) else { return false };
    let mut pg = Pg { b };
    for raw in &parsed.protobuf.stmts {
        if let Some(n) = raw.stmt.as_ref().and_then(|s| s.node.as_ref()) {
            pg.stmt(cx, n);
        }
    }
    true
}

struct Pg<'b> {
    b: &'b mut Builder,
}

fn nm(b: &mut Builder, s: &str) -> u32 {
    b.names.intern(&s.to_ascii_lowercase())
}

/// A `String` node's text.
fn sval(n: &pb::Node) -> Option<&str> {
    match n.node.as_ref()? {
        N::String(s) => Some(s.sval.as_str()),
        _ => None,
    }
}

/// The last name of a qualified-name list (`schema.table` -> `table`).
fn last_name(list: &[pb::Node]) -> Option<&str> {
    list.iter().rev().find_map(sval)
}

fn kind_of(n: &Option<Box<pb::Node>>) -> Option<&N> {
    n.as_ref().and_then(|b| b.node.as_ref())
}

impl Pg<'_> {
    fn name(&mut self, s: &str) -> u32 {
        nm(self.b, s)
    }

    fn stmt(&mut self, cx: &Cx, n: &N) {
        match n {
            N::CreateStmt(_) | N::IndexStmt(_) | N::AlterTableStmt(_) | N::RenameStmt(_) | N::DropStmt(_) | N::ViewStmt(_) => {
                self.ddl(cx.file, n);
                self.b.ddl_ok += 1;
            }
            _ => self.dml(cx, n),
        }
    }

    // ---- DDL --------------------------------------------------------------------------

    fn ddl(&mut self, file: u32, n: &N) {
        match n {
            N::CreateStmt(c) => self.create_table(file, c),
            N::IndexStmt(i) => self.create_index(i),
            N::AlterTableStmt(a) => self.alter(a),
            N::RenameStmt(r) => self.rename(r),
            N::DropStmt(d) => self.drop(d),
            N::ViewStmt(v) => {
                if let Some(rv) = &v.view {
                    let t = self.name(&rv.relname);
                    self.b.create_opaque_table(file, t, T_VIEW);
                }
            }
            _ => {}
        }
    }

    fn create_table(&mut self, file: u32, c: &pb::CreateStmt) {
        let Some(rel) = &c.relation else { return };
        let t = self.name(&rel.relname);
        let mut spec = TableSpec::default();
        for e in &c.table_elts {
            match e.node.as_ref() {
                Some(N::ColumnDef(d)) => {
                    let col = self.col_spec(d);
                    spec.cols.push(col);
                }
                Some(N::Constraint(k)) => self.table_constraint(k, &mut spec),
                _ => {}
            }
        }
        self.b.create_table(file, t, spec, c.if_not_exists);
    }

    fn col_spec(&mut self, d: &pb::ColumnDef) -> ColSpec {
        let mut c = ColSpec { name: self.name(&d.colname), not_null: d.is_not_null, default: d.raw_default.is_some(), ..ColSpec::default() };
        for k in &d.constraints {
            let Some(N::Constraint(k)) = k.node.as_ref() else { continue };
            match k.contype() {
                pb::ConstrType::ConstrPrimary => c.pk = true,
                pb::ConstrType::ConstrNotnull => c.not_null = true,
                pb::ConstrType::ConstrUnique => c.unique = true,
                pb::ConstrType::ConstrDefault => c.default = true,
                pb::ConstrType::ConstrGenerated | pb::ConstrType::ConstrIdentity => c.generated = true,
                pb::ConstrType::ConstrForeign => c.fk = Some(self.fk_target(k)),
                _ => {}
            }
        }
        c
    }

    fn fk_target(&mut self, k: &pb::Constraint) -> (u32, u32) {
        let t = k.pktable.as_ref().map_or(NONE, |r| self.name(&r.relname));
        let rc = match last_name(&k.pk_attrs[..k.pk_attrs.len().min(1)]) {
            Some(n) => self.name(n),
            None => NONE,
        };
        (t, rc)
    }

    fn names(&mut self, list: &[pb::Node]) -> Vec<u32> {
        list.iter().filter_map(sval).map(|s| nm(self.b, s)).collect()
    }

    fn table_constraint(&mut self, k: &pb::Constraint, spec: &mut TableSpec) {
        match k.contype() {
            pb::ConstrType::ConstrPrimary => spec.pk = self.names(&k.keys),
            pb::ConstrType::ConstrUnique => spec.uniques.push(self.names(&k.keys)),
            pb::ConstrType::ConstrForeign => {
                let cols = self.names(&k.fk_attrs);
                let (rt, _) = self.fk_target(k);
                let rcols = self.names(&k.pk_attrs);
                spec.fks.push((cols, rt, rcols));
            }
            _ => {}
        }
    }

    fn create_index(&mut self, i: &pb::IndexStmt) {
        let Some(rel) = &i.relation else { return };
        let (idx, t) = (self.name(&i.idxname), self.name(&rel.relname));
        let mut cols = Vec::new();
        for p in &i.index_params {
            let Some(N::IndexElem(e)) = p.node.as_ref() else { continue };
            cols.push(if e.name.is_empty() { NONE } else { self.name(&e.name) });
        }
        let mut flags = 0;
        for (on, bit) in [(i.unique, I_UNIQUE), (i.where_clause.is_some(), I_PARTIAL), (cols.contains(&NONE), I_EXPR)] {
            if on {
                flags |= bit;
            }
        }
        self.b.create_index(idx, t, flags, cols);
    }

    fn alter(&mut self, a: &pb::AlterTableStmt) {
        let Some(rel) = &a.relation else { return };
        let t = self.name(&rel.relname);
        for c in &a.cmds {
            if let Some(N::AlterTableCmd(cmd)) = c.node.as_ref() {
                self.alter_cmd(t, cmd);
            }
        }
    }

    fn alter_cmd(&mut self, t: u32, cmd: &pb::AlterTableCmd) {
        match (cmd.subtype(), kind_of(&cmd.def)) {
            (pb::AlterTableType::AtAddColumn, Some(N::ColumnDef(d))) => {
                let c = self.col_spec(d);
                self.b.add_column(t, c);
            }
            (pb::AlterTableType::AtDropColumn, _) => {
                let c = self.name(&cmd.name);
                self.b.drop_column(t, c);
            }
            (pb::AlterTableType::AtAddConstraint, Some(N::Constraint(k))) => self.add_constraint(t, k),
            _ => {}
        }
    }

    fn add_constraint(&mut self, t: u32, k: &pb::Constraint) {
        match k.contype() {
            pb::ConstrType::ConstrUnique => {
                let cols = self.names(&k.keys);
                self.b.add_unique(t, cols);
            }
            pb::ConstrType::ConstrForeign => {
                let cols = self.names(&k.fk_attrs);
                let (rt, _) = self.fk_target(k);
                let rcols = self.names(&k.pk_attrs);
                self.b.add_fk(t, cols, rt, rcols);
            }
            _ => {}
        }
    }

    fn rename(&mut self, r: &pb::RenameStmt) {
        let Some(rel) = &r.relation else { return };
        let t = self.name(&rel.relname);
        match r.rename_type() {
            pb::ObjectType::ObjectTable => {
                let to = self.name(&r.newname);
                self.b.rename_table(t, to);
            }
            pb::ObjectType::ObjectColumn => {
                let (from, to) = (self.name(&r.subname), self.name(&r.newname));
                self.b.rename_column(t, from, to);
            }
            _ => {}
        }
    }

    fn drop(&mut self, d: &pb::DropStmt) {
        for o in &d.objects {
            let Some(N::List(l)) = o.node.as_ref() else { continue };
            let Some(n) = last_name(&l.items) else { continue };
            let id = self.name(n);
            match d.remove_type() {
                pb::ObjectType::ObjectTable | pb::ObjectType::ObjectView => self.b.drop_table(id),
                pb::ObjectType::ObjectIndex => self.b.drop_index(id),
                _ => {}
            }
        }
    }

    // ---- statements -------------------------------------------------------------------

    fn dml(&mut self, cx: &Cx, n: &N) {
        match n {
            N::SelectStmt(s) => {
                self.b.begin_site(cx.file, cx.fn_id, cx.node, cx.line, K_SELECT);
                self.select(s, None);
                self.limit(s);
            }
            N::InsertStmt(i) => {
                self.b.begin_site(cx.file, cx.fn_id, cx.node, cx.line, K_INSERT);
                self.insert(i);
            }
            N::UpdateStmt(u) => {
                self.b.begin_site(cx.file, cx.fn_id, cx.node, cx.line, K_UPDATE);
                self.update(u);
            }
            N::DeleteStmt(d) => {
                self.b.begin_site(cx.file, cx.fn_id, cx.node, cx.line, K_DELETE);
                self.delete(d);
            }
            _ => return,
        }
        self.b.end_site();
    }

    fn target(&mut self, rv: &pb::RangeVar, mode: u8) -> Scoped {
        let t = self.name(&rv.relname);
        let alias = rv.alias.as_ref().map_or(t, |a| nm(self.b, &a.aliasname));
        self.b.table_ref(t, mode);
        let sc = self.b.new_scope(None);
        self.b.scope_entry(sc, alias, t);
        sc
    }

    fn insert(&mut self, i: &pb::InsertStmt) {
        let Some(rel) = &i.relation else { return };
        let sc = self.target(rel, M_INSERT);
        for c in &i.cols {
            if let Some(N::ResTarget(r)) = c.node.as_ref() {
                let col = self.name(&r.name);
                self.b.col_use(sc, None, col, R_INSERT_COL);
            }
        }
        if let Some(N::SelectStmt(s)) = kind_of(&i.select_stmt) {
            self.select(s, None);
        }
        if let Some(oc) = &i.on_conflict_clause {
            self.res_sets(&oc.target_list, sc);
            if let Some(w) = &oc.where_clause {
                self.pred(w, sc, false);
            }
        }
    }

    fn res_sets(&mut self, list: &[pb::Node], sc: Scoped) {
        for t in list {
            let Some(N::ResTarget(r)) = t.node.as_ref() else { continue };
            let col = self.name(&r.name);
            self.b.col_use(sc, None, col, R_SET);
            if let Some(v) = &r.val {
                self.expr(v, sc, None);
            }
        }
    }

    fn update(&mut self, u: &pb::UpdateStmt) {
        let Some(rel) = &u.relation else { return };
        let sc = self.target(rel, M_UPDATE);
        for f in &u.from_clause {
            self.from_item(f, sc);
        }
        self.res_sets(&u.target_list, sc);
        if let Some(w) = &u.where_clause {
            self.pred(w, sc, false);
        }
    }

    fn delete(&mut self, d: &pb::DeleteStmt) {
        let Some(rel) = &d.relation else { return };
        let sc = self.target(rel, M_DELETE);
        for f in &d.using_clause {
            self.from_item(f, sc);
        }
        if let Some(w) = &d.where_clause {
            self.pred(w, sc, false);
        }
    }

    fn limit(&mut self, s: &pb::SelectStmt) {
        if let Some(c) = &s.limit_count {
            self.b.flag(Q_LIMIT);
            if matches!(c.node.as_ref(), Some(N::AConst(a)) if const_int(a) == Some(1)) {
                self.b.flag(Q_LIMIT_ONE);
            }
        }
        match s.limit_offset.as_ref().and_then(|o| o.node.as_ref()) {
            Some(N::AConst(_)) => self.b.flag(Q_OFFSET_LITERAL),
            Some(_) => self.b.flag(Q_OFFSET_PARAM),
            None => {}
        }
    }

    // ---- SELECT -----------------------------------------------------------------------

    fn select(&mut self, s: &pb::SelectStmt, parent: Option<Scoped>) {
        if let Some(w) = &s.with_clause {
            self.with(w);
        }
        let first = self.one_select(s, parent);
        for side in [&s.larg, &s.rarg].into_iter().flatten() {
            self.select(side, parent);
        }
        for t in &s.sort_clause {
            if let Some(N::SortBy(sb)) = t.node.as_ref() {
                if let Some(e) = &sb.node {
                    self.term(e, first, R_ORDER);
                }
            }
        }
    }

    fn with(&mut self, w: &pb::WithClause) {
        for c in &w.ctes {
            if let Some(N::CommonTableExpr(c)) = c.node.as_ref() {
                let n = self.name(&c.ctename);
                self.b.cte(n);
            }
        }
        for c in &w.ctes {
            let Some(N::CommonTableExpr(c)) = c.node.as_ref() else { continue };
            if let Some(N::SelectStmt(q)) = kind_of(&c.ctequery) {
                self.select(q, None);
            }
        }
    }

    fn one_select(&mut self, s: &pb::SelectStmt, parent: Option<Scoped>) -> Scoped {
        let sc = self.b.new_scope(parent);
        for f in &s.from_clause {
            self.from_item(f, sc);
        }
        for t in &s.target_list {
            self.result_col(t, sc);
        }
        if let Some(w) = &s.where_clause {
            self.pred(w, sc, false);
        }
        for g in &s.group_clause {
            self.term(g, sc, R_GROUP);
        }
        if let Some(h) = &s.having_clause {
            self.pred(h, sc, false);
        }
        for row in &s.values_lists {
            self.expr(row, sc, None);
        }
        sc
    }

    fn result_col(&mut self, t: &pb::Node, sc: Scoped) {
        let Some(N::ResTarget(r)) = t.node.as_ref() else { return };
        let Some(v) = &r.val else { return };
        if let Some(N::ColumnRef(c)) = v.node.as_ref() {
            if matches!(c.fields.last().and_then(|f| f.node.as_ref()), Some(N::AStar(_))) {
                self.b.flag(if c.fields.len() > 1 { Q_TABLE_STAR } else { Q_STAR });
                return;
            }
        }
        self.expr(v, sc, Some(R_PROJ));
    }

    fn from_item(&mut self, f: &pb::Node, sc: Scoped) {
        match f.node.as_ref() {
            Some(N::RangeVar(rv)) => {
                let t = self.name(&rv.relname);
                let alias = rv.alias.as_ref().map_or(t, |a| nm(self.b, &a.aliasname));
                if self.b.is_cte(t) {
                    self.b.scope_entry(sc, alias, DERIVED);
                } else {
                    self.b.scope_entry(sc, alias, t);
                    self.b.table_ref(t, M_READ);
                }
            }
            Some(N::JoinExpr(j)) => self.join(j, sc),
            Some(N::RangeSubselect(r)) => {
                let alias = r.alias.as_ref().map_or(NONE, |a| nm(self.b, &a.aliasname));
                self.b.scope_entry(sc, alias, DERIVED);
                if let Some(N::SelectStmt(q)) = kind_of(&r.subquery) {
                    self.select(q, None);
                }
            }
            Some(N::RangeFunction(r)) => {
                let alias = r.alias.as_ref().map_or(NONE, |a| nm(self.b, &a.aliasname));
                self.b.scope_entry(sc, alias, DERIVED);
            }
            _ => {}
        }
    }

    fn join(&mut self, j: &pb::JoinExpr, sc: Scoped) {
        for side in [&j.larg, &j.rarg].into_iter().flatten() {
            self.from_item(side, sc);
        }
        if let Some(q) = &j.quals {
            self.pred(q, sc, true);
        }
        for u in &j.using_clause {
            if let Some(n) = sval(u) {
                let c = self.name(n);
                self.b.col_use(sc, None, c, R_JOIN);
            }
        }
    }

    // ---- expressions ------------------------------------------------------------------

    /// `(qualifier, column)` for a bare column reference.
    fn simple_col(&mut self, e: &pb::Node) -> Option<(Option<u32>, u32)> {
        let Some(N::ColumnRef(c)) = e.node.as_ref() else { return None };
        let names: Vec<&str> = c.fields.iter().filter_map(sval).collect();
        let col = names.last()?;
        let q = names.len().checked_sub(2).map(|i| names[i]);
        Some((q.map(|q| nm(self.b, q)), nm(self.b, col)))
    }

    fn first_col(&mut self, e: &pb::Node) -> Option<(Option<u32>, u32)> {
        if let Some(c) = self.simple_col(e) {
            return Some(c);
        }
        for k in child_nodes(e) {
            if let Some(c) = self.first_col(k) {
                return Some(c);
            }
        }
        None
    }

    fn expr(&mut self, e: &pb::Node, sc: Scoped, role: Option<u8>) {
        if let Some((q, c)) = self.simple_col(e) {
            if let Some(r) = role {
                self.b.col_use(sc, q, c, r);
            }
            return;
        }
        if let Some(N::SubLink(s)) = e.node.as_ref() {
            self.sublink(s, sc, role);
            return;
        }
        for k in child_nodes(e) {
            self.expr(k, sc, role);
        }
    }

    fn sublink(&mut self, s: &pb::SubLink, sc: Scoped, role: Option<u8>) {
        if let Some(t) = &s.testexpr {
            self.expr(t, sc, role);
        }
        if let Some(N::SelectStmt(q)) = kind_of(&s.subselect) {
            self.select(q, Some(sc));
        }
    }

    fn term(&mut self, e: &pb::Node, sc: Scoped, role: u8) {
        let role = self.simple_col(e).map(|_| role);
        self.expr(e, sc, role);
    }

    // ---- predicates -------------------------------------------------------------------

    fn pred(&mut self, e: &pb::Node, sc: Scoped, on: bool) {
        match e.node.as_ref() {
            Some(N::BoolExpr(b)) => self.bool_expr(b, sc, on),
            Some(N::AExpr(a)) => self.a_expr(a, sc),
            Some(N::NullTest(t)) => {
                if let Some(x) = &t.arg {
                    self.side(x, R_NULL, sc);
                }
            }
            Some(N::SubLink(s)) => self.sublink_pred(s, sc),
            _ => self.expr(e, sc, None),
        }
    }

    fn bool_expr(&mut self, b: &pb::BoolExpr, sc: Scoped, on: bool) {
        match b.boolop() {
            pb::BoolExprType::OrExpr => self.or(&b.args, sc, on),
            _ => {
                for a in &b.args {
                    self.pred(a, sc, on);
                }
            }
        }
    }

    fn sublink_pred(&mut self, s: &pb::SubLink, sc: Scoped) {
        if let Some(t) = &s.testexpr {
            self.side(t, R_IN, sc);
        }
        if let Some(N::SelectStmt(q)) = kind_of(&s.subselect) {
            self.select(q, Some(sc));
        }
    }

    fn a_expr(&mut self, a: &pb::AExpr, sc: Scoped) {
        let (Some(l), r) = (&a.lexpr, &a.rexpr) else { return };
        let op = a.name.iter().filter_map(sval).last().unwrap_or("");
        match a.kind() {
            pb::AExprKind::AexprIn => {
                self.side(l, R_IN, sc);
                if let Some(r) = r {
                    self.expr(r, sc, None);
                }
            }
            pb::AExprKind::AexprBetween | pb::AExprKind::AexprNotBetween => {
                self.side(l, R_RANGE, sc);
                if let Some(r) = r {
                    self.expr(r, sc, None);
                }
            }
            pb::AExprKind::AexprLike | pb::AExprKind::AexprIlike => {
                self.side(l, R_LIKE, sc);
                if let Some(r) = r {
                    self.leading_wildcard(l, r, sc);
                }
            }
            _ => self.compare(l, op, r.as_deref(), sc),
        }
    }

    fn side(&mut self, e: &pb::Node, role: u8, sc: Scoped) {
        if let Some((q, c)) = self.simple_col(e) {
            self.b.col_use(sc, q, c, role);
            return;
        }
        if let Some((q, c)) = self.first_col(e) {
            self.b.defeat(sc, q, c, D_WRAPPED);
        }
        self.expr(e, sc, None);
    }

    fn compare(&mut self, l: &pb::Node, op: &str, r: Option<&pb::Node>, sc: Scoped) {
        let role = match op {
            "=" => R_EQ,
            "<" | ">" | "<=" | ">=" => R_RANGE,
            _ => {
                self.expr(l, sc, None);
                if let Some(r) = r {
                    self.expr(r, sc, None);
                }
                return;
            }
        };
        let both = self.simple_col(l).is_some() && r.is_some_and(|r| self.simple_col(r).is_some());
        let role = if both && role == R_EQ && self.b.scope_len(sc) > 1 { R_JOIN } else { role };
        self.side(l, role, sc);
        if let Some(r) = r {
            self.side(r, role, sc);
        }
    }

    fn leading_wildcard(&mut self, lhs: &pb::Node, rhs: &pb::Node, sc: Scoped) {
        let Some(N::AConst(c)) = rhs.node.as_ref() else { return };
        let Some(text) = const_str(c) else { return };
        if !text.starts_with(['%', '_']) {
            return;
        }
        if let Some((q, col)) = self.simple_col(lhs) {
            self.b.defeat(sc, q, col, D_LEADING_WILDCARD);
        }
    }

    fn or(&mut self, args: &[pb::Node], sc: Scoped, on: bool) {
        let from = self.b.use_count();
        for a in args {
            self.pred(a, sc, on);
        }
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

fn const_int(a: &pb::AConst) -> Option<i32> {
    match a.val.as_ref()? {
        pb::a_const::Val::Ival(i) => Some(i.ival),
        _ => None,
    }
}

fn const_str(a: &pb::AConst) -> Option<&str> {
    match a.val.as_ref()? {
        pb::a_const::Val::Sval(s) => Some(s.sval.as_str()),
        _ => None,
    }
}

fn boxed(n: &Option<Box<pb::Node>>) -> Option<&pb::Node> {
    n.as_deref()
}

/// The direct sub-expressions of `e` a column can hide in; subqueries are handled by callers.
fn child_nodes(e: &pb::Node) -> Vec<&pb::Node> {
    let mut v: Vec<&pb::Node> = Vec::new();
    match e.node.as_ref() {
        Some(N::AExpr(a)) => v.extend([boxed(&a.lexpr), boxed(&a.rexpr)].into_iter().flatten()),
        Some(N::BoolExpr(b)) => v.extend(b.args.iter()),
        Some(N::FuncCall(f)) => v.extend(f.args.iter()),
        Some(N::TypeCast(t)) => v.extend(boxed(&t.arg)),
        Some(N::NullTest(t)) => v.extend(boxed(&t.arg)),
        Some(N::CoalesceExpr(c)) => v.extend(c.args.iter()),
        Some(N::List(l)) => v.extend(l.items.iter()),
        Some(N::CaseExpr(c)) => {
            v.extend(boxed(&c.arg));
            v.extend(c.args.iter());
            v.extend(boxed(&c.defresult));
        }
        Some(N::CaseWhen(w)) => v.extend([boxed(&w.expr), boxed(&w.result)].into_iter().flatten()),
        _ => {}
    }
    v
}

