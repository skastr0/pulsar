# Publishing

Pulsar publishes in small, explicit stages, and only the maintainer publishes. Agents prepare a release; they do not flip repository visibility, push release tags, create GitHub releases or upload packages.

## Public promise

Pulsar is experimental. Version `0.y.z` means it is usable on real repositories, but rule versions, finding keys, CLI output and the policy format may change. Changes a user sees go in `CHANGELOG.md`, including every rule version bump (it re-keys that rule's findings).

## Channel

npm, through a Node launcher package plus one package per platform:

| Package | Holds |
|---|---|
| `@skastr0/pulsar` | `bin/pulsar.js`, which runs the platform package's binary |
| `@skastr0/pulsar-darwin-arm64` | `bin/pulsar` (Rust CLI), `engine/pulsar-engine` (the Bend-built engine), `engine/MANIFEST` |
| `@skastr0/pulsar-linux-x64` | the same, static musl binaries |

Every package carries `LICENSE` and `THIRD_PARTY_NOTICES`. darwin-x64 and linux-arm64 engines build (`packaging/build-engine.sh`) but are not packaged in 0.4.0.

## Prepare a release

From `experiments/bend-pulsar/` (details in `packaging/README.md`):

1. The release gate passes at the release sha on a VM: `cargo test`, the engine fixtures, `bend engine/PROOF.bend --verdict`, the delta self-test and dogfood.
2. `packaging/build-engine.sh --targets "darwin-arm64 linux-x64" --test` builds the engines and their `MANIFEST`.
3. The CLI: `cargo build --release` on macOS arm64, and a static `x86_64-unknown-linux-musl` build in an Alpine Rust container.
4. `python3 packaging/notices.py --target aarch64-apple-darwin --target x86_64-unknown-linux-musl --check THIRD_PARTY_NOTICES`.
5. `bash packaging/stage-npm.sh --cli-darwin-arm64 <bin> --cli-linux-x64 <bin> --pack` lays out and packs `dist/npm/`. It publishes nothing.

## Publish (maintainer)

```sh
cd experiments/bend-pulsar/dist/npm
npm publish ./pulsar-darwin-arm64
npm publish ./pulsar-linux-x64
npm publish ./pulsar
git tag v<version> <release sha> && git push origin v<version>
```

Platform packages go first, so the launcher's optional dependencies resolve.
