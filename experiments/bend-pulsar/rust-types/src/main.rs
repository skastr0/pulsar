//! Opt-in Rust type lane: rust-analyzer's libraries, workspace bodies only.
//!
//! Reads the function side table the syntax lane wrote (`<facts>.fns`), loads the workspace,
//! infers every workspace body, and emits type facts keyed to the same function ids. The
//! default lane never runs this, so the main binary keeps no rust-analyzer dependency.
//!
//! Usage: pulsar-rust-types <workspace-dir> --facts <facts-file> [--out <file>]
//!                           [--rss-limit-mb <n>] [--shard <crate-name>]
//!
//! Facts (FACTS.md "Type lane"):
//!   T  <im> <if> <cm> <et>            header: row counts, before the rows
//!   IM <impl> <tr> <self_ty>          an impl block; tr = 4294967295 when inherent
//!   IF <fn> <impl>                    function fn is an item of impl impl
//!   CM <fn> <expr> <callee> <mode>    call at expr resolves to callee; mode 0 inherent,
//!                                     1 trait method, 2 free function
//!   ET <fn> <expr> <ty> <flags>       type of expr; flags 1 Result, 2 Option, 16 receiver,
//!                                     32 reference or pointer
//!
//! Side tables: `<out>.syms` (kind<TAB>rendered) and `<out>.exprs` (fn<TAB>expr<TAB>path<TAB>line).

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use ra_ap_hir as hir;
use ra_ap_hir::{AsAssocItem, AssocItem, AssocItemContainer, Crate, DefWithBody, Function, HasSource, Impl, ModuleDef};
use ra_ap_syntax::ast::AstNode;
use ra_ap_hir_def::DefWithBodyId;
use ra_ap_hir_ty::InferenceResult;
use ra_ap_load_cargo::{load_workspace, LoadCargoConfig, ProcMacroServerChoice};
use ra_ap_paths::{AbsPathBuf, Utf8PathBuf};
use ra_ap_project_model::{CargoConfig, ProjectManifest, ProjectWorkspace, RustLibSource};
use rustc_hash::FxHashMap;

const NO_SYMBOL: u32 = u32::MAX;

/// One `.fns` row: the syntax lane's function id and the span it covers.
struct FnRow {
    id: u32,
    path: String,
    start_line: u32,
}

fn read_fns(path: &Path) -> anyhow::Result<Vec<FnRow>> {
    let text = std::fs::read_to_string(path)?;
    let mut out = Vec::new();
    for line in text.lines() {
        // The side table carries a `pulsar-facts 0` header line; rows start with the fn id.
        if !line.as_bytes().first().is_some_and(|b| b.is_ascii_digit()) {
            continue;
        }
        let f: Vec<&str> = line.split('\t').collect();
        anyhow::ensure!(f.len() >= 4, "malformed .fns row: {line}");
        out.push(FnRow {
            id: f[0].parse()?,
            path: f[1].to_string(),
            start_line: f[2].parse()?,
        });
    }
    Ok(out)
}

fn peak_rss_mb() -> u64 {
    let Ok(status) = std::fs::read_to_string("/proc/self/status") else { return 0 };
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmHWM:") {
            if let Some(kb) = rest.split_whitespace().next().and_then(|v| v.parse::<u64>().ok()) {
                return kb / 1024;
            }
        }
    }
    0
}

/// Line of `offset` (0-based bytes) in `text`, 1-based, matching the syntax lane's spans.
fn line_at(text: &str, offset: usize) -> u32 {
    let upto = &text[..offset.min(text.len())];
    1 + upto.bytes().filter(|b| *b == b'\n').count() as u32
}


/// Name and whether the type is defined in `core`, for the two lang-level types `RT` flags
/// care about. Resolved through the ADT, never by matching a printed type name.
fn core_adt(adt: ra_ap_hir_def::AdtId, db: &ra_ap_ide_db::RootDatabase) -> (String, bool) {
    use ra_ap_hir_def::AdtId;
    let (name, module) = match adt {
        AdtId::EnumId(id) => {
            let e = hir::Enum::from(id);
            (e.name(db).as_str().to_string(), e.module(db))
        }
        AdtId::StructId(id) => {
            let s = hir::Struct::from(id);
            (s.name(db).as_str().to_string(), s.module(db))
        }
        AdtId::UnionId(id) => {
            let u = hir::Union::from(id);
            (u.name(db).as_str().to_string(), u.module(db))
        }
    };
    let core = module.krate(db).display_name(db).is_some_and(|n| n.to_string() == "core");
    (name, core)
}

