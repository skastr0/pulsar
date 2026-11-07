//! The dialect-neutral SQL model: a schema that DDL is replayed into, and the query sites that
//! DML statements produce. A dialect front-end (`sqlite.rs`) walks its own syntax tree and calls
//! the methods here; nothing in this file knows a parser crate. Names are interned during the
//! walk and renumbered in sorted order at the end, so ids are stable for a given set of texts.

use std::collections::{BTreeMap, HashMap};

/// "No such id": an expression term in an index, an ambiguous table, a function id for a `.sql`.
pub const NONE: u32 = u32::MAX;
/// A scope entry whose columns the lane cannot know: a subquery or a CTE.
pub const DERIVED: u32 = u32::MAX - 1;

/// `DT` flags.
pub const T_WITHOUT_ROWID: u32 = 1;
pub const T_STRICT: u32 = 2;
pub const T_VIRTUAL: u32 = 4;
pub const T_VIEW: u32 = 8;
/// `DC` flags.
pub const C_PK: u32 = 1;
pub const C_NOT_NULL: u32 = 2;
pub const C_UNIQUE: u32 = 4;
pub const C_GENERATED: u32 = 8;
pub const C_DEFAULT: u32 = 16;
pub const C_ROWID: u32 = 32;
/// `DI` flags.
pub const I_UNIQUE: u32 = 1;
pub const I_PARTIAL: u32 = 2;
pub const I_EXPR: u32 = 4;
pub const I_IMPLIED: u32 = 8;
/// `QS` flags.
pub const Q_LIMIT: u32 = 1;
pub const Q_LIMIT_ONE: u32 = 2;
pub const Q_OFFSET_LITERAL: u32 = 4;
pub const Q_OFFSET_PARAM: u32 = 8;
pub const Q_STAR: u32 = 16;
pub const Q_TABLE_STAR: u32 = 32;
pub const Q_DYNAMIC: u32 = 64;
pub const Q_FAILED: u32 = 128;
/// `QS` kinds.
pub const K_SELECT: u32 = 1;
pub const K_INSERT: u32 = 2;
pub const K_UPDATE: u32 = 3;
pub const K_DELETE: u32 = 4;
pub const K_OTHER: u32 = 5;
/// `QT` modes.
pub const M_READ: u8 = 1;
pub const M_INSERT: u8 = 2;
pub const M_UPDATE: u8 = 3;
pub const M_DELETE: u8 = 4;
/// `QU` roles.
pub const R_EQ: u8 = 1;
pub const R_RANGE: u8 = 2;
pub const R_IN: u8 = 3;
pub const R_LIKE: u8 = 4;
pub const R_NULL: u8 = 5;
pub const R_ORDER: u8 = 6;
pub const R_JOIN: u8 = 7;
pub const R_PROJ: u8 = 8;
pub const R_GROUP: u8 = 9;
pub const R_SET: u8 = 10;
pub const R_INSERT_COL: u8 = 11;
/// `QD` kinds.
pub const D_LEADING_WILDCARD: u8 = 1;
pub const D_WRAPPED: u8 = 2;
pub const D_OR: u8 = 3;

#[derive(Default)]
pub struct Names {
    map: HashMap<String, u32>,
    list: Vec<String>,
}

impl Names {
    /// Intern a normalised (unquoted, lower-case) name.
    pub fn intern(&mut self, s: &str) -> u32 {
        if let Some(&i) = self.map.get(s) {
            return i;
        }
        let i = self.list.len() as u32;
        self.map.insert(s.to_string(), i);
        self.list.push(s.to_string());
        i
    }
}

/// A column as a front-end describes it.
#[derive(Default, Clone)]
pub struct ColSpec {
    pub name: u32,
    /// The declared type is `INTEGER`: with a single-column primary key it makes a rowid alias.
    pub integer: bool,
    pub pk: bool,
    pub not_null: bool,
    pub unique: bool,
    pub generated: bool,
    pub default: bool,
    /// Inline `REFERENCES t(c)`: `(ref table, ref column or NONE)`.
    pub fk: Option<(u32, u32)>,
}

/// A table as a front-end describes it.
#[derive(Default)]
pub struct TableSpec {
    pub flags: u32,
    pub cols: Vec<ColSpec>,
    /// Table-level `PRIMARY KEY (..)`; `NONE` for an expression term.
    pub pk: Vec<u32>,
    /// Table-level `UNIQUE (..)` constraints.
    pub uniques: Vec<Vec<u32>>,
    /// Table-level `FOREIGN KEY (..) REFERENCES t(..)`: `(columns, ref table, ref columns)`.
    pub fks: Vec<(Vec<u32>, u32, Vec<u32>)>,
}

