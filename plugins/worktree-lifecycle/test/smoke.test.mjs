// Engine smoke test: real Git repositories under a throwaway /tmp directory.
// Everything here is destructive only inside that directory.
//
//   node --test test/
//
// The plugin half (lib/index.js) needs DSH's installation-scoped
// `@deepseek-ai/*` resolution and a live Cordis context; it is covered by the
// scratch-profile boot documented in README.md.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import {
  canonical,
  classifyWorktree,
  cleanupWorktree,
  findHookSpec,
  parseWorktreeList,
  runHookCommands,
} from '../lib/engine.js'

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-lifecycle-'))
process.on('exit', () => {
  fs.rmSync(BASE, { recursive: true, force: true })
})

function sh(cwd, argv, options = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
  })
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${argv.join(' ')} failed (${result.status}): ${result.stderr}`)
  }
  return result
}

/** The engine's `run` contract, backed by spawnSync. */
function nodeRun(argv, { cwd, env, timeoutMs = 30_000, allowedExitCodes, maxOutputBytes = 1 << 20 } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, ...env },
    maxBuffer: maxOutputBytes,
  })
  const outcome = {
    code: result.status,
    signal: result.signal ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.code === 'ETIMEDOUT',
  }
  if (Array.isArray(allowedExitCodes) && !allowedExitCodes.includes(outcome.code)) {
    throw new Error(`${argv.join(' ')} failed: ${outcome.stderr.trim()}`)
  }
  return outcome
}

function makeRepo(name, { branch = 'main' } = {}) {
  const repo = path.join(BASE, name)
  fs.mkdirSync(repo, { recursive: true })
  sh(repo, ['git', 'init', '-q', '-b', branch])
  sh(repo, ['git', 'config', 'user.email', 'smoke@example.invalid'])
  sh(repo, ['git', 'config', 'user.name', 'smoke'])
  fs.writeFileSync(path.join(repo, 'README.md'), `# ${name}\n`)
  sh(repo, ['git', 'add', '.'])
  sh(repo, ['git', 'commit', '-q', '-m', 'init'])
  return repo
}

