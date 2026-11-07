//! Crates and targets from `cargo metadata --no-deps`, one call per workspace. No network and
//! no dependency resolution: the output lists workspace members, their targets and their
//! declared dependencies. If cargo is missing or fails (for example a `rust-toolchain` that is
//! not installed), the conventional layout stands in and the caller is told.

use serde::Deserialize;
use std::collections::{BTreeSet, HashSet};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Target {
    /// Crate name as written in `use` paths (hyphens as underscores).
    pub crate_name: String,
    /// Repo-relative path of the root file.
    pub root: String,
    pub is_lib: bool,
    pub is_bin: bool,
    pub package: usize,
}

#[derive(Debug, Clone, Default)]
pub struct Package {
    pub name: String,
    pub manifest: String,
    /// Names a `use` path may start with: every declared dependency (all kinds) and the package.
    pub dep_names: HashSet<String>,
    /// Indices of workspace members this package depends on (normal and build kinds).
    pub member_deps: Vec<usize>,
}

#[derive(Debug, Default)]
pub struct Crates {
    pub packages: Vec<Package>,
    pub targets: Vec<Target>,
    /// Manifests whose metadata call failed and fell back to the conventional layout.
    pub fallbacks: Vec<String>,
}

#[derive(Deserialize)]
struct Meta {
    packages: Vec<Pkg>,
}

#[derive(Deserialize)]
struct Pkg {
    name: String,
    manifest_path: String,
    targets: Vec<Tgt>,
    dependencies: Vec<Dep>,
}

#[derive(Deserialize)]
struct Tgt {
    name: String,
    kind: Vec<String>,
    src_path: String,
}

#[derive(Deserialize)]
struct Dep {
    name: String,
    rename: Option<String>,
    kind: Option<String>,
}

pub fn underscored(s: &str) -> String {
    s.replace('-', "_")
}

fn rel_to(root: &Path, abs: &str) -> Option<String> {
    let p = Path::new(abs);
    let p = p.strip_prefix(root).ok()?;
    Some(p.to_string_lossy().replace('\\', "/"))
}

/// Discover every workspace under `root` from its tracked `Cargo.toml` files.
pub fn discover(root: &Path, tracked: &[String], files: &HashSet<&str>) -> Crates {
    let mut manifests: Vec<&String> = tracked
        .iter()
        .filter(|p| p.as_str() == "Cargo.toml" || p.ends_with("/Cargo.toml"))
        .collect();
    manifests.sort();
    let mut out = Crates::default();
    let mut known: BTreeSet<String> = BTreeSet::new();
    let mut raw: Vec<(Pkg, Vec<(String, String, bool, bool)>)> = Vec::new();
    for m in manifests {
        if known.contains(m.as_str()) {
            continue;
        }
        match metadata(root, m) {
            Ok(meta) => {
                for p in meta.packages {
                    if let Some(rel) = rel_to(root, &p.manifest_path) {
                        known.insert(rel);
                    }
                    raw.push((p, Vec::new()));
                }
                known.insert(m.clone());
            }
            Err(e) => {
                eprintln!("pulsar: cargo metadata failed for {m} ({e}); using the conventional layout");
                out.fallbacks.push(m.clone());
                known.insert(m.clone());
                if let Some(p) = conventional(root, m, files) {
                    raw.push(p);
                }
            }
        }
    }
    // Assign package indices, then targets and member dependencies.
    let names: Vec<String> = raw.iter().map(|(p, _)| p.name.clone()).collect();
    for (pi, (p, conv_targets)) in raw.iter().enumerate() {
        let mut pkg = Package {
            name: p.name.clone(),
            manifest: rel_to(root, &p.manifest_path).unwrap_or_else(|| p.manifest_path.clone()),
            ..Package::default()
        };
        pkg.dep_names.insert(underscored(&p.name));
        for d in &p.dependencies {
            let used = underscored(d.rename.as_deref().unwrap_or(&d.name));
            pkg.dep_names.insert(used);
            let normal = matches!(d.kind.as_deref(), None | Some("build"));
            if normal {
                if let Some(mi) = names.iter().position(|n| n == &d.name) {
                    if mi != pi && !pkg.member_deps.contains(&mi) {
                        pkg.member_deps.push(mi);
                    }
                }
            }
        }
        out.packages.push(pkg);
        for t in &p.targets {
            let Some(root_rel) = rel_to(root, &t.src_path) else { continue };
            let is_lib = t.kind.iter().any(|k| k == "lib" || k == "rlib" || k == "proc-macro" || k == "dylib" || k == "cdylib" || k == "staticlib");
            let is_bin = t.kind.iter().any(|k| k == "bin");
            let crate_name = underscored(&t.name);
            out.targets.push(Target { crate_name, root: root_rel, is_lib, is_bin, package: pi });
        }
        for (name, root_rel, is_lib, is_bin) in conv_targets {
            out.targets.push(Target {
                crate_name: underscored(name),
                root: root_rel.clone(),
                is_lib: *is_lib,
                is_bin: *is_bin,
                package: pi,
            });
        }
    }
    out
}

fn metadata(root: &Path, manifest_rel: &str) -> Result<Meta, String> {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let out = Command::new(cargo)
        .args(["metadata", "--format-version", "1", "--no-deps", "--offline", "--manifest-path"])
        .arg(root.join(manifest_rel))
        .env("RUSTUP_AUTO_INSTALL", "0")
        .current_dir(root)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.lines().find(|l| l.starts_with("error")).unwrap_or("non-zero exit").to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

/// `src/lib.rs`, `src/main.rs`, `src/bin/*.rs`, `build.rs`, `tests/`, `examples/`, `benches/`.
fn conventional(
    root: &Path,
    manifest_rel: &str,
    files: &HashSet<&str>,
) -> Option<(Pkg, Vec<(String, String, bool, bool)>)> {
    let dir = manifest_rel.strip_suffix("Cargo.toml").unwrap_or("");
    let text = std::fs::read_to_string(root.join(manifest_rel)).ok()?;
    let mut in_pkg = false;
    let mut name = None;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            in_pkg = l == "[package]";
        } else if in_pkg {
            if let Some(v) = l.strip_prefix("name") {
                name = v.trim_start().strip_prefix('=').map(|v| v.trim().trim_matches('"').to_string());
            }
        }
    }
    let name = name?;
    let mut targets = Vec::new();
    let join = |p: &str| format!("{dir}{p}");
    for (p, is_lib, is_bin) in [("src/lib.rs", true, false), ("src/main.rs", false, true), ("build.rs", false, false)] {
        if files.contains(join(p).as_str()) {
            targets.push((name.clone(), join(p), is_lib, is_bin));
        }
    }
    let mut extra: Vec<&&str> = files
        .iter()
        .filter(|f| {
            ["src/bin/", "tests/", "examples/", "benches/"].iter().any(|d| {
                f.strip_prefix(dir)
                    .and_then(|r| r.strip_prefix(d))
                    .is_some_and(|r| r.ends_with(".rs") && !r.contains('/'))
            })
        })
        .collect();
    extra.sort();
    for f in extra {
        let stem = f.rsplit('/').next().unwrap_or(f).trim_end_matches(".rs");
        targets.push((stem.to_string(), (*f).to_string(), false, f.contains("/src/bin/") || f.starts_with("src/bin/")));
    }
    let pkg = Pkg {
        name,
        manifest_path: root.join(manifest_rel).to_string_lossy().into_owned(),
        targets: Vec::new(),
        dependencies: Vec::new(),
    };
    Some((pkg, targets))
}
