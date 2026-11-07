# Contributing

Pulsar has one maintainer. The default contribution path is issues first: reproducible bugs, documentation corrections, and scoped proposals.

## Useful Issues

Please include enough context for the maintainer to reproduce or evaluate the report:

- Pulsar version or commit
- operating system
- command run
- expected behavior
- actual behavior
- minimal repository shape or fixture when the behavior depends on project layout
- logs with secrets and private data removed

## Proposals

Scoped proposals are welcome when they explain the problem, the desired behavior, alternatives considered, and the maintenance cost. Large changes should start as an issue before implementation work.

## Pull Requests

External pull requests are not the default maintenance path. Small corrections may be accepted, but a PR can be declined for scope, maintenance cost, compatibility risk, or product direction even when the implementation is technically sound.

If a PR is discussed and opened, include the verification commands you ran and call out any user-facing behavior changes.

A new or changed detector follows `AGENTS.md`: a generic statement, evidence from unrelated
repositories, laws in the engine and a negative control for each new law.

## Local Workflow

Pulsar is a Rust CLI (`experiments/bend-pulsar/cli/`) and an engine written in Bend
(`experiments/bend-pulsar/engine/`). It needs Rust stable, Bend 2.0.40
(`experiments/bend-pulsar/packaging/bend-version`), clang 19+ and Lean 4.34 for the proof gate.

```bash
cd experiments/bend-pulsar
(cd cli && cargo test --release)
(cd engine && bend main.bend -o /tmp/e.c && clang -O2 -o pulsar-engine /tmp/e.c -lm -lpthread && bash test.sh)
(cd engine && bend PROOF.bend --verdict)
```

## Security

Do not open public issues for suspected vulnerabilities. Use the private reporting path in [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the MIT license used by this project.
