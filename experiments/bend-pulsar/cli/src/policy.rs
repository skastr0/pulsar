//! Repository policy: `.pulsar/` in the repo, an org fallback in `~/.pulsar/policy.toml`, and a
//! canonical fingerprint of everything that can change a finding.
//!
//! Every file is TOML, strict, sorted, one item per line, so a diff is reviewable. Precedence:
//! the repo's own `.pulsar/policy.toml` always wins; `~/.pulsar/policy.toml` is used only when
//! the repo has none, and the output says so. There is no per-user or per-agent policy.
//!
//! Files (all optional):
//!   `.pulsar/policy.toml`      history window, rules enabled or disabled
//!   `.pulsar/decisions.toml`   findings accepted with a reason
//!   `.pulsar/catalogs/*.toml`  repo catalogs (see `pulsar catalog --help`)

use crate::catalog::{self, sha256_hex, Loaded, Scope};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

pub const POLICY_FORMAT: &str = "pulsar-policy 0";
pub const DECISIONS_FORMAT: &str = "pulsar-decisions 0";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct History {
    pub since_days: u32,
    pub max_commits: u32,
}

impl Default for History {
    fn default() -> Self {
        History { since_days: 365, max_commits: 2000 }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rules {
    #[serde(default)]
    pub enable: Vec<String>,
    #[serde(default)]
    pub disable: Vec<String>,
}

/// Which files of one language lane the repo wants checked: repo-relative path prefixes. A prefix
/// ending in `/` matches a directory, anything else matches that exact file. Empty `include`
/// means the whole repo.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaneScope {
    #[serde(default)]
    pub include: Vec<String>,
    #[serde(default)]
    pub exclude: Vec<String>,
    /// Paths that are production code whatever the lane's default rule says.
    #[serde(default)]
    pub prod: Vec<String>,
    /// Paths that are test or support code whatever the lane's default rule says (wins over `prod`).
    #[serde(default)]
    pub test: Vec<String>,
}

fn under(prefix: &str, path: &str) -> bool {
    if prefix.ends_with('/') { path.starts_with(prefix) } else { path == prefix }
}

impl LaneScope {
    pub fn allows(&self, path: &str) -> bool {
        (self.include.is_empty() || self.include.iter().any(|p| under(p, path)))
            && !self.exclude.iter().any(|p| under(p, path))
    }
}

/// Per-lane scopes (`[lanes.ts]`, `[lanes.rust]`, `[lanes.bend]`). A lane with no table is unrestricted.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Lanes {
    #[serde(default)]
    pub ts: LaneScope,
    #[serde(default)]
    pub rust: LaneScope,
    #[serde(default)]
    pub bend: LaneScope,
}

