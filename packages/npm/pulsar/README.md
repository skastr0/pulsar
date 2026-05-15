# Pulsar CLI

This package is the npm runner entrypoint for Pulsar.

It exposes the `pulsar` command through a small Node launcher and delegates to the matching prebuilt Bun standalone binary package for the current platform.

```bash
npx @skastr0/pulsar --version
bunx @skastr0/pulsar --version
pnpm dlx @skastr0/pulsar --version
```

The source repository and package documentation live at <https://github.com/skastr0/pulsar>.
