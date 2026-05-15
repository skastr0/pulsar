# Publishing

Pulsar publishes in small, explicit stages. Do not flip repository visibility, push release tags, dispatch publish workflows, create GitHub releases, or upload packages without a maintainer gate.

## Public Promise

Pulsar is experimental. Version `0.y.z` means the project is usable for inspection and local scoring, but public APIs, CLI output, package boundaries, and signal behavior may change. User-visible breaking changes should still be documented in `CHANGELOG.md`.

## Channels

Primary package channel:

- npm for TypeScript/Bun libraries and project modules

Binary distribution:

- GitHub Releases for Bun-compiled standalone CLI binaries
- Homebrew tap after the first release asset shape is stable

Deferred:

- npm runner compatibility for `pulsar` through `npx`, `bunx`, or `pnpm dlx`

The CLI is Bun-native. Do not publish the raw Bun entrypoint as an npm executable and promise broad runner compatibility. If npm runner support becomes required, use the package-publishing wrapper pattern: main package, per-platform optional packages, and a small Node launcher.

## Publishable Packages

Publish these npm packages in dependency order:

1. `@skastr0/pulsar-core`
2. `@skastr0/pulsar-project-module-sdk`
3. `@skastr0/pulsar-shared-signals`
4. `@skastr0/pulsar-ts-pack`
5. `@skastr0/pulsar-rs-pack`
6. `@skastr0/pulsar-project-module-effect`
7. `@skastr0/pulsar-project-module-convex`

Keep these private or unpublished:

- root workspace package `@skastr0/pulsar`
- `@skastr0/pulsar-cli` until the npm wrapper/package split exists
- exploration prototypes under `docs/explorations/prototypes/**`

## Local Verification

```bash
bun install --frozen-lockfile
bun run verify
```

Before the visibility flip, confirm `.pulsar/` contains only repo-owned configuration or calibration files. Runtime state belongs under `~/.config/pulsar/repos/<repo-id>/`; do not publish `.pulsar/cache`, `.pulsar/time-series`, `.pulsar/proposals`, or draft extraction files.

Before a package publish, inspect package contents:

```bash
bun run build
npm pack --dry-run --workspace packages/core
npm pack --dry-run --workspace packages/project-module-sdk
npm pack --dry-run --workspace packages/shared-signals
npm pack --dry-run --workspace packages/ts-pack
npm pack --dry-run --workspace packages/rs-pack
npm pack --dry-run --workspace packages/project-module-effect
npm pack --dry-run --workspace packages/project-module-convex
```

Before a binary release, inspect assets:

```bash
bun run build:cli
ls -lh dist
shasum -a 256 dist/pulsar-*
```

## GitHub Setup

Before making the repository public:

- enable secret scanning and push protection
- enable Dependabot alerts and dependency graph
- enable private vulnerability reporting
- keep issues enabled
- keep Discussions, Wiki, and Projects disabled unless there is a clear support plan
- protect the default branch once external PRs are accepted

Before npm publishing:

- create or confirm access to the `@skastr0` npm scope
- configure npm Trusted Publishers for `.github/workflows/npm-publish.yml`
- use the protected `release` GitHub environment for publish workflows
- confirm each scoped package publishes with public access

## First Release Sequence

1. Keep the repository private.
2. Run local verification and package dry-runs.
3. Confirm the public docs, security policy, issue templates, and package metadata.
4. Configure GitHub security settings and npm trusted publishing.
5. Make the repository public after the maintainer gate.
6. Push `v0.1.0` only after the maintainer gate.
7. Let CI publish packages and create draft release assets.
8. Verify package pages, release assets, checksums, and install commands.

## Rollback Notes

npm package versions should be treated as permanent. Prefer publishing a fixed version over relying on unpublish. GitHub release assets can be replaced, but users may already have downloaded them.