impl Lanes {
    /// Is `rel` production code? Policy `test` prefixes win, then `prod` prefixes, then what the
    /// lane's analysis decided (`lane`: for example a Rust file only reachable through
    /// `#[cfg(test)] mod`, or a Bend file no `main` reaches), then the path rule of the lane's
    /// language (each language decides what is test or support code).
    pub fn is_prod(&self, rel: &str, lane: Option<bool>) -> bool {
        let rust = rel.ends_with(".rs");
        let bend = rel.ends_with(".bend");
        let scope = if rust { &self.rust } else if bend { &self.bend } else { &self.ts };
        if scope.test.iter().any(|p| under(p, rel)) {
            return false;
        }
        if scope.prod.iter().any(|p| under(p, rel)) {
            return true;
        }
        if let Some(found) = lane {
            return found;
        }
        if rust {
            crate::lang::rust::is_prod(rel)
        } else if bend {
            false
        } else {
            crate::lang::scope::is_prod(rel)
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPolicy {
    format: Option<String>,
    history: Option<History>,
    rules: Option<Rules>,
    lanes: Option<Lanes>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Policy {
    pub history: History,
    pub rules: Rules,
    pub lanes: Lanes,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {
    pub key: String,
    pub rule: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawDecisions {
    format: String,
    #[serde(default)]
    allow: Vec<Decision>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Repo,
    Org,
    Default,
}

/// Evidence that switches packs on. `imports` stays empty until the TS lane reports bare
/// specifiers, so `import:` activators never match yet (listed by `pulsar catalog list`).
#[derive(Debug, Default, Clone)]
pub struct Evidence {
    pub deps: BTreeSet<String>,
    pub imports: BTreeSet<String>,
    /// Base names of tracked files (`wrangler.toml`), for `file:` activators.
    pub files: BTreeSet<String>,
}

/// One input to the fingerprint: what it is, its name, and the SHA-256 of its content.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Part {
    pub kind: String,
    pub name: String,
    pub sha256: String,
}

#[derive(Debug, Clone)]
pub struct ActiveCatalog {
    pub loaded: Loaded,
    pub scope: Scope,
    /// Why it is on: "lane", "repo", or the activator that matched.
    pub why: String,
}

#[derive(Debug)]
pub struct Effective {
    pub policy: Policy,
    pub source: Source,
    pub decisions: Vec<Decision>,
    pub catalogs: Vec<ActiveCatalog>,
    pub parts: Vec<Part>,
    /// Hex SHA-256 over the sorted parts.
    pub fingerprint: String,
}

impl Effective {
    /// One line for stderr, printed with every run.
    pub fn summary(&self) -> String {
        let src = match self.source {
            Source::Repo => "repo .pulsar/policy.toml",
            Source::Org => "ORG FALLBACK ~/.pulsar/policy.toml (repo has no policy)",
            Source::Default => "built-in defaults (no .pulsar/policy.toml)",
        };
        let cats: Vec<String> = self
            .catalogs
            .iter()
            .map(|c| format!("{}[{}]", c.loaded.catalog.id, c.why))
            .collect();
        format!(
            "policy sha256:{} source={} catalogs={} decisions={} rules=+{}/-{}",
            &self.fingerprint[..16],
            src,
            if cats.is_empty() { "none".into() } else { cats.join(",") },
            self.decisions.len(),
            self.policy.rules.enable.len(),
            self.policy.rules.disable.len()
        )
    }

    /// The decision that allows a finding key, if any.
    pub fn allowed(&self, key_hex: &str) -> Option<&Decision> {
        self.decisions.iter().find(|d| d.key == key_hex)
    }
}

fn read(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(catalog::normalise(&s))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Reject `a = ["x", "y"]` on one line: every array item gets its own line.
fn one_item_per_line(name: &str, text: &str) -> Result<(), String> {
    for (i, l) in text.lines().enumerate() {
        let t = l.trim();
        if t.starts_with('#') {
            continue;
        }
        if t.contains("\", \"") {
            return Err(format!("{name}:{}: one array item per line, sorted", i + 1));
        }
    }
    Ok(())
}

fn sorted_unique(name: &str, what: &str, items: &[String]) -> Result<(), String> {
    for w in items.windows(2) {
        if w[0] == w[1] {
            return Err(format!("{name}: {what} lists {:?} twice", w[0]));
        }
        if w[0] > w[1] {
            return Err(format!("{name}: {what}: {:?} must come before {:?}", w[1], w[0]));
        }
    }
    Ok(())
}

pub fn parse_policy(name: &str, text: &str) -> Result<Policy, String> {
    let raw: RawPolicy = toml::from_str(text).map_err(|e| format!("{name}: {e}"))?;
    if raw.format.as_deref() != Some(POLICY_FORMAT) {
        return Err(format!("{name}: format must be {POLICY_FORMAT:?}"));
    }
    one_item_per_line(name, text)?;
    let p = Policy {
        history: raw.history.unwrap_or_default(),
        rules: raw.rules.unwrap_or_default(),
        lanes: raw.lanes.unwrap_or_default(),
    };
    for (lane, scope) in [("ts", &p.lanes.ts), ("rust", &p.lanes.rust), ("bend", &p.lanes.bend)] {
        for (what, items) in
            [("include", &scope.include), ("exclude", &scope.exclude), ("prod", &scope.prod), ("test", &scope.test)]
        {
            sorted_unique(name, &format!("lanes.{lane}.{what}"), items)?;
            if let Some(bad) = items.iter().find(|i| i.is_empty() || i.starts_with('/') || i.starts_with("./") || i.split('/').any(|c| c == "..")) {
                return Err(format!("{name}: lanes.{lane}.{what} {bad:?} must be a repo-relative path prefix"));
            }
        }
    }
    sorted_unique(name, "rules.enable", &p.rules.enable)?;
    sorted_unique(name, "rules.disable", &p.rules.disable)?;
    if let Some(r) = p.rules.enable.iter().find(|r| p.rules.disable.contains(r)) {
        return Err(format!("{name}: rule {r:?} is both enabled and disabled"));
    }
    if p.history.since_days == 0 || p.history.max_commits == 0 {
        return Err(format!("{name}: history.since_days and history.max_commits must be positive"));
    }
    Ok(p)
}

pub fn parse_decisions(name: &str, text: &str) -> Result<Vec<Decision>, String> {
    let raw: RawDecisions = toml::from_str(text).map_err(|e| format!("{name}: {e}"))?;
    if raw.format != DECISIONS_FORMAT {
        return Err(format!("{name}: format must be {DECISIONS_FORMAT:?}"));
    }
    let starts = text.lines().filter(|l| l.trim_start().starts_with("{ ")).count();
    if starts != raw.allow.len() {
        return Err(format!("{name}: one decision per line"));
    }
    let keys: Vec<String> = raw.allow.iter().map(|d| d.key.clone()).collect();
    sorted_unique(name, "allow", &keys)?;
    for d in &raw.allow {
        if d.key.len() != 16 || !d.key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
            return Err(format!("{name}: key {:?} must be 16 lowercase hex digits (a finding key)", d.key));
        }
        if d.reason.trim().is_empty() {
            return Err(format!("{name}: decision {} needs a reason", d.key));
        }
    }
    Ok(raw.allow)
}

/// Does `pattern` (with `*` matching any run of characters) match `s`?
pub fn glob(pattern: &str, s: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == s;
    }
    let mut rest = s;
    for (i, part) in parts.iter().enumerate() {
        if i == 0 {
            match rest.strip_prefix(part) {
                Some(r) => rest = r,
                None => return false,
            }
        } else if i == parts.len() - 1 {
            return rest.ends_with(part);
        } else {
            match rest.find(part) {
                Some(p) => rest = &rest[p + part.len()..],
                None => return false,
            }
        }
    }
    true
}

/// The activator that switches `c` on for this evidence, if any.
fn matches(activate: &[String], ev: &Evidence) -> Option<String> {
    for a in activate {
        if let Some(dep) = a.strip_prefix("dep:") {
            if ev.deps.contains(dep) {
                return Some(a.clone());
            }
        } else if let Some(pat) = a.strip_prefix("import:") {
            if ev.imports.iter().any(|i| glob(pat, i)) {
                return Some(a.clone());
            }
        } else if let Some(name) = a.strip_prefix("file:") {
            if ev.files.contains(name) {
                return Some(a.clone());
            }
        }
    }
    None
}

/// Load the effective policy for the tree at `root`. `home` is the user's home directory (for
/// the org fallback); pass `None` to ignore it.
pub fn load(root: &Path, home: Option<&Path>, ev: &Evidence) -> Result<Effective, String> {
    let dir = root.join(".pulsar");
    let repo_policy = dir.join("policy.toml");
    let mut parts = Vec::new();

    let (policy, source) = if let Some(text) = read(&repo_policy)? {
        let p = parse_policy(".pulsar/policy.toml", &text)?;
        parts.push(Part { kind: "policy".into(), name: "repo".into(), sha256: sha256_hex(text.as_bytes()) });
        (p, Source::Repo)
    } else if let Some(text) = home.and_then(|h| read(&h.join(".pulsar/policy.toml")).transpose()).transpose()? {
        let p = parse_policy("~/.pulsar/policy.toml", &text)?;
        parts.push(Part { kind: "policy".into(), name: "org".into(), sha256: sha256_hex(text.as_bytes()) });
        (p, Source::Org)
    } else {
        parts.push(Part { kind: "policy".into(), name: "default".into(), sha256: sha256_hex(b"") });
        (Policy::default(), Source::Default)
    };

    let decisions = match read(&dir.join("decisions.toml"))? {
        Some(text) => {
            parts.push(Part { kind: "decisions".into(), name: "repo".into(), sha256: sha256_hex(text.as_bytes()) });
            parse_decisions(".pulsar/decisions.toml", &text)?
        }
        None => Vec::new(),
    };

    let mut catalogs = Vec::new();
    for (id, text) in catalog::EMBEDDED {
        let loaded = catalog::load(id, text)?;
        let scope = loaded.catalog.scope;
        let why = match scope {
            Scope::Lane => Some("lane".to_string()),
            Scope::Pack => matches(loaded.catalog.activate.as_deref().unwrap_or(&[]), ev),
            Scope::Repo => unreachable!("embedded catalogs are lane or pack"),
        };
        if let Some(why) = why {
            parts.push(Part {
                kind: format!("catalog:{}", if scope == Scope::Lane { "lane" } else { "pack" }),
                name: (*id).to_string(),
                sha256: loaded.sha256.clone(),
            });
            catalogs.push(ActiveCatalog { loaded, scope, why });
        }
    }
    let mut repo_cats: Vec<PathBuf> = match std::fs::read_dir(dir.join("catalogs")) {
        Ok(rd) => rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "toml"))
            .collect(),
        Err(_) => Vec::new(),
    };
    repo_cats.sort();
    for p in repo_cats {
        let name = p.file_name().unwrap().to_string_lossy().into_owned();
        let text = read(&p)?.ok_or_else(|| format!("{}: vanished", p.display()))?;
        let loaded = catalog::load(&format!(".pulsar/catalogs/{name}"), &text)?;
        if loaded.catalog.scope != Scope::Repo {
            return Err(format!(".pulsar/catalogs/{name}: repo catalogs use scope \"repo\""));
        }
        parts.push(Part { kind: "catalog:repo".into(), name: loaded.catalog.id.clone(), sha256: loaded.sha256.clone() });
        catalogs.push(ActiveCatalog { loaded, scope: Scope::Repo, why: "repo".into() });
    }

    // A rule named in policy.toml must exist in an active catalog, or the policy is wrong.
    let known: BTreeSet<&str> = catalogs.iter().flat_map(|c| c.loaded.catalog.rules.iter().map(|r| r.id.as_str())).collect();
    for r in policy.rules.enable.iter().chain(&policy.rules.disable) {
        if !known.contains(r.as_str()) && !crate::finding::is_builtin_rule(r) {
            return Err(format!("policy names rule {r:?}, which no active catalog or built-in rule defines"));
        }
    }

    parts.sort();
    let mut h = Sha256::new();
    for p in &parts {
        h.update(format!("{}\t{}\t{}\n", p.kind, p.name, p.sha256).as_bytes());
    }
    let fingerprint = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    Ok(Effective { policy, source, decisions, catalogs, parts, fingerprint })
}

/// Collect `dep:` evidence from every tracked `package.json`.
pub fn gather_evidence(root: &Path, tracked: &[String]) -> Evidence {
    let mut ev = Evidence::default();
    ev.files = tracked.iter().map(|p| p.rsplit('/').next().unwrap_or(p).to_string()).collect();
    for p in tracked.iter().filter(|p| p == &"package.json" || p.ends_with("/package.json")) {
        let Ok(text) = std::fs::read_to_string(root.join(p)) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        for section in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
            if let Some(o) = v.get(section).and_then(|s| s.as_object()) {
                ev.deps.extend(o.keys().cloned());
            }
        }
    }
    ev
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("pulsar-policy-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }
    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    const POLICY: &str = "format = \"pulsar-policy 0\"\n[history]\nsince_days = 30\nmax_commits = 50\n";

    #[test]
    fn repo_policy_wins_and_org_is_a_fallback_only() {
        let (repo, home) = (tmp("a-repo"), tmp("a-home"));
        write(&home, ".pulsar/policy.toml", "format = \"pulsar-policy 0\"\n[history]\nsince_days = 7\nmax_commits = 9\n");
        let org = load(&repo, Some(&home), &Evidence::default()).unwrap();
        assert_eq!(org.source, Source::Org);
        assert_eq!(org.policy.history.since_days, 7);
        assert!(org.summary().contains("ORG FALLBACK"));
        write(&repo, ".pulsar/policy.toml", POLICY);
        let r = load(&repo, Some(&home), &Evidence::default()).unwrap();
        assert_eq!(r.source, Source::Repo);
        assert_eq!(r.policy.history.since_days, 30);
        assert_ne!(r.fingerprint, org.fingerprint);
        let none = load(&tmp("a-none"), None, &Evidence::default()).unwrap();
        assert_eq!(none.source, Source::Default);
        assert_eq!(none.policy.history, History::default());
    }

    #[test]
    fn fingerprint_is_stable_and_moves_with_every_input() {
        let repo = tmp("b");
        write(&repo, ".pulsar/policy.toml", POLICY);
        let base = load(&repo, None, &Evidence::default()).unwrap().fingerprint;
        assert_eq!(base, load(&repo, None, &Evidence::default()).unwrap().fingerprint);
        // policy edit
        write(&repo, ".pulsar/policy.toml", &POLICY.replace("30", "31"));
        let p2 = load(&repo, None, &Evidence::default()).unwrap().fingerprint;
        assert_ne!(base, p2);
        // decision
        write(&repo, ".pulsar/decisions.toml",
            "format = \"pulsar-decisions 0\"\nallow = [\n  { key = \"78c5bd807667298b\", rule = \"graph.import-cycle\", reason = \"legacy\" },\n]\n");
        let p3 = load(&repo, None, &Evidence::default()).unwrap().fingerprint;
        assert_ne!(p2, p3);
        // pack evidence turns the effect catalog on
        let mut ev = Evidence::default();
        ev.deps.insert("effect".into());
        let with = load(&repo, None, &ev).unwrap();
        assert_ne!(p3, with.fingerprint);
        assert!(with.catalogs.iter().any(|c| c.loaded.catalog.id == "effect" && c.why == "dep:effect"));
        // repo catalog
        write(&repo, ".pulsar/catalogs/db.toml",
            "format = \"pulsar-catalog 0\"\nid = \"db\"\nscope = \"repo\"\nsources = [\"x\"]\nclasses = [\n  { class = \"query\", id = 1, rule = \"db/query\" },\n]\n");
        assert_ne!(with.fingerprint, load(&repo, None, &ev).unwrap().fingerprint);
    }

    #[test]
    fn the_lane_catalog_is_always_on_and_packs_need_evidence() {
        let e = load(&tmp("c"), None, &Evidence::default()).unwrap();
        let ids: Vec<&str> = e.catalogs.iter().map(|c| c.loaded.catalog.id.as_str()).collect();
        assert_eq!(ids, ["js-globals"]);
    }

    #[test]
    fn a_file_activator_switches_a_pack_on_by_a_tracked_base_name() {
        let ev = gather_evidence(&tmp("f"), &["apps/api/wrangler.jsonc".to_string(), "src/a.ts".to_string()]);
        let e = load(&tmp("g"), None, &ev).unwrap();
        let on = e.catalogs.iter().find(|c| c.loaded.catalog.id == "cloudflare-workers").expect("pack on");
        assert_eq!(on.why, "file:wrangler.jsonc");
        let off = load(&tmp("h"), None, &gather_evidence(&tmp("i"), &["src/a.ts".to_string()])).unwrap();
        assert!(off.catalogs.iter().all(|c| c.loaded.catalog.id != "cloudflare-workers"));
    }

    #[test]
    fn strict_parsing_and_canonical_form() {
        let bad = |t: &str| parse_policy("p", t).unwrap_err();
        assert!(bad("format = \"pulsar-policy 0\"\nbogus = 1\n").contains("bogus"));
        assert!(bad("format = \"pulsar-policy 1\"\n").contains("format"));
        assert!(bad("format = \"pulsar-policy 0\"\n[rules]\nenable = [\"b\", \"a\"]\n").contains("one array item per line"));
        assert!(bad("format = \"pulsar-policy 0\"\n[rules]\nenable = [\n  \"b\",\n  \"a\",\n]\n").contains("must come before"));
        assert!(bad("format = \"pulsar-policy 0\"\n[rules]\nenable = [\n  \"a\",\n]\ndisable = [\n  \"a\",\n]\n").contains("both"));
        assert!(bad("format = \"pulsar-policy 0\"\n[history]\nsince_days = 0\nmax_commits = 1\n").contains("positive"));
        let d = |t: &str| parse_decisions("d", t).unwrap_err();
        assert!(d("format = \"pulsar-decisions 0\"\nallow = [\n  { key = \"zz\", rule = \"r\", reason = \"x\" },\n]\n").contains("16 lowercase hex"));
        assert!(d("format = \"pulsar-decisions 0\"\nallow = [\n  { key = \"78c5bd807667298b\", rule = \"r\", reason = \" \" },\n]\n").contains("reason"));
    }

    #[test]
    fn a_policy_rule_that_nothing_defines_is_an_error() {
        let repo = tmp("d");
        write(&repo, ".pulsar/policy.toml", "format = \"pulsar-policy 0\"\n[rules]\nenable = [\n  \"nope/missing\",\n]\n");
        assert!(load(&repo, None, &Evidence::default()).unwrap_err().contains("nope/missing"));
    }

    #[test]
    fn lane_scopes_parse_and_filter() {
        let t = "format = \"pulsar-policy 0\"\n[lanes.rust]\ninclude = [\n  \"cli/\",\n]\n[lanes.ts]\ninclude = [\n  \"scripts/\",\n  \"tools/run.ts\",\n]\nexclude = [\n  \"scripts/fixtures/\",\n]\n";
        let p = parse_policy("p", t).unwrap();
        assert!(p.lanes.rust.allows("cli/src/main.rs") && !p.lanes.rust.allows("engine/x.rs"));
        assert!(p.lanes.ts.allows("scripts/a.ts") && p.lanes.ts.allows("tools/run.ts"));
        assert!(!p.lanes.ts.allows("scripts/fixtures/a.ts") && !p.lanes.ts.allows("tools/run.tsx"));
        assert!(Lanes::default().ts.allows("anything/at/all.ts"), "no table = unrestricted");
        let bad = |x: &str| parse_policy("p", &format!("format = \"pulsar-policy 0\"\n[lanes.ts]\ninclude = [\n  \"{x}\",\n]\n")).unwrap_err();
        assert!(bad("/abs/").contains("repo-relative"));
        assert!(bad("../up/").contains("repo-relative"));
        assert!(parse_policy("p", "format = \"pulsar-policy 0\"\n[lanes.go]\ninclude = []\n").is_err());
    }

    #[test]
    fn production_is_decided_by_policy_then_the_lane_then_the_path_rule() {
        let t = "format = \"pulsar-policy 0\"\n[lanes.rust]\nprod = [\n  \"cli/tests/golden.rs\",\n]\ntest = [\n  \"cli/src/gen/\",\n]\n";
        let l = parse_policy("p", t).unwrap().lanes;
        assert!(l.is_prod("cli/src/main.rs", None) && !l.is_prod("cli/tests/other.rs", None));
        assert!(l.is_prod("cli/tests/golden.rs", None), "prod prefix overrides the lane rule");
        assert!(!l.is_prod("cli/src/gen/x.rs", None), "test prefix overrides the lane rule");
        assert!(!l.is_prod("cli/src/lib.rs", Some(false)), "the analysis can mark a file non-production");
        assert!(l.is_prod("cli/src/lib.rs", Some(true)));
        assert!(!l.is_prod("cli/src/gen/x.rs", Some(true)), "policy test prefixes beat the analysis");
        let d = Lanes::default();
        assert!(d.is_prod("src/a.ts", None) && !d.is_prod("src/a.test.ts", None) && !d.is_prod("README.md", None));
        assert!(d.is_prod("e/Facts.bend", Some(true)) && !d.is_prod("e/Facts.bend", Some(false)));
        assert!(!d.is_prod("e/Facts.bend", None), "a Bend file is production only if its lane says so");
    }

    #[test]
    fn glob_matches_stars() {
        assert!(glob("node:*", "node:fs"));
        assert!(!glob("node:*", "fs"));
        assert!(glob("@effect/*", "@effect/sql"));
        assert!(glob("a*c*e", "abcde"));
        assert!(glob("exact", "exact") && !glob("exact", "exactly"));
    }
}
