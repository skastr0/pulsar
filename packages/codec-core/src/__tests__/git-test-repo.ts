import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface CommitOptions {
  readonly message: string
  readonly authorName?: string
  readonly authorEmail?: string
  readonly dateIso?: string
}

export interface GitTestRepo {
  readonly root: string
  readonly write: (relativePath: string, content: string) => Promise<void>
  readonly writeJson: (relativePath: string, value: unknown) => Promise<void>
  readonly commitAll: (options: CommitOptions) => Promise<string>
  readonly rename: (
    fromRelativePath: string,
    toRelativePath: string,
    options: CommitOptions,
  ) => Promise<string>
  readonly revParse: (ref: string) => string
  readonly cleanup: () => Promise<void>
}

export const createGitTestRepo = async (
  prefix: string,
): Promise<GitTestRepo> => {
  const root = await mkdtemp(join(tmpdir(), prefix))
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "test@example.com"])
  git(root, ["config", "user.name", "Taste Test"])
  git(root, ["config", "commit.gpgsign", "false"])

  return {
    root,
    write: async (relativePath, content) => {
      const fullPath = join(root, relativePath)
      await mkdir(join(fullPath, ".."), { recursive: true })
      await writeFile(fullPath, content, "utf8")
    },
    writeJson: async (relativePath, value) => {
      const fullPath = join(root, relativePath)
      await mkdir(join(fullPath, ".."), { recursive: true })
      await writeFile(fullPath, JSON.stringify(value, null, 2), "utf8")
    },
    commitAll: async (options) => {
      git(root, ["add", "."])
      git(root, ["commit", "-q", "-m", options.message], commitEnv(options))
      return revParse(root, "HEAD")
    },
    rename: async (fromRelativePath, toRelativePath, options) => {
      const destination = join(root, toRelativePath)
      await mkdir(join(destination, ".."), { recursive: true })
      git(root, ["mv", fromRelativePath, toRelativePath])
      git(root, ["commit", "-q", "-m", options.message], commitEnv(options))
      return revParse(root, "HEAD")
    },
    revParse: (ref) => revParse(root, ref),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

const commitEnv = (options: CommitOptions): Record<string, string> => {
  const authorName = options.authorName ?? "Taste Test"
  const authorEmail = options.authorEmail ?? "test@example.com"
  const dateIso = options.dateIso ?? "2024-01-01T00:00:00Z"

  return {
    ...process.env,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
    GIT_AUTHOR_DATE: dateIso,
    GIT_COMMITTER_DATE: dateIso,
  } as Record<string, string>
}

const git = (
  cwd: string,
  args: ReadonlyArray<string>,
  env?: Record<string, string>,
): void => {
  const result = spawnSync("git", [...args], {
    cwd,
    env: env === undefined ? undefined : { ...process.env, ...env },
    encoding: "utf8",
  })
  if (result.status === 0) return
  throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
}

const revParse = (cwd: string, ref: string): string => {
  const result = spawnSync("git", ["rev-parse", ref], {
    cwd,
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(`git rev-parse ${ref} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}
