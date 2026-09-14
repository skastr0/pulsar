# Shared history `git log -p` stream receipt

Opt-in reproduction (not a shipped test):

```sh
bun scripts/shared-history-git-bench.ts --tip 5358e69
```

These numbers are a local receipt for tip `5358e69` (`5358e6974cc0fc1ec7eb04ebfc424093bb521f3d`), 365-day window ending `2026-09-07T23:55:51Z`. They are not CI assertions.

| Path | Lines | Wall | Heap Δ |
| --- | ---: | ---: | ---: |
| Buffer + `split("\n")` (before) | 345040 | ~623 ms | 59.74 MiB |
| Streamed `forEachGitLine` (after) | 345040 | 668–841 ms | 2.83–12.49 MiB |

Raw stdout was 13.7 MiB. The shipped history tests use self-contained git fixtures only.
