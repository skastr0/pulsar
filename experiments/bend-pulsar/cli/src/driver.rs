//! The driver: one file-id space for every lane, global function numbering, one writer.
//!
//! It lists the tree's files once (every file some lane owns, byte-sorted, ids `0..n-1`), pushes
//! `N`, `F` and `K`, hands each lane its `(id, path)` list, and writes what the lanes return:
//! `I` and `U` rows over global ids, and per-file function rows that it numbers in file-id order
//! (`M`, `FN`, `FK`, `CT`, `TF`) together with the `.fns` side table. Lanes never format a fact
//! line and never see another lane's files.

use crate::facts::{stable_key, FactWriter, FnEntry, Rel, SideTables};
use crate::git::git_ls_files;
use crate::lang::functions::{ctx, FileFns, NO_PARENT};
use crate::policy::{ActiveRule, Lanes};
use crate::lang::{self, Degraded, FileOut};
use std::path::{Path, PathBuf};

pub struct FactSet {
    pub files: Vec<String>,
    /// Number of production files (`F ... 1`).
    pub prod: usize,
    /// `FK` key of each function, indexed by `FN` id (the `.fns` order).
    pub fn_keys: Vec<u64>,
}

#[derive(Default)]
pub struct Stats {
    pub files: usize,
    pub prod: usize,
    pub fatal: usize,
    pub unreadable: usize,
    pub i_facts: usize,
    pub u_facts: usize,
    pub fns: usize,
    pub ct: usize,
    pub ts_files: usize,
    pub rust_files: usize,
    pub sql: crate::sql::Stats,
    pub infra: crate::infra::Stats,
    pub bend_files: usize,
    pub laws: usize,
    pub markers: usize,
    pub sites: usize,
    /// Lanes that ran on weaker input than they wanted; also noted in the facts header.
    pub degraded: Vec<Degraded>,
}

/// Run the lanes on the git checkout at `repo`.
pub fn build_repo(
    repo: &Path,
    lanes: &Lanes,
    rules: &[ActiveRule],
    w: &mut FactWriter,
    tables: &mut SideTables,
) -> Result<(FactSet, Stats), String> {
    let root: PathBuf = std::fs::canonicalize(repo).map_err(|e| format!("{}: {e}", repo.display()))?;
    let tracked = git_ls_files(&root)?;
    build(&root, tracked, lanes, rules, w, tables)
}

