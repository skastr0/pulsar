//! SQL lane: schema and query facts (FACTS.md "SQL"). Texts come from `.sql` files and from the
//! query-class calls the TS lane hands over; each text is split into statements, every statement
//! parsed alone (a bad one costs only itself), and the dialect front-end feeds a neutral model
//! that renumbers names and emits the rows. Dialects: SQLite now (`sqlite3-parser`, chosen in
//! `research/sql-parser.md`); the dialect is chosen per run by the caller.

mod model;
mod postgres;
mod sqlite;

pub use model::{Out, NONE};
use model::{Builder, Q_DYNAMIC, Q_FAILED};
use sqlite::{Cx, Fe};
use sqlite3_parser::lexer::sql::Parser;
use sqlite3_parser::{Bump, FallibleIterator};

/// Whether this lane owns a tracked path.
pub fn owns(path: &str) -> bool {
    path.ends_with(".sql")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dialect {
    Sqlite,
    Postgres,
}

/// The SQL of one query-class call or one `.sql` file.
#[derive(Debug, Clone)]
pub struct Text {
    pub file: u32,
    /// Global id of the enclosing function, or [`NONE`].
    pub fn_id: u32,
    /// Innermost enclosing `CT` node of that function; 0 = the body.
    pub node: u32,
    /// 1-based line of the text's first character.
    pub line: u32,
    /// `None` = dynamic: neither a literal nor a template.
    pub sql: Option<String>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Stats {
    pub texts: usize,
    pub dynamic: usize,
    pub statements: usize,
    pub failed: usize,
    pub ddl_ok: u32,
    pub ddl_skipped: u32,
}

/// Run the lane over `texts`. Files and lines decide the order, so DDL replays in file-id order.
pub fn analyze(mut texts: Vec<Text>, dialect: Dialect) -> (Out, Stats) {
    texts.sort_by_key(|t| (t.file, t.line));
    let mut b = Builder::default();
    let mut st = Stats { texts: texts.len(), ..Stats::default() };
    for t in &texts {
        let cx = Cx { file: t.file, fn_id: t.fn_id, node: t.node, line: t.line };
        match &t.sql {
            None => {
                st.dynamic += 1;
                b.bare_site(t.file, t.fn_id, t.node, t.line, Q_DYNAMIC);
            }
            Some(sql) => run_text(&mut b, &cx, sql, dialect, &mut st),
        }
    }
    st.ddl_ok = b.ddl_ok;
    st.ddl_skipped = b.ddl_skipped;
    (b.finish(), st)
}

fn run_text(b: &mut Builder, cx: &Cx, sql: &str, dialect: Dialect, st: &mut Stats) {
    for (offset_lines, chunk) in split(sql) {
        st.statements += 1;
        let at = Cx { line: cx.line + offset_lines, ..*cx };
        if !parse_chunk(b, &at, chunk, dialect) {
            st.failed += 1;
            b.bare_site(at.file, at.fn_id, at.node, at.line, Q_FAILED);
            if starts_ddl(chunk) {
                b.ddl_skipped += 1;
            }
        }
    }
}

/// Parse one statement chunk and hand its commands to the front-end. `false` = parse failure.
fn parse_chunk(b: &mut Builder, cx: &Cx, chunk: &str, dialect: Dialect) -> bool {
    match dialect {
        Dialect::Sqlite => sqlite_chunk(b, cx, chunk),
        Dialect::Postgres => postgres::run(b, cx, chunk),
    }
}

fn sqlite_chunk(b: &mut Builder, cx: &Cx, chunk: &str) -> bool {
    let bump = Bump::new();
    let mut p = Parser::new(&bump, chunk.as_bytes());
    let mut fe = Fe::new(b);
    loop {
        match p.next() {
            Ok(Some(cmd)) => fe.command(cx, &cmd),
            Ok(None) => return true,
            Err(_) => return false,
        }
    }
}

/// The first word of a chunk, skipping comments, is CREATE, ALTER or DROP.
fn starts_ddl(chunk: &str) -> bool {
    let mut rest = chunk.trim_start();
    loop {
        if let Some(r) = rest.strip_prefix("--") {
            rest = r.split_once('\n').map_or("", |(_, t)| t).trim_start();
        } else if let Some(r) = rest.strip_prefix("/*") {
            rest = r.split_once("*/").map_or("", |(_, t)| t).trim_start();
        } else {
            break;
        }
    }
    let word: String = rest.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    ["create", "alter", "drop"].iter().any(|k| word.eq_ignore_ascii_case(k))
}

/// Split a text into statements at `;`, outside strings, quoted identifiers and comments, and
/// not inside a trigger body (`CREATE TRIGGER .. BEGIN .. END;`, with `CASE .. END` nested).
/// Each chunk comes with the number of newlines before it.
pub fn split(text: &str) -> Vec<(u32, &str)> {
    let mut sp = Splitter::default();
    let b = text.as_bytes();
    let mut out = Vec::new();
    let (mut start, mut i, mut lines, mut counted) = (0usize, 0usize, 0u32, 0usize);
    while i < b.len() {
        let (n, cut) = sp.step(b, i);
        i += n;
        if cut {
            push_chunk(&mut out, text, (start, i), &mut lines, &mut counted);
            start = i;
        }
    }
    push_chunk(&mut out, text, (start, b.len()), &mut lines, &mut counted);
    out
}

/// Add `text[start..end]` as a chunk unless it is blank. `lines` counts newlines before `counted`.
fn push_chunk<'t>(out: &mut Vec<(u32, &'t str)>, text: &'t str, span: (usize, usize), lines: &mut u32, counted: &mut usize) {
    let (start, end) = span;
    *lines += text[*counted..start].bytes().filter(|c| *c == b'\n').count() as u32;
    *counted = start;
    let chunk = &text[start..end];
    if chunk.trim().is_empty() {
        return;
    }
    let lead = chunk.bytes().take_while(|c| c.is_ascii_whitespace()).filter(|c| *c == b'\n').count() as u32;
    out.push((*lines + lead, chunk));
}

