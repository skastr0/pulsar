import {
  type ObserverOutput,
  toObserverJson,
} from "@skastr0/pulsar-core/observer"
import { isAbsolute, relative, resolve } from "node:path"
import type { DiscoveredPulsarVector } from "./vector-discovery.js"

export const toScoreJson = (
  output: ObserverOutput,
  vectorSelection: DiscoveredPulsarVector,
  repoRoot: string,
): ReturnType<typeof toObserverJson> & {
  readonly vector: {
    readonly id: string
    readonly source: DiscoveredPulsarVector["source"]
    readonly trust_boundary: DiscoveredPulsarVector["trustBoundary"]
    readonly source_label: string
    readonly path?: string
  }
} => {
  const observerJson = toObserverJson(output)
  const signalDiagnostics = observerJson.signal_diagnostics === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(observerJson.signal_diagnostics).map(([signalId, snapshot]) => [
          signalId,
          {
            ...snapshot,
            diagnostics: snapshot.diagnostics.map((diagnostic) => {
              if (diagnostic.location === undefined) return diagnostic
              const file = portableDiagnosticFile(diagnostic.location.file, repoRoot)
              return file === diagnostic.location.file
                ? diagnostic
                : {
                    ...diagnostic,
                    location: {
                      ...diagnostic.location,
                      file,
                    },
                  }
            }),
          },
        ]),
      )

  return {
    ...observerJson,
    ...(signalDiagnostics !== undefined ? { signal_diagnostics: signalDiagnostics } : {}),
    vector: {
      id: vectorSelection.label,
      source: vectorSelection.source,
      trust_boundary: vectorSelection.trustBoundary,
      source_label: vectorSelection.sourceLabel,
      ...(vectorSelection.path !== undefined ? { path: vectorSelection.path } : {}),
    },
  }
}

const portableDiagnosticFile = (file: string, repoRoot: string): string => {
  const portable = isAbsolute(file) ? relative(resolve(repoRoot), file) : file
  const normalized = portable.replaceAll("\\", "/").replace(/^\.\/+/, "")
  return normalized.length > 0 ? normalized : "."
}
