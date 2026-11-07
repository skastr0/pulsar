# coverage

Coverage ingest. Owner: pulsar-cov. It reads the repo's own report (Vitest `coverage-final.json`, lcov, Cobertura) and emits `CV` (`fn covered coverable`) by mapping covered lines to functions through the `.fns` side table (innermost function wins). A function without data gets no `CV`. Rows go through `crate::facts::FactWriter`.
