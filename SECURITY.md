# Security Policy

## Supported Status

Pulsar is experimental and solo-maintained. Security reports are reviewed on a best-effort basis; there is no formal response SLA.

## Reporting A Vulnerability

Do not open a public issue for suspected vulnerabilities. Use GitHub private vulnerability reporting for this repository when it is enabled, or contact the maintainer directly if private reporting is not yet available.

Include:

- affected version or commit
- reproduction steps
- expected impact
- relevant logs or proof of concept with secrets removed

## Scope

In scope:

- CLI behavior and package installation paths
- generated release assets
- documented local workflows
- repository scoring behavior that could expose private data unexpectedly

Out of scope:

- third-party services
- user-provided credentials
- private repository configuration outside Pulsar's control
- local machine configuration unless Pulsar directly mishandles it
