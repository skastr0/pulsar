# Contributing

Pulsar is experimental and solo-maintained. The default contribution path is issues first: reproducible bugs, documentation corrections, and scoped proposals.

## Useful Issues

Please include enough context for the maintainer to reproduce or evaluate the report:

- Pulsar version or commit
- operating system and Bun version
- command run
- expected behavior
- actual behavior
- minimal repository shape or fixture when the behavior depends on project layout
- logs with secrets and private data removed

## Proposals

Scoped proposals are welcome when they explain the problem, the desired behavior, alternatives considered, and the maintenance cost. Large changes should start as an issue before implementation work.

## Pull Requests

External pull requests are not the default maintenance path while Pulsar is experimental. Small corrections may be accepted, but a PR can be declined for scope, maintenance cost, compatibility risk, or product direction even when the implementation is technically sound.

If a PR is discussed and opened, include the verification commands you ran and call out any user-facing behavior changes.

## Local Workflow

```bash
bun install
bun run verify
```

For narrower checks:

```bash
bun run typecheck
bun run test
bun run build
```

## Security

Do not open public issues for suspected vulnerabilities. Use the private reporting path in [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the MIT license used by this project.
