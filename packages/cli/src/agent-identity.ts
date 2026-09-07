import { createHash } from "node:crypto"
import { lstat, readFile, readlink } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { simpleGit } from "simple-git"
import { hashCalibrationValue } from "@skastr0/pulsar-core/calibration"
import {
  CANONICAL_CONTRACT_FRESHNESS_RELATIVE_PATH,
  CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
  CANONICAL_CONVENTIONS_RELATIVE_PATH,
  CANONICAL_GLOSSARY_RELATIVE_PATH,
} from "@skastr0/pulsar-core/reference-data"

/** Unlike the engine's cache key, this is byte identity, independent of HEAD/index state. */
export const agentInputFingerprint = (repoRoot: string): Effect.Effect<string, unknown> => Effect.tryPromise({
  try: async () => {
    const paths = await simpleGit(repoRoot).raw([
      "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ".",
      ":!.pulsar/cache", ":!.pulsar/timeseries", ":!.amp", ":!node_modules",
    ])
    const hash = createHash("sha256")
    for (const path of [...new Set(paths.split("\0").filter(Boolean))].sort()) {
      const absolute = join(repoRoot, path)
      let stat
      try { stat = await lstat(absolute) } catch (cause) {
        if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") continue
        throw cause
      }
      // Never pretend submodule directories or unreadable inputs are file bytes.
      if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Unsupported assessment input: ${path}`)
      hash.update(path).update("\0")
      if (stat.isSymbolicLink()) {
        hash.update("symlink:").update(await readlink(absolute)).update("\0")
      }
      hash.update(createHash("sha256").update(await readFile(absolute)).digest("hex")).update("\0")
    }
    return hash.digest("hex")
  },
  catch: (cause) => cause,
})

/** These are interpretation configuration, not generated coverage/contract facts. */
export const agentReferencePolicyFingerprint = (repoRoot: string): Effect.Effect<string, unknown> => Effect.tryPromise({
  try: async () => {
    const entries: Array<readonly [string, unknown]> = []
    for (const path of [
      CANONICAL_GLOSSARY_RELATIVE_PATH,
      CANONICAL_CONVENTIONS_RELATIVE_PATH,
      CANONICAL_CONTRACT_FRESHNESS_RELATIVE_PATH,
      CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
    ]) {
      try { entries.push([path, JSON.parse(await readFile(join(repoRoot, path), "utf8"))]) } catch (cause) {
        if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") continue
        throw cause
      }
    }
    return hashCalibrationValue(entries)
  },
  catch: (cause) => cause,
})