/// Run the lanes on the tree at `root`; `tracked` is its file list, repo-relative (for a tree that
/// is not a git checkout, for example one materialised from a sha). `lanes` is the policy's
/// per-lane scope: a file outside it is in no lane and gets no id.
pub fn build(
    root: &Path,
    tracked: Vec<String>,
    lanes: &Lanes,
    rules: &[ActiveRule],
    w: &mut FactWriter,
    tables: &mut SideTables,
) -> Result<(FactSet, Stats), String> {
    let files = list_files(root, &tracked, lanes);
    let ts_files = lane_files(&files, lang::ts::owns);
    let rust_files = lane_files(&files, lang::rust::owns);
    let bend_files = lane_files(&files, lang::bend::owns);
    let sql_files = lane_files(&files, crate::sql::owns);

    let mut st = Stats { files: files.len(), ts_files: ts_files.len(), rust_files: rust_files.len(), bend_files: bend_files.len(), ..Stats::default() };

    // Lanes run one after another: each already uses every core, and one lane's ASTs are gone
    // before the next lane parses.
    let mut per: Vec<Option<FileOut>> = (0..files.len()).map(|_| None).collect();
    let (sym_classes, effect, sql_texts, edges) =
        analyze_ts(root, lanes, &tracked, &ts_files, &mut per, w, &mut st)?;
    // What a lane's analysis decided about production code, per file id: None keeps the path rule.
    let mut lane_prod: Vec<Option<bool>> = vec![None; files.len()];
    analyze_rust(root, lanes, &tracked, &rust_files, &mut per, &mut lane_prod, w, &mut st)?;
    tables.laws = bend_lane(root, &bend_files, &files, &mut per, &mut lane_prod, w, &mut st)?;
    // F rows come after the lanes, because only a lane's analysis can tell some test files.
    push_files(w, &files, lanes, &lane_prod, &mut st);

    // Function ids are global: files in id order, functions in start-offset order within a file.
    // Each file's rows move into the writer and are freed before the next file.
    let total_fns: usize = per.iter().flatten().map(|f| f.fns.fns.len()).sum();
    let total_ct: usize = per.iter().flatten().map(|f| f.fns.ct.len()).sum();
    w.reserve(Rel::Fn, total_fns);
    w.reserve(Rel::Fk, total_fns);
    w.reserve(Rel::Ct, total_ct);
    w.push(Rel::M, &[total_fns as u32]);
    tables.fns.reserve(total_fns);
    push_sites(w, &per, &sym_classes, tables, &mut st);
    let fn_base = function_bases(&per);
    if let Some(rows) = &effect {
        push_effect(w, &per, rows);
        tables.effect = effect_table(rows, &files);
    }
    let fn_keys = push_functions(w, per, &|file| lanes.is_policy_test(&files[file]), tables, &mut st);
    push_rules(w, rules, tables);
    push_composites(w, &tables.composites);
    analyze_sql(root, &sql_files, sql_texts, &fn_base, w, tables, &mut st);
    // SQL rules are opt-in: one SR row per rule policy turned on, and none means no SQL section.
    for code in std::mem::take(&mut tables.sql_rules) {
        w.push(Rel::Sr, &[code]);
    }
    // Binding rules are on when a pack or policy says so: one BF row per rule, with its threshold.
    for (code, thr) in std::mem::take(&mut tables.binding_rules) {
        w.push(Rel::Bf, &[code, thr]);
    }
    // Infra declarations and the binding names their entry closures read. Inert unless the tree
    // has a config the lane reads, so it costs no rows in a repo without one.
    let infra = crate::infra::emit(root, &tracked, &files, &edges, w, tables);
    st.degraded
        .extend(infra.degraded.iter().map(|c| Degraded { lane: "infra", cause: c.clone() }));
    st.infra = infra;
    st.fns = total_fns;
    for d in &st.degraded {
        w.note(&format!("degraded {}: {}", d.lane, d.cause));
    }
    tables.paths = files.clone();
    let prod = st.prod;
    Ok((FactSet { files, prod, fn_keys }, st))
}

/// One id space: every existing file some lane owns and the policy allows, byte-sorted.
fn list_files(root: &Path, tracked: &[String], lanes: &Lanes) -> Vec<String> {
    let mut files: Vec<String> = tracked
        .iter()
        .filter(|p| {
            ((lang::ts::owns(p) && lanes.ts.allows(p))
                || (lang::rust::owns(p) && lanes.rust.allows(p))
                || (lang::bend::owns(p) && lanes.bend.allows(p))
                || (crate::sql::owns(p) && lanes.sql.allows(p)))
                && root.join(p).is_file()
        })
        .cloned()
        .collect();
    files.sort();
    files.dedup();
    files
}

/// `(global file id, path)` for the files one lane owns.
fn lane_files(files: &[String], owns: fn(&str) -> bool) -> Vec<(u32, String)> {
    files.iter().enumerate().filter(|(_, p)| owns(p)).map(|(i, p)| (i as u32, p.clone())).collect()
}

/// Global id of each file's first function, by file id (files without functions repeat the next
/// base): `fn_base[file] + fn_local` is a function's global id.
fn function_bases(per: &[Option<FileOut>]) -> Vec<u32> {
    let mut next = 0u32;
    per.iter()
        .map(|f| {
            let base = next;
            next += f.as_ref().map_or(0, |f| f.fns.fns.len() as u32);
            base
        })
        .collect()
}

