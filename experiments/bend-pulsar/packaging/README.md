# Engine packaging

`./build-engine.sh --test` builds `pulsar-engine` for darwin-arm64, darwin-x64, linux-x64 and linux-arm64 from one C file that Bend emits. It writes them to `dist/engine/`, which is not committed.

- **Pinned Bend:** `bend-version`. The script refuses any other `bend version`, because the laws were checked with this one. To bump it, re-run `bend engine/PROOF.bend --verdict` with the new Bend, then edit the file.
- **The C file:** `bend engine/main.bend -o pulsar-engine.c`. Emitting it is deterministic: the same sources give the same sha256. It needs no Bend to build. Emitting it costs about 15 s and 0.9 GB RSS, so it runs only at packaging time.
- **macOS:** host `clang -O2 -target <arch>-apple-macos11`. The binary links only libSystem.
- **Linux:** `clang -O2 -static` against musl, in the Alpine image pinned in `linux.Dockerfile` and run under `docker --platform`. The binary has no libc dependency, so one binary per CPU runs on any distro, glibc or musl.
- **`MANIFEST`:** the Bend version, the sha256 of the C file, and the sha256, size and compiler of each binary.
- **npm:** the script stages `dist/engine/npm/pulsar-<target>/engine/pulsar-engine`. That matches the per-platform packages in `packages/npm/pulsar-<target>/`, with the Rust CLI in `bin/`. The CLI finds the engine at `<exe dir>/../engine/pulsar-engine` (`cli/src/engine.rs`).
- **`--test`:** runs `engine/test.sh` with each binary, natively, under Rosetta, or in the container. It then checks that each binary's stdout and exit code match the first target's on every fixture.

Windows is not a target: Bend has none (see `PRODUCT.md`).

## npm release (0.4.0: darwin-arm64 and linux-x64)

Prepared here, published only by the operator.

- **`npm/`:** the launcher `@skastr0/pulsar` (`bin/pulsar.js` runs the platform package's binary) and one package per target, `@skastr0/pulsar-<target>`, holding `bin/pulsar`, `engine/pulsar-engine` and the engine `MANIFEST`. Every version equals `cli/Cargo.toml`'s.
- **`THIRD_PARTY_NOTICES`** (in `experiments/bend-pulsar/`), shipped in every package. `notices.py` generates it from `cargo metadata` for the release targets, with the licence files each linked crate ships, plus `notices/` for the texts some crates omit from their crates.io package (the oxc crates; pg_query and the C it vendors: libpg_query, PostgreSQL, protobuf-c, xxhash). A linked crate with no notice text fails it. Regenerate after any dependency change:
  `python3 packaging/notices.py --target aarch64-apple-darwin --target x86_64-unknown-linux-musl -o THIRD_PARTY_NOTICES`
- **Linux CLI:** a static musl build, `cargo build --release --target x86_64-unknown-linux-musl` in an Alpine Rust container (the C in pg_query builds against musl there).
- **`stage-npm.sh`:** checks the versions, that `THIRD_PARTY_NOTICES` is current and that each binary is for its platform, then lays out `dist/npm/` and prints `npm pack --dry-run` for each package (`--pack` writes the tarballs). It never publishes. To publish (operator): `npm publish dist/npm/pulsar-darwin-arm64`, then `pulsar-linux-x64`, then `pulsar`.
