// dsh-worktree-lifecycle — pure filesystem/git engine.
//
// Everything in this module is testable without a Cordis context: it takes a
// `run(argv, opts)` command adapter and plain paths. The plugin glue
// (src/index.js) supplies the host subprocess seam and the event wiring.
import fs from 'node:fs'
import path from 'node:path'

/** Branch prefix that marks a DSH-created worktree branch. */
export const BRANCH_PREFIX = 'dsh-'

/** Directory prefix that marks a DSH-created worktree even after its branch was renamed. */
export const WORKTREE_NAME_PREFIX = 'dsh-'
/** Checkout pools used by DSH worktree creators, relative to the project root. */
export const POOL_SEGMENTS = [
  ['.agents', 'worktrees'],
  ['.dsh', 'worktrees'],
]

/** Canonicalize a path without requiring a real filesystem entry. */
export function canonical(p) {
  const resolved = path.resolve(p)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

function statOrNull(p) {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

function readTextOrNull(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/** Parse a `gitdir: <path>` `.git` file, resolving relative targets. */
export function parseGitFile(gitFile) {
  const text = readTextOrNull(gitFile)
  if (text === null) return null
  const match = /^\s*gitdir:\s*(.+?)\s*$/m.exec(text)
  if (!match) return null
  return path.resolve(path.dirname(gitFile), match[1])
}

/**
 * Walk up from `startDir` to the nearest directory that owns a `.git` entry.
 * @returns `{root, kind: 'checkout' | 'linked'}` or null when there is none.
 */
export function inspectCheckout(startDir) {
  let dir = path.resolve(startDir)
  for (;;) {
    const gitPath = path.join(dir, '.git')
    const info = statOrNull(gitPath)
    if (info) {
      if (info.isDirectory()) return { root: dir, kind: 'checkout' }
      if (info.isFile()) return { root: dir, kind: 'linked' }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Detect a DSH-created linked worktree from a session working directory.
 *
 * The detection never trusts the caller-supplied branch alone. It requires:
 *   - the nearest checkout root has a `.git` FILE (a linked worktree, never a
 *     plain project checkout);
 *   - that file resolves to `<main>/.git/worktrees/<name>`;
 *   - the worktree lives under `<something>/.agents/worktrees/` or
 *     `<something>/.dsh/worktrees/` (the DSH pools);
 *   - `<gitdir>/gitdir` points back at this worktree's `.git` file
 *     (Git's own registration proof);
 *   - the worktree HEAD branch starts with `dsh-`, **or** the worktree was
 *     created under a `dsh-*` directory name in a DSH pool (a renamed branch
 *     must not orphan the worktree).
 *
 * @returns `{worktreePath, mainRepo, gitdir, name, branch}` or null.
 */
export function classifyWorktree(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null
  const checkout = inspectCheckout(cwd)
  if (!checkout || checkout.kind !== 'linked') return null

  const worktreePath = checkout.root
  const gitFile = path.join(worktreePath, '.git')
  const gitdir = parseGitFile(gitFile)
  if (gitdir === null) return null

  const worktreesDir = path.dirname(gitdir)
  const dotGit = path.dirname(worktreesDir)
  if (path.basename(worktreesDir) !== 'worktrees' || path.basename(dotGit) !== '.git') return null
  const mainRepo = path.dirname(dotGit)
  if (mainRepo === worktreePath) return null
  if (!statOrNull(path.join(mainRepo, '.git'))) return null

  const name = path.basename(gitdir)
  const poolDir = path.dirname(worktreePath)
  const poolParent = path.dirname(poolDir)
  const inPool = POOL_SEGMENTS.some(
    ([outer, inner]) => path.basename(poolParent) === outer && path.basename(poolDir) === inner,
  )
  if (!inPool) return null

  // Git's own registration: <gitdir>/gitdir names the worktree's `.git` file.
  const back = readTextOrNull(path.join(gitdir, 'gitdir'))
  if (back === null) return null
  if (canonical(back.trim()) !== canonical(gitFile)) return null

  const head = readTextOrNull(path.join(gitdir, 'HEAD'))
  const headMatch = head === null ? null : /^ref:\s*refs\/heads\/(.+?)\s*$/.exec(head)
  const branch = headMatch ? headMatch[1] : null
  const branchOwned = branch !== null && branch.startsWith(BRANCH_PREFIX)
  const directoryOwned = name.startsWith(WORKTREE_NAME_PREFIX) && path.basename(worktreePath) === name
  if (!branchOwned && !directoryOwned) return null

  return { worktreePath, mainRepo, gitdir, name, branch }
}

/** True when `child` is `parent` or lies underneath it (string containment). */
export function isWithin(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Parse `git worktree list --porcelain` into `{path, branch}` records.
 */
export function parseWorktreeList(text) {
  const records = []
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null, bare: false }
      records.push(current)
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (current && line === 'bare') {
      current.bare = true
    }
  }
  return records
}

/**
 * Remove one DSH-created worktree; delete its `dsh-*` branch when it still has one.
 *
 * Safety invariants (any failure aborts the step, never falls back to rm -rf):
 *   1. the path must be a linked worktree registered in the main repo's
 *      `.git/worktrees/` and live inside a DSH pool at the time we look;
 *   2. the path must never equal the main project checkout;
 *   3. a `dsh-*` branch must not be checked out in any other registered worktree;
 *      a renamed user branch is preserved (only the worktree is removed);
 *   4. `git worktree remove --force` must actually deregister the path before
 *      the branch is deleted.
 * The function is idempotent: a missing path just prunes a stale registration.
 *
 * @returns `{removedWorktree, removedBranch, skipped, reasons}`.
 */
export async function cleanupWorktree({ target, run, log = () => {} }) {
  const result = {
    path: target?.path ?? null,
    branch: target?.branch ?? null,
    removedWorktree: false,
    removedBranch: false,
    prunedRegistration: false,
    skipped: false,
    reasons: [],
  }
  const skip = (reason) => {
    result.skipped = true
    result.reasons.push(reason)
    log(`skip ${target?.path ?? '<none>'}: ${reason}`)
    return result
  }

  const recordedPath = target?.path ? canonical(target.path) : null
  const recordedBranch = typeof target?.branch === 'string' ? target.branch : null
  if (!recordedPath) return skip('no recorded worktree path')

  let detectedBranch = recordedBranch
  const exists = statOrNull(recordedPath)
  let mainRepo = target?.repo ? canonical(target.repo) : null
  if (exists) {
    const info = statOrNull(recordedPath)
    if (!info || !info.isDirectory()) return skip('recorded path is not a directory')
    const detected = classifyWorktree(recordedPath)
    if (!detected) return skip('path is not a proven DSH-created worktree')
    if (canonical(detected.worktreePath) !== recordedPath) return skip('classification resolved a different path')
    if (mainRepo !== null && canonical(detected.mainRepo) !== mainRepo) {
      return skip('recorded repository does not match the worktree registration')
    }
    mainRepo = canonical(detected.mainRepo)
    detectedBranch = detected.branch ?? recordedBranch
    if (isWithin(recordedPath, mainRepo)) return skip('worktree path contains the main checkout')
  } else {
    if (mainRepo === null) return skip('worktree is already gone and no repository was recorded')
    if (!statOrNull(path.join(mainRepo, '.git'))) return skip('recorded repository is gone')
  }

  if (mainRepo === null) return skip('no repository resolved')
  if (canonical(mainRepo) === recordedPath) return skip('path is the main checkout')
  const branchToDelete = detectedBranch !== null && detectedBranch.startsWith(BRANCH_PREFIX)
    ? detectedBranch
    : null

  const git = (args, allowed = [0]) => run(['git', ...args], { cwd: mainRepo, allowedExitCodes: allowed })

  let listed
  try {
    listed = parseWorktreeList((await git(['worktree', 'list', '--porcelain'])).stdout)
  } catch (error) {
    return skip(`cannot list worktrees: ${errorText(error)}`)
  }
  const registered = listed.find((entry) => canonical(entry.path) === recordedPath) ?? null

  if (exists) {
    if (registered === null) return skip('path exists but is not a registered worktree')
    let removal
    try {
      removal = await git(['worktree', 'remove', '--force', recordedPath])
    } catch (error) {
      return skip(`git worktree remove failed: ${errorText(error)}`)
    }
    if (statOrNull(recordedPath)) return skip(`git worktree remove left the path behind: ${removal.stderr.trim()}`)
    result.removedWorktree = true
    log(`removed worktree ${recordedPath}`)
  } else {
    if (registered !== null) {
      try {
        await git(['worktree', 'prune'])
        result.prunedRegistration = true
        log(`pruned stale registration for ${recordedPath}`)
      } catch (error) {
        return skip(`git worktree prune failed: ${errorText(error)}`)
      }
    }
  }

  // Re-read the registrations after removal/prune: the branch must not be in
  // use by any other checkout (git itself refuses in that case, but a clear
  // skip is cheaper than an expected failure).
  try {
    listed = parseWorktreeList((await git(['worktree', 'list', '--porcelain'])).stdout)
  } catch (error) {
    return skip(`cannot re-list worktrees: ${errorText(error)}`)
  }
  if (branchToDelete === null) {
    const detail = `branch ${JSON.stringify(detectedBranch)} preserved (not dsh-*)`
    result.reasons.push(detail)
    log(detail)
    return result
  }
  const user = listed.find((entry) => entry.branch === branchToDelete)
  if (user) return skip(`branch ${branchToDelete} is still checked out at ${user.path}`)
  if (listed.some((entry) => canonical(entry.path) === recordedPath)) {
    return skip('worktree registration survived removal')
  }

  try {
    await git(['branch', '-D', branchToDelete])
    result.removedBranch = true
    log(`deleted branch ${branchToDelete}`)
  } catch (error) {
    // A missing branch (already deleted manually) is fine; report it.
    const text = errorText(error)
    result.reasons.push(`branch delete failed: ${text}`)
    log(`branch ${branchToDelete} not deleted: ${text}`)
  }
  return result
}

function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Read a JSON file, returning undefined for a missing/invalid file. */
export function readJson(file) {
  const text = readTextOrNull(file)
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Write a JSON file atomically (temp file + rename in the same directory). */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

/**
 * Resolve the per-project create-hook commands.
 *
 * Order inside one base directory: `worktree-create.json` (`run: [...]`),
 * `worktree-create.sh`, then `worktree-create.d/*` sorted by name. The first
 * base directory that yields any spec wins, so a committed copy in the
 * worktree does not run twice.
 *
 * @returns `{base, commands: string[][]}` or null when the project has no hook.
 */
export function findHookSpec({ repo, worktreePath, shell = '/bin/sh' }) {
  const bases = [repo, worktreePath].filter((value, index, all) => typeof value === 'string' && all.indexOf(value) === index)
  for (const base of bases) {
    const commands = []
    const dir = path.join(base, '.dsh')
    const json = readJson(path.join(dir, 'worktree-create.json'))
    if (json !== undefined) {
      if (!Array.isArray(json?.run) || json.run.length === 0 || !json.run.every((part) => typeof part === 'string')) {
        return { base, commands: [], error: 'worktree-create.json must be {"run": ["cmd", ...]}' }
      }
      commands.push(json.run)
    }
    const script = path.join(dir, 'worktree-create.sh')
    if (statOrNull(script)?.isFile()) commands.push([shell, script])
    const dropIn = path.join(dir, 'worktree-create.d')
    const dropInInfo = statOrNull(dropIn)
    if (dropInInfo?.isDirectory()) {
      const files = fs
        .readdirSync(dropIn)
        .filter((name) => !name.startsWith('.'))
        .map((name) => path.join(dropIn, name))
        .filter((file) => statOrNull(file)?.isFile())
        .sort()
      for (const file of files) commands.push([shell, file])
    }
    if (commands.length > 0) return { base, commands }
  }
  return null
}

/** Run every hook command sequentially; stop at the first failure. */
export async function runHookCommands({ commands, cwd, env, timeoutMs, run, log = () => {} }) {
  const results = []
  for (const argv of commands) {
    log(`hook: ${argv.join(' ')}`)
    const outcome = await run(argv, { cwd, env, timeoutMs })
    results.push({ argv, ...outcome })
    if (outcome.code !== 0) {
      log(`hook failed (${outcome.signal ?? outcome.code}): ${argv.join(' ')}`)
      return { ok: false, results }
    }
  }
  return { ok: true, results }
}
