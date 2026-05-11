import type { PackageInfo } from "./discovery.js"

export const nearestPackageForPath = (
  path: string,
  packages: ReadonlyArray<PackageInfo>,
): PackageInfo | undefined =>
  packages
    .slice()
    .sort((left, right) => right.path.length - left.path.length)
    .find((pkg) => path === pkg.path || path.startsWith(`${pkg.path}/`))
