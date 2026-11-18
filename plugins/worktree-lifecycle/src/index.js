// dsh-worktree-lifecycle — HOST half.
//
// Two lifecycle behaviours for DSH-created Git worktrees:
//
//   1. CASCADE DELETE — when a Session is deleted (the removal frame every
//      delete path broadcasts as `api-session/removed`; the installed
//      @hualiong/dsh-session-delete emits it after it removed the log dir),
//      remove the DSH-created worktree and its `dsh-*` branch. Never a plain
//      project checkout, never a manually created worktree, never a branch
//      that is not `dsh-*`. Every step re-proves the checkout from the
//      filesystem (`<repo>/.git/worktrees/<name>` registration) before Git is
//      allowed to touch it.
//
//   2. CREATE HOOK — when a Session starts working inside a DSH-created
//      worktree, run the project's setup hook once:
//        <repo>/.dsh/worktree-create.json  {"run": ["cmd", "arg", ...]}
//        <repo>/.dsh/worktree-create.sh
//        <repo>/.dsh/worktree-create.d/*   (sorted, run in order)
//      The hook runs fire-and-forget with WORKTREE_PATH, WORKTREE_BRANCH,
//      WORKTREE_REPO and SESSION_ID in its environment. It never blocks or
//      fails the agent turn.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  canonical,
  classifyWorktree,
  cleanupWorktree,
  findHookSpec,
  readJson,
  runHookCommands,
  writeJsonAtomic,
} from './engine.js'

export const name = 'worktree-lifecycle'

// The plugin degrades to a no-op without these; all lookups are defensive so a
// terminal-only or headless composition still loads.
export const inject = []

export const Config = z.object({
  enabled: z.boolean().default(true).description(
    'Master switch: turn both the cascade delete and the create hook off.',
  ),
  cascadeDelete: z.boolean().default(true).description(
    'Remove the DSH-created worktree and its dsh-* branch when its Session is deleted.',
  ),
  runCreateHook: z.boolean().default(true).description(
    'Run <project>/.dsh/worktree-create.{json,sh} (and .d/. scripts) once per Session in a DSH worktree.',
  ),
  hookTimeoutMs: z.number().default(300_000).description('Per create-hook command timeout in milliseconds.'),
  gitTimeoutMs: z.number().default(120_000).description('Per Git maintenance command timeout in milliseconds.'),
  hookShell: z.string().default('/bin/sh').description('Shell used for worktree-create.sh and .d/ scripts.'),
  graceMs: z.number().default(5_000).description('Grace period handed to the subprocess seam on termination.'),
  maxOutputBytes: z.number().default(256 * 1024).description('Collected stdout/stderr cap per command.'),
  stateFile: z.string().default('').description(
    'State file path; empty means <DSH_HOME>/worktree-lifecycle.json.',
  ),
})

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const HOOK_STALE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_TRACKED_WORKTREES = 4

function normId(id) {
  return String(id).startsWith('session-') ? String(id).slice('session-'.length) : String(id)
}

