//! Binding-drift findings: the engine's `pulsar-binding 0` section (FACTS.md "Binding rules")
//! as findings.
//!
//! A `BFX` line names a deployable and a binding by id; the CLI names them from the
//! `.deployables` and `.bindings` side tables, and keys the finding by the deployable's
//! declaration path (a file key) plus a symbol key over the deployable and binding names, never
//! by an id or a line.

use crate::engine::Binding;
use crate::facts::{stable_key, SideTables};
use crate::finding::{Finding, Rule, Subject, BINDING_RULES};
use crate::lang::functions::fnv_parts;
use crate::lang::Degraded;
use serde_json::json;

fn rule(name: &str) -> Result<Rule, String> {
    BINDING_RULES.iter().find(|r| r.id == name).copied().ok_or_else(|| format!("engine reported binding rule {name:?}, which this CLI does not know"))
}

fn deployable(t: &SideTables, id: u32) -> Result<(String, String, u32), String> {
    t.deployables
        .lines()
        .find_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            match f.as_slice() {
                [i, path, line, name] if *i == id.to_string() => Some((name.to_string(), path.to_string(), line.parse().unwrap_or(0))),
                _ => None,
            }
        })
        .ok_or_else(|| format!("engine names deployable {id}, but .deployables does not"))
}

/// The findings of the binding section, and the degraded input the CLI had to drop.
pub fn findings(s: &Binding, t: &SideTables) -> Result<(Vec<Finding>, Vec<Degraded>), String> {
    let mut out = Vec::new();
    let mut notices = Vec::new();
    for x in &s.xs {
        let r = rule(&x.rule)?;
        let (dep, path, line, bind) = match (deployable(t, x.dep), t.bindings.get(x.bind as usize)) {
            (Ok(d), Some(b)) => (d.0, d.1, d.2, b.clone()),
            _ => {
                notices.push(Degraded {
                    lane: "infra",
                    cause: format!("binding finding {} names deployable {} or binding {}, which the side tables do not", x.rule, x.dep, x.bind),
                });
                continue;
            }
        };
        let name = format!("{dep}.{bind}");
        let subjects = vec![
            Subject::File { key: stable_key(&path), path: path.to_string() },
            Subject::Symbol { key: fnv_parts(&[b"infra", dep.as_bytes(), b".", bind.as_bytes()]), name: name.clone() },
        ];
        let f = Finding::new(
            r,
            subjects,
            path.to_string(),
            None,
            format!("declares {bind} and no reachable code reads it"),
            json!({"deployable": dep, "binding": bind, "declared": x.declared, "unread": x.value, "threshold": x.thr}),
        )
        .at_line(line);
        out.push(f);
    }
    Ok((out, notices))
}
