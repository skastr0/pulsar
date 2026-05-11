export {
  clamp01,
  hasIncludedExtension,
  type SharedHistoryFilterConfig,
} from "./shared-history-filter.js"
export {
  countCommitsInWindow,
  execGit,
  listTrackedFiles,
  readFileAtCommit,
  readHeadDate,
} from "./shared-history-git.js"
export {
  listAuthorsByTouchedFileInWindow,
  loadAuthorAliases,
  normalizeAuthor,
  normalizeAuthorKey,
} from "./shared-history-authors.js"
export {
  listAddedLineCountInWindow,
  listAddedLinesByFileInMatureWindow,
} from "./shared-history-lines.js"
export { countFileLoc, fileExists } from "./shared-history-files.js"