function idVariants(id) {
  const raw = String(id)
  const variants = new Set([raw])
  if (raw.startsWith('session-')) variants.add(raw.slice('session-'.length))
  else variants.add(`session-${raw}`)
  return [...variants]
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function makeLog(ctx) {
  const logger = ctx.logger
  return (message, level = 'info') => {
    try {
      if (level === 'warn') logger?.warn?.(`worktree-lifecycle: ${message}`)
      else if (level === 'error') logger?.error?.(`worktree-lifecycle: ${message}`)
      else logger?.info?.(`worktree-lifecycle: ${message}`)
    } catch {
      /* logging never breaks a lifecycle operation */
    }
  }
}

// --- persistent state ---------------------------------------------------------
// One small JSON file owns both pieces of durable knowledge: which DSH-created
// worktrees belong to which Session, and which Session+worktree create hooks
// already ran. Session logs disappear on delete, so this file is what lets the
// cascade find a worktree after its Session record is gone.
class LifecycleState {
  constructor(file) {
    this.file = file
    this.data = null
    this.writing = Promise.resolve()
  }

  async load() {
    if (this.data !== null) return this.data
    const parsed = readJson(this.file)
    this.data = {
      version: 1,
      sessions: {},
      hooks: {},
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    }
    if (this.data.version !== 1) this.data = { version: 1, sessions: {}, hooks: {} }
    if (typeof this.data.sessions !== 'object' || this.data.sessions === null) this.data.sessions = {}
    if (typeof this.data.hooks !== 'object' || this.data.hooks === null) this.data.hooks = {}
    this.prune()
    return this.data
  }

  prune() {
    const now = Date.now()
    for (const [key, marker] of Object.entries(this.data.hooks)) {
      const at = typeof marker?.at === 'number' ? marker.at : 0
      if (now - at > HOOK_STALE_MS) delete this.data.hooks[key]
    }
  }

  session(id) {
    return this.data.sessions[id] ?? null
  }

  sessionEntries() {
    return Object.entries(this.data.sessions).map(([id, record]) => ({ id, ...record }))
  }

  /** Associate one Session with a proven DSH worktree; returns the record. */
  associate(sessionId, info) {
    const record = this.data.sessions[sessionId] ?? { cwd: null, worktrees: [] }
    record.cwd = info.cwd ?? record.cwd
    record.updatedAt = Date.now()
    const list = Array.isArray(record.worktrees) ? record.worktrees : []
    const existing = list.find((entry) => canonical(entry.path) === canonical(info.worktreePath))
    if (existing) {
      existing.repo = info.mainRepo
      existing.branch = info.branch
      existing.updatedAt = record.updatedAt
    } else {
      list.push({
        path: info.worktreePath,
        repo: info.mainRepo,
        branch: info.branch,
        at: record.updatedAt,
      })
      while (list.length > MAX_TRACKED_WORKTREES) list.shift()
    }
    record.worktrees = list
    this.data.sessions[sessionId] = record
    return record
  }

  setCwd(sessionId, cwd) {
    const record = this.data.sessions[sessionId] ?? { cwd: null, worktrees: [] }
    record.cwd = cwd
    record.updatedAt = Date.now()
    this.data.sessions[sessionId] = record
    return record
  }

  forgetSession(sessionId) {
    delete this.data.sessions[sessionId]
  }

  hookKey(sessionId, worktreePath) {
    return `${sessionId}::${worktreePath}`
  }

  hook(sessionId, worktreePath) {
    return this.data.hooks[this.hookKey(sessionId, worktreePath)] ?? null
  }

  markHook(sessionId, worktreePath, marker) {
    this.data.hooks[this.hookKey(sessionId, worktreePath)] = { at: Date.now(), ...marker }
  }

  async save() {
    const snapshot = JSON.parse(JSON.stringify(this.data))
    this.writing = this.writing
      .then(() => writeJsonAtomic(this.file, snapshot))
      .catch(() => {})
    return this.writing
  }
}

// --- subprocess seam ---------------------------------------------------------
// The host subprocess service when the composition has one; a plain Node spawn
// fallback for terminal-only profiles. Both return the same outcome shape and
// never leak a rejection for a non-zero exit code unless the caller asked for
// strict exit codes.
function createRunner(ctx, cfg, log) {
  return async function run(argv, options = {}) {
    // `ctx.get` instead of property access: the plugin declares no required
    // services, and Cordis refuses property access without an injection.
    // Resolved per call so a service mounted later is still picked up.
    const subprocess = ctx.get('subprocess')
    if (!Array.isArray(argv) || argv.length === 0) throw new Error('empty argv')
    const cwd = options.cwd ?? process.cwd()
    const timeoutMs = options.timeoutMs ?? cfg.gitTimeoutMs
    const maxBytes = options.maxOutputBytes ?? cfg.maxOutputBytes
    const stdoutMode = { maxBytes }
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('worktree-lifecycle: command timed out'))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    let outcome
    try {
      if (subprocess && typeof subprocess.spawn === 'function') {
        const executable = await subprocess.resolveExecutable(argv[0], undefined, controller.signal)
        const child = subprocess.spawn({
          argv: [executable, ...argv.slice(1)],
          cwd,
          env: { ...options.env },
          signal: controller.signal,
          graceMs: cfg.graceMs,
          stdio: { stdin: 'ignore', stdout: stdoutMode, stderr: stdoutMode },
        })
        try {
          const settled = await child.done
          const out = child.collected.stdout?.readFrom(0)?.text ?? ''
          const err = child.collected.stderr?.readFrom(0)?.text ?? ''
          outcome = { code: settled.exitCode, signal: settled.signal, stdout: out, stderr: err, timedOut }
        } catch (error) {
          outcome = { code: null, signal: null, stdout: '', stderr: errorText(error), timedOut }
        } finally {
          try {
            child.terminate()
          } catch {
            /* already gone */
          }
        }
      } else {
        outcome = await spawnWithNode(argv, {
          cwd,
          env: { ...process.env, ...options.env },
          maxBytes,
          controller,
          timedOut: () => timedOut,
        })
      }
    } catch (error) {
      outcome = { code: null, signal: null, stdout: '', stderr: errorText(error), timedOut }
    } finally {
      clearTimeout(timer)
    }
    const allowed = options.allowedExitCodes
    if (Array.isArray(allowed) && !allowed.includes(outcome.code)) {
      throw new Error(
        `${argv[0]} ${argv.slice(1).join(' ')} failed (${outcome.signal ?? outcome.code}${outcome.timedOut ? ', timeout' : ''}): ${outcome.stderr.trim().slice(-2000)}`,
      )
    }
    return outcome
  }
}

