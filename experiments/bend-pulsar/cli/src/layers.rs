//! Effect layer findings: the engine's `pulsar-layers 0` section (FACTS.md "Effect pack") as findings.
//!
//! The engine proves the graph results over layer, service and root ids, which are dense per run
//! and shift between shas. A finding is therefore keyed by what the ids stand for: a layer by its
//! file and name (`-`, an unnamed layer, by file and line), a service by its tag string, a root by
//! the function that builds it (or its file at module level), all from the `.effect` side table.

use crate::engine::Layers;
use crate::facts::SideTables;
use crate::finding::{catalog_rule, Finding, Rule, Subject};
use crate::lang::functions::fnv_parts;
use crate::lang::Degraded;
use serde_json::json;

pub const LAYER_CYCLE: Rule = Rule { id: "effect.layer-cycle", version: 1 };
pub const UNPROVIDED: Rule = Rule { id: "effect.unprovided-service", version: 1 };
pub const DUPLICATE: Rule = Rule { id: "effect.duplicate-builder", version: 1 };
pub const HUB: Rule = Rule { id: "effect.hub-service", version: 1 };

/// Where something is, and what to call it, from one `.effect` row.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Place {
    pub path: String,
    pub line: u32,
    pub name: String,
}

#[derive(Default, Debug)]
pub struct Names {
    pub svc: Vec<Place>,
    pub layer: Vec<Place>,
}

/// Parse the `.effect` table: `S svc path line name` then `L layer path line name`, TAB-separated.
pub fn parse_names(text: &str) -> Result<Names, String> {
    let mut n = Names::default();
    for (i, l) in text.lines().enumerate() {
        let f: Vec<&str> = l.splitn(5, '\t').collect();
        let [kind, id, path, line, name] = f[..] else { return Err(format!(".effect line {}: need 5 TAB fields", i + 1)) };
        let id: usize = id.parse().map_err(|_| format!(".effect line {}: bad id {id:?}", i + 1))?;
        let p = Place { path: path.into(), line: line.parse().unwrap_or(0), name: name.into() };
        let list = match kind {
            "S" => &mut n.svc,
            "L" => &mut n.layer,
            other => return Err(format!(".effect line {}: unknown kind {other:?}", i + 1)),
        };
        if id != list.len() {
            return Err(format!(".effect line {}: {kind} ids must run 0,1,2.. in order", i + 1));
        }
        list.push(p);
    }
    Ok(n)
}

impl Place {
    fn layer_label(&self) -> String {
        if self.name == "-" { format!("{}:{}", self.path, self.line) } else { format!("{} ({})", self.name, self.path) }
    }
    fn layer_subject(&self) -> Subject {
        let id = if self.name == "-" { self.line.to_string() } else { self.name.clone() };
        Subject::Symbol { key: fnv_parts(&[b"layer", self.path.as_bytes(), id.as_bytes()]), name: self.layer_label() }
    }
    fn svc_subject(&self) -> Subject {
        Subject::Symbol { key: fnv_parts(&[b"service", self.name.as_bytes()]), name: self.name.clone() }
    }
}

/// A root: where its layer expression is built.
pub struct Root {
    pub root: u32,
    pub file: u32,
    pub fn_id: u32,
}

/// Everything the layer findings need to name things.
pub struct Ctx<'a> {
    pub names: &'a Names,
    pub roots: &'a [Root],
    pub files: &'a [String],
    pub tables: &'a SideTables,
    pub keys: &'a [u64],
}