struct Col {
    name: u32,
    flags: u32,
}

struct Table {
    file: u32,
    flags: u32,
    cols: Vec<Col>,
    pk: Vec<u32>,
}

struct Index {
    name: Option<u32>,
    table: u32,
    flags: u32,
    cols: Vec<u32>,
}

struct Fk {
    table: u32,
    ref_table: u32,
    pairs: Vec<(u32, u32)>,
}

#[derive(Default)]
struct Scope {
    parent: Option<usize>,
    /// `(alias or table name, table)`; `table` is `DERIVED` for a subquery or CTE.
    entries: Vec<(u32, u32)>,
}

struct RawUse {
    scope: usize,
    qual: Option<u32>,
    col: u32,
    role: u8,
}

struct RawDefeat {
    scope: usize,
    qual: Option<u32>,
    col: u32,
    kind: u8,
}

#[derive(Default)]
struct Site {
    file: u32,
    fn_id: u32,
    node: u32,
    line: u32,
    kind: u32,
    flags: u32,
    tables: Vec<(u32, u8)>,
    scopes: Vec<Scope>,
    uses: Vec<RawUse>,
    defeats: Vec<RawDefeat>,
    ctes: Vec<u32>,
}

#[derive(Default)]
pub struct Builder {
    pub names: Names,
    tables: BTreeMap<u32, Table>,
    indexes: Vec<Option<Index>>,
    fks: Vec<Option<Fk>>,
    pub ddl_ok: u32,
    pub ddl_skipped: u32,
    sites: Vec<Site>,
    cur: Option<Site>,
}

// ---- schema -----------------------------------------------------------------------------

impl Builder {
    pub fn create_table(&mut self, file: u32, name: u32, spec: TableSpec, if_not_exists: bool) {
        if if_not_exists && self.tables.contains_key(&name) {
            return;
        }
        self.drop_table(name);
        let (cols, pk, rowid_alias) = table_columns(&spec);
        if !pk.is_empty() && !rowid_alias {
            self.indexes.push(Some(Index { name: None, table: name, flags: I_UNIQUE | I_IMPLIED, cols: pk.clone() }));
        }
        self.implied_indexes(name, &spec);
        self.fk_rows(name, &spec);
        self.tables.insert(name, Table { file, flags: spec.flags, cols, pk });
    }

    /// The indexes `UNIQUE` column and table constraints imply.
    fn implied_indexes(&mut self, table: u32, spec: &TableSpec) {
        for c in spec.cols.iter().filter(|c| c.unique) {
            self.indexes.push(Some(Index { name: None, table, flags: I_UNIQUE | I_IMPLIED, cols: vec![c.name] }));
        }
        for u in &spec.uniques {
            let flags = I_UNIQUE | I_IMPLIED | if u.contains(&NONE) { I_EXPR } else { 0 };
            self.indexes.push(Some(Index { name: None, table, flags, cols: u.clone() }));
        }
    }

    /// Foreign keys, inline on a column and as table constraints.
    fn fk_rows(&mut self, table: u32, spec: &TableSpec) {
        for c in &spec.cols {
            if let Some((rt, rc)) = c.fk {
                self.fks.push(Some(Fk { table, ref_table: rt, pairs: vec![(c.name, rc)] }));
            }
        }
        for (cs, rt, rcs) in &spec.fks {
            let pairs = cs.iter().enumerate().map(|(i, c)| (*c, rcs.get(i).copied().unwrap_or(NONE))).collect();
            self.fks.push(Some(Fk { table, ref_table: *rt, pairs }));
        }
    }

    /// A table whose columns the lane does not model: a view or a virtual table.
    pub fn create_opaque_table(&mut self, file: u32, name: u32, flags: u32) {
        self.drop_table(name);
        self.tables.insert(name, Table { file, flags, cols: Vec::new(), pk: Vec::new() });
    }

    pub fn drop_table(&mut self, name: u32) {
        self.tables.remove(&name);
        for i in &mut self.indexes {
            if i.as_ref().is_some_and(|x| x.table == name) {
                *i = None;
            }
        }
        for f in &mut self.fks {
            if f.as_ref().is_some_and(|x| x.table == name) {
                *f = None;
            }
        }
    }

