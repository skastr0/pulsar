//! Finding identity and rendering.
//!
//! A finding's key is `hash(rule id, rule version, sorted subject keys)`, so it survives line
//! moves and renumbered ids, and changes when a rule's meaning changes (its version). Subject
//! keys follow FACTS.md: a file is its path key, a function is its `FK` key. Never lines.

use serde_json::{json, Value};

/// A rule as the CLI reports it. The version bumps when the rule's meaning changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rule {
    pub id: &'static str,
    pub version: u32,
}

/// Engine `FX`: a function over a metric threshold. Rule ids and versions per FACTS.md.
pub const CYCLOMATIC: Rule = Rule { id: "core.cyclomatic", version: 1 };
pub const NESTING: Rule = Rule { id: "core.nesting", version: 1 };
pub const NPATH: Rule = Rule { id: "core.npath", version: 1 };
pub const LENGTH: Rule = Rule { id: "core.length", version: 1 };

/// The rule for an engine `FX` rule id, or an error if the CLI does not know it (an engine and
/// CLI that disagree must fail, not drop findings).
pub fn metric_rule(id: &str) -> Result<Rule, String> {
    [CYCLOMATIC, NESTING, NPATH, LENGTH]
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| format!("engine reported FX rule {id:?}, which this CLI does not know"))
}

/// Engine `CYC`: a strongly connected set of files in the import graph.
pub const IMPORT_CYCLE: Rule = Rule { id: "graph.import-cycle", version: 1 };

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Subject {
    /// File key (`K` fact: FNV-1a 64 of the repo-relative path) and the path to render.
    File { key: u64, path: String },
    /// Function key (`FK` fact) with its path and container chain to render.
    #[allow(dead_code)] // function findings arrive with the function lanes
    Function { key: u64, path: String, chain: String },
}

impl Subject {
    fn tag(&self) -> u8 {
        match self {
            Subject::File { .. } => 0,
            Subject::Function { .. } => 1,
        }
    }
    fn key(&self) -> u64 {
        match self {
            Subject::File { key, .. } | Subject::Function { key, .. } => *key,
        }
    }
    fn json(&self) -> Value {
        match self {
            Subject::File { key, path } => json!({"kind":"file","key":hex(*key),"path":path}),
            Subject::Function { key, path, chain } => {
                json!({"kind":"function","key":hex(*key),"path":path,"symbol":chain})
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct Finding {
    pub rule: Rule,
    /// Sorted by (tag, key); the order the identity hash uses.
    pub subjects: Vec<Subject>,
    /// The file to point at. For a cycle: the smallest member path.
    pub file: String,
    /// The symbol to point at, when the finding is about a symbol.
    pub symbol: Option<String>,
    /// 1-based line to navigate to, for display only: never part of the key.
    pub line: Option<u32>,
    /// One line a peer can read.
    pub evidence_text: String,
    /// The same evidence, structured.
    pub evidence: Value,
}

pub fn hex(k: u64) -> String {
    format!("{k:016x}")
}

impl Finding {
    pub fn new(
        rule: Rule,
        mut subjects: Vec<Subject>,
        file: String,
        symbol: Option<String>,
        evidence_text: String,
        evidence: Value,
    ) -> Self {
        subjects.sort_by_key(|s| (s.tag(), s.key()));
        Finding { rule, subjects, file, symbol, line: None, evidence_text, evidence }
    }

    /// Set the display line (a navigation hint, not identity).
    pub fn at_line(mut self, line: u32) -> Self {
        self.line = Some(line);
        self
    }

    /// Stable identity: FNV-1a 64 over `rule id, 0, version (u32 BE)`, then each subject as
    /// `tag, key (u64 BE)` in sorted order.
    pub fn key(&self) -> u64 {
        let mut h = Fnv::new();
        h.bytes(self.rule.id.as_bytes());
        h.bytes(&[0]);
        h.bytes(&self.rule.version.to_be_bytes());
        for s in &self.subjects {
            h.bytes(&[s.tag()]);
            h.bytes(&s.key().to_be_bytes());
        }
        h.0
    }

    /// `rule key path[:line] symbol-or-dash  evidence (rule vN)`, one line.
    pub fn text(&self) -> String {
        let place = match self.line {
            Some(l) => format!("{}:{l}", self.file),
            None => self.file.clone(),
        };
        format!(
            "{} {} {} {}  {} (rule v{})",
            self.rule.id,
            hex(self.key()),
            place,
            self.symbol.as_deref().unwrap_or("-"),
            self.evidence_text,
            self.rule.version
        )
    }

    pub fn json(&self, change: &str) -> Value {
        json!({
            "type": "finding",
            "change": change,
            "key": hex(self.key()),
            "rule": self.rule.id,
            "rule_version": self.rule.version,
            "file": self.file,
            "line": self.line,
            "symbol": self.symbol,
            "subjects": self.subjects.iter().map(Subject::json).collect::<Vec<_>>(),
            "evidence": self.evidence,
        })
    }
}

struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Fnv(0xcbf2_9ce4_8422_2325)
    }
    fn bytes(&mut self, b: &[u8]) {
        for x in b {
            self.0 ^= *x as u64;
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, key: u64) -> Subject {
        Subject::File { key, path: path.into() }
    }
    fn finding(rule: Rule, subs: Vec<Subject>) -> Finding {
        Finding::new(rule, subs, "x".into(), None, String::new(), Value::Null)
    }

    #[test]
    fn key_ignores_subject_order() {
        let a = finding(IMPORT_CYCLE, vec![f("a", 1), f("b", 2), f("c", 3)]);
        let b = finding(IMPORT_CYCLE, vec![f("c", 3), f("a", 1), f("b", 2)]);
        assert_eq!(a.key(), b.key());
    }

    #[test]
    fn key_changes_with_rule_version_and_subjects() {
        let base = finding(IMPORT_CYCLE, vec![f("a", 1), f("b", 2)]);
        let v2 = finding(Rule { version: 2, ..IMPORT_CYCLE }, vec![f("a", 1), f("b", 2)]);
        let other = finding(Rule { id: "other", ..IMPORT_CYCLE }, vec![f("a", 1), f("b", 2)]);
        let grown = finding(IMPORT_CYCLE, vec![f("a", 1), f("b", 2), f("c", 3)]);
        for x in [&v2, &other, &grown] {
            assert_ne!(base.key(), x.key());
        }
    }

    #[test]
    fn key_is_a_pinned_value() {
        // Pin the encoding: a change here silently re-keys every finding ever recorded.
        let k = finding(IMPORT_CYCLE, vec![f("a", 1), f("b", 2)]).key();
        assert_eq!(hex(k), "1361b4bb177d73eb", "encoding changed: bump the format deliberately");
    }

    #[test]
    fn file_and_function_subjects_with_equal_keys_differ() {
        let a = finding(IMPORT_CYCLE, vec![f("a", 7)]);
        let b = finding(IMPORT_CYCLE, vec![Subject::Function { key: 7, path: "a".into(), chain: "g".into() }]);
        assert_ne!(a.key(), b.key());
    }
}

/// Rules the CLI itself defines (not catalog rules). Policy may enable or disable them by id.
pub fn is_builtin_rule(id: &str) -> bool {
    id == IMPORT_CYCLE.id || metric_rule(id).is_ok()
}
