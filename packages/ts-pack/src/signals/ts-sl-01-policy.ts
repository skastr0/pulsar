import type { Diagnostic } from "@skastr0/pulsar-core"
import type { CloneGroup, CloneGroupMember, TsSl01Output } from "./ts-sl-01-model.js"
import { DEFAULT_SCORE_BUDGET_MIN_TOKENS } from "./ts-sl-01-model.js"

export const cloneMemberSummary = (members: ReadonlyArray<CloneGroupMember>): string => {
  const visible = members
    .slice(0, 3)
    .map((member) => `${member.file}:${member.startLine} ${member.name}`)
  const hidden = members.length - visible.length
  return hidden > 0 ? `${visible.join(", ")} (+${hidden} more)` : visible.join(", ")
}

export const cloneGroupImpact = (
  group: CloneGroup,
  scopeMode: TsSl01Output["scopeMode"],
  minTokens: number,
): number => {
  const extraMembers = Math.max(0, group.members.length - 1)
  if (extraMembers === 0) return 0

  if (group.kind === "exact") {
    if (group.tokenCount < 20 && minTokens >= DEFAULT_SCORE_BUDGET_MIN_TOKENS) return 0
    if (scopeMode === "whole-tree" && group.tokenCount < 20) return 0
    const isParallelImplementationFamily =
      scopeMode === "whole-tree" && isParallelImplementationFamilyClone(group.members)
    const isCompatibilityMirror =
      scopeMode === "whole-tree" && isCompatibilityMirrorClone(group.members)
    const isHistoricalMigration =
      scopeMode === "whole-tree" && isHistoricalMigrationClone(group.members)
    const memberPressure = isParallelImplementationFamily
      ? Math.log2(group.members.length)
      : scopeMode === "whole-tree" && group.tokenCount < 50
      ? Math.log2(group.members.length) * 0.5
      : extraMembers
    const familyWeight = isCompatibilityMirror
      ? 0.15
      : isHistoricalMigration
      ? 0.2
      : isParallelImplementationFamily
      ? 0.35
      : 1
    return memberPressure * 1.2 * Math.min(3, Math.max(0.3, group.tokenCount / 30)) * familyWeight
  }

  if (scopeMode === "changed-hunks") {
    return extraMembers * Math.min(1.5, Math.max(0.1, group.tokenCount / 60))
  }

  if (group.tokenCount < 30) return 0
  return extraMembers * Math.min(0.35, (group.tokenCount - 30) / 120)
}

const isParallelImplementationFamilyClone = (
  members: ReadonlyArray<CloneGroupMember>,
): boolean => {
  if (members.length < 2) return false
  if (isSiblingImplementationVariantClone(members)) return true

  const descriptors = members.map(parallelPackageDescriptor)
  if (descriptors.some((descriptor) => descriptor === undefined)) return false

  const packages = new Set(descriptors.map((descriptor) => descriptor!.packageName))
  if (packages.size < 2) return false

  const familyNames = new Set(descriptors.map((descriptor) => descriptor!.familyName))
  if (familyNames.size !== 1) return false

  const functionNames = new Set(members.map((member) => member.name))
  const relativeTails = new Set(descriptors.map((descriptor) => descriptor!.relativeTail))
  const basenames = new Set(descriptors.map((descriptor) => descriptor!.basename))
  return functionNames.size === 1 && (relativeTails.size === 1 || basenames.size === 1)
}

const isSiblingImplementationVariantClone = (
  members: ReadonlyArray<CloneGroupMember>,
): boolean => {
  const functionNames = new Set(members.map((member) => member.name))
  if (functionNames.size !== 1) return false

  const pathParts = members.map((member) =>
    member.file.replace(/\\/g, "/").split("/").filter((part) => part.length > 0),
  )
  const minLength = Math.min(...pathParts.map((parts) => parts.length))
  for (let familyIndex = 0; familyIndex < minLength - 3; familyIndex++) {
    const familyName = pathParts[0]?.[familyIndex]
    if (familyName === undefined) continue
    if (pathParts.some((parts) => parts[familyIndex] !== familyName)) continue

    const variants = new Set(pathParts.map((parts) => parts[familyIndex + 1]))
    if (variants.size < 2 || variants.has(undefined)) continue

    const tails = pathParts.map((parts) => parts.slice(familyIndex + 2).join("/"))
    if (tails.some((tail) => tail.split("/").length < 2)) continue
    if (new Set(tails).size === 1) return true
  }

  return false
}

