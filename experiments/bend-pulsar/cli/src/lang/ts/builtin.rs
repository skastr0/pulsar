//! The catalogs the TS lane applies today: the three that ship with the binary, selected by
//! evidence. Until `.pulsar/` policy supplies the set, a pack is on when a `package.json` in the
//! repo lists a dependency its `activate` names, or a tracked file has a `file:` name it lists;
//! `import:` evidence is not read yet, so a pack that only activates by import stays off.

use super::calls::CatalogIndex;
use crate::catalog::{self, Catalog, Scope};
use std::collections::BTreeSet;
use std::path::Path;

const SHIPPED: [(&str, &str); 4] = [
    ("js-globals", include_str!("../../packs/effect/catalog/js-globals.toml")),
    ("cloudflare-workers", include_str!("../../packs/cloudflare/catalog/cloudflare-workers.toml")),
    ("effect", include_str!("../../packs/effect/catalog/effect.toml")),
    ("platform-node", include_str!("../../packs/effect/catalog/platform-node.toml")),
];

/// What a tree shows about itself: dependency names from every tracked `package.json`, and the
/// base names of tracked files (`wrangler.toml`).
struct Evidence {
    deps: BTreeSet<String>,
    files: BTreeSet<String>,
}

fn gather(root: &Path, tracked: &[String]) -> Evidence {
    let files = tracked.iter().map(|p| p.rsplit('/').next().unwrap_or(p).to_string()).collect();
    Evidence { deps: dependency_names(root, tracked), files }
}

/// Dependency names listed by any tracked `package.json`.
fn dependency_names(root: &Path, tracked: &[String]) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for rel in tracked.iter().filter(|p| *p == "package.json" || p.ends_with("/package.json")) {
        let Ok(text) = std::fs::read_to_string(root.join(rel)) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        for key in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
            if let Some(obj) = json.get(key).and_then(|v| v.as_object()) {
                names.extend(obj.keys().cloned());
            }
        }
    }
    names
}

fn dep_matches(pattern: &str, deps: &BTreeSet<String>) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => deps.range(prefix.to_string()..).next().is_some_and(|d| d.starts_with(prefix)),
        None => deps.contains(pattern),
    }
}

fn is_active(c: &Catalog, ev: &Evidence) -> bool {
    match c.scope {
        Scope::Lane | Scope::Repo => true,
        Scope::Pack => c.activate.iter().flatten().any(|a| {
            match (a.strip_prefix("dep:"), a.strip_prefix("file:")) {
                (Some(p), _) => dep_matches(p, &ev.deps),
                (_, Some(f)) => ev.files.contains(f),
                _ => false,
            }
        }),
    }
}

/// The index for a repo, and the ids of the catalogs that are on (for the stats line).
pub fn index_for(root: &Path, tracked: &[String]) -> Result<(CatalogIndex, Vec<String>), String> {
    let ev = gather(root, tracked);
    let mut loaded = Vec::new();
    for (name, text) in SHIPPED {
        let l = catalog::load(name, text)?;
        if is_active(&l.catalog, &ev) {
            loaded.push(l);
        }
    }
    let refs: Vec<&Catalog> = loaded.iter().map(|l| &l.catalog).collect();
    let ids = loaded.iter().map(|l| l.catalog.id.clone()).collect();
    Ok((CatalogIndex::from_catalogs(&refs), ids))
}

/// Every shipped catalog, whatever the evidence: for tests.
#[cfg(test)]
pub fn all_index() -> CatalogIndex {
    let loaded: Vec<_> = SHIPPED.iter().map(|(n, t)| catalog::load(n, t).unwrap()).collect();
    let refs: Vec<&Catalog> = loaded.iter().map(|l| &l.catalog).collect();
    CatalogIndex::from_catalogs(&refs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pack_is_on_only_when_a_listed_dependency_is_present() {
        let deps: BTreeSet<String> = ["effect".to_string(), "@effect/sql-pg".to_string()].into();
        assert!(dep_matches("effect", &deps));
        assert!(dep_matches("@effect/sql*", &deps));
        assert!(!dep_matches("@types/node", &deps));
    }

    #[test]
    fn the_shipped_catalogs_parse() {
        for (name, text) in SHIPPED {
            catalog::load(name, text).unwrap();
        }
    }
}
