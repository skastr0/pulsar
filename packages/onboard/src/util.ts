// Engine signal ids are full slugs ("TS-LD-02-function-size-distribution");
// the calibration catalog is keyed by the short code ("TS-LD-02"). Normalize
// both sides to the short code so a scan signal matches its catalog entry.
export const normalizeSignalId = (id: string): string => {
  const match = id.match(/^[A-Z]+(?:-[A-Z]+)*-\d+/)
  return match ? match[0] : id
}