const parallelPackageDescriptor = (
  member: CloneGroupMember,
):
  | {
      readonly familyName: string
      readonly packageName: string
      readonly relativeTail: string
      readonly basename: string
    }
  | undefined => {
  const parts = member.file.replace(/\\/g, "/").split("/")
  const packagesIndex = parts.lastIndexOf("packages")
  if (packagesIndex !== -1 && packagesIndex + 2 < parts.length) {
    const packageName = parts[packagesIndex + 1]
    if (packageName === undefined || packageName.length === 0) return undefined
    const tail = parts.slice(packagesIndex + 2).join("/")
    const basename = parts[parts.length - 1]
    if (tail.length === 0 || basename === undefined) return undefined
    return { familyName: parts.slice(0, packagesIndex + 1).join("/"), packageName, relativeTail: tail, basename }
  }
  return undefined
}

export const cloneGroupSeverity = (
  group: CloneGroup,
  scopeMode: TsSl01Output["scopeMode"],
  minTokens: number,
): Diagnostic["severity"] => {
  if (scopeMode === "whole-tree" && isCompatibilityMirrorClone(group.members)) return "info"
  if (scopeMode === "whole-tree" && isHistoricalMigrationClone(group.members)) return "info"
  if (group.kind === "exact") return group.tokenCount < 30 ? "info" : "warn"
  return cloneGroupImpact(group, scopeMode, minTokens) >= 5 ? "warn" : "info"
}

const isHistoricalMigrationClone = (
  members: ReadonlyArray<CloneGroupMember>,
): boolean => {
  if (members.length < 2) return false
  const functionNames = new Set(members.map((member) => member.name))
  if (functionNames.size !== 1) return false
  return members.every((member) => isMigrationPath(member.file))
}

const isMigrationPath = (file: string): boolean =>
  file
    .replace(/\\/g, "/")
    .split("/")
    .some((part) => /^(?:migrations?|db-migrations?|schema-migrations?)$/i.test(part))

const isCompatibilityMirrorClone = (
  members: ReadonlyArray<CloneGroupMember>,
): boolean => {
  if (members.length < 2) return false
  if (isVersionedSiblingFileClone(members)) return true
  return isCacheApiMirrorClone(members)
}

const isVersionedSiblingFileClone = (
  members: ReadonlyArray<CloneGroupMember>,
): boolean => {
  const functionNames = new Set(members.map((member) => member.name))
  if (functionNames.size !== 1) return false

  const parsed = members.map((member) => {
    const normalized = member.file.replace(/\\/g, "/")
    const slash = normalized.lastIndexOf("/")
    const dirname = slash === -1 ? "" : normalized.slice(0, slash)
    const filename = slash === -1 ? normalized : normalized.slice(slash + 1)
    const match = /^(.+?)(?:v?\d+)(\.[^.]+)$/.exec(filename)
    return match === null
      ? undefined
      : { dirname, filename, stem: `${match[1]}${match[2]}` }
  })

  if (parsed.some((entry) => entry === undefined)) return false
  return (
    new Set(parsed.map((entry) => entry!.filename)).size > 1 &&
    new Set(parsed.map((entry) => entry!.dirname)).size === 1 &&
    new Set(parsed.map((entry) => entry!.stem)).size === 1
  )
}

const isCacheApiMirrorClone = (
  members: ReadonlyArray<CloneGroupMember>,
): boolean => {
  if (members.length !== 2) return false
  const descriptors = members.map(packageTailDescriptor)
  if (descriptors.some((descriptor) => descriptor === undefined)) return false
  if (new Set(descriptors.map((descriptor) => descriptor!.packageRoot)).size !== 1) return false

  const [a, b] = descriptors as [
    { readonly packageRoot: string; readonly tail: string },
    { readonly packageRoot: string; readonly tail: string },
  ]
  return isCacheMirrorTail(a.tail, b.tail) || isCacheMirrorTail(b.tail, a.tail)
}

const isCacheMirrorTail = (rootTail: string, cacheTail: string): boolean => {
  const rootMatch = /^([^/]+)\.tsx?$/.exec(rootTail)
  if (rootMatch === null) return false
  return cacheTail.startsWith(`${rootMatch[1]}/cache/`)
}

const packageTailDescriptor = (
  member: CloneGroupMember,
): { readonly packageRoot: string; readonly tail: string } | undefined => {
  const parts = member.file.replace(/\\/g, "/").split("/")
  const packagesIndex = parts.lastIndexOf("packages")
  if (packagesIndex === -1 || packagesIndex + 2 >= parts.length) return undefined
  return {
    packageRoot: parts.slice(0, packagesIndex + 2).join("/"),
    tail: parts.slice(packagesIndex + 2).join("/"),
  }
}