function spawnWithNode(argv, { cwd, env, maxBytes, controller, timedOut }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: null, signal: null, stdout: '', stderr: errorText(error), timedOut: false })
      return
    }
    let stdout = ''
    let stderr = ''
    const append = (current, chunk) => {
      const next = current + chunk
      return next.length > maxBytes ? next.slice(next.length - maxBytes) : next
    }
    child.stdout?.on('data', (chunk) => {
      stdout = append(stdout, String(chunk))
    })
    child.stderr?.on('data', (chunk) => {
      stderr = append(stderr, String(chunk))
    })
    const onAbort = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
    }
    controller.signal.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error) => {
      controller.signal.removeEventListener('abort', onAbort)
      resolve({ code: null, signal: null, stdout, stderr: `${stderr}${errorText(error)}`, timedOut: timedOut() })
    })
    child.on('close', (code, signal) => {
      controller.signal.removeEventListener('abort', onAbort)
      resolve({ code, signal, stdout, stderr, timedOut: timedOut() })
    })
  })
}

// --- session log helpers -----------------------------------------------------
function sessionsRoot() {
  return dshHomePath('sessions')
}

/** Every on-disk log directory for one Session id (any project slug). */
export function findSessionLogDirs(sessionId) {
  const root = sessionsRoot()
  let projects = []
  try {
    projects = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const project of projects) {
    if (!project.isDirectory()) continue
    for (const variant of idVariants(sessionId)) {
      const candidate = path.join(root, project.name, variant)
      try {
        if (fs.statSync(candidate).isDirectory()) found.push(candidate)
      } catch {
        /* keep scanning */
      }
    }
  }
  return found
}

// --- plugin ------------------------------------------------------------------
export 
// ---------------------------------------------------------------------------
// Settings UI transport: the Plugins page tab fetches and saves per-project
// create hooks through these two same-origin routes. The registry is the only
// source of project paths, so a request can never write outside a registered
// workspace.
// ---------------------------------------------------------------------------
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function isJsonRequest(req) {
  return String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')
}

function isSameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
    return url.host === req.headers.host
  } catch {
    return true
  }
}

function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > limit) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data.trim() === '' ? {} : JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function hookFileFor(projectPath) {
  return path.join(projectPath, '.dsh', 'worktree-create.json')
}