impl Ctx<'_> {
    fn layer(&self, id: u32) -> Result<&Place, String> {
        self.names.layer.get(id as usize).ok_or_else(|| format!("engine names layer {id}, but .effect has {}", self.names.layer.len()))
    }
    fn svc(&self, id: u32) -> Result<&Place, String> {
        self.names.svc.get(id as usize).ok_or_else(|| format!("engine names service {id}, but .effect has {}", self.names.svc.len()))
    }
    /// The root's subject, its file, its display symbol and line.
    fn root(&self, id: u32) -> Result<(Subject, String, Option<String>, u32), String> {
        let r = self.roots.iter().find(|r| r.root == id).ok_or_else(|| format!("engine names root {id}, but there is no RT row"))?;
        let path = self.files.get(r.file as usize).cloned().ok_or("RT names a file that does not exist")?;
        match (r.fn_id != crate::sql::NONE).then(|| (self.tables.fns.get(r.fn_id as usize), self.keys.get(r.fn_id as usize))) {
            Some((Some(f), Some(&key))) => {
                Ok((Subject::Function { key, path: path.clone(), chain: f.chain.clone() }, path, Some(f.chain.clone()), f.start_line))
            }
            Some(_) => Err("RT names a function that does not exist".into()),
            None => Ok((Subject::File { key: crate::facts::stable_key(&path), path: path.clone() }, path, None, 0)),
        }
    }
}

fn walk(c: &Ctx, ids: &[u32]) -> Result<String, String> {
    Ok(ids.iter().map(|&i| c.layer(i).map(|p| p.layer_label())).collect::<Result<Vec<_>, _>>()?.join(" -> "))
}

fn finding(rule: Rule, subjects: Vec<Subject>, at: &Place, text: String, evidence: serde_json::Value) -> Finding {
    Finding::new(rule, subjects, at.path.clone(), Some(at.name.clone()).filter(|n| n != "-"), text, evidence).at_line(at.line)
}

/// The layer findings, and the degraded-input notices for what the engine could not check.
pub fn findings(l: &Layers, c: &Ctx, disabled: &[String]) -> Result<(Vec<Finding>, Vec<Degraded>), String> {
    let on = |r: &Rule| !disabled.iter().any(|d| d == r.id);
    let mut out = Vec::new();
    if on(&LAYER_CYCLE) {
        for ids in &l.cycles {
            let first = c.layer(ids[0])?;
            let subjects = ids.iter().map(|&i| c.layer(i).map(Place::layer_subject)).collect::<Result<_, _>>()?;
            let text = format!("layers require each other in a cycle: {}", walk(c, ids)?);
            out.push(finding(catalog_rule(LAYER_CYCLE.id, 1), subjects, first, text, json!({"layers": ids.len()})));
        }
    }
    if on(&UNPROVIDED) {
        for u in &l.unp {
            let (root_subject, _, _, _) = c.root(u.root)?;
            let (layer, svc) = (c.layer(u.layer)?, c.svc(u.svc)?);
            let text = format!("{} requires {} but no layer provides it at this root (via {})", layer.layer_label(), svc.name, walk(c, &u.walk)?);
            let subjects = vec![root_subject, layer.layer_subject(), svc.svc_subject()];
            out.push(finding(catalog_rule(UNPROVIDED.id, 1), subjects, layer, text, json!({"service": svc.name, "walk": u.walk.len()})));
        }
    }
    if on(&DUPLICATE) {
        for d in &l.dups {
            let (a, b, svc) = (c.layer(d.a)?, c.layer(d.b)?, c.svc(d.svc)?);
            let text = format!("{} is built by both {} and {} (via {} and {})", svc.name, a.layer_label(), b.layer_label(), walk(c, &d.wa)?, walk(c, &d.wb)?);
            out.push(finding(catalog_rule(DUPLICATE.id, 1), vec![svc.svc_subject(), a.layer_subject(), b.layer_subject()], a, text, json!({"service": svc.name})));
        }
    }
    if on(&HUB) {
        for h in &l.hubs {
            let svc = c.svc(h.svc)?;
            let text = format!("{} has fan-in {} ({} layers + {} functions), threshold {}", svc.name, h.k, h.a, h.b, l.hub_min);
            out.push(finding(catalog_rule(HUB.id, 1), vec![svc.svc_subject()], svc, text, json!({"fan_in": h.k, "layers": h.a, "functions": h.b, "threshold": l.hub_min})));
        }
    }
    Ok((out, opaque_notice(l, c)?))
}

