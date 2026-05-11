export const ROOT_PACKAGE_NAME = "(root)" as const

export interface NamedPackage {
  readonly name: string
}

export const compareRootFirstPackageNames = (left: string, right: string): number => {
  if (left === ROOT_PACKAGE_NAME) return -1
  if (right === ROOT_PACKAGE_NAME) return 1
  return left.localeCompare(right)
}

export const sortRootFirstPackages = <T extends NamedPackage>(
  packages: ReadonlyArray<T>,
): ReadonlyArray<T> =>
  [...packages].sort((left, right) => compareRootFirstPackageNames(left.name, right.name))
