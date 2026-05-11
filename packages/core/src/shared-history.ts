export {
  clamp01,
  type SharedHistoryFilterConfig,
} from "./shared-history-filter.js"
export {
  countCommitsInWindow,
  listTrackedFiles,
  readFileAtCommit,
  readHeadDate,
} from "./shared-history-git.js"
export {
  listAuthorsByTouchedFileInWindow,
  loadAuthorAliases,
  normalizeAuthor,
} from "./shared-history-authors.js"
export {
  listAddedLineCountInWindow,
  listAddedLinesByFileInMatureWindow,
} from "./shared-history-lines.js"
export { countFileLoc } from "./shared-history-files.js"
