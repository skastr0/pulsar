export const requiresChangedScopeObservation = (
  changedOnly: boolean,
  headIsWorktree: boolean,
  changedHunkCount: number,
): boolean => changedOnly && headIsWorktree && changedHunkCount > 0
