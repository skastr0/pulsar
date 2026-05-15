# Pulsar

Pulsar measures repository health with deterministic, inspectable signals.

## Status

Experimental. Pulsar is usable for inspection and local scoring, but signal semantics, scoring bands, package boundaries, and release channels may change before a stable public API is declared.

## What Pulsar Does

Pulsar turns grounded repository evidence into scores that can be reviewed, cached, calibrated, and explained. It is built for maintainers who want repo-level health signals that are harder to game than vibes-based review.

The current workspace includes:

- `@skastr0/pulsar-core`: signal runtime, registry, observer, scoring engine, vectors, calibration, routing, and time-series primitives
- `@skastr0/pulsar-ts-pack`: TypeScript signal pack
- `@skastr0/pulsar-rs-pack`: Rust signal pack
- `@skastr0/pulsar-shared-signals`: language-agnostic shared signals
- `@skastr0/pulsar-project-module-sdk`: typed project-module authoring APIs for calibration processors
- `@skastr0/pulsar-project-module-effect` and `@skastr0/pulsar-project-module-convex`: technology calibration modules
- `@skastr0/pulsar-cli`: local CLI source and standalone binary release target
- `@skastr0/pulsar`: npm runner package for `npx`, `bunx`, `pnpm dlx`, and `pnpx`

## Repository-Level Invariant

Pulsar is repository-level, always. A repo-local `.pulsar/vector.json` is the source of truth for scoring that repo. A home-directory vector is only an organization-standard fallback transport location; it is not a personal preference layer.

Presets are templates for creating or updating a repo vector. A preset is not active pulsar until it is applied to the repo.

## Quick Start From Source

After the first npm release, run Pulsar without cloning the repo:

```bash
npx @skastr0/pulsar score .
bunx @skastr0/pulsar score .
pnpm dlx @skastr0/pulsar score .
```

```bash
git clone https://github.com/skastr0/pulsar.git
cd pulsar
bun install
bun run verify
```

Run the CLI from source:

```bash
bun packages/cli/src/bin.ts score .
bun packages/cli/src/bin.ts score --json .
bun packages/cli/src/bin.ts backpressure .
```

Build and install a local standalone binary:

```bash
bun run build:cli
bun run install:local
pulsar --help
```

## Common Commands

```bash
bun run typecheck
bun run test
bun run build
bun run verify
```

`bun run verify` is the public baseline used by CI.

## Configuration

Repo-owned Pulsar files live under `.pulsar/`. The public, diffable files are expected to be committed when they define repository scoring behavior:

- `.pulsar/vector.json`
- `.pulsar/conventions.json`
- `.pulsar/glossary.json`
- `.pulsar/author-aliases.json`
- `.pulsar/project-modules.json`
- `.pulsar/modules/**`
- `.pulsar/routing-patterns/**`

Generated caches, quiz sessions, draft extraction files, proposal queues, time-series data, and calibration suggestion reports are local runtime state under `~/.config/pulsar/repos/<repo-id>/`. They are not global/user Pulsar customization and are not part of the repo-owned `.pulsar` surface.

CI ratcheting debt is recorded separately in `pulsar-baseline.json`.

## Publishing

See [PUBLISHING.md](PUBLISHING.md). Real package uploads, release creation, visibility changes, and tag pushes require an explicit maintainer gate.

## Support And Contributions

Use GitHub issues for reproducible bugs, documentation corrections, and scoped proposals. External pull requests are not the default support path while the project is experimental; discuss larger changes in an issue first. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SUPPORT.md](SUPPORT.md).

## Security

Please report suspected vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
