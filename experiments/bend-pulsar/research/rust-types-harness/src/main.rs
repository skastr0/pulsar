// On-demand rust-analyzer-as-a-library harness: infer bodies of workspace crates only.
// usage: ra-harness <workspace-dir> [--traits] [--only <crate-name>]
use std::{io::Write, time::Instant};

use hir::{Adt, AssocItem, Crate, DefWithBody, Function, ModuleDef};
use ra_ap_hir as hir;
use ra_ap_hir_def::DefWithBodyId;
use ra_ap_hir_ty::InferenceResult;
use ra_ap_load_cargo::{load_workspace, LoadCargoConfig, ProcMacroServerChoice};
use ra_ap_paths::{AbsPathBuf, Utf8PathBuf};
use ra_ap_project_model::{CargoConfig, ProjectManifest, ProjectWorkspace, RustLibSource};

fn mark(s: &str, t0: Instant) {
    eprintln!("[phase {:>8.2}s] {s}", t0.elapsed().as_secs_f64());
    let _ = std::io::stderr().flush();
}

#[derive(Default)]
struct Counts {
    functions: u64,
    exprs_typed: u64,
    exprs_unknown: u64,
    result_exprs: u64,
    resolved_method_calls: u64,
}

fn analyse(db: &ra_ap_ide_db::RootDatabase, f: Function, c: &mut Counts) {
    if !f.has_body(db) {
        return;
    }
    c.functions += 1;
    let def = DefWithBody::from(f);
    for ty in def.expression_types(db) {
        if ty.is_unknown() {
            c.exprs_unknown += 1;
            continue;
        }
        c.exprs_typed += 1;
        if let Some(Adt::Enum(e)) = ty.as_adt() {
            if e.name(db).as_str() == "Result"
                && e.module(db).krate(db).display_name(db).is_some_and(|n| n.to_string() == "core")
            {
                c.result_exprs += 1;
            }
        }
    }
    if let Ok(id) = DefWithBodyId::try_from(def) {
        let inf = InferenceResult::of(db, id);
        for (eid, _) in inf.expression_types() {
            if inf.method_resolution(eid).is_some() {
                c.resolved_method_calls += 1;
            }
        }
    }
}

fn main() -> anyhow::Result<()> {
    let t0 = Instant::now();
    let args: Vec<String> = std::env::args().collect();
    let dir = args.get(1).expect("workspace dir");
    let traits_mode = args.iter().any(|a| a == "--traits");
    let only = args.iter().position(|a| a == "--only").and_then(|i| args.get(i + 1)).cloned();

    mark("start", t0);
    let root = AbsPathBuf::assert(Utf8PathBuf::from(std::fs::canonicalize(dir)?.to_string_lossy().into_owned()));
    let manifest = ProjectManifest::discover_single(root.as_path())?;
    let cargo_cfg = CargoConfig { sysroot: Some(RustLibSource::Discover), ..Default::default() };
    let ws = ProjectWorkspace::load(manifest, &cargo_cfg, &|_| {})?;
    mark("project model loaded (cargo metadata + sysroot)", t0);
    let load_cfg = LoadCargoConfig {
        load_out_dirs_from_check: false,
        with_proc_macro_server: ProcMacroServerChoice::None,
        prefill_caches: false,
        num_worker_threads: 1,
        proc_macro_processes: 0,
    };
    let (db, _vfs, _pm) = load_workspace(ws, &cargo_cfg.extra_env, &load_cfg)?;
    mark("vfs + crate graph loaded", t0);

    let t1 = Instant::now();
    let all = Crate::all(&db);
    let local: Vec<Crate> = all
        .iter()
        .copied()
        .filter(|k| k.origin(&db).is_local())
        .filter(|k| {
            only.as_ref().is_none_or(|o| {
                k.display_name(&db).is_some_and(|n| n.to_string().replace('-', "_") == o.replace('-', "_"))
            })
        })
        .collect();
    eprintln!("crates total={} analysed(local)={}", all.len(), local.len());
    mark("crates enumerated", t0);

    let mut c = Counts::default();
    let (mut n_mods, mut n_traits, mut n_impls_for_traits) = (0u64, 0u64, 0u64);
    hir::attach_db(&db, || {
    for k in &local {
        for m in k.modules(&db) {
            n_mods += 1;
            for d in m.declarations(&db) {
                match d {
                    ModuleDef::Function(f) => analyse(&db, f, &mut c),
                    ModuleDef::Trait(t) => {
                        for it in t.items(&db) {
                            if let AssocItem::Function(f) = it {
                                analyse(&db, f, &mut c);
                            }
                        }
                        if traits_mode {
                            n_traits += 1;
                            n_impls_for_traits += hir::Impl::all_for_trait(&db, t).len() as u64;
                        }
                    }
                    _ => {}
                }
            }
        }
        for imp in hir::Impl::all_in_crate(&db, *k) {
            for it in imp.items(&db) {
                if let AssocItem::Function(f) = it {
                    analyse(&db, f, &mut c);
                }
            }
        }
        mark(&format!("crate done: {}", k.display_name(&db).map(|n| n.to_string()).unwrap_or_default()), t0);
    }
    });
    let infer_secs = t1.elapsed().as_secs_f64();
    mark("inference done", t0);

    println!("modules={n_mods} functions={}", c.functions);
    println!("exprs_typed={} exprs_unknown={}", c.exprs_typed, c.exprs_unknown);
    println!("result_typed_exprs={}", c.result_exprs);
    println!("resolved_method_calls={}", c.resolved_method_calls);
    if traits_mode {
        println!("workspace_traits={n_traits} impls_of_workspace_traits={n_impls_for_traits}");
    }
    println!("analysis_phase_secs={infer_secs:.2} total_secs={:.2}", t0.elapsed().as_secs_f64());
    Ok(())
}