/// The SQL lane: every `.sql` file as one text, plus the SQL of the TypeScript lane's query-class
/// calls. Runs after all other lanes (it needs global function ids); its rows are `DS`..`QD` and its
/// name, index and site tables go to the side tables. A bad statement costs only itself.
fn analyze_sql(
    root: &Path,
    files: &[(u32, String)],
    ts_texts: Vec<lang::ts::SqlText>,
    fn_base: &[u32],
    w: &mut FactWriter,
    tables: &mut SideTables,
    st: &mut Stats,
) {
    use crate::sql;
    let mut texts: Vec<sql::Text> = Vec::new();
    for (id, rel) in files {
        match std::fs::read_to_string(root.join(rel)) {
            Ok(content) => texts.push(sql::Text { file: *id, fn_id: sql::NONE, node: 0, line: 1, sql: Some(content) }),
            Err(_) => st.unreadable += 1,
        }
    }
    for t in ts_texts {
        let fn_id = t.fn_local.map_or(sql::NONE, |l| fn_base[t.file as usize] + l);
        let sql_text = (t.kind != lang::functions::SqlTextKind::Dynamic).then_some(t.text);
        texts.push(sql::Text { file: t.file, fn_id, node: t.ct_node, line: t.line, sql: sql_text });
    }
    if texts.is_empty() {
        return;
    }
    let (out, stats) = sql::analyze(texts, sql::Dialect::Sqlite);
    w.push(Rel::Ds, &out.ds);
    for r in &out.dt { w.push(Rel::Dt, r); }
    for r in &out.dc { w.push(Rel::Dc, r); }
    for r in &out.dp { w.push(Rel::Dp, r); }
    for r in &out.di { w.push(Rel::Di, r); }
    for r in &out.dx { w.push(Rel::Dx, r); }
    for r in &out.df { w.push(Rel::Df, r); }
    for r in &out.dg { w.push(Rel::Dg, r); }
    for r in &out.qs { w.push(Rel::Qs, r); }
    for r in &out.qt { w.push(Rel::Qt, r); }
    for r in &out.qu { w.push(Rel::Qu, r); }
    for r in &out.qd { w.push(Rel::Qd, r); }
    tables.sql_names = out.names;
    tables.sql_indexes = out.index_names;
    tables.sql_sites = out.site_pos;
    eprintln!(
        "pulsar: sql texts={} dynamic={} statements={} failed={} ddl_ok={} ddl_skipped={}",
        stats.texts, stats.dynamic, stats.statements, stats.failed, stats.ddl_ok, stats.ddl_skipped
    );
    st.sql = stats;
}

/// `RL rule class ctx_any ctx_none` for every active catalog rule, numbered by sorted id. A
/// classification alone never makes a finding: only these rows do (class-in-context detector).
fn push_rules(w: &mut FactWriter, rules: &[ActiveRule], tables: &mut SideTables) {
    for (id, r) in rules.iter().enumerate() {
        w.push(Rel::Rl, &[id as u32, r.class_id, r.ctx_any, r.ctx_none]);
    }
    tables.rules = rules.iter().map(|r| r.id.clone()).collect();
}

/// `RF`, `RK`, `RH` and `RG` for every fan-out, constant-argument and hot-path rule that is on. The rule
/// number is the rule's position in its sorted list (policy.rs `Effective::composites`), so the same
/// policy always writes the same rows.
fn push_composites(w: &mut FactWriter, c: &crate::policy::Composites) {
    for (n, r) in c.fanouts.iter().enumerate() {
        w.push(Rel::Rf, &[n as u32, r.class_id, r.edges, r.none]);
    }
    for (n, r) in c.konsts.iter().enumerate() {
        w.push(Rel::Rk, &[n as u32, r.class_id, r.pos]);
    }
    for (n, r) in c.hots.iter().enumerate() {
        w.push(Rel::Rh, &[n as u32, r.lane, r.base, r.depth]);
    }
    for (n, r) in c.growths.iter().enumerate() {
        w.push(Rel::Rg, &[n as u32, r.depth]);
    }
    // `RE` and `RM`: call-edge and module rules, numbered the same way.
    for (n, r) in c.edges.iter().enumerate() {
        let [all, none, ta, tn] = r.masks;
        w.push(Rel::Re, &[n as u32, all, none, ta, tn]);
    }
    for (n, r) in c.modules.iter().enumerate() {
        let [all, none, ba, bn] = r.masks;
        w.push(Rel::Rm, &[n as u32, all, none, ba, bn]);
    }
}

/// `N`, `F` and `K` for every file.
fn push_files(w: &mut FactWriter, files: &[String], lanes: &Lanes, lane_prod: &[Option<bool>], st: &mut Stats) {
    w.push(Rel::N, &[files.len() as u32]);
    for (id, rel) in files.iter().enumerate() {
        let prod = lanes.is_prod(rel, lane_prod[id]);
        st.prod += prod as usize;
        w.push(Rel::F, &[id as u32, prod as u32]);
        let k = stable_key(rel);
        w.push(Rel::K, &[id as u32, (k >> 32) as u32, (k & 0xffff_ffff) as u32]);
    }
}