#[derive(Default)]
struct Counts {
    fns_matched: u64,
    fns_unmatched: u64,
    exprs_typed: u64,
    exprs_unknown: u64,
    impls: u64,
    methods: u64,
    method_calls: u64,
    result_exprs: u64,
    option_exprs: u64,
}

struct Symbols {
    rows: Vec<(u8, String)>,
    by_name: BTreeMap<String, u32>,
}

impl Symbols {
    fn intern(&mut self, kind: u8, name: String) -> u32 {
        if let Some(id) = self.by_name.get(&name) {
            return *id;
        }
        let id = self.rows.len() as u32;
        self.rows.push((kind, name.clone()));
        self.by_name.insert(name, id);
        id
    }
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = args.first().cloned().unwrap_or_else(|| ".".into());
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let facts_path = flag("--facts");
    let out_path = flag("--out").map(PathBuf::from);
    let rss_limit: u64 = flag("--rss-limit-mb").and_then(|v| v.parse().ok()).unwrap_or(4096);
    let shard = flag("--shard");
    // The workspace may sit inside a larger repo: facts paths are relative to the repo root.
    let path_root = std::fs::canonicalize(flag("--repo").unwrap_or_else(|| dir.clone()))?;

    let fns = match &facts_path {
        Some(p) => read_fns(Path::new(p))?,
        None => Vec::new(),
    };
    let by_spot: BTreeMap<(String, u32), u32> =
        fns.iter().map(|f| ((f.path.clone(), f.start_line), f.id)).collect();
    // Without a syntax facts file the lane numbers functions itself and writes `<out>.fnspots`,
    // so the ids can be joined to `FN` later; with one, ids are the syntax lane's.
    let mut local_fns: Vec<(u32, String, u32)> = Vec::new();
    let mut next_local = 0u32;

    let t0 = Instant::now();
    let root = AbsPathBuf::assert(Utf8PathBuf::from(
        std::fs::canonicalize(&dir)?.to_string_lossy().into_owned(),
    ));
    let manifest = ProjectManifest::discover_single(root.as_path())?;
    let cargo_cfg = CargoConfig { sysroot: Some(RustLibSource::Discover), ..Default::default() };
    let ws = ProjectWorkspace::load(manifest, &cargo_cfg, &|_| {})?;
    let load_cfg = LoadCargoConfig {
        load_out_dirs_from_check: false,
        with_proc_macro_server: ProcMacroServerChoice::None,
        prefill_caches: false,
        num_worker_threads: 1,
        proc_macro_processes: 0,
    };
    let (db, vfs, _pm) = load_workspace(ws, &cargo_cfg.extra_env, &load_cfg)?;
    eprintln!("types: workspace loaded in {:.2}s, rss {} MB", t0.elapsed().as_secs_f64(), peak_rss_mb());

    let mut counts = Counts::default();
    let mut symbols = Symbols { rows: Vec::new(), by_name: BTreeMap::new() };
    let mut im_rows: Vec<(u32, u32, u32)> = Vec::new();
    let mut if_rows: Vec<(u32, u32)> = Vec::new();
    let mut cm_rows: Vec<(u32, u32, u32, u32)> = Vec::new();
    let mut et_rows: Vec<(u32, u32, u32, u32)> = Vec::new();
    let mut expr_rows: Vec<(u32, u32, String, u32)> = Vec::new();

    let all = Crate::all(&db);
    let local: Vec<Crate> = all
        .iter()
        .copied()
        .filter(|k| k.origin(&db).is_local())
        .filter(|k| match &shard {
            None => true,
            Some(name) => k
                .display_name(&db)
                .is_some_and(|n| n.to_string().replace('-', "_") == name.replace('-', "_")),
        })
        .collect();
    eprintln!("types: crates total={} analysed(local)={}", all.len(), local.len());