function readHookFile(projectPath) {
  const file = hookFileFor(projectPath)
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const run = Array.isArray(parsed?.run) ? parsed.run.filter((entry) => typeof entry === 'string') : []
    return { run, file, exists: true }
  } catch {
    return { run: [], file, exists: false }
  }
}

function listProjects(ctx) {
  const registry = ctx.get('workspaceRegistry')
  const workspaces = typeof registry?.list === 'function' ? registry.list() : []
  return workspaces.map((workspace) => {
    const hook = readHookFile(workspace.path)
    return {
      path: workspace.path,
      title: workspace.title || workspace.path,
      run: hook.run,
      hookFile: hook.file,
      hasHook: hook.exists,
      script: fs.existsSync(path.join(workspace.path, '.dsh', 'worktree-create.sh')),
      hookDir: fs.existsSync(path.join(workspace.path, '.dsh', 'worktree-create.d')),
    }
  })
}

function registerSettingsRoutes(ctx, host) {
  ctx.effect(() => host.register({
    kind: 'exact',
    path: '/worktree-lifecycle/hooks',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, projects: listProjects(ctx) })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        if (!isJsonRequest(req) || !isSameOrigin(req)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const body = await readJsonBody(req)
        const projectPath = typeof body?.path === 'string' ? body.path : ''
        const registry = ctx.get('workspaceRegistry')
        const workspaces = typeof registry?.list === 'function' ? registry.list() : []
        const known = workspaces.some((workspace) => workspace.path === projectPath)
        if (!known) {
          sendJson(res, 400, { ok: false, error: 'unknown project path' })
          return
        }
        const run = Array.isArray(body?.run) ? body.run.map((line) => String(line).trim()).filter(Boolean) : []
        const dir = path.join(projectPath, '.dsh')
        fs.mkdirSync(dir, { recursive: true })
        const file = hookFileFor(projectPath)
        const payload = JSON.stringify({ run }, null, 2) + '\n'
        const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
        fs.writeFileSync(tmp, payload, 'utf8')
        fs.renameSync(tmp, file)
        sendJson(res, 200, { ok: true, path: projectPath, file, run })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }))
}