/// Run the TypeScript lane; returns the catalog classes of each symbol it saw.
fn analyze_ts(
    root: &Path,
    lanes: &Lanes,
    tracked: &[String],
    files: &[(u32, String)],
    per: &mut [Option<FileOut>],
    w: &mut FactWriter,
    st: &mut Stats,
) -> Result<
    (
        std::collections::BTreeMap<String, Vec<u32>>,
        Option<crate::packs::effect::Rows>,
        Vec<lang::ts::SqlText>,
        Vec<[u32; 5]>,
    ),
    String,
> {
    if files.is_empty() {
        return Ok(Default::default());
    }
    // The per-file ctx bits from policy `[packs.effect]`: 8 effect-only, 16 boundary.
    // Also 4 test: a file policy `[lanes.ts] test` marks, as `TF` says (the lane's own path convention adds to it).
    let file_ctx = |rel: &str| lanes.effect.file_ctx(rel);
    let file_ctx = |rel: &str| file_ctx(rel) | if lanes.is_policy_test(rel) { ctx::TEST } else { 0 };
    let a = lang::ts::analyze(root, files, tracked, &file_ctx)?;
    st.fatal += a.stats.fatal;
    st.unreadable += a.stats.unreadable;
    push_edges(w, &a.i, &a.u, st);
    let edges = a.i;
    for ((id, _), f) in files.iter().zip(a.per_file) {
        per[*id as usize] = Some(f);
    }
    Ok((a.sym_classes, a.effect, a.sql_texts, edges))
}

/// The `.effect` side table: what each service and layer id names, for finding subjects.
fn effect_table(rows: &crate::packs::effect::Rows, files: &[String]) -> String {
    use std::fmt::Write;
    let mut s = String::new();
    let path = |f: u32| files.get(f as usize).map_or("-", String::as_str);
    for (tag, names) in [("S", &rows.svc_names), ("L", &rows.layer_names)] {
        for (id, n) in names.iter().enumerate() {
            let _ = writeln!(s, "{tag}\t{id}\t{}\t{}\t{}", path(n.file), n.line, n.name);
        }
    }
    s
}

/// The Effect pack's rows (FACTS.md, "Effect pack"), with functions numbered as `FN` numbers
/// them. Nothing is written when the pack found no service, layer or root.
fn push_effect(w: &mut FactWriter, per: &[Option<FileOut>], rows: &crate::packs::effect::Rows) {
    if rows.is_empty() {
        return;
    }
    let mut base = vec![0u32; per.len()];
    let mut next = 0u32;
    for (file, slot) in per.iter().enumerate() {
        base[file] = next;
        next += slot.as_ref().map_or(0, |f| f.fns.fns.len() as u32);
    }
    let fid = |(file, local): (u32, u32)| base[file as usize] + local;
    w.push(Rel::E, &[rows.nl, rows.ns, rows.nr]);
    rows.sv.iter().for_each(|r| w.push(Rel::Sv, r));
    rows.ly.iter().for_each(|r| w.push(Rel::Ly, r));
    rows.lq.iter().for_each(|r| w.push(Rel::Lq, r));
    rows.lp.iter().for_each(|r| w.push(Rel::Lp, r));
    rows.lr.iter().for_each(|r| w.push(Rel::Lr, r));
    for (root, file, f) in &rows.rt {
        w.push(Rel::Rt, &[*root, *file, f.map_or(NO_PARENT, fid)]);
    }
    for (l, f) in &rows.lc {
        w.push(Rel::Lc, &[*l, fid(*f)]);
    }
    rows.lo.iter().for_each(|l| w.push(Rel::Lo, &[*l]));
    for (f, s) in &rows.us {
        w.push(Rel::Us, &[fid(*f), *s]);
    }
}

