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
    /// Manifests whose metadata call failed and fell back to the conventional layout, with the
    /// reason cargo gave.
    pub fallbacks: Vec<(String, String)>,
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

/// A conventional target when metadata failed: crate name, root path, is lib, is bin.
type ConvTarget = (String, String, bool, bool);

/// A package as cargo reported it, or the conventional stand-in.
struct Raw {
    pkg: Pkg,
    conv: Vec<ConvTarget>,
}

/// Discover every workspace under `root` from its tracked `Cargo.toml` files.
pub fn discover(root: &Path, tracked: &[String], files: &HashSet<&str>) -> Crates {
    let mut out = Crates::default();
    let raw = load_packages(root, tracked, files, &mut out.fallbacks);
    let names: Vec<String> = raw.iter().map(|r| r.pkg.name.clone()).collect();
    for (pi, r) in raw.iter().enumerate() {
        out.packages.push(package_of(root, pi, r, &names));
        out.targets.extend(targets_of(root, pi, r));
    }
    out
}

/// One `cargo metadata` call per workspace: a manifest already listed as a member of an earlier
/// workspace is skipped.
fn load_packages(root: &Path, tracked: &[String], files: &HashSet<&str>, fallbacks: &mut Vec<(String, String)>) -> Vec<Raw> {
    let mut manifests: Vec<&String> =
        tracked.iter().filter(|p| p.as_str() == "Cargo.toml" || p.ends_with("/Cargo.toml")).collect();
    manifests.sort();
    let mut known: BTreeSet<String> = BTreeSet::new();
    let mut raw = Vec::new();
    for m in manifests {
        if !known.insert(m.clone()) {
            continue;
        }
        match metadata(root, m) {
            Ok(meta) => {
                for p in meta.packages {
                    known.extend(rel_to(root, &p.manifest_path));
                    raw.push(Raw { pkg: p, conv: Vec::new() });
                }
            }
            Err(e) => {
                fallbacks.push((m.clone(), e));
                raw.extend(conventional(root, m, files));
            }
        }
    }
    raw
}

fn package_of(root: &Path, pi: usize, r: &Raw, names: &[String]) -> Package {
    let p = &r.pkg;
    let mut pkg = Package {
        name: p.name.clone(),
        manifest: rel_to(root, &p.manifest_path).unwrap_or_else(|| p.manifest_path.clone()),
        ..Package::default()
    };
    pkg.dep_names.insert(underscored(&p.name));
    for d in &p.dependencies {
        pkg.dep_names.insert(underscored(d.rename.as_deref().unwrap_or(&d.name)));
        // Dev-dependencies may legally form cycles, so they are not crate edges.
        if !matches!(d.kind.as_deref(), None | Some("build")) {
            continue;
        }
        let member = names.iter().position(|n| n == &d.name).filter(|&mi| mi != pi);
        if let Some(mi) = member.filter(|mi| !pkg.member_deps.contains(mi)) {
            pkg.member_deps.push(mi);
        }
    }
    pkg
}

fn targets_of(root: &Path, pi: usize, r: &Raw) -> Vec<Target> {
    let from_meta = r.pkg.targets.iter().filter_map(|t| {
        let root_rel = rel_to(root, &t.src_path)?;
        let is_lib = t.kind.iter().any(|k| matches!(k.as_str(), "lib" | "rlib" | "proc-macro" | "dylib" | "cdylib" | "staticlib"));
        let is_bin = t.kind.iter().any(|k| k == "bin");
        Some(Target { crate_name: underscored(&t.name), root: root_rel, is_lib, is_bin, package: pi })
    });
    let from_conv = r.conv.iter().map(|(name, root_rel, is_lib, is_bin)| Target {
        crate_name: underscored(name),
        root: root_rel.clone(),
        is_lib: *is_lib,
        is_bin: *is_bin,
        package: pi,
    });
    from_meta.chain(from_conv).collect()
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
) -> Option<Raw> {
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
    Some(Raw { pkg, conv: targets })
}