function addWorktree(repo, branch, name = branch) {
  fs.mkdirSync(path.join(repo, '.agents', 'worktrees'), { recursive: true })
  const worktree = path.join(repo, '.agents', 'worktrees', name)
  sh(repo, ['git', 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD'])
  return worktree
}

test('classifyWorktree accepts a DSH-created linked worktree and its subdirectories', () => {
  const repo = makeRepo('classify')
  const worktree = addWorktree(repo, 'dsh-1234abcd-1a2b')
  const nested = path.join(worktree, 'src', 'deep')
  fs.mkdirSync(nested, { recursive: true })

  for (const cwd of [worktree, nested]) {
    const info = classifyWorktree(cwd)
    assert.ok(info, `expected detection for ${cwd}`)
    assert.equal(canonical(info.worktreePath), canonical(worktree))
    assert.equal(canonical(info.mainRepo), canonical(repo))
    assert.equal(info.branch, 'dsh-1234abcd-1a2b')
  }

  assert.equal(classifyWorktree(repo), null, 'plain checkout is never a worktree')
  assert.equal(classifyWorktree(path.join(repo, 'nope')), null)
  assert.equal(classifyWorktree(''), null)
  assert.equal(classifyWorktree(undefined), null)
})

test('classifyWorktree rejects manual checkouts and misplaced dsh branches', () => {
  const repo = makeRepo('reject')
  const manual = addWorktree(repo, 'feature/manual', 'manual')
  assert.equal(classifyWorktree(manual), null, 'branch must start with dsh-')

  // A dsh-* branch checked out outside the DSH pool is not ours.
  const outside = path.join(BASE, 'outside', 'dsh-99999999-aaaa')
  fs.mkdirSync(path.dirname(outside), { recursive: true })
  sh(repo, ['git', 'worktree', 'add', '-q', '-b', 'dsh-99999999-aaaa', outside, 'HEAD'])
  assert.equal(classifyWorktree(outside), null, 'outside the pool')

  // A forged `.git` file that does not point into a real registration.
  const forged = path.join(repo, '.agents', 'worktrees', 'forged')
  fs.mkdirSync(forged, { recursive: true })
  fs.writeFileSync(path.join(forged, '.git'), 'gitdir: /tmp/not-a-repo/.git/worktrees/forged\n')
  assert.equal(classifyWorktree(forged), null)
})

test('classifyWorktree accepts a renamed branch in a dsh-* pool directory', () => {
  const repo = makeRepo('renamed-classify')
  const worktree = addWorktree(repo, 'feature/renamed', 'dsh-aaaa0000-bbbb')
  const info = classifyWorktree(worktree)
  assert.ok(info, 'dsh-* directory name proves DSH ownership after a branch rename')
  assert.equal(info.branch, 'feature/renamed')
  assert.equal(canonical(info.mainRepo), canonical(repo))
})

test('cleanupWorktree removes a renamed-branch worktree but preserves the user branch', async () => {
  const repo = makeRepo('renamed-cleanup')
  const worktree = addWorktree(repo, 'feature/renamed-keep', 'dsh-bbbb1111-cccc')
  fs.writeFileSync(path.join(worktree, 'dirty.txt'), 'uncommitted\n')
  const info = classifyWorktree(worktree)

  const result = await cleanupWorktree({
    target: { path: worktree, repo: info.mainRepo, branch: info.branch },
    run: nodeRun,
  })

  assert.equal(result.skipped, false)
  assert.equal(result.removedWorktree, true)
  assert.equal(result.removedBranch, false)
  assert.equal(fs.existsSync(worktree), false, 'worktree directory removed')
  const branches = sh(repo, ['git', 'branch', '--format=%(refname:short)']).stdout
  assert.ok(branches.includes('feature/renamed-keep'), 'renamed user branch kept')
  assert.ok(result.reasons.some((line) => line.includes('preserved')), 'reason recorded')
})

test('cleanupWorktree handles a branch renamed after tracking', async () => {
  const repo = makeRepo('renamed-after')
  const worktree = addWorktree(repo, 'dsh-cccc2222-dddd')
  const info = classifyWorktree(worktree)
  sh(worktree, ['git', 'branch', '-m', 'feature/renamed-later'])

  const result = await cleanupWorktree({
    target: { path: worktree, repo: info.mainRepo, branch: info.branch },
    run: nodeRun,
  })

  assert.equal(result.skipped, false)
  assert.equal(result.removedWorktree, true)
  assert.equal(result.removedBranch, false)
  assert.equal(fs.existsSync(worktree), false)
  const branches = sh(repo, ['git', 'branch', '--format=%(refname:short)']).stdout
  assert.ok(branches.includes('feature/renamed-later'), 'renamed branch preserved')
})

test('cleanupWorktree removes only the DSH worktree and its dsh-* branch', async () => {
  const repo = makeRepo('cleanup')
  const keepSource = fs.readFileSync(path.join(repo, 'README.md'), 'utf8')
  const dsh = addWorktree(repo, 'dsh-aaaa1111-bbbb')
  const manual = addWorktree(repo, 'feature/keep', 'keep')
  fs.writeFileSync(path.join(dsh, 'dirty.txt'), 'uncommitted\n') // --force must handle this

  const info = classifyWorktree(dsh)
  const logs = []
  const result = await cleanupWorktree({
    target: { path: dsh, repo: info.mainRepo, branch: info.branch },
    run: nodeRun,
    log: (line) => logs.push(line),
  })

  assert.equal(result.removedWorktree, true)
  assert.equal(result.removedBranch, true)
  assert.equal(result.skipped, false)
  assert.equal(fs.existsSync(dsh), false, 'worktree directory removed')
  const branches = sh(repo, ['git', 'branch', '--format=%(refname:short)']).stdout
  assert.ok(!branches.includes('dsh-aaaa1111-bbbb'), 'dsh branch deleted')
  assert.ok(branches.includes('feature/keep'), 'unrelated branch kept')
  assert.ok(fs.existsSync(manual), 'unrelated worktree kept')
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), keepSource, 'source checkout untouched')

  const again = await cleanupWorktree({
    target: { path: dsh, repo: info.mainRepo, branch: info.branch },
    run: nodeRun,
  })
  assert.equal(again.removedWorktree, false)
  assert.equal(again.removedBranch, false)
})