/// Run the Rust lane; a manifest cargo cannot read degrades the graph and is reported.
fn analyze_rust(
    root: &Path,
    lanes: &Lanes,
    tracked: &[String],
    files: &[(u32, String)],
    per: &mut [Option<FileOut>],
    lane_prod: &mut [Option<bool>],
    w: &mut FactWriter,
    st: &mut Stats,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let a = lang::rust::analyze(root, files, tracked)?;
    for ((id, _), p) in files.iter().zip(&a.prod) {
        lane_prod[*id as usize] = *p;
    }
    st.fatal += a.stats.failed_parse;
    if a.stats.metadata_fallbacks > 0 {
        st.degraded.push(Degraded {
            lane: "rust",
            cause: format!(
                "cargo metadata failed for {} manifest(s) (missing toolchain or unresolvable workspace); the module graph uses the conventional layout, so use edges and cycles may be missing",
                a.stats.metadata_fallbacks
            ),
        });
    }
    push_edges(w, &a.i, &a.u, st);
    for ((id, rel), mut f) in files.iter().zip(a.per_file) {
        // A file the policy marks as test code has every call site in test code, as `TF` says.
        if lanes.is_policy_test(rel) {
            lang::rust::mark_test_sites(&mut f.fns);
        }
        per[*id as usize] = Some(FileOut { fns: f.fns, tests: f.tests });
    }
    Ok(())
}

/// Call sites and handlers: symbol ids are global and sorted by name, site ids run in
/// (file, source) order, so they need every file's rows before any is consumed.
fn push_sites(
    w: &mut FactWriter,
    per: &[Option<FileOut>],
    sym_classes: &std::collections::BTreeMap<String, Vec<u32>>,
    tables: &mut SideTables,
    st: &mut Stats,
) {
    let mut bases = Vec::new();
    let mut file_base = std::collections::HashMap::new();
    let mut next = 0u32;
    for (file, slot) in per.iter().enumerate() {
        let Some(f) = slot else { continue };
        file_base.insert(file as u32, next);
        bases.push((next, &f.fns));
        next += f.fns.fns.len() as u32;
    }
    let rows = crate::lang::functions::number_sites(
        &bases,
        &|file| file_base.get(&file).copied(),
        &|s| sym_classes.get(s).cloned().unwrap_or_default(),
    );
    for id in 0..rows.syms.len() {
        w.push(Rel::Sy, &[id as u32]);
    }
    rows.cl.iter().for_each(|r| w.push(Rel::Cl, r));
    rows.cs.iter().for_each(|r| w.push(Rel::Cs, r));
    rows.hd.iter().for_each(|r| w.push(Rel::Hd, r));
    rows.al.iter().for_each(|r| w.push(Rel::Al, r));
    rows.ce.iter().for_each(|r| w.push(Rel::Ce, r));
    rows.cu.iter().for_each(|r| w.push(Rel::Cu, r));
    st.sites = rows.cs.len() + rows.hd.len() + rows.ce.len();
    tables.syms = rows.syms;
}

