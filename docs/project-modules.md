# Project Modules

Project modules are executable calibration processors declared by a repository in `.pulsar/project-modules.json`.

Supported module refs:

- `repo-local`: a JavaScript/TypeScript module committed inside the target repository. The path must be relative to the repo root and must not escape it.
- `workspace`: a package resolved from the target repository's package graph.
- `package`: an installed package resolved from the target repository's `node_modules` or package root.

Pulsar fingerprints the module manifest, loaded module source, helper source files, and package source identity. Package modules are materialized in local Pulsar runtime state under `~/.config/pulsar/repos/<repo-id>/` for cache-busting; their declared package dependencies are linked from the package graph that resolved the module. Standalone binaries therefore support dependency-bearing package modules when those dependencies are installed with the module in the target repo.

If a package module import cannot be resolved, install the module and its dependencies in the target repo, or use a repo-local module with relative helper files.