function apply(ctx, config) {
  const cfg = {
    enabled: true,
    cascadeDelete: true,
    runCreateHook: true,
    hookTimeoutMs: 300_000,
    gitTimeoutMs: 120_000,
    hookShell: '/bin/sh',
    graceMs: 5_000,
    maxOutputBytes: 256 * 1024,
    stateFile: '',
    ...(config ?? {}),
  }
  if (cfg.enabled === false) return
  const log = makeLog(ctx)
  const stateFile = typeof cfg.stateFile === 'string' && cfg.stateFile.length > 0
    ? cfg.stateFile
    : dshHomePath('worktree-lifecycle.json')
  const state = new LifecycleState(stateFile)
  const run = createRunner(ctx, cfg, log)
  const hooksInFlight = new Set()
  const cascadesInFlight = new Set()

  const hookLogFile = (sessionId) =>
    dshHomePath('logs', 'worktree-lifecycle', `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.log`)

  const appendHookLog = (sessionId, text) => {
    try {
      const file = hookLogFile(sessionId)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, text)
    } catch {
      /* hook logging is best effort */
    }
  }

  // ---- create hook -------------------------------------------------------
  const maybeRunHook = (sessionId, info) => {
    if (!cfg.runCreateHook) return
    if (state.data === null) return
    const key = state.hookKey(sessionId, info.worktreePath)
    if (hooksInFlight.has(key)) return
    if (state.hook(sessionId, info.worktreePath)) return
    hooksInFlight.add(key)
    void (async () => {
      try {
        await state.load()
        if (state.hook(sessionId, info.worktreePath)) return
        const spec = findHookSpec({
          repo: info.mainRepo,
          worktreePath: info.worktreePath,
          shell: cfg.hookShell,
        })
        if (!spec || spec.commands.length === 0) {
          state.markHook(sessionId, info.worktreePath, { status: spec?.error ? 'invalid' : 'none', sessionId })
          await state.save()
          if (spec?.error) log(spec.error, 'warn')
          return
        }
        // Mark BEFORE the first command so a re-entrant working-directory
        // event cannot start a second copy.
        state.markHook(sessionId, info.worktreePath, { status: 'running', sessionId })
        await state.save()
        const env = {
          WORKTREE_PATH: info.worktreePath,
          WORKTREE_BRANCH: info.branch,
          WORKTREE_REPO: info.mainRepo,
          SESSION_ID: String(sessionId),
        }
        appendHookLog(sessionId, `\n=== ${new Date().toISOString()} hook start (${info.branch}) ===\n`)
        log(`running create hook from ${spec.base} for ${info.branch}`)
        const result = await runHookCommands({
          commands: spec.commands,
          cwd: info.worktreePath,
          env,
          timeoutMs: cfg.hookTimeoutMs,
          run,
          log,
        })
        for (const item of result.results) {
          appendHookLog(
            sessionId,
            `$ ${item.argv.join(' ')}\n${item.stdout ?? ''}${item.stderr ? `[stderr] ${item.stderr}` : ''}\n`,
          )
        }
        appendHookLog(sessionId, `=== ${new Date().toISOString()} hook ${result.ok ? 'ok' : 'FAILED'} ===\n`)
        const exitCode = result.results.at(-1)?.code ?? null
        state.markHook(sessionId, info.worktreePath, {
          status: result.ok ? 'ok' : 'failed',
          sessionId,
          exitCode,
        })
        await state.save()
        if (!result.ok) {
          log(`create hook failed for ${info.branch} (see ${hookLogFile(sessionId)})`, 'warn')
        }
      } catch (error) {
        log(`create hook crashed: ${errorText(error)}`, 'warn')
        try {
          state.markHook(sessionId, info.worktreePath, { status: 'error', sessionId, error: errorText(error) })
          await state.save()
        } catch {
          /* state writes are best effort here */
        }
      } finally {
        hooksInFlight.delete(key)
      }
    })()
  }

  // ---- tracking ----------------------------------------------------------
  const observe = (sessionId, cwd) => {
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return
    if (typeof cwd !== 'string' || cwd.length === 0) return
    void (async () => {
      try {
        await state.load()
        const info = classifyWorktree(cwd)
        if (!info) {
          if (!state.session(sessionId)?.cwd) {
            state.setCwd(sessionId, cwd)
            await state.save()
          }
          return
        }
        state.associate(sessionId, { cwd, ...info })
        await state.save()
        maybeRunHook(sessionId, info)
      } catch (error) {
        log(`failed to observe ${JSON.stringify(cwd)}: ${errorText(error)}`, 'warn')
      }
    })()
  }

  // A resumed Session starts with its header cwd and no new
  // working-directory/change event, so inspect what is on disk once.
  const seedFromSession = (session) => {
    const id = session?.id
    const cwd = session?.header?.cwd
    if (typeof id !== 'string') return
    if (typeof cwd === 'string' && cwd.length > 0) observe(id, cwd)
    void (async () => {
      const sq = ctx.get('sessionQuery')
      if (!sq || typeof sq.readSession !== 'function') return
      try {
        await state.load()
        if (state.session(id)?.worktrees?.length) return
        const snapshot = await sq.readSession(id)
        let lastCwd = null
        let forge = null
        for (const event of snapshot?.events ?? []) {
          if (event?.type === 'working-directory/change' && typeof event.data?.cwd === 'string') lastCwd = event.data.cwd
          if (event?.type === 'plugin:client-ui-forge/worktree' && event.data?.action === 'created') {
            forge = event.data.worktree ?? null
          }
        }
        if (forge && typeof forge.path === 'string' && typeof forge.branch === 'string') {
          const detected = classifyWorktree(forge.path)
          if (detected) {
            state.associate(id, { cwd: lastCwd ?? detected.worktreePath, ...detected })
            await state.save()
            maybeRunHook(id, detected)
            return
          }
        }
        if (lastCwd) observe(id, lastCwd)
      } catch {
        /* a cold-read failure just means less is known about this Session */
      }
    })()
  }

  // ---- cascade delete ----------------------------------------------------
  const cascade = (sessionId) => {
    if (!cfg.cascadeDelete) return
    if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) return
    if (cascadesInFlight.has(sessionId)) return
    cascadesInFlight.add(sessionId)
    void (async () => {
      try {
        await state.load()
        const record = state.session(sessionId)
        if (!record || !Array.isArray(record.worktrees) || record.worktrees.length === 0) {
          log(`no tracked worktree for removed Session ${sessionId}`)
          return
        }
        // `api-session/removed` also relays ordinary store disposal; only a
        // removal the storage corpus no longer knows is a real deletion.
        if (findSessionLogDirs(sessionId).length > 0) {
          log(`Session ${sessionId} still has a log on disk; not a deletion, skipping cascade`)
          return
        }
        const sq = ctx.get('sessionQuery')
        if (sq && typeof sq.listSessions === 'function') {
          try {
            const records = await sq.listSessions()
            if (records.some((record) => normId(record?.header?.id) === normId(sessionId))) {
              log(`Session ${sessionId} is still in the session corpus; not a deletion, skipping cascade`)
              return
            }
          } catch {
            /* an unavailable corpus falls back to the log-directory proof */
          }
        }
        const all = state.sessionEntries()
        const results = []
        for (const target of record.worktrees) {
          const owner = all.find(
            (entry) =>
              entry.id !== sessionId &&
              Array.isArray(entry.worktrees) &&
              entry.worktrees.some((other) => canonical(other.path) === canonical(target.path)),
          )
          if (owner) {
            log(`worktree ${target.path} is also tracked by Session ${owner.id}; refusing to remove it`, 'warn')
            results.push({ path: target.path, skipped: true, reasons: ['shared with another Session'] })
            continue
          }
          results.push(await cleanupWorktree({ target, run, log }))
        }
        state.forgetSession(sessionId)
        await state.save()
        const removed = results.filter((entry) => entry.removedWorktree || entry.removedBranch).length
        log(`cascade for ${sessionId}: ${removed}/${results.length} worktrees cleaned`)
      } catch (error) {
        log(`cascade delete failed for ${sessionId}: ${errorText(error)}`, 'warn')
      } finally {
        cascadesInFlight.delete(sessionId)
      }
    })()
  }

  // Before a delete path removes a Session that this process never loaded
  // (cold session), capture its directory and forge worktree record from the
  // on-disk log. `workspace/session-stop` is dispatched first by the official
  // archive and delete paths, so a cold Session can still be attributed.
  const captureColdSession = (sessionId) => {
    if (typeof sessionId !== 'string') return
    void (async () => {
      try {
        await state.load()
        if (state.session(sessionId)?.worktrees?.length) return
        const sq = ctx.get('sessionQuery')
        if (!sq || typeof sq.readSession !== 'function') return
        const snapshot = await sq.readSession(sessionId)
        let lastCwd = null
        let forge = null
        for (const event of snapshot?.events ?? []) {
          if (event?.type === 'working-directory/change' && typeof event.data?.cwd === 'string') lastCwd = event.data.cwd
          if (event?.type === 'plugin:client-ui-forge/worktree' && event.data?.action === 'created') {
            forge = event.data.worktree ?? null
          }
        }
        let info = forge ? classifyWorktree(forge.path) : null
        if (!info && lastCwd) info = classifyWorktree(lastCwd)
        if (!info) return
        state.associate(sessionId, { cwd: lastCwd ?? info.worktreePath, ...info })
        await state.save()
      } catch {
        /* best effort capture */
      }
    })()
  }

  ctx.on('session/created', (session) => seedFromSession(session))
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'working-directory/change') return
    observe(session.id, event.data?.cwd)
  })
  ctx.on('workspace/session-stop', (payload) => captureColdSession(payload?.sessionId))
  ctx.on('api-session/removed', (sessionId) => cascade(sessionId))

  ctx.inject(['webServer'], (sub) => registerSettingsRoutes(sub, sub.webServer))

  log(`loaded (state ${stateFile})`)
}

export default { name, inject, Config, apply }
