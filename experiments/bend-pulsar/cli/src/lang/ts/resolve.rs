//! Specifier resolution: oxc_resolver for relative paths and the nearest tsconfig's
//! `paths`/`baseUrl`/`extends`, plus Pulsar's workspace-package-name rule.

use oxc_resolver::{
    ResolveOptions, Resolver, TsconfigDiscovery, TsconfigOptions, TsconfigReferences,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Why an import-like statement resolved to no repo file (FACTS.md `U` reasons).
pub const U_BARE: u8 = 0;
pub const U_RELATIVE: u8 = 1;
pub const U_ALIAS: u8 = 2;
pub const U_OTHER: u8 = 3;

pub enum Resolved {
    File(u32),
    Unresolved(u8),
}

struct Workspace {
    name: String,
    dir: String, // repo-relative, "" for root
}

pub struct Resolution {
    root: PathBuf,
    ids: HashMap<String, u32>,
    /// extension-stripped path (and bare directory for index files) -> file id, last wins
    lookup: HashMap<String, u32>,
    /// nearest tsconfig dir (repo-relative) -> resolver index
    tsconfig_dirs: HashMap<String, usize>,
    resolvers: Vec<Resolver>,
    no_tsconfig: Resolver,
    workspaces: Vec<Workspace>, // longest name first
}

fn base_options() -> ResolveOptions {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    ResolveOptions {
        extensions: s(&[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"]),
        extension_alias: vec![
            (".js".into(), s(&[".ts", ".tsx", ".js"])),
            (".jsx".into(), s(&[".tsx", ".jsx"])),
            (".mjs".into(), s(&[".mts", ".mjs"])),
            (".cjs".into(), s(&[".cts", ".cjs"])),
        ],
        main_files: s(&["index"]),
        // Only repo files matter; node_modules lookups would cost syscalls and always land outside.
        modules: Vec::new(),
        symlinks: false,
        node_path: false,
        builtin_modules: false,
        tsconfig: None,
        ..ResolveOptions::default()
    }
}

fn strip_ts_ext(p: &str) -> &str {
    for e in [".tsx", ".ts", ".mts", ".cts"] {
        if let Some(s) = p.strip_suffix(e) {
            return s;
        }
    }
    p
}

fn strip_runtime_ext(p: &str) -> &str {
    for e in [".js", ".jsx", ".mjs", ".cjs"] {
        if let Some(s) = p.strip_suffix(e) {
            return s;
        }
    }
    p
}

fn join_rel(dir: &str, rest: &str) -> String {
    if dir.is_empty() { rest.to_string() } else { format!("{dir}/{rest}") }
}

impl Resolution {
    /// `files` is the sorted repo-relative TS file list (index = file id); `tracked` is the full
    /// `git ls-files` list, used to find tsconfig.json and package.json files.
    pub fn new(root: &Path, files: &[String], tracked: &[String]) -> Self {
        let mut ids = HashMap::with_capacity(files.len());
        let mut lookup = HashMap::with_capacity(files.len() * 2);
        for (i, f) in files.iter().enumerate() {
            let id = i as u32;
            ids.insert(f.clone(), id);
            lookup.insert(f.clone(), id);
            let stem = strip_ts_ext(f);
            lookup.insert(stem.to_string(), id);
            if let Some(dir) = stem.strip_suffix("/index") {
                lookup.insert(dir.to_string(), id);
            } else if stem == "index" {
                lookup.insert(String::new(), id);
            }
        }

        let base = Resolver::new(base_options());
        let mut tsconfig_dirs = HashMap::new();
        let mut resolvers = Vec::new();
        let mut workspaces = Vec::new();
        for t in tracked {
            let (dir, name) = match t.rfind('/') {
                Some(i) => (&t[..i], &t[i + 1..]),
                None => ("", t.as_str()),
            };
            let skip = dir.split('/').any(|s| matches!(s, "node_modules" | "dist" | "build" | "coverage"));
            if name == "tsconfig.json" {
                let mut opts = base_options();
                opts.tsconfig = Some(TsconfigDiscovery::Manual(TsconfigOptions {
                    config_file: root.join(t),
                    references: TsconfigReferences::Disabled,
                }));
                tsconfig_dirs.insert(dir.to_string(), resolvers.len());
                resolvers.push(Resolver::new(opts));
            } else if name == "package.json" && !skip {
                if let Ok(bytes) = std::fs::read(root.join(t)) {
                    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                        if let Some(n) = v.get("name").and_then(|n| n.as_str()) {
                            if !n.is_empty() {
                                workspaces.push(Workspace { name: n.to_string(), dir: dir.to_string() });
                            }
                        }
                    }
                }
            }
        }
        workspaces.sort_by(|a, b| b.name.len().cmp(&a.name.len()).then(a.dir.cmp(&b.dir)));
        Resolution { root: root.to_path_buf(), ids, lookup, tsconfig_dirs, resolvers, no_tsconfig: base, workspaces }
    }

    fn nearest(&self, src_rel: &str) -> &Resolver {
        let mut dir = match src_rel.rfind('/') {
            Some(i) => &src_rel[..i],
            None => "",
        };
        loop {
            if let Some(&i) = self.tsconfig_dirs.get(dir) {
                return &self.resolvers[i];
            }
            if dir.is_empty() {
                return &self.no_tsconfig;
            }
            dir = match dir.rfind('/') {
                Some(i) => &dir[..i],
                None => "",
            };
        }
    }

    fn id_of_abs(&self, p: &Path) -> Option<u32> {
        let rel = p.strip_prefix(&self.root).ok()?.to_str()?;
        self.ids.get(rel).copied()
    }

    fn lookup_path(&self, cand: &str) -> Option<u32> {
        self.lookup.get(cand).or_else(|| self.lookup.get(strip_runtime_ext(cand))).copied()
    }

    fn workspace(&self, spec: &str) -> Option<u32> {
        let ws = self.workspaces.iter().find(|w| {
            spec == w.name || (spec.starts_with(w.name.as_str()) && spec.as_bytes().get(w.name.len()) == Some(&b'/'))
        })?;
        let sub = if spec == ws.name { "" } else { &spec[ws.name.len() + 1..] };
        let cands = if sub.is_empty() {
            [join_rel(&ws.dir, "src/index"), join_rel(&ws.dir, "index")]
        } else {
            [join_rel(&ws.dir, &format!("src/{sub}")), join_rel(&ws.dir, sub)]
        };
        cands.iter().find_map(|c| self.lookup_path(c))
    }

    pub fn resolve(&self, src_rel: &str, spec: &str) -> Resolved {
        // Bundler query suffixes (`./x?worker`, `./x?modulePath`) name an asset or URL, not a
        // module dependency; old Pulsar never resolved them either.
        if spec.contains('?') {
            return Resolved::Unresolved(U_OTHER);
        }
        let resolver = self.nearest(src_rel);
        let src_dir = match src_rel.rfind('/') {
            Some(i) => self.root.join(&src_rel[..i]),
            None => self.root.clone(),
        };
        if spec.starts_with('.') || spec.starts_with('/') {
            return match resolver.resolve(&src_dir, spec) {
                Ok(r) => match self.id_of_abs(r.path()) {
                    Some(id) => Resolved::File(id),
                    None => Resolved::Unresolved(U_RELATIVE),
                },
                Err(_) => Resolved::Unresolved(U_RELATIVE),
            };
        }
        // Non-relative: tsconfig paths/baseUrl first (node_modules disabled), then workspace names.
        if let Ok(r) = resolver.resolve(&src_dir, spec) {
            if let Some(id) = self.id_of_abs(r.path()) {
                return Resolved::File(id);
            }
        }
        if let Some(id) = self.workspace(spec) {
            return Resolved::File(id);
        }
        Resolved::Unresolved(classify_unresolved(spec))
    }
}

fn classify_unresolved(spec: &str) -> u8 {
    if spec.is_empty() {
        return U_OTHER;
    }
    if spec.starts_with("@/") || spec.starts_with("~/") || spec.starts_with('#') || spec.starts_with('$') {
        return U_ALIAS;
    }
    if let Some(i) = spec.find(':') {
        let proto = &spec[..i];
        if !matches!(proto, "node" | "bun" | "npm") {
            return U_OTHER;
        }
    }
    U_BARE
}