    pub fn add_column(&mut self, table: u32, c: ColSpec) {
        let Some(t) = self.tables.get_mut(&table) else { return };
        t.cols.push(Col { name: c.name, flags: col_flags(&c) });
        if c.unique {
            self.indexes.push(Some(Index { name: None, table, flags: I_UNIQUE | I_IMPLIED, cols: vec![c.name] }));
        }
        if let Some((rt, rc)) = c.fk {
            self.fks.push(Some(Fk { table, ref_table: rt, pairs: vec![(c.name, rc)] }));
        }
    }

    pub fn rename_table(&mut self, from: u32, to: u32) {
        if let Some(t) = self.tables.remove(&from) {
            self.tables.insert(to, t);
        }
        for i in self.indexes.iter_mut().flatten().filter(|i| i.table == from) {
            i.table = to;
        }
        for f in self.fks.iter_mut().flatten() {
            if f.table == from {
                f.table = to;
            }
            if f.ref_table == from {
                f.ref_table = to;
            }
        }
    }

    pub fn rename_column(&mut self, table: u32, from: u32, to: u32) {
        let swap = |c: &mut u32| {
            if *c == from {
                *c = to;
            }
        };
        if let Some(t) = self.tables.get_mut(&table) {
            t.cols.iter_mut().for_each(|c| swap(&mut c.name));
            t.pk.iter_mut().for_each(swap);
        }
        for i in self.indexes.iter_mut().flatten().filter(|i| i.table == table) {
            i.cols.iter_mut().for_each(swap);
        }
        for f in self.fks.iter_mut().flatten().filter(|f| f.table == table) {
            f.pairs.iter_mut().for_each(|p| swap(&mut p.0));
        }
    }

    pub fn drop_column(&mut self, table: u32, col: u32) {
        if let Some(t) = self.tables.get_mut(&table) {
            t.cols.retain(|c| c.name != col);
            t.pk.retain(|c| *c != col);
        }
    }

    pub fn create_index(&mut self, name: u32, table: u32, flags: u32, cols: Vec<u32>) {
        self.drop_index(name);
        self.indexes.push(Some(Index { name: Some(name), table, flags, cols }));
    }

    pub fn drop_index(&mut self, name: u32) {
        for i in &mut self.indexes {
            if i.as_ref().is_some_and(|x| x.name == Some(name)) {
                *i = None;
            }
        }
    }

    /// A table constraint added by `ALTER TABLE .. ADD CONSTRAINT`.
    pub fn add_unique(&mut self, table: u32, cols: Vec<u32>) {
        let flags = I_UNIQUE | I_IMPLIED | if cols.contains(&NONE) { I_EXPR } else { 0 };
        self.indexes.push(Some(Index { name: None, table, flags, cols }));
    }

    pub fn add_fk(&mut self, table: u32, cols: Vec<u32>, ref_table: u32, ref_cols: Vec<u32>) {
        let pairs = cols.iter().enumerate().map(|(i, c)| (*c, ref_cols.get(i).copied().unwrap_or(NONE))).collect();
        self.fks.push(Some(Fk { table, ref_table, pairs }));
    }
}

/// Columns with their flags, the primary key (a table-level one wins), and whether the key is a
/// rowid alias (a single `INTEGER` column of a rowid table).
fn table_columns(spec: &TableSpec) -> (Vec<Col>, Vec<u32>, bool) {
    let mut cols: Vec<Col> = spec.cols.iter().map(|c| Col { name: c.name, flags: col_flags(c) }).collect();
    let mut pk: Vec<u32> = spec.cols.iter().filter(|c| c.pk).map(|c| c.name).collect();
    if !spec.pk.is_empty() {
        pk = spec.pk.clone();
    }
    for c in cols.iter_mut().filter(|c| pk.contains(&c.name)) {
        c.flags |= C_PK;
    }
    let rowid_alias =
        spec.flags & T_WITHOUT_ROWID == 0 && pk.len() == 1 && spec.cols.iter().any(|c| c.name == pk[0] && c.integer);
    if rowid_alias {
        cols.iter_mut().filter(|c| c.name == pk[0]).for_each(|c| c.flags |= C_ROWID);
    }
    (cols, pk, rowid_alias)
}

fn col_flags(c: &ColSpec) -> u32 {
    let mut f = 0;
    for (on, bit) in [
        (c.pk, C_PK),
        (c.not_null, C_NOT_NULL),
        (c.unique, C_UNIQUE),
        (c.generated, C_GENERATED),
        (c.default, C_DEFAULT),
    ] {
        if on {
            f |= bit;
        }
    }
    f
}

