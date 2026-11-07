//! lcov → executable lines per file. Also the format `cargo llvm-cov --lcov` writes.
//!
//! Only `SF:` (start of file) and `DA:<line>,<hits>[,<checksum>]` (executable line) carry
//! `CV`. `BRDA`, `FN`, `FNDA`, `LF` and `LH` are branch and function coverage, which `CV`
//! does not carry, and are ignored so a report without them parses the same.

use std::collections::BTreeMap;

use super::istanbul::FileEntry;

pub fn parse(text: &str) -> Result<Vec<FileEntry>, String> {
    let mut out: Vec<FileEntry> = Vec::new();
    let mut current: Option<FileEntry> = None;
    for (n, raw) in text.lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        let at = n + 1;
        if let Some(rest) = line.strip_prefix("SF:") {
            if let Some(done) = current.take() {
                out.push(done);
            }
            let path = rest.trim();
            if path.is_empty() {
                return Err(format!("lcov line {at}: SF: with no path"));
            }
            current = Some(FileEntry { path: path.to_string(), lines: BTreeMap::new() });
        } else if let Some(rest) = line.strip_prefix("DA:") {
            let entry = current
                .as_mut()
                .ok_or_else(|| format!("lcov line {at}: DA: before any SF:"))?;
            let mut fields = rest.split(',');
            let line_no = fields
                .next()
                .and_then(|s| s.trim().parse::<u32>().ok())
                .ok_or_else(|| format!("lcov line {at}: DA: without a line number"))?;
            let hits = fields
                .next()
                .and_then(|s| s.trim().parse::<u64>().ok())
                .ok_or_else(|| format!("lcov line {at}: DA:{line_no} without a hit count"))?;
            // The optional third field is a checksum; it does not change the count.
            let slot = entry.lines.entry(line_no).or_insert(0);
            *slot = slot.saturating_add(hits);
        } else if line == "end_of_record" {
            if let Some(done) = current.take() {
                out.push(done);
            }
        }
    }
    if let Some(done) = current.take() {
        out.push(done);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_two_files_and_ignores_branch_and_function_records() {
        let text = "TN:\n\
                    SF:src/a.ts\n\
                    FN:1,add\n\
                    FNDA:1,add\n\
                    DA:1,1\n\
                    DA:2,0\n\
                    BRDA:1,0,0,1\n\
                    LF:2\nLH:1\n\
                    end_of_record\n\
                    SF:src/b.ts\n\
                    DA:7,3\n\
                    end_of_record\n";
        let out = parse(text).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].path, "src/a.ts");
        assert_eq!(out[0].lines.iter().collect::<Vec<_>>(), vec![(&1, &1), (&2, &0)]);
        assert_eq!(out[1].lines.get(&7), Some(&3));
    }

    #[test]
    fn accepts_a_checksum_field() {
        let out = parse("SF:a.ts\nDA:4,0,abcdef\nend_of_record\n").unwrap();
        assert_eq!(out[0].lines.get(&4), Some(&0));
    }

    #[test]
    fn accepts_a_missing_end_of_record() {
        let out = parse("SF:a.ts\nDA:4,1\nSF:b.ts\nDA:5,1\n").unwrap();
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn rejects_data_before_a_file_record() {
        let err = parse("DA:1,1\n").unwrap_err();
        assert!(err.contains("before any SF"), "{err}");
    }

    #[test]
    fn rejects_a_malformed_da() {
        assert!(parse("SF:a.ts\nDA:x,1\n").is_err());
        assert!(parse("SF:a.ts\nDA:1\n").is_err());
        assert!(parse("SF:\n").is_err());
    }
}