/// Function ids are global: files in id order, functions in start-offset order within a file.
/// Each file's rows move into the writer and are freed before the next file. Returns the `FK`
/// key of each function.
/// A file that policy marks as test code (`[lanes.*] test`, by prefix or `*suffix`) has every function
/// flagged `TF`, so the metric rules skip it like any other test function.
fn push_functions(w: &mut FactWriter, mut per: Vec<Option<FileOut>>, policy_test: &dyn Fn(usize) -> bool, tables: &mut SideTables, st: &mut Stats) -> Vec<u64> {
    let mut fn_keys = Vec::new();
    let mut base = 0u32;
    for (file, slot) in per.iter_mut().enumerate() {
        // Per-function ctx bits (FC), taken before the destructure below.
        let mut fn_ctx = slot.as_mut().map(|o| std::mem::take(&mut o.fns.fn_ctx)).unwrap_or_default();
        let Some(FileOut { fns: FileFns { fns, mut ct, mut ops, mut branches, entries, blocks, .. }, tests }) = slot.take() else { continue };
        let count = fns.len() as u32;
        for (local, f) in fns.into_iter().enumerate() {
            let id = base + local as u32;
            let parent = f.parent.map(|l| base + l);
            w.push(Rel::Fn, &[id, file as u32, parent.unwrap_or(NO_PARENT), f.loc]);
            w.push(Rel::Fk, &[id, (f.key >> 32) as u32, (f.key & 0xffff_ffff) as u32]);
            fn_keys.push(f.key);
            tables.fns.push(FnEntry {
                file: file as u32,
                start_line: f.start_line,
                end_line: f.end_line,
                parent,
                kind: f.kind,
                chain: f.chain,
            });
        }
        // Canonical (fn, node) order, so the writer's sorted fast path applies.
        ct.sort_unstable_by_key(|c| (c.fn_local, c.node));
        st.ct += ct.len();
        for c in &ct {
            w.push(Rel::Ct, &[base + c.fn_local, c.node, c.parent, c.kind as u32]);
        }
        // The boolean operator behind each kind-6 node.
        ops.sort_unstable_by_key(|o| (o.fn_local, o.node));
        for o in &ops {
            w.push(Rel::Co, &[base + o.fn_local, o.node, o.op as u32]);
        }
        // What each branch node is (`if`, `else if`, ternary), for cognitive complexity.
        branches.sort_unstable_by_key(|b| (b.fn_local, b.node));
        for b in &branches {
            w.push(Rel::Cb, &[base + b.fn_local, b.node, b.flavor as u32]);
        }
        for (local, kind) in &entries {
            w.push(Rel::Ep, &[base + local, *kind as u32]);
        }
        fn_ctx.sort_unstable();
        for (local, c) in &fn_ctx {
            w.push(Rel::Fc, &[base + local, file as u32, *c as u32]);
        }
        for r in &blocks.bl {
            w.push(Rel::Bl, &[base + r[0], r[1], r[2]]);
        }
        for r in &blocks.bw {
            w.push(Rel::Bw, &[base + r[0], r[1], r[2]]);
        }
        for r in &blocks.br {
            w.push(Rel::Br, &[base + r[0], r[1], r[2]]);
        }
        for r in &blocks.bc {
            w.push(Rel::Bc, &[base + r[0], r[1], r[2], r[3], r[4]]);
        }
        if policy_test(file) {
            for t in 0..count {
                w.push(Rel::Tf, &[base + t]);
            }
        } else {
            for t in tests {
                w.push(Rel::Tf, &[base + t]);
            }
        }
        base += count;
    }
    fn_keys
}

/// The Bend lane: its `I`/`U` rows and per-file functions, then `MK`/`L`/`LW`/`LN`, which name
/// functions by (file, local index) and so are numbered here, like `FN` below. Returns the
/// `.laws` table (empty when there are no Bend files or no laws).
fn bend_lane(
    root: &Path,
    bend_files: &[(u32, String)],
    files: &[String],
    per: &mut [Option<FileOut>],
    lane_prod: &mut [Option<bool>],
    w: &mut FactWriter,
    st: &mut Stats,
) -> Result<String, String> {
    if bend_files.is_empty() {
        return Ok(String::new());
    }
    let a = lang::bend::analyze(root, bend_files)?;
    for ((id, _), p) in bend_files.iter().zip(&a.prod) {
        lane_prod[*id as usize] = Some(*p);
    }
    st.unreadable += a.stats.unreadable;
    st.laws = a.stats.laws;
    st.markers = a.stats.markers;
    push_edges(w, &a.i, &a.u, st);
    for ((id, _), f) in bend_files.iter().zip(a.per_file) {
        per[*id as usize] = Some(f);
    }
    a.extra.push_rows(w, &lang::bend::fn_bases(per));
    Ok(a.extra.laws_table(files))
}