// ---- sites ------------------------------------------------------------------------------

impl Builder {
    pub fn begin_site(&mut self, file: u32, fn_id: u32, node: u32, line: u32, kind: u32) {
        self.cur = Some(Site { file, fn_id, node, line, kind, ..Site::default() });
    }

    pub fn end_site(&mut self) {
        if let Some(s) = self.cur.take() {
            self.sites.push(s);
        }
    }

    /// A text that never became a statement: dynamic, or it did not parse.
    pub fn bare_site(&mut self, file: u32, fn_id: u32, node: u32, line: u32, flags: u32) {
        self.sites.push(Site { file, fn_id, node, line, kind: K_OTHER, flags, ..Site::default() });
    }

    pub fn flag(&mut self, bit: u32) {
        if let Some(s) = &mut self.cur {
            s.flags |= bit;
        }
    }

    pub fn table_ref(&mut self, table: u32, mode: u8) {
        if let Some(s) = &mut self.cur {
            if !s.tables.contains(&(table, mode)) {
                s.tables.push((table, mode));
            }
        }
    }

    pub fn cte(&mut self, name: u32) {
        if let Some(s) = &mut self.cur {
            s.ctes.push(name);
        }
    }

    pub fn is_cte(&self, name: u32) -> bool {
        self.cur.as_ref().is_some_and(|s| s.ctes.contains(&name))
    }

    pub fn new_scope(&mut self, parent: Option<usize>) -> usize {
        let s = self.cur.as_mut().expect("scope outside a site");
        s.scopes.push(Scope { parent, entries: Vec::new() });
        s.scopes.len() - 1
    }

    pub fn scope_entry(&mut self, scope: usize, alias: u32, table: u32) {
        if let Some(s) = &mut self.cur {
            s.scopes[scope].entries.push((alias, table));
        }
    }

    pub fn scope_len(&self, scope: usize) -> usize {
        self.cur.as_ref().map_or(0, |s| s.scopes[scope].entries.len())
    }

    pub fn col_use(&mut self, scope: usize, qual: Option<u32>, col: u32, role: u8) {
        if let Some(s) = &mut self.cur {
            s.uses.push(RawUse { scope, qual, col, role });
        }
    }

    pub fn use_count(&self) -> usize {
        self.cur.as_ref().map_or(0, |s| s.uses.len())
    }

    /// `(qualifier, column)` of the uses recorded since `from` that are predicate roles.
    pub fn predicate_cols_since(&self, from: usize) -> Vec<(usize, Option<u32>, u32)> {
        let Some(s) = &self.cur else { return Vec::new() };
        s.uses[from..]
            .iter()
            .filter(|u| (R_EQ..=R_NULL).contains(&u.role))
            .map(|u| (u.scope, u.qual, u.col))
            .collect()
    }

    pub fn defeat(&mut self, scope: usize, qual: Option<u32>, col: u32, kind: u8) {
        if let Some(s) = &mut self.cur {
            s.defeats.push(RawDefeat { scope, qual, col, kind });
        }
    }
}

// ---- output -----------------------------------------------------------------------------

#[derive(Default, Debug)]
pub struct Out {
    /// Name id -> name, sorted.
    pub names: Vec<String>,
    /// Index id -> declared name, `None` when anonymous.
    pub index_names: Vec<Option<String>>,
    pub ds: [u32; 2],
    pub dt: Vec<[u32; 3]>,
    pub dc: Vec<[u32; 4]>,
    pub dp: Vec<[u32; 3]>,
    pub di: Vec<[u32; 3]>,
    pub dx: Vec<[u32; 3]>,
    pub df: Vec<[u32; 3]>,
    pub dg: Vec<[u32; 4]>,
    pub qs: Vec<[u32; 6]>,
    pub qt: Vec<[u32; 3]>,
    pub qu: Vec<[u32; 4]>,
    pub qd: Vec<[u32; 4]>,
    /// Site id -> `(file, line)`.
    pub site_pos: Vec<(u32, u32)>,
}

impl Builder {
    fn resolve(&self, site: &Site, scope: usize, qual: Option<u32>, col: u32) -> u32 {
        let mut at = Some(scope);
        while let Some(si) = at {
            let sc = &site.scopes[si];
            if let Some(t) = self.resolve_in(sc, qual, col) {
                return t;
            }
            at = sc.parent;
        }
        NONE
    }

