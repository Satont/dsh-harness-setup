/**
 * dsh-workspace-profiles — Host half.
 *
 * Serves and persists the profile configuration for the browser half:
 *
 *   GET  /workspace-profiles/config  -> { version, activeProfileId, profiles }
 *   PUT  /workspace-profiles/config  <- the complete configuration (atomic write)
 *
 * The file lives at `$DSH_HOME/workspace-profiles.json` (DSH_HOME falls back
 * to `~/.dsh`). Nothing else is touched: the Workspace registry
 * (`~/.dsh/storages/workspace.json`), Session logs, and the profile's
 * cordis.patch.yml stay as they are.
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'

/** Plugin identity for the bundle patch row. */
export const name = 'dsh-workspace-profiles'

/** The HTTP carrier that owns the route table. */
export const inject = ['webServer']

/** One accepted configuration version. */
const VERSION = 1
/** A client bug, not a real profile set, can exceed this. */
const MAX_BODY_BYTES = 128 * 1024
const MAX_PROFILES = 24
const MAX_PATHS = 200
const MAX_NAME_LENGTH = 48
const MAX_PATH_LENGTH = 1024
/** Number of profile dot colors the client can render. */
const COLOR_COUNT = 6

/** Default configuration served when no file exists yet. */
export const EMPTY_CONFIG = Object.freeze({
  version: VERSION,
  activeProfileId: null,
  profiles: [],
})

/** Absolute path of the profile configuration file. */
export function configPath() {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : resolve(homedir(), '.dsh')
  return resolve(home, 'workspace-profiles.json')
}

/** Reject a configuration the browser half must not store. */
class ConfigError extends Error {}

/** Plain-text response helper. */
function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8')
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
  })
  res.end(body)
}

/** JSON response helper. */
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  })
  res.end(body)
}

/**
 * Validate one profile entry and return the normalized copy.
 * @param {unknown} raw - candidate entry.
 * @param {number} index - position, for error text.
 * @returns {{ id: string, name: string, color: number, paths: string[] }}
 */
function normalizeProfile(raw, index) {
  const where = `profiles[${index}]`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${where} must be an object`)
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new ConfigError(`${where}.id must be 1-64 characters of A-Z, a-z, 0-9, "_" or "-"`)
  }
  const rawName = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (rawName.length === 0 || rawName.length > MAX_NAME_LENGTH) {
    throw new ConfigError(`${where}.name must be 1-${MAX_NAME_LENGTH} characters`)
  }
  const color = Number.isInteger(raw.color) && raw.color >= 0 && raw.color < COLOR_COUNT
    ? raw.color
    : 0
  if (!Array.isArray(raw.paths) || raw.paths.length > MAX_PATHS) {
    throw new ConfigError(`${where}.paths must be a list of at most ${MAX_PATHS} paths`)
  }
  const paths = []
  const seen = new Set()
  for (const value of raw.paths) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH) {
      throw new ConfigError(`${where}.paths entries must be non-empty strings`)
    }
    if (!value.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(value)) {
      throw new ConfigError(`${where}.paths entries must be absolute paths`)
    }
    if (!seen.has(value)) {
      seen.add(value)
      paths.push(value)
    }
  }
  return { id, name: rawName, color, paths }
}

/**
 * Validate a complete configuration document.
 * @param {unknown} raw - parsed JSON.
 * @returns {{ version: number, activeProfileId: string | null, profiles: Array<{id: string, name: string, color: number, paths: string[]}> }}
 */
export function normalizeConfig(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError('configuration must be an object')
  }
  if (!Array.isArray(raw.profiles) || raw.profiles.length > MAX_PROFILES) {
    throw new ConfigError(`profiles must be a list of at most ${MAX_PROFILES} entries`)
  }
  const profiles = raw.profiles.map(normalizeProfile)
  const ids = new Set()
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new ConfigError(`duplicate profile id "${profile.id}"`)
    ids.add(profile.id)
  }
  const activeProfileId = typeof raw.activeProfileId === 'string' && ids.has(raw.activeProfileId)
    ? raw.activeProfileId
    : null
  return { version: VERSION, activeProfileId, profiles }
}

/**
 * Read the configuration, returning the empty one when the file is absent.
 * @param {string} file - absolute path.
 */
export async function readConfig(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return EMPTY_CONFIG
    throw error
  }
  if (text.trim() === '') return EMPTY_CONFIG
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(`workspace-profiles.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return normalizeConfig(parsed)
}

/**
 * Replace the configuration atomically (write beside the target, then rename).
 * Writes are serialized: two concurrent PUTs cannot interleave one temporary
 * file, and the last admitted write wins as a whole document.
 * @param {string} file - absolute path.
 * @param {unknown} config - already validated configuration.
 */
let writeChain = Promise.resolve()

export function writeConfig(file, config) {
  const task = async () => {
    const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`
    await mkdir(dirname(file), { recursive: true })
    try {
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
      await rename(temporary, file)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }
  const run = writeChain.then(task, task)
  writeChain = run.catch(() => {})
  return run
}

/**
 * Read a request body as UTF-8 text, rejecting oversized bodies.
 * @param {import('node:http').IncomingMessage} req - request.
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new ConfigError(`request body exceeds ${MAX_BODY_BYTES} bytes`)
    }
    chunks.push(buffer)
  }
  if (size === 0) throw new ConfigError('request body is empty')
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Mount the configuration route.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host root context.
 */
export function apply(ctx) {
  const file = configPath()
  const handler = async (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      try {
        const config = await readConfig(file)
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end()
          return
        }
        sendJson(res, 200, config)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendText(res, 500, `workspace-profiles: cannot read configuration: ${message}`)
      }
      return
    }
    if (req.method === 'PUT') {
      const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase()
      if (!contentType.includes('application/json')) {
        sendText(res, 415, 'workspace-profiles: PUT requires application/json')
        return
      }
      try {
        const raw = JSON.parse(await readBody(req))
        const config = normalizeConfig(raw)
        await writeConfig(file, config)
        sendJson(res, 200, config)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status = error instanceof SyntaxError ? 400 : error instanceof ConfigError ? 400 : 500
        sendText(res, status, `workspace-profiles: ${message}`)
      }
      return
    }
    res.writeHead(405, { Allow: 'GET, HEAD, PUT' })
    res.end()
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/workspace-profiles/config', handler }),
    'dsh-workspace-profiles: /workspace-profiles/config route',
  )
}
