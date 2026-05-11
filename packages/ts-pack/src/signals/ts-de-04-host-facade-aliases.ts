export const inferHostFacadeAlias = (
  hostPackageName: string,
  specifiers: ReadonlySet<string>,
  productionDeclared: ReadonlySet<string>,
  devDeclared: ReadonlySet<string>,
  typeOnlyUsage: boolean,
): string | undefined => {
  if (hostPackageName === "vscode" && devDeclared.has("@types/vscode")) return "@types/vscode"
  if (typeOnlyUsage) {
    const definitelyTypedPackage = definitelyTypedPackageNameFor(hostPackageName)
    if (
      definitelyTypedPackage !== undefined &&
      (productionDeclared.has(definitelyTypedPackage) || devDeclared.has(definitelyTypedPackage))
    ) {
      return definitelyTypedPackage
    }
  }
  const pluginSdkPrefix = `${hostPackageName}/plugin-sdk`
  if (
    specifiers.size === 0 ||
    ![...specifiers].every(
      (specifier) => specifier === pluginSdkPrefix || specifier.startsWith(`${pluginSdkPrefix}/`),
    )
  ) {
    return undefined
  }
  const declaredPluginSdkPackages = [...productionDeclared, ...devDeclared]
    .filter((dependencyName) => dependencyName.endsWith("/plugin-sdk"))
    .sort((left, right) => left.localeCompare(right))
  return declaredPluginSdkPackages.length === 1 ? declaredPluginSdkPackages[0] : undefined
}

const definitelyTypedPackageNameFor = (packageName: string): string | undefined => {
  if (packageName.startsWith("@types/")) return undefined
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.slice(1).split("/")
    return scope !== undefined && name !== undefined ? `@types/${scope}__${name}` : undefined
  }
  return `@types/${packageName}`
}