    hir::attach_db(&db, || {
        // Impls first, so a method can point at its impl and impl ids follow (path, offset).
        let mut impls: Vec<(Impl, String, u32)> = Vec::new();
        for krate in &local {
            for imp in Impl::all_in_crate(&db, *krate) {
                let Some(source) = imp.source(&db) else { continue };
                let file_id = source.file_id.file_id().map(|e| e.file_id(&db));
                let Some(file_id) = file_id else {
                    counts.fns_unmatched += 1;
                    return;
                };
                let Some(path) = vfs.file_path(file_id).as_path().map(|p| p.to_string()) else {
                    continue;
                };
                let text = match std::fs::read_to_string(&path) {
                    Ok(t) => t,
                    Err(_) => continue,
                };
                let offset: usize = source.value.syntax().text_range().start().into();
                impls.push((imp, path, line_at(&text, offset)));
            }
        }
        impls.sort_by(|a, b| (&a.1, a.2).cmp(&(&b.1, b.2)));
        // File paths in .fns are repo-relative; the vfs gives absolute paths.
        let rel = |path: &str| -> Option<String> {
            let p = Path::new(path);
            p.strip_prefix(&path_root).ok().map(|r| r.to_string_lossy().replace('\\', "/"))
        };
        let mut impl_ids: FxHashMap<Impl, u32> = FxHashMap::default();
        for (i, (imp, path, _)) in impls.iter().enumerate() {
            let impl_id = i as u32;
            impl_ids.insert(*imp, impl_id);
            let tr = imp
                .trait_(&db)
                .map(|t| symbols.intern(2, t.name(&db).as_str().to_string()))
                .unwrap_or(NO_SYMBOL);
            let self_ty_name = format!("{:?}", imp.self_ty(&db));
            let self_ty = symbols.intern(1, self_ty_name);
            im_rows.push((impl_id, tr, self_ty));
            counts.impls += 1;
            let _ = path;
        }

        for krate in &local {
            let mut analyse = |f: Function, counts: &mut Counts| {
                if !f.has_body(&db) {
                    return;
                }
                // Join to the syntax lane: same path, same start line.
                let Some(source) = f.source(&db) else {
                    counts.fns_unmatched += 1;
                    return;
                };
                let file_id = source.file_id.file_id().map(|e| e.file_id(&db));
                let Some(file_id) = file_id else {
                    counts.fns_unmatched += 1;
                    return;
                };
                let Some(abs) = vfs.file_path(file_id).as_path().map(|p| p.to_string()) else {
                    counts.fns_unmatched += 1;
                    return;
                };
                let Some(path) = rel(&abs) else {
                    counts.fns_unmatched += 1;
                    return;
                };
                let text = match std::fs::read_to_string(&abs) {
                    Ok(t) => t,
                    Err(_) => {
                        counts.fns_unmatched += 1;
                        return;
                    }
                };
                let offset: usize = source.value.syntax().text_range().start().into();
                let line = line_at(&text, offset);
                let fn_id = match by_spot.get(&(path.clone(), line)) {
                    Some(&id) => id,
                    None if by_spot.is_empty() => {
                        let id = next_local;
                        next_local += 1;
                        local_fns.push((id, path.clone(), line));
                        id
                    }
                    None => {
                        counts.fns_unmatched += 1;
                        return;
                    }
                };
                counts.fns_matched += 1;

                if let Some(item) = f.as_assoc_item(&db) {
                    if let AssocItemContainer::Impl(imp) = item.container(&db) {
                    if let Some(&impl_id) = impl_ids.get(&imp) {
                        if_rows.push((fn_id, impl_id));
                        counts.methods += 1;
                    }
                    }
                }

                let def = DefWithBody::from(f);
                let Ok(body_id) = DefWithBodyId::try_from(def) else { return };
                let inf = InferenceResult::of(&db, body_id);
                for (expr_id, ty) in inf.expression_types() {
                    let rendered = format!("{ty:?}");
                    if rendered.contains("unknown") {
                        counts.exprs_unknown += 1;
                        continue;
                    }
                    counts.exprs_typed += 1;
                    let expr_no = u32::from(expr_id.into_raw());
                    let ty_id = symbols.intern(1, rendered);
                    let mut flags = 0u32;
                    if let Some((adt, _args)) = ty.as_adt() {
                        let (name, core) = core_adt(adt, &db);
                        if core && name == "Result" {
                            flags |= 1;
                            counts.result_exprs += 1;
                        } else if core && name == "Option" {
                            flags |= 2;
                            counts.option_exprs += 1;
                        }
                    }
                    if ty.as_reference_or_ptr().is_some() {
                        flags |= 32;
                    }
                    if inf.method_resolution(expr_id).is_some() {
                        flags |= 16;
                    }
                    if flags != 0 {
                        et_rows.push((fn_id, expr_no, ty_id, flags));
                    }
                    expr_rows.push((fn_id, expr_no, path.clone(), line));
                    match inf.method_resolution(expr_id) {
                        Some((callee, _)) => {
                            let callee_fn: Function = callee.into();
                            let mode = match callee_fn.as_assoc_item(&db).map(|i| i.container(&db)) {
                                Some(AssocItemContainer::Trait(_)) => 1,
                                Some(AssocItemContainer::Impl(_)) => 0,
                                None => 2,
                            };
                            let name = callee_fn.name(&db).as_str().to_string();
                            let callee_id = symbols.intern(0, name);
                            cm_rows.push((fn_id, expr_no, callee_id, mode));
                            counts.method_calls += 1;
                        }
                        None => {}
                    }
                }
            };

            for module in krate.modules(&db) {
                for def in module.declarations(&db) {
                    match def {
                        ModuleDef::Function(f) => analyse(f, &mut counts),
                        ModuleDef::Trait(t) => {
                            for item in t.items(&db) {
                                if let AssocItem::Function(f) = item {
                                    analyse(f, &mut counts);
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            for imp in Impl::all_in_crate(&db, *krate) {
                for item in imp.items(&db) {
                    if let AssocItem::Function(f) = item {
                        analyse(f, &mut counts);
                    }
                }
            }
            let rss = peak_rss_mb();
            if rss > rss_limit {
                eprintln!(
                    "types: RSS {rss} MB over the {rss_limit} MB guard, stopping before the OOM killer; \
                     rerun with --shard <crate> for the rest"
                );
                std::process::exit(3);
            }
        }
    });

    let mut buf = String::new();
    buf.push_str("pulsar-types 0\n");
    buf.push_str(&format!("S {}\n", symbols.rows.len()));
    buf.push_str(&format!("T {} {} {} {}\n", im_rows.len(), if_rows.len(), cm_rows.len(), et_rows.len()));
    im_rows.sort_unstable();
    im_rows.dedup();
    for (imp, tr, self_ty) in &im_rows {
        buf.push_str(&format!("IM {imp} {tr} {self_ty}\n"));
    }
    if_rows.sort_unstable();
    if_rows.dedup();
    for (f, imp) in &if_rows {
        buf.push_str(&format!("IF {f} {imp}\n"));
    }
    cm_rows.sort_unstable();
    cm_rows.dedup();
    for (f, e, callee, mode) in &cm_rows {
        buf.push_str(&format!("CM {f} {e} {callee} {mode}\n"));
    }
    et_rows.sort_unstable();
    et_rows.dedup();
    for (f, e, ty, flags) in &et_rows {
        buf.push_str(&format!("ET {f} {e} {ty} {flags}\n"));
    }

    match &out_path {
        Some(path) => {
            std::fs::write(path, &buf)?;
            let mut syms = String::new();
            for (kind, name) in &symbols.rows {
                syms.push_str(&format!("{kind}\t{name}\n"));
            }
            let mut sp = path.clone().into_os_string();
            sp.push(".syms");
            std::fs::write(&sp, syms)?;
            expr_rows.sort_unstable();
            expr_rows.dedup();
            let mut exprs = String::new();
            for (f, e, path, line) in &expr_rows {
                exprs.push_str(&format!("{f}\t{e}\t{path}\t{line}\n"));
            }
            let mut ep = path.clone().into_os_string();
            ep.push(".exprs");
            std::fs::write(&ep, exprs)?;
            local_fns.sort_unstable();
            local_fns.dedup();
            let mut fp = path.clone().into_os_string();
            fp.push(".fnspots");
            let mut spots = String::new();
            for (id, p, line) in &local_fns {
                spots.push_str(&format!("{id}\t{p}\t{line}\n"));
            }
            std::fs::write(&fp, spots)?;
        }
        None => {
            let stdout = std::io::stdout();
            let mut lock = stdout.lock();
            lock.write_all(buf.as_bytes())?;
        }
    }

    eprintln!(
        "types: fns matched={} unmatched={} impls={} methods={} exprs typed={} unknown={} \
         result={} option={} method_calls={} total {:.2}s rss {} MB",
        counts.fns_matched,
        counts.fns_unmatched,
        counts.impls,
        counts.methods,
        counts.exprs_typed,
        counts.exprs_unknown,
        counts.result_exprs,
        counts.option_exprs,
        counts.method_calls,
        t0.elapsed().as_secs_f64(),
        peak_rss_mb()
    );
    Ok(())
}