    /// `Some(table or NONE)` when this scope decides, `None` to try the parent.
    fn resolve_in(&self, sc: &Scope, qual: Option<u32>, col: u32) -> Option<u32> {
        if let Some(q) = qual {
            let e = sc.entries.iter().find(|e| e.0 == q)?;
            return Some(if e.1 == DERIVED { NONE } else { e.1 });
        }
        let real: Vec<u32> = sc.entries.iter().filter(|e| e.1 != DERIVED).map(|e| e.1).collect();
        if real.len() == 1 && real.len() == sc.entries.len() {
            return Some(real[0]);
        }
        let has = |t: &u32| self.tables.get(t).is_some_and(|tb| tb.cols.iter().any(|c| c.name == col));
        let owners: Vec<u32> = real.into_iter().filter(has).collect();
        match owners.len() {
            1 => Some(owners[0]),
            0 if sc.entries.is_empty() => None,
            _ => Some(NONE),
        }
    }

    /// Resolve, renumber and emit.
    pub fn finish(self) -> Out {
        // Sorted names: raw id -> final id.
        let mut order: Vec<u32> = (0..self.names.list.len() as u32).collect();
        order.sort_by(|a, b| self.names.list[*a as usize].cmp(&self.names.list[*b as usize]));
        let mut remap = vec![0u32; order.len()];
        for (rank, raw) in order.iter().enumerate() {
            remap[*raw as usize] = rank as u32;
        }
        let id = |raw: u32| if raw >= DERIVED { raw } else { remap[raw as usize] };
        let mut out = Out {
            names: order.iter().map(|r| self.names.list[*r as usize].clone()).collect(),
            ds: [self.ddl_ok, self.ddl_skipped],
            ..Out::default()
        };
        self.emit_schema(&mut out, &id);
        self.emit_sites(&mut out, &id);
        out
    }

    fn emit_schema(&self, out: &mut Out, id: &dyn Fn(u32) -> u32) {
        for (name, t) in &self.tables {
            let tid = id(*name);
            out.dt.push([tid, t.file, t.flags]);
            for (pos, c) in t.cols.iter().enumerate() {
                out.dc.push([tid, id(c.name), pos as u32, c.flags]);
            }
            for (pos, c) in t.pk.iter().enumerate() {
                out.dp.push([tid, pos as u32, id(*c)]);
            }
        }
        self.emit_indexes(out, id);
        self.emit_fks(out, id);
    }

    /// Index ids follow (table id, creation order).
    fn emit_indexes(&self, out: &mut Out, id: &dyn Fn(u32) -> u32) {
        let mut idx: Vec<&Index> = self.indexes.iter().flatten().collect();
        idx.sort_by_key(|i| id(i.table));
        for (n, i) in idx.iter().enumerate() {
            out.di.push([n as u32, id(i.table), i.flags]);
            out.index_names.push(i.name.map(|r| self.names.list[r as usize].clone()));
            for (pos, c) in i.cols.iter().enumerate() {
                out.dx.push([n as u32, pos as u32, if *c == NONE { NONE } else { id(*c) }]);
            }
        }
    }

    fn emit_fks(&self, out: &mut Out, id: &dyn Fn(u32) -> u32) {
        let mut fks: Vec<&Fk> = self.fks.iter().flatten().collect();
        fks.sort_by_key(|f| id(f.table));
        for (n, f) in fks.iter().enumerate() {
            out.df.push([n as u32, id(f.table), id(f.ref_table)]);
            for (pos, (c, rc)) in f.pairs.iter().enumerate() {
                out.dg.push([n as u32, pos as u32, id(*c), if *rc == NONE { NONE } else { id(*rc) }]);
            }
        }
    }

    fn emit_sites(&self, out: &mut Out, id: &dyn Fn(u32) -> u32) {
        for (n, s) in self.sites.iter().enumerate() {
            let site = n as u32;
            out.qs.push([site, s.file, s.fn_id, s.node, s.kind, s.flags]);
            out.site_pos.push((s.file, s.line));
            for (t, m) in &s.tables {
                out.qt.push([site, id(*t), *m as u32]);
            }
            for u in &s.uses {
                let t = self.resolve(s, u.scope, u.qual, u.col);
                out.qu.push([site, if t == NONE { NONE } else { id(t) }, id(u.col), u.role as u32]);
            }
            for d in &s.defeats {
                let t = self.resolve(s, d.scope, d.qual, d.col);
                out.qd.push([site, if t == NONE { NONE } else { id(t) }, id(d.col), d.kind as u32]);
            }
        }
    }
}
