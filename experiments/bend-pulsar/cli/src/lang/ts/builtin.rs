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

/// The repo's own catalogs, `.pulsar/catalogs/*.toml`, always on and strict like the policy's
/// loader: a catalog that does not parse, or is not scope \"repo\", is an error.
fn repo_catalogs(root: &Path) -> Result<Vec<catalog::Loaded>, String> {
    let Ok(rd) = std::fs::read_dir(root.join(".pulsar/catalogs")) else { return Ok(Vec::new()) };
    let mut paths: Vec<_> =
        rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "toml")).collect();
    paths.sort();
    let mut out = Vec::new();
    for p in paths {
        let name = p.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        let l = catalog::load(&format!(".pulsar/catalogs/{name}"), &text)?;
        if l.catalog.scope != Scope::Repo {
            return Err(format!(".pulsar/catalogs/{name}: repo catalogs use scope \"repo\""));
        }
        out.push(l);
    }
    Ok(out)
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
    loaded.extend(repo_catalogs(root)?);
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
    fn a_repo_catalog_reaches_the_index_and_must_be_scope_repo() {
        let dir = std::env::temp_dir().join(format!("pulsar-repo-cat-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".pulsar/catalogs")).unwrap();
        let cat = "format = \"pulsar-catalog 0\"\nid = \"shard\"\nscope = \"repo\"\nsources = [\"x\"]\nclasses = [\n  { class = \"partition\", id = 1000, rule = \"shard/partition\" },\n]\nsymbols = [\n  { sym = \"shard-lib#pick\", class = \"partition\", ver = \"1\", at = \"x:1\", doc = \"d\" },\n]\n";
        std::fs::write(dir.join(".pulsar/catalogs/shard.toml"), cat).unwrap();
        let (ix, ids) = index_for(&dir, &[]).unwrap();
        assert_eq!(ix.classes("shard-lib#pick"), vec![1000]);
        assert!(ids.contains(&"shard".to_string()));
        std::fs::write(dir.join(".pulsar/catalogs/shard.toml"), cat.replace("scope = \"repo\"", "scope = \"lane\"")).unwrap();
        assert!(index_for(&dir, &[]).unwrap_err().contains("scope \"repo\""));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_shipped_catalogs_parse() {
        for (name, text) in SHIPPED {
            catalog::load(name, text).unwrap();
        }
    }
}
