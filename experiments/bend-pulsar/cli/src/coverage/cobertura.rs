//! Cobertura XML → executable lines per file.
//!
//! `<class filename="...">` names a file and its `<lines>` children carry `number` and
//! `hits`. The same `<line>` elements appear again under `<methods>`, so those are skipped:
//! only the class-level list is read. A relative `filename` is resolved against the
//! `<sources><source>` entries, which is how Cobertura report roots are written.

use std::collections::BTreeMap;

use super::FileLines;
use super::istanbul::FileEntry;

struct Tag<'a> {
    name: &'a str,
    attrs: &'a str,
    closing: bool,
    self_closing: bool,
}

/// Read the next element tag, skipping comments, doctypes and processing instructions.
fn next_tag(text: &str, from: usize) -> Option<(Tag<'_>, usize)> {
    let bytes = text.as_bytes();
    let mut lt = from;
    while lt < bytes.len() && bytes[lt] != b'<' {
        lt += 1;
    }
    if lt == bytes.len() {
        return None;
    }
    let mut i = lt + 1;
    if i < bytes.len() && (bytes[i] == b'!' || bytes[i] == b'?') {
        let mut j = i;
        while j < bytes.len() && bytes[j] != b'>' {
            j += 1;
        }
        return next_tag(text, (j + 1).min(bytes.len()));
    }
    let closing = i < bytes.len() && bytes[i] == b'/';
    if closing {
        i += 1;
    }
    let name_start = i;
    while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' && bytes[i] != b'/' {
        i += 1;
    }
    let name = &text[name_start..i];
    let attrs_start = i;
    let mut quote: Option<u8> = None;
    let mut self_closing = false;
    while i < bytes.len() {
        let b = bytes[i];
        match quote {
            Some(q) if b != q => i += 1,
            Some(_) => {
                quote = None;
                i += 1;
            }
            None => match b {
                b'"' | b'\'' => {
                    quote = Some(b);
                    i += 1;
                }
                b'>' => break,
                b'/' => {
                    self_closing = true;
                    i += 1;
                }
                _ => {
                    self_closing = false;
                    i += 1;
                }
            },
        }
    }
    if i == bytes.len() {
        return None;
    }
    let attrs = &text[attrs_start..i];
    let end = i + 1;
    Some((Tag { name, attrs, closing, self_closing }, end))
}

fn attr<'a>(attrs: &'a str, key: &str) -> Option<&'a str> {
    let mut rest = attrs;
    while let Some(pos) = rest.find(key) {
        let before = rest[..pos].chars().next_back();
        let boundary = before.map(|c| c.is_ascii_whitespace()).unwrap_or(true);
        let after = rest[pos + key.len()..].trim_start();
        if boundary && after.starts_with('=') {
            let after = after[1..].trim_start();
            let quote = after.chars().next()?;
            if quote == '"' || quote == '\'' {
                let value = &after[1..];
                let end = value.find(quote)?;
                return Some(&value[..end]);
            }
        }
        rest = &rest[pos + key.len()..];
    }
    None
}

