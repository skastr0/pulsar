//! `pulsar version`: which CLI, which engine, which Bend, and every rule with its version, so a
//! reader of a finding can say exactly what produced it.

use crate::{catalog, engine, finding, layers};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Every rule id this CLI can report, with its version, sorted: the built-in rules, the Effect layer
/// rules and the rules of the shipped catalogs.
pub fn rules() -> Vec<(String, u32)> {
    let mut out: Vec<(String, u32)> = [
        finding::IMPORT_CYCLE,
        finding::CYCLOMATIC,
        finding::NESTING,
        finding::NPATH,
        finding::LENGTH,
        finding::CRAP,
        finding::HOTSPOT,
        finding::RISKY_CHANGE,
        finding::COGNITIVE,
        finding::UNTESTED,
        layers::LAYER_CYCLE,
        layers::UNPROVIDED,
        layers::DUPLICATE,
        layers::HUB,
    ]
    .iter()
    .map(|r| (r.id.to_string(), r.version))
    .collect();
    out.extend(finding::SQL_RULES.iter().map(|r| (r.id.to_string(), r.version)));
    for (id, text) in catalog::EMBEDDED {
        if let Ok(l) = catalog::load(id, text) {
            out.extend(l.catalog.rules.iter().map(|r| (r.id.clone(), r.ver.parse().unwrap_or(1))));
            let c = &l.catalog;
            out.extend(c.fanouts.iter().map(|r| (r.id.clone(), r.ver.parse().unwrap_or(1))));
            out.extend(c.konsts.iter().map(|r| (r.id.clone(), r.ver.parse().unwrap_or(1))));
            out.extend(c.hots.iter().map(|r| (r.id.clone(), r.ver.parse().unwrap_or(1))));
            out.extend(c.growths.iter().map(|r| (r.id.clone(), r.ver.parse().unwrap_or(1))));
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The `bend` and `c` lines of the MANIFEST that `packaging/build-engine.sh` writes beside the
/// engine, when it was installed next to the binary.
fn manifest(engine_path: &Path) -> (Option<String>, Option<String>) {
    let text = engine_path.parent().and_then(|d| std::fs::read_to_string(d.join("MANIFEST")).ok()).unwrap_or_default();
    let line = |tag: &str| text.lines().find_map(|l| l.strip_prefix(tag)).map(|v| v.trim().to_string());
    (line("bend "), line("c "))
}

pub fn render(sha: &str, engine_path: Result<&Path, &str>, rules: &[(String, u32)]) -> String {
    let mut out = format!("pulsar {} (cli {sha})\nfacts: pulsar-facts 0\n", env!("CARGO_PKG_VERSION"));
    match engine_path {
        Ok(p) => {
            let digest = std::fs::read(p).map(|b| Sha256::digest(&b).iter().map(|x| format!("{x:02x}")).collect::<String>());
            out.push_str(&format!("engine: {} sha256:{}\n", p.display(), digest.as_deref().map_or("unreadable", |d| &d[..16])));
            let (bend, c) = manifest(p);
            out.push_str(&format!("bend: {}\n", bend.as_deref().unwrap_or("unknown (no MANIFEST beside the engine)")));
            if let Some(c) = c {
                out.push_str(&format!("engine source: {c}\n"));
            }
        }
        Err(why) => out.push_str(&format!("engine: not found ({why})\nbend: unknown\n")),
    }
    out.push_str("rules:\n");
    for (id, v) in rules {
        out.push_str(&format!("  {id} v{v}\n"));
    }
    out
}

pub fn run() -> Result<(), String> {
    let located = engine::locate();
    let engine_path = located.as_deref().map_err(String::as_str);
    print!("{}", render(env!("PULSAR_GIT_SHA"), engine_path, &rules()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_every_rule_with_its_version_and_no_duplicates() {
        let r = rules();
        let ids: Vec<&str> = r.iter().map(|x| x.0.as_str()).collect();
        for want in ["graph.import-cycle", "core.cyclomatic", "core.cognitive", "effect.unprovided-service", "effect.ambient-read-in-effect"] {
            assert!(ids.contains(&want), "{want} missing from {ids:?}");
        }
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted, ids, "sorted and unique");
    }

    #[test]
    fn prints_sha_engine_hash_and_the_bend_version_from_the_manifest() {
        let dir = std::env::temp_dir().join(format!("pulsar-version-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("pulsar-engine"), b"engine bytes").unwrap();
        std::fs::write(dir.join("MANIFEST"), "bend 2.0.40\nc abc123 99 pulsar-engine.c\n").unwrap();
        let text = render("deadbeef0123", Ok(&dir.join("pulsar-engine")), &[("core.length".into(), 1)]);
        std::fs::remove_dir_all(&dir).ok();
        assert!(text.contains("(cli deadbeef0123)") && text.contains("bend: 2.0.40"), "{text}");
        assert!(text.contains("engine source: abc123 99 pulsar-engine.c") && text.contains("sha256:"), "{text}");
        assert!(text.contains("  core.length v1"));
        let none = render("x", Err("not installed"), &[]);
        assert!(none.contains("engine: not found (not installed)") && none.contains("bend: unknown"));
    }
}