#[derive(Default)]
struct Splitter {
    /// Words since the statement began, up to the point the kind is known.
    first_words: Vec<String>,
    word: String,
    in_trigger: bool,
    begun: bool,
    case_depth: u32,
    ended: bool,
}

impl Splitter {
    /// Advance at byte `i`: how many bytes to consume (>= 1), and whether a statement ends here.
    fn step(&mut self, b: &[u8], i: usize) -> (usize, bool) {
        let c = b[i];
        if let Some(n) = skip_quoted(b, i) {
            self.end_word();
            return (n, false);
        }
        if c.is_ascii_alphanumeric() || c == b'_' {
            self.word.push(c as char);
            return (1, false);
        }
        self.end_word();
        if c != b';' {
            return (1, false);
        }
        if self.in_trigger && self.begun && !self.ended {
            return (1, false);
        }
        *self = Splitter::default();
        (1, true)
    }

    fn end_word(&mut self) {
        if self.word.is_empty() {
            return;
        }
        let w = std::mem::take(&mut self.word).to_ascii_lowercase();
        if self.first_words.len() < 4 {
            self.first_words.push(w.clone());
            self.in_trigger = self.first_words[0] == "create" && self.first_words.iter().any(|x| x == "trigger");
        }
        if !self.in_trigger {
            return;
        }
        match w.as_str() {
            "begin" => self.begun = true,
            "case" if self.begun => self.case_depth += 1,
            "end" if self.begun && self.case_depth > 0 => self.case_depth -= 1,
            "end" if self.begun => self.ended = true,
            _ => {}
        }
    }
}

/// If a string, quoted identifier or comment starts at `i`, the number of bytes it spans.
fn skip_quoted(b: &[u8], i: usize) -> Option<usize> {
    let c = b[i];
    match c {
        b'\'' | b'"' | b'`' => Some(quoted_len(b, i, c)),
        b'$' => dollar_len(b, i),
        b'[' => Some(b[i..].iter().position(|x| *x == b']').map_or(b.len() - i, |p| p + 1)),
        b'-' if b.get(i + 1) == Some(&b'-') => Some(b[i..].iter().position(|x| *x == b'\n').unwrap_or(b.len() - i)),
        b'/' if b.get(i + 1) == Some(&b'*') => {
            let end = b[i + 2..].windows(2).position(|w| w == b"*/").map_or(b.len() - i, |p| p + 4);
            Some(end)
        }
        _ => None,
    }
}

/// A Postgres dollar-quoted string (`$$..$$`, `$tag$..$tag$`) starting at `i`; `$1` is a parameter.
fn dollar_len(b: &[u8], i: usize) -> Option<usize> {
    if i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_') {
        return None;
    }
    let tag_end = b[i + 1..].iter().position(|c| !(c.is_ascii_alphanumeric() || *c == b'_'))? + i + 1;
    if b[tag_end] != b'$' || b.get(i + 1).is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    let tag = &b[i..=tag_end];
    let close = b[tag_end + 1..].windows(tag.len()).position(|w| w == tag);
    Some(close.map_or(b.len() - i, |p| tag_end + 1 + p + tag.len() - i))
}

/// Length of a quoted run starting at `i`, doubled quotes included.
fn quoted_len(b: &[u8], i: usize, q: u8) -> usize {
    let mut j = i + 1;
    while j < b.len() {
        if b[j] == q {
            if b.get(j + 1) == Some(&q) {
                j += 2;
                continue;
            }
            return j + 1 - i;
        }
        j += 1;
    }
    b.len() - i
}

#[cfg(test)]
mod tests;