fn unescape(raw: &str) -> String {
    if !raw.contains('&') {
        return raw.to_string();
    }
    raw.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

pub fn parse(text: &str) -> Result<Vec<FileEntry>, String> {
    let mut classes: Vec<(String, FileLines)> = Vec::new();
    let mut sources: Vec<String> = Vec::new();
    let mut current: Option<(String, FileLines)> = None;
    let mut in_methods = 0u32;
    let mut in_source_text = false;
    let mut source_text = String::new();
    let mut pos = 0usize;
    while let Some((tag, next)) = next_tag(text, pos) {
        match (tag.closing, tag.name) {
            (false, "class") if !tag.self_closing => {
                let filename = attr(tag.attrs, "filename")
                    .ok_or("cobertura: <class> without filename")?;
                current = Some((unescape(filename), BTreeMap::new()));
            }
            (true, "class") => {
                if let Some(done) = current.take() {
                    classes.push(done);
                }
            }
            (false, "methods") if !tag.self_closing => in_methods += 1,
            (true, "methods") => in_methods = in_methods.saturating_sub(1),
            (false, "source") if !tag.self_closing => {
                in_source_text = true;
                source_text.clear();
            }
            (true, "source") if in_source_text => {
                let value = unescape(source_text.trim());
                if !value.is_empty() {
                    sources.push(value);
                }
                in_source_text = false;
            }
            (false, "line") => {
                if let Some((_, lines)) = current.as_mut() {
                    if in_methods == 0 {
                        let number = attr(tag.attrs, "number")
                            .ok_or("cobertura: <line> without number")?
                            .trim()
                            .parse::<u32>()
                            .map_err(|_| "cobertura: <line> number is not a line number")?;
                        let hits = attr(tag.attrs, "hits")
                            .ok_or("cobertura: <line> without hits")?
                            .trim()
                            .parse::<u64>()
                            .map_err(|_| "cobertura: <line> hits is not a count")?;
                        let slot = lines.entry(number).or_insert(0);
                        *slot = slot.saturating_add(hits);
                    }
                }
            }
            _ => {}
        }
        if in_source_text {
            let raw_start = next;
            let raw_end = text[raw_start..]
                .find('<')
                .map(|i| raw_start + i)
                .unwrap_or(text.len());
            source_text.push_str(&text[raw_start..raw_end]);
        }
        pos = next;
    }
    if let Some(done) = current.take() {
        classes.push(done);
    }

    let mut out: Vec<FileEntry> = Vec::new();
    for (filename, lines) in classes {
        if filename.starts_with('/') || sources.is_empty() {
            out.push(FileEntry { path: filename, lines });
        } else {
            // One candidate per source root; normalization keeps the one that exists.
            for source in &sources {
                const SEP: &str = if cfg!(windows) { "\\" } else { "/" };
                let path = format!("{}{SEP}{filename}", source.trim_end_matches('/'));
                out.push(FileEntry { path, lines: lines.clone() });
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPORT: &str = r#"<?xml version="1.0" ?>
<coverage line-rate="0.5" version="1.9">
  <sources><source>/repo/src</source></sources>
  <packages>
    <package name="p">
      <classes>
        <class name="a" filename="a.ts">
          <methods>
            <method name="m">
              <lines><line number="99" hits="1"/></lines>
            </method>
          </methods>
          <lines>
            <line number="2" hits="1"/>
            <line number="5" hits="0"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>"#;

    #[test]
    fn reads_class_lines_and_skips_method_lines() {
        let out = parse(REPORT).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].path, "/repo/src/a.ts");
        assert_eq!(out[0].lines.iter().collect::<Vec<_>>(), vec![(&2, &1), (&5, &0)]);
    }

    #[test]
    fn a_relative_name_without_sources_stays_relative() {
        let text = r#"<coverage><packages><package><classes><class filename="src/b.ts"><lines><line number="3" hits="1"/></lines></class></classes></package></packages></coverage>"#;
        let out = parse(text).unwrap();
        assert_eq!(out[0].path, "src/b.ts");
    }

    #[test]
    fn an_empty_methods_element_does_not_hide_the_class_lines() {
        let text = r#"<coverage><class filename="a.ts"><methods/><lines><line number="1" hits="1"/></lines></class></coverage>"#;
        let out = parse(text).unwrap();
        assert_eq!(out[0].lines.get(&1), Some(&1));
    }

    #[test]
    fn decodes_entities_in_a_filename() {
        let text = r#"<coverage><packages><package><classes><class filename="a&amp;b.ts"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>"#;
        assert_eq!(parse(text).unwrap()[0].path, "a&b.ts");
    }

    #[test]
    fn rejects_a_line_without_hits() {
        let text = r#"<coverage><class filename="a.ts"><lines><line number="1"/></lines></class></coverage>"#;
        assert!(parse(text).unwrap_err().contains("hits"));
    }

    #[test]
    fn ignores_comments_and_the_xml_declarations() {
        let text = r#"<?xml version="1.0"?><!-- a > comment --><coverage><class filename="a.ts"><lines><line number="1" hits="1"/></lines></class></coverage>"#;
        let out = parse(text).unwrap();
        assert_eq!(out[0].lines.get(&1), Some(&1));
    }
}
