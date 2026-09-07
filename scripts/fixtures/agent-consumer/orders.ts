import { appendFileSync } from "node:fs"
import { Effect } from "effect"
import {
  defineProcessor,
  defineProjectModule,
  tuneTypeScriptSize,
} from "@skastr0/pulsar-project-module-sdk"

// Smoke-test instrumentation lives outside the scored repository.
if (process.env.PULSAR_SMOKE_IMPORT_MARKER) {
  appendFileSync(process.env.PULSAR_SMOKE_IMPORT_MARKER, "import\n")
}

export default defineProjectModule({
  id: "order-service",
  version: "1.0.0",
  scope: "repository",
  processors: [defineProcessor({
    id: "order-service-size",
    slot: "typescript.size-policy",
    role: "factor-policy",
    fingerprint: "order-service-size-v1",
    process: (current, _context, runtime) => Effect.sync(() => {
      if (!current.value.file.endsWith("src/service.ts")) return current
      if (process.env.PULSAR_SMOKE_PROCESSOR_MARKER) {
        appendFileSync(process.env.PULSAR_SMOKE_PROCESSOR_MARKER, "size-policy\n")
      }
      return tuneTypeScriptSize(current, runtime, {
        maxLoc: current.value.kind === "file" ? 250 : 40,
        ruleId: "order-service.reviewable-size.v1",
        reason: "Order pricing code has a repository-owned review budget.",
        evidence: [{ kind: "path", value: current.value.file }],
      })
    }),
  })],
})
