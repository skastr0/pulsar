# history

Git history lane. Owner: pulsar-history. It will emit `H` (window header), `C` (commits), `A` (authors, with bot flag from the catalog), `CF` (per-file line counts, renames followed) and `CFN` (lines touched per head function, matched through `FK`). Git access goes through `crate::git`; rows through `crate::facts::FactWriter`.