test('cleanupWorktree refuses the project checkout and unproven paths', async () => {
  const repo = makeRepo('refuse')
  const branch = sh(repo, ['git', 'rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()

  const self = await cleanupWorktree({
    target: { path: repo, repo, branch: 'dsh-fake-0000' },
    run: nodeRun,
  })
  assert.equal(self.skipped, true)
  assert.ok(fs.existsSync(path.join(repo, 'README.md')), 'source checkout survives')

  const stranger = path.join(BASE, 'stranger')
  fs.mkdirSync(path.join(stranger, '.git'), { recursive: true })
  fs.writeFileSync(path.join(stranger, '.git', 'HEAD'), 'ref: refs/heads/dsh-evil\n')
  const refused = await cleanupWorktree({
    target: { path: stranger, repo, branch: 'dsh-evil' },
    run: nodeRun,
  })
  assert.equal(refused.skipped, true)
  assert.ok(fs.existsSync(stranger), 'unproven directory is never removed')

  const missing = await cleanupWorktree({
    target: { path: path.join(BASE, 'missing'), repo: null, branch: 'dsh-evil' },
    run: nodeRun,
  })
  assert.equal(missing.skipped, true)
  assert.equal(branch.length > 0, true)
})

test('create hook: spec discovery, environment, drop-ins, and failure reporting', async () => {
  const repo = makeRepo('hooks')
  const worktree = addWorktree(repo, 'dsh-hook0001-cccc')
  const marker = path.join(BASE, 'hook-out.txt')
  const order = path.join(BASE, 'hook-order.txt')
  const hookDir = path.join(repo, '.dsh')
  fs.mkdirSync(path.join(hookDir, 'worktree-create.d'), { recursive: true })
  fs.writeFileSync(
    path.join(hookDir, 'worktree-create.sh'),
    `#!/bin/sh\nprintf '%s|%s|%s|%s\\n' "$WORKTREE_PATH" "$WORKTREE_BRANCH" "$WORKTREE_REPO" "$SESSION_ID" > "${marker}"\necho hook-stdout\n`,
  )
  fs.writeFileSync(path.join(hookDir, 'worktree-create.d', '10-first.sh'), `#!/bin/sh\necho first >> "${order}"\n`)
  fs.writeFileSync(path.join(hookDir, 'worktree-create.d', '20-second.sh'), `#!/bin/sh\necho second >> "${order}"\n`)
  // A committed copy inside the worktree must not run twice.
  fs.mkdirSync(path.join(worktree, '.dsh'), { recursive: true })
  fs.writeFileSync(path.join(worktree, '.dsh', 'extra.sh'), '#!/bin/sh\nexit 0\n')

  const spec = findHookSpec({ repo, worktreePath: worktree })
  assert.ok(spec)
  assert.equal(canonical(spec.base), canonical(repo))
  assert.equal(spec.commands.length, 3)

  const outcome = await runHookCommands({
    commands: spec.commands,
    cwd: worktree,
    env: {
      WORKTREE_PATH: worktree,
      WORKTREE_BRANCH: 'dsh-hook0001-cccc',
      WORKTREE_REPO: repo,
      SESSION_ID: 'session-test-hook',
    },
    timeoutMs: 30_000,
    run: nodeRun,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.results.length, 3)
  assert.match(outcome.results[0].stdout, /hook-stdout/)
  assert.equal(
    fs.readFileSync(marker, 'utf8').trim(),
    `${worktree}|dsh-hook0001-cccc|${repo}|session-test-hook`,
  )
  assert.deepEqual(fs.readFileSync(order, 'utf8').trim().split('\n'), ['first', 'second'])

  const failing = await runHookCommands({
    commands: [['/bin/sh', '-c', 'echo boom >&2; exit 7']],
    cwd: worktree,
    env: {},
    timeoutMs: 30_000,
    run: nodeRun,
  })
  assert.equal(failing.ok, false)
  assert.equal(failing.results[0].code, 7)
})

test('create hook: JSON form, timeout, and absent hook', async () => {
  const repo = makeRepo('hooks-json')
  const worktree = addWorktree(repo, 'dsh-json-0001')
  const out = path.join(BASE, 'json-out.txt')
  fs.mkdirSync(path.join(repo, '.dsh'), { recursive: true })
  fs.writeFileSync(
    path.join(repo, '.dsh', 'worktree-create.json'),
    JSON.stringify({ run: ['/bin/sh', '-c', `printf ok > "${out}"`] }),
  )
  const spec = findHookSpec({ repo, worktreePath: worktree })
  assert.deepEqual(spec.commands, [['/bin/sh', '-c', `printf ok > "${out}"`]])
  const result = await runHookCommands({ commands: spec.commands, cwd: worktree, env: {}, run: nodeRun })
  assert.equal(result.ok, true)
  assert.equal(fs.readFileSync(out, 'utf8'), 'ok')

  const timed = await runHookCommands({
    commands: [['/bin/sh', '-c', 'sleep 5']],
    cwd: worktree,
    env: {},
    timeoutMs: 300,
    run: nodeRun,
  })
  assert.equal(timed.ok, false)

  const empty = makeRepo('hooks-none')
  assert.equal(findHookSpec({ repo: empty, worktreePath: empty }), null)
})

test('parseWorktreeList handles porcelain blocks', () => {
  const text = [
    'worktree /repo',
    'HEAD abc',
    'branch refs/heads/main',
    '',
    'worktree /repo/.agents/worktrees/dsh-1',
    'HEAD def',
    'branch refs/heads/dsh-1',
    'locked',
    '',
  ].join('\n')
  const records = parseWorktreeList(text)
  assert.equal(records.length, 2)
  assert.equal(records[1].branch, 'dsh-1')
  assert.equal(records[0].path, '/repo')
})
