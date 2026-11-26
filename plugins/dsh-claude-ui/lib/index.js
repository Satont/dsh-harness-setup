/**
 * Host half of dsh-claude-ui.
 *
 * The browser half owns presentation; this half owns one small piece of durable
 * state: per-workspace icons (emoji or an uploaded image as a data URL), kept in
 * `$DSH_HOME/workspace-icons.json` so they survive reloads, browser switches and
 * profile restores.
 *
 * Route: `/claude-ui/workspace-icons`
 *   GET  → { version, icons: { [workspaceId]: { kind, value, mime?, updatedAt } } }
 *   PUT  → { workspaceId, icon: { kind: 'emoji' | 'image', value, mime? } | null }
 *          answers with the whole map after the merge.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { access } from 'node:fs/promises'

const ROUTE = '/claude-ui/workspace-icons'
const FILE_NAME = 'workspace-icons.json'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_ICON_BYTES = 300 * 1024
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,64}$/
const DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/

/** Absolute path of the icon store. */
export function iconStorePath(env = process.env) {
  const home = env.DSH_HOME?.trim()
  return home ? join(home, FILE_NAME) : join(homedir(), '.dsh', FILE_NAME)
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) throw new Error('request body is empty')
  return Buffer.concat(chunks).toString('utf8')
}

/** Read the store; a missing or unreadable file is an empty map, not an error. */
async function readIcons(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    const icons = parsed?.icons
    if (!icons || typeof icons !== 'object') return {}
    const clean = {}
    for (const [id, icon] of Object.entries(icons)) {
      if (!WORKSPACE_ID.test(id) || !icon || typeof icon !== 'object') continue
      if (icon.kind === 'emoji' && typeof icon.value === 'string' && icon.value.length <= 24) {
        clean[id] = { kind: 'emoji', value: icon.value, updatedAt: Number(icon.updatedAt) || 0 }
      } else if (icon.kind === 'image' && typeof icon.value === 'string' && DATA_URL.test(icon.value)) {
        clean[id] = {
          kind: 'image',
          value: icon.value,
          ...(typeof icon.mime === 'string' ? { mime: icon.mime.slice(0, 64) } : {}),
          updatedAt: Number(icon.updatedAt) || 0,
        }
      }
    }
    return clean
  } catch {
    return {}
  }
}

async function writeIcons(file, icons, updatedAt) {
  await mkdir(dirname(file), { recursive: true })
  const payload = JSON.stringify({ version: 1, updatedAt, icons }, null, 2)
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, payload, { mode: 0o600 })
  await rename(temp, file)
}

/** Accept one icon request; throws with a human reason when it is invalid. */
export function normalizeRequest(raw, now = Date.now()) {
  const workspaceId = String(raw?.workspaceId ?? '')
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error('workspaceId must be a workspace id')
  const icon = raw?.icon
  if (icon === null || icon === undefined) return { workspaceId, icon: null }
  if (typeof icon !== 'object') throw new Error('icon must be an object or null')
  if (icon.kind === 'emoji') {
    const value = String(icon.value ?? '')
    if (!value || value.length > 24) throw new Error('emoji icon needs a short value')
    return { workspaceId, icon: { kind: 'emoji', value, updatedAt: now } }
  }
  if (icon.kind === 'image') {
    const value = String(icon.value ?? '')
    if (!DATA_URL.test(value)) throw new Error('image icon needs a base64 image data URL')
    if (Buffer.byteLength(value, 'utf8') > MAX_ICON_BYTES) throw new Error('image icon is larger than 300 KB')
    const mime = typeof icon.mime === 'string' && /^image\//.test(icon.mime) ? icon.mime.slice(0, 64) : undefined
    return { workspaceId, icon: { kind: 'image', value, ...(mime ? { mime } : {}), updatedAt: now } }
  }
  throw new Error("icon.kind must be 'emoji' or 'image'")
}

/**
 * Mount the icon route.
 * @param ctx - Host context carrying the webServer service.
 */
export function apply(ctx) {
  const file = iconStorePath()
  const handler = async (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const icons = await readIcons(file)
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end()
        return
      }
      sendJson(res, 200, { version: 1, icons })
      return
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase()
      if (!contentType.includes('application/json')) {
        sendText(res, 415, 'claude-ui: icon updates require application/json')
        return
      }
      try {
        const request = normalizeRequest(JSON.parse(await readBody(req)))
        const icons = await readIcons(file)
        if (request.icon === null) delete icons[request.workspaceId]
        else icons[request.workspaceId] = request.icon
        await writeIcons(file, icons, Date.now())
        sendJson(res, 200, { version: 1, icons })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendText(res, error instanceof SyntaxError ? 400 : 400, `claude-ui: ${message}`)
      }
      return
    }
    res.writeHead(405, { Allow: 'GET, HEAD, PUT' })
    res.end()
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }),
    'dsh-claude-ui: /claude-ui/workspace-icons route',
  )

  const openHandler = async (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const editor = await firstEditor()
      sendJson(res, 200, { editor: editor ?? null, name: editor ? 'zed' : null })
      return
    }
    if (req.method !== 'POST' && req.method !== 'PUT') {
      res.writeHead(405, { Allow: 'GET, HEAD, POST' })
      res.end()
      return
    }
    const contentType = String(req.headers?.['content-type'] ?? '').toLowerCase()
    if (!contentType.includes('application/json')) {
      sendText(res, 415, 'claude-ui: opening a file requires application/json')
      return
    }
    let target
    try {
      const payload = JSON.parse(await readBody(req))
      target = String(payload?.path ?? '')
      if (!target || target.length > 4096 || target.includes('\u0000') || !isAbsolute(target)) {
        sendText(res, 400, 'claude-ui: path must be an absolute file path')
        return
      }
      const info = await stat(target)
      if (!info.isFile()) {
        sendText(res, 400, 'claude-ui: path is not a regular file')
        return
      }
    } catch (error) {
      sendText(res, 400, `claude-ui: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const editor = await firstEditor()
    if (!editor) {
      sendJson(res, 503, { opened: false, reason: 'no editor CLI on PATH (tried zeditor, zed, zed-editor)' })
      return
    }
    try {
      const child = spawn(editor, ['-n', target], { detached: true, stdio: 'ignore' })
      child.unref()
      sendJson(res, 200, { opened: true, editor })
    } catch (error) {
      sendText(res, 500, `claude-ui: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/claude-ui/open', handler: openHandler }),
    'dsh-claude-ui: /claude-ui/open route',
  )
}

/** Editor CLIs tried in order for "open in editor"; first existing one wins. */
const EDITOR_CLI = ['zeditor', 'zed', 'zed-editor']

async function firstEditor() {
  for (const candidate of EDITOR_CLI) {
    for (const dir of (process.env.PATH ?? '').split(':')) {
      if (!dir) continue
      const file = join(dir, candidate)
      try {
        await access(file)
        return file
      } catch {
        /* keep looking */
      }
    }
  }
  return undefined
}

export const inject = ['webServer']
