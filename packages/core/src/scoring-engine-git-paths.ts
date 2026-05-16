import { CANONICAL_CONTRACT_FRESHNESS_RELATIVE_PATH } from "./contract-freshness.js"
import { CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH } from "./domain-construction.js"
import {
  CANONICAL_CONVENTIONS_RELATIVE_PATH,
  CANONICAL_GLOSSARY_RELATIVE_PATH,
} from "./reference-data-loader.js"

export const isPulsarSource = (path: string): boolean =>
  path === CANONICAL_CONTRACT_FRESHNESS_RELATIVE_PATH ||
  path === CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH ||
  path === CANONICAL_CONVENTIONS_RELATIVE_PATH ||
  path === CANONICAL_GLOSSARY_RELATIVE_PATH ||
  path.startsWith(".github/workflows/") && (path.endsWith(".yml") || path.endsWith(".yaml")) ||
  path.endsWith(".ts") ||
  path.endsWith(".tsx") ||
  path.endsWith("package.json") ||
  path.endsWith("tsconfig.json") ||
  path.endsWith("tsconfig.base.json") ||
  path.endsWith("bun.lock") ||
  path.endsWith("bun.lockb") ||
  path.endsWith("pnpm-lock.yaml") ||
  path.endsWith("package-lock.json") ||
  path.endsWith("yarn.lock") ||
  path.endsWith(".rs") ||
  path.endsWith("Cargo.toml") ||
  path.endsWith("Cargo.lock")