/// `LOPQ r l`: root r reaches an opaque layer, so its gaps are not reported. Not a finding, a
/// coverage notice shown like the degraded marker.
fn opaque_notice(l: &Layers, c: &Ctx) -> Result<Vec<Degraded>, String> {
    if l.opq.is_empty() {
        return Ok(Vec::new());
    }
    let mut roots: Vec<u32> = l.opq.iter().map(|o| o.0).collect();
    roots.sort_unstable();
    roots.dedup();
    let example = {
        let (r, ly) = l.opq[0];
        let (_, path, symbol, _) = c.root(r)?;
        format!("{}{} reaches the opaque layer {}", path, symbol.map(|s| format!(" ({s})")).unwrap_or_default(), c.layer(ly)?.layer_label())
    };
    Ok(vec![Degraded {
        lane: "effect",
        cause: format!("{} root(s) reach opaque layers, so their unprovided-service gaps are not reported (for example {example})", roots.len()),
    }])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Dup, Hub, Unp};

    fn ctx_parts() -> (Names, Vec<Root>, Vec<String>, SideTables) {
        let names = parse_names("S\t0\tsrc/db.ts\t3\tDb (Db)\nS\t1\tsrc/mail.ts\t4\tMailer (Mailer)\nL\t0\tsrc/app.ts\t10\tDbLive\nL\t1\tsrc/app.ts\t12\tMailerLive\nL\t2\tsrc/app.ts\t15\t-\n").unwrap();
        (names, vec![Root { root: 0, file: 0, fn_id: crate::sql::NONE }], vec!["src/app.ts".into()], SideTables::default())
    }

    #[test]
    fn parses_the_effect_table_strictly() {
        let (n, ..) = ctx_parts();
        assert_eq!((n.svc.len(), n.layer.len()), (2, 3));
        assert_eq!(n.layer[2].name, "-");
        assert!(parse_names("S\t1\ta.ts\t1\tX\n").unwrap_err().contains("in order"));
        assert!(parse_names("Q\t0\ta.ts\t1\tX\n").unwrap_err().contains("unknown kind"));
        assert!(parse_names("S\t0\ta.ts\n").unwrap_err().contains("5 TAB"));
    }

    #[test]
    fn findings_are_named_by_what_the_ids_stand_for() {
        let (names, roots, files, tables) = ctx_parts();
        let c = Ctx { names: &names, roots: &roots, files: &files, tables: &tables, keys: &[] };
        let l = Layers {
            cycles: vec![vec![0, 1]],
            cert: Some(true),
            unp: vec![Unp { root: 0, layer: 1, svc: 0, via: 0, walk: vec![0, 1] }],
            opq: vec![(0, 2)],
            dups: vec![Dup { svc: 1, a: 0, b: 1, w: 2, wa: vec![2, 0], wb: vec![2, 1] }],
            hubs: vec![Hub { svc: 0, k: 12, a: 9, b: 3 }],
            hub_min: 10,
        };
        let (f, degraded) = findings(&l, &c, &[]).unwrap();
        let ids: Vec<&str> = f.iter().map(|x| x.rule.id).collect();
        assert_eq!(ids, ["effect.layer-cycle", "effect.unprovided-service", "effect.duplicate-builder", "effect.hub-service"]);
        assert!(f[1].text().contains("MailerLive (src/app.ts) requires Db (Db) but no layer provides it"), "{}", f[1].text());
        assert!(f[3].text().contains("fan-in 12 (9 layers + 3 functions), threshold 10"));
        assert_eq!(degraded.len(), 1);
        assert!(degraded[0].cause.contains("1 root(s) reach opaque layers") && degraded[0].cause.contains("src/app.ts:15"));
        // the key does not depend on ids: swapping which id a layer has changes nothing
        let (g, _) = findings(&l, &c, &["effect.hub-service".to_string()]).unwrap();
        assert_eq!(g.len(), 3, "rules.disable turns a rule off");
        assert_eq!(f[0].key(), g[0].key());
        // an id the table does not know is an error, never a dropped finding
        let bad = Layers { cycles: vec![vec![0, 9]], ..Layers::default() };
        assert!(findings(&bad, &c, &[]).unwrap_err().contains("names layer 9"));
    }
}
