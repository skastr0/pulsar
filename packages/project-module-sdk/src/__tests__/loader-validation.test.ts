import { expect, test } from "bun:test"
import { Effect } from "effect"
import { defineProjectModule } from "../definition.js"
import { loadEnabledProjectModules } from "../loader.js"
import { validateLoadedProjectModule } from "../loader-validation.js"

const ref = { id: "fixture", kind: "builtin" as const, enabled: true }
const processor = { id: "p", slot: "typescript.size-policy" as const, role: "factor-policy" as const, fingerprint: "p-v1", process: Effect.succeed }
const definition = { id: "fixture", version: "1", scope: "repository" as const, processors: [processor] }
test("validates definition and defined module boundaries", async () => {
  for (const value of [definition, defineProjectModule(definition)]) {
    const module = await Effect.runPromise(validateLoadedProjectModule(ref, "fixture", value))
    expect(module.descriptor.id).toBe("fixture")
  }
})
test("rejects invalid slots, roles, callables, IDs, scopes, priorities and duplicate processors", async () => {
  const invalid = [
    { ...definition, id: "different" }, { ...definition, scope: "personal" },
    ...[{ slot: "bogus" }, { process: undefined }, { role: "bogus" }, { priority: NaN }, { fingerprint: "" }].map((change) => ({ ...definition, processors: [{ ...processor, ...change }] })),
    { ...definition, processors: [processor, processor] },
  ]
  for (const value of invalid) {
    await expect(Effect.runPromise(validateLoadedProjectModule(ref, "fixture", value))).rejects.toMatchObject({ _tag: "ProjectModuleLoadError" })
  }
})
test("rejects inconsistent descriptors, active identity and processor identity", async () => {
  const module = defineProjectModule(definition)
  for (const value of [
    { ...module, descriptor: { ...module.descriptor, contributions: [] } },
    { ...module, activeModule: { ...module.activeModule, id: "forged" } },
    { ...module, processors: module.processors.map((p) => ({ ...p, moduleId: "other" })) },
  ]) {
    await expect(Effect.runPromise(validateLoadedProjectModule(ref, "fixture", value))).rejects.toMatchObject({ _tag: "ProjectModuleLoadError" })
  }
})
test("duplicate refs fail before loading", async () => {
  await expect(Effect.runPromise(loadEnabledProjectModules({ schema: "pulsar/project-modules/v1", modules: [ref, ref] }, { repoRoot: "/nonexistent" }))).rejects.toMatchObject({ message: "Duplicate project module ref fixture" })
})