fn push_edges(w: &mut FactWriter, i: &[[u32; 5]], u: &[[u32; 2]], st: &mut Stats) {
    w.reserve(Rel::I, i.len());
    w.reserve(Rel::U, u.len());
    for r in i {
        w.push(Rel::I, r);
    }
    for r in u {
        w.push(Rel::U, r);
    }
    st.i_facts += i.len();
    st.u_facts += u.len();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(root: &Path, tracked: &[&str]) -> String {
        let mut w = FactWriter::new();
        let mut t = SideTables::default();
        build(root, tracked.iter().map(|s| s.to_string()).collect(), &Lanes::default(), &[], &mut w, &mut t).unwrap();
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn ts_and_rust_files_share_one_sorted_id_space() {
        let dir = std::env::temp_dir().join(format!("pulsar-driver-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("a.ts"), "export const a = 1\n").unwrap();
        std::fs::write(dir.join("b.ts"), "import {a} from \"./a\"\nexport const b = a\n").unwrap();
        std::fs::write(dir.join("src/lib.rs"), "pub fn f() {}\n").unwrap();
        std::fs::write(dir.join("notes.md"), "x\n").unwrap();
        let out = facts(&dir, &["notes.md", "src/lib.rs", "b.ts", "a.ts"]);
        std::fs::remove_dir_all(&dir).ok();
        // ids by byte-sorted path: a.ts 0, b.ts 1, src/lib.rs 2; notes.md has no lane.
        assert!(out.contains("N 3\n"), "{out}");
        assert!(out.contains("F 0 ") && out.contains("F 1 ") && out.contains("F 2 "), "{out}");
        assert!(out.contains("I 1 0 0 1 0\n"), "b imports a: {out}");
        // functions are numbered in file-id order: the Rust fn is in file 2.
        assert!(out.lines().any(|l| l.starts_with("FN ") && l.split(' ').nth(2) == Some("2")), "{out}");
    }

    #[test]
    fn a_policy_test_suffix_makes_every_function_in_the_file_a_test_function() {
        let dir = std::env::temp_dir().join(format!("pulsar-driver-tf-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.tst.ts"), "export function one() { return 1 }\nexport function two() { return 2 }\n").unwrap();
        std::fs::write(dir.join("b.ts"), "export function three() { return 3 }\n").unwrap();
        let tracked: Vec<String> = vec!["a.tst.ts".into(), "b.ts".into()];
        let run = |lanes: &Lanes| {
            let mut w = FactWriter::new();
            let mut t = SideTables::default();
            build(&dir, tracked.clone(), lanes, &[], &mut w, &mut t).unwrap();
            let mut out = Vec::new();
            w.write_to(&mut out).unwrap();
            String::from_utf8(out).unwrap()
        };
        let tf = |out: &str| out.lines().filter(|l| l.starts_with("TF ")).map(String::from).collect::<Vec<_>>();
        assert!(tf(&run(&Lanes::default())).is_empty(), "without the policy entry nothing is a test function");
        let mut lanes = Lanes::default();
        lanes.ts.test = vec!["*.tst.ts".into()];
        let out = run(&lanes);
        std::fs::remove_dir_all(&dir).ok();
        // a.tst.ts is file 0 with functions 0 and 1; b.ts holds function 2, which stays production.
        assert_eq!(tf(&out), vec!["TF 0".to_string(), "TF 1".to_string()], "{out}");
        assert!(out.contains("F 0 0\n") && out.contains("F 1 1\n"), "the policy test file is not production, b.ts is: {out}");
    }

    #[test]
    fn a_policy_test_file_carries_the_test_bit_on_its_call_sites() {
        let dir = std::env::temp_dir().join(format!("pulsar-driver-ctx4-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.tst.ts"), "export function one() { return Date.now() }\n").unwrap();
        std::fs::write(dir.join("b.ts"), "export function two() { return Date.now() }\n").unwrap();
        let tracked: Vec<String> = vec!["a.tst.ts".into(), "b.ts".into()];
        let run = |lanes: &Lanes| {
            let mut w = FactWriter::new();
            let mut t = SideTables::default();
            build(&dir, tracked.clone(), lanes, &[], &mut w, &mut t).unwrap();
            let mut out = Vec::new();
            w.write_to(&mut out).unwrap();
            String::from_utf8(out).unwrap()
        };
        // `CS site fn callee loop_depth ctx`, by function: a.tst.ts holds fn 0, b.ts fn 1.
        let ctx_of = |out: &str, f: &str| {
            out.lines().find(|l| l.starts_with("CS ") && l.split(' ').nth(2) == Some(f)).map(|l| l.rsplit(' ').next().unwrap().to_string())
        };
        let before = run(&Lanes::default());
        assert_eq!(ctx_of(&before, "0").as_deref(), Some("0"), "no policy entry and no test naming: {before}");
        let mut lanes = Lanes::default();
        lanes.ts.test = vec!["*.tst.ts".into()];
        let out = run(&lanes);
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(ctx_of(&out, "0").as_deref(), Some("4"), "the policy test file carries bit 4: {out}");
        assert_eq!(ctx_of(&out, "1").as_deref(), Some("0"), "an ordinary file does not: {out}");
    }

    #[test]
    fn a_policy_test_file_carries_the_test_bit_in_the_rust_lane_too() {
        let dir = std::env::temp_dir().join(format!("pulsar-driver-ctx4-rs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/lib.rs"), "pub fn f(x: Option<u8>) -> u8 {\n    x.unwrap()\n}\n").unwrap();
        let tracked: Vec<String> = vec!["src/lib.rs".into()];
        let run = |lanes: &Lanes| {
            let mut w = FactWriter::new();
            let mut t = SideTables::default();
            build(&dir, tracked.clone(), lanes, &[], &mut w, &mut t).unwrap();
            let mut out = Vec::new();
            w.write_to(&mut out).unwrap();
            String::from_utf8(out).unwrap()
        };
        let ctx_of = |out: &str| out.lines().find(|l| l.starts_with("CS ")).map(|l| l.rsplit(' ').next().unwrap().to_string());
        // 64 is the name-only bit of `x.unwrap()`.
        assert_eq!(ctx_of(&run(&Lanes::default())).as_deref(), Some("64"));
        let mut lanes = Lanes::default();
        lanes.rust.test = vec!["src/lib.rs".into()];
        let out = run(&lanes);
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(ctx_of(&out).as_deref(), Some("68"), "name-only and test: {out}");
    }

    #[test]
    fn sql_files_join_the_id_space_and_emit_schema_and_query_rows() {
        let dir = std::env::temp_dir().join(format!("pulsar-driver-sql-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("db")).unwrap();
        std::fs::write(dir.join("db/schema.sql"), "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nSELECT name FROM users WHERE id = 1;\n").unwrap();
        std::fs::write(dir.join("a.ts"), "export const a = 1\n").unwrap();
        let mut w = FactWriter::new();
        let mut t = SideTables::default();
        let tracked = ["db/schema.sql", "a.ts"].map(String::from).to_vec();
        let (set, st) = build(&dir, tracked, &Lanes::default(), &[], &mut w, &mut t).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        let out = String::from_utf8(out).unwrap();
        // ids by sorted path: a.ts 0, db/schema.sql 1; the schema is a production file.
        assert_eq!(set.files, ["a.ts", "db/schema.sql"]);
        assert!(out.contains("F 1 1\n"), "{out}");
        assert!(out.lines().any(|l| l.starts_with("DT ")), "a table row: {out}");
        assert!(out.lines().any(|l| l.starts_with("QS ")), "a query site row: {out}");
        assert_eq!((st.sql.texts, st.sql.failed), (1, 0));
        assert!(!t.sql_names.is_empty() && !t.sql_sites.is_empty());
    }

    #[test]
    fn bend_files_join_the_id_space_and_number_law_functions_globally() {
        let dir = std::env::temp_dir().join(format!("pulsar-driver-bend-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("e")).unwrap();
        std::fs::write(dir.join("a.ts"), "export function f() { return 1 }\n").unwrap();
        std::fs::write(dir.join("e/lib.bend"), "import Base\n\ndef inc(+x: U32) -> U32:\n  U32.add(x, 1)\n").unwrap();
        std::fs::write(
            dir.join("e/laws.bend"),
            "import Base\nimport ./lib.bend as L\n\nlaw inc_is:\n  for +x: U32\n  {L.inc(x) == U32.add(x, 1) : U32}\n",
        )
        .unwrap();
        let mut w = FactWriter::new();
        let mut t = SideTables::default();
        let tracked = ["e/laws.bend", "a.ts", "e/lib.bend"].map(String::from).to_vec();
        let (_, st) = build(&dir, tracked, &Lanes::default(), &[], &mut w, &mut t).unwrap();
        std::fs::remove_dir_all(&dir).ok();
        let mut out = Vec::new();
        w.write_to(&mut out).unwrap();
        let out = String::from_utf8(out).unwrap();
        // ids: a.ts 0, e/laws.bend 1, e/lib.bend 2; a.ts has one function (FN 0), lib's inc is FN 1.
        assert_eq!((st.bend_files, st.laws), (2, 1));
        assert!(out.contains("N 3\n") && out.contains("I 1 2 0 1 0\n"), "{out}");
        assert!(out.contains("FN 1 2 "), "{out}");
        assert!(out.contains("L 1\n") && out.contains("LW 0 1 0\n") && out.contains("LN 0 1\n"), "{out}");
        assert_eq!(t.laws, "0\te/laws.bend\t4\tinc_is\n");
    }
}
