/**
 * Sidebar composition for the DSH web shell.
 *
 * The stock sidebar puts Workspaces in the middle of the scroll region and the
 * account chip under it. This module recomposes it:
 *
 *   logo row (brand · gear · collapse)
 *   new session
 *   global panels (Plugins, Artifacts, …)
 *   ── flexible gap ──
 *   Limits card
 *   workspace profile chips
 *   Workspaces list (pinned to the bottom)
 *
 * It also removes the signed-in account chip and the broken Projects block the
 * threads plugin renders into a fixed 8px grid row (its header overlapped the
 * panel list).
 *
 * Nothing here is React state: the moved nodes are portal targets, so moving
 * the element keeps React rendering into it. A MutationObserver re-applies the
 * layout whenever the shell re-renders.
 */

const GEAR_ATTR = 'data-claude-settings-gear'

const GEAR_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="3.2"/>' +
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.5.66.87 1.2.99H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
  '</svg>'

/** Ask the shell to open its settings dialog. */
function openSettings() {
  const direct = globalThis.__claudeOpenSettings
  if (typeof direct === 'function') {
    try {
      direct()
      return
    } catch (error) {
      console.warn('dsh-claude-ui: settings opener failed', error)
    }
  }
  // Fallback: the account chip (hidden by CSS, still mounted) opens a menu whose
  // first entry is Settings.
  const trigger =
    document.querySelector('[data-slot="sidebar.settings"] button[aria-haspopup="menu"]') ??
    document.querySelector('.hHd-Xa_settingsArea button')
  if (!trigger) return
  trigger.click()
  setTimeout(() => {
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
    const item = items.find((el) => /settings|настройк|设置/i.test(el.textContent ?? '')) ?? items[0]
    item?.click()
  }, 50)
}

function ensureGear(logoRow) {
  if (logoRow.querySelector(`[${GEAR_ATTR}]`)) return
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dsh-claude-gear'
  button.setAttribute(GEAR_ATTR, '')
  button.setAttribute('aria-label', 'Settings')
  button.setAttribute('title', 'Settings')
  button.innerHTML = GEAR_SVG
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    openSettings()
  })
  logoRow.appendChild(button)
}

/**
 * Custom workspace icons.
 *
 * A workspace icon is an emoji or an uploaded image; the choice is stored on the
 * host (`$DSH_HOME/workspace-icons.json` via `/claude-ui/workspace-icons`) so it
 * survives reloads, browser switches and profile restores. Clicking a
 * workspace's folder glyph opens the picker; session rows are untouched.
 */
const ICON_ROUTE = '/claude-ui/workspace-icons'
const ICON_FALLBACK_KEY = 'dsh-claude-ui:workspace-icons'
const MAX_ICON_BYTES = 300 * 1024
const ICON_CHOICES = [
  '📁', '🚀', '🧪', '🛠', '🐛', '💻', '🧠', '📦',
  '🗄', '☁️', '🔧', '🎨', '🎮', '📝', '📚', '🧩',
  '⚙️', '🔬', '🧵', '🌐', '🔒', '🏗', '🧮', '🎯',
  '🪄', '🍀', '🌙', '⭐', '🔥', '💾', '🧭', '🐳',
]

let iconCache = {}
let iconPicker = null

function readFallbackIcons() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(ICON_FALLBACK_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeFallbackIcons(icons) {
  try {
    globalThis.localStorage?.setItem(ICON_FALLBACK_KEY, JSON.stringify(icons))
  } catch {
    /* storage blocked: the host copy is the source of truth anyway */
  }
}

async function requestIcons(method, body) {
  const response = await fetch(ICON_ROUTE, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(`icon store answered ${response.status}`)
  return response.json()
}

/** Load icons once from the host; fall back to localStorage when it is absent. */
async function loadWorkspaceIcons() {
  try {
    const data = await requestIcons('GET')
    const icons = data?.icons
    if (icons && typeof icons === 'object') {
      // Icons chosen before the host half answered on this browser only: push
      // them once and drop the local copy.
      const local = readFallbackIcons()
      const missing = Object.entries(local).filter(([id]) => !(id in icons))
      for (const [id, icon] of missing) {
        try {
          const saved = await requestIcons('PUT', { workspaceId: id, icon })
          if (saved?.icons && typeof saved.icons === 'object') Object.assign(icons, saved.icons)
        } catch {
          /* keep it local and try again next load */
        }
      }
      iconCache = icons
      if (missing.length > 0 && Object.keys(readFallbackIcons()).length > 0) {
        writeFallbackIcons({})
      }
      paintWorkspaceIcons()
      return
    }
  } catch {
    /* host half may not be reloaded yet — use the local copy */
  }
  iconCache = readFallbackIcons()
  paintWorkspaceIcons()
  decorateWorkspaceMenu()
}

async function saveWorkspaceIcon(id, icon) {
  const previous = iconCache
  if (icon) iconCache = { ...iconCache, [id]: { ...icon, updatedAt: Date.now() } }
  else {
    iconCache = { ...iconCache }
    delete iconCache[id]
  }
  paintWorkspaceIcons()
  try {
    const data = await requestIcons('PUT', { workspaceId: id, icon })
    if (data?.icons && typeof data.icons === 'object') iconCache = data.icons
    writeFallbackIcons(iconCache)
  } catch {
    writeFallbackIcons(iconCache)
  }
  paintWorkspaceIcons()
}

/** Shrink a raster upload to a small PNG data URL; SVGs are kept as they are. */
async function readIconFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('cannot read the file'))
    reader.readAsDataURL(file)
  })
  const isSvg = /^data:image\/svg\+xml/.test(dataUrl)
  if (!isSvg) {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('cannot decode the image'))
      element.src = dataUrl
    })
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (context) {
      const scale = Math.min(size / image.width, size / image.height)
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      context.clearRect(0, 0, size, size)
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
      const shrunk = canvas.toDataURL('image/png')
      if (new TextEncoder().encode(shrunk).length <= MAX_ICON_BYTES) return { kind: 'image', value: shrunk, mime: 'image/png' }
    }
  }
  if (new TextEncoder().encode(dataUrl).length > MAX_ICON_BYTES) {
    throw new Error('картинка больше 300 КБ — возьми что-нибудь поменьше')
  }
  return { kind: 'image', value: dataUrl, mime: file.type || undefined }
}

function workspaceRows() {
  return Array.from(document.querySelectorAll('[data-row-key^="workspace:"]'))
}

/** Show the stored icon (emoji or image) over the default folder glyph. */
function paintWorkspaceIcons() {
  for (const row of workspaceRows()) {
    const id = (row.getAttribute('data-row-key') ?? '').slice('workspace:'.length)
    const folder = row.querySelector('.YDXeBa_slot.YDXeBa_folder')
    if (!id || !folder) continue
    const icon = iconCache[id]
    const paint = icon ? `${icon.kind}:${icon.updatedAt ?? ''}:${icon.value.slice(0, 32)}` : ''
    const existing = folder.querySelector('.dsh-ws-glyph, .dsh-ws-img')
    if (!icon) {
      if (existing) {
        existing.remove()
        folder.removeAttribute('data-dsh-custom-icon')
      }
      continue
    }
    if (existing && existing.getAttribute('data-dsh-paint') === paint) continue
    existing?.remove()
    let node
    if (icon.kind === 'image') {
      node = document.createElement('img')
      node.className = 'dsh-ws-img'
      node.src = icon.value
      node.alt = ''
      node.draggable = false
    } else {
      node = document.createElement('span')
      node.className = 'dsh-ws-glyph'
      node.textContent = icon.value
    }
    node.setAttribute('data-dsh-paint', paint)
    folder.appendChild(node)
    folder.setAttribute('data-dsh-custom-icon', '')
    folder.setAttribute('title', 'Custom icon — click to change')
  }
}

function closeIconPicker() {
  iconPicker?.remove()
  iconPicker = null
}

/** Open the icon picker anchored under one workspace row. */
function openIconPicker(box, id) {
  closeIconPicker()
  const picker = document.createElement('div')
  picker.className = 'dsh-icon-picker'
  picker.setAttribute('role', 'dialog')
  picker.setAttribute('aria-label', 'Workspace icon')

  const grid = document.createElement('div')
  grid.className = 'dsh-icon-grid'
  for (const glyph of ICON_CHOICES) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsh-icon-choice'
    button.textContent = glyph
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      void saveWorkspaceIcon(id, { kind: 'emoji', value: glyph })
      closeIconPicker()
    })
    grid.appendChild(button)
  }

  const error = document.createElement('div')
  error.className = 'dsh-icon-error'
  error.hidden = true

  const upload = document.createElement('label')
  upload.className = 'dsh-icon-upload'
  upload.textContent = 'Картинка (PNG, JPG, SVG)…'
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
  input.hidden = true
  upload.appendChild(input)
  input.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const icon = await readIconFile(file)
      await saveWorkspaceIcon(id, icon)
      closeIconPicker()
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : String(failure)
      error.hidden = false
    }
  })

  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'dsh-icon-reset'
  reset.textContent = 'Default folder'
  reset.addEventListener('click', (event) => {
    event.stopPropagation()
    void saveWorkspaceIcon(id, null)
    closeIconPicker()
  })

  picker.append(grid, upload, error, reset)
  document.body.appendChild(picker)

  const width = picker.offsetWidth
  const height = picker.offsetHeight
  const left = Math.min(Math.max(8, box.left - 8), globalThis.innerWidth - width - 8)
  const below = box.bottom + 6
  const above = box.top - height - 6
  const top = below + height <= globalThis.innerHeight - 8 ? below : Math.max(8, above)
  picker.style.left = `${Math.round(left)}px`
  picker.style.top = `${Math.round(top)}px`
  picker.addEventListener('click', (event) => event.stopPropagation())
  iconPicker = picker
}

/**
 * The picker lives in the row's `⋯` menu: pressing that button records the
 * workspace, and the menu that opens gets one extra entry ("Иконка…").
 * The shell re-renders the menu, so the entry is re-appended on mutations.
 */
const MENU_ITEM_ATTR = 'data-dsh-icon-menu-item'
const MENU_LABELS = /Rename|Show in folder|Delete workspace|Переименовать|Показать|Удалить/i
let pendingActions = null

function closeOpenMenu() {
  for (const type of ['mousedown', 'mouseup', 'click']) {
    document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
  }
}

/** Append the icon entry to the open workspace actions menu. */
function decorateWorkspaceMenu() {
  if (!pendingActions) return
  const menu = Array.from(document.querySelectorAll('[role="menu"]')).find(
    (element) => element.querySelector('[role="menuitem"]') && MENU_LABELS.test(element.textContent ?? ''),
  )
  if (!menu) return
  const existing = menu.querySelector(`[${MENU_ITEM_ATTR}]`)
  if (existing) {
    const pending = existing.getAttribute('data-workspace-id')
    if (pending !== pendingActions.id) {
      existing.setAttribute('data-workspace-id', pendingActions.id)
    }
    return
  }

  const template = menu.querySelector('[role="menuitem"]')
  const wrap = template?.parentElement
  if (!template || !wrap) return
  const iconClass = template.querySelector('[aria-hidden="true"]')?.className ?? ''
  const labelClass = template.querySelector('span:not([aria-hidden])')?.className ?? ''

  const itemWrap = document.createElement('div')
  itemWrap.className = wrap.className
  const item = document.createElement('button')
  item.type = 'button'
  item.className = template.className
  item.setAttribute('role', 'menuitem')
  item.setAttribute(MENU_ITEM_ATTR, '')
  item.setAttribute('data-workspace-id', pendingActions.id)
  item.innerHTML =
    `<span aria-hidden="true" class="${iconClass}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="7.5" r="1.1"/><circle cx="7.5" cy="14" r="1.1"/><circle cx="14" cy="15" r="1.1"/><path d="M12 21a3 3 0 0 0 0-6 3 3 0 0 1 0-6"/></svg></span>` +
    `<span class="${labelClass}">Иконка…</span>`
  item.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const pending = pendingActions
    pendingActions = null
    closeOpenMenu()
    if (pending) openIconPicker(pending.rect, pending.id)
  })
  itemWrap.appendChild(item)

  const viewport = menu.querySelector('[role="presentation"]') ?? menu
  const deleteWrap = Array.from(menu.querySelectorAll('[role="menuitem"]')).find(
    (entry) => /Delete workspace|Удалить/i.test(entry.textContent ?? ''),
  )?.parentElement
  if (deleteWrap && deleteWrap.parentElement === viewport) viewport.insertBefore(itemWrap, deleteWrap)
  else viewport.appendChild(itemWrap)
}

document.addEventListener(
  'click',
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button[aria-label^="Workspace actions for "]')
    if (!button) return
    const row = button.closest('[data-row-key^="workspace:"]')
    const id = (row?.getAttribute('data-row-key') ?? '').slice('workspace:'.length)
    if (!id) return
    const rect = button.getBoundingClientRect()
    pendingActions = {
      id,
      rect: { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right, width: rect.width, height: rect.height },
    }
    setTimeout(decorateWorkspaceMenu, 0)
    setTimeout(decorateWorkspaceMenu, 80)
  },
  true,
)

document.addEventListener('click', (event) => {
  if (!iconPicker) return
  const target = event.target
  if (target instanceof Element && target.closest('.dsh-icon-picker')) return
  closeIconPicker()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && iconPicker) closeIconPicker()
})

/** Recompose the sidebar; safe to call on every shell mutation. */
function composeSidebar() {
  const sidebar = document.querySelector('[data-slot="sidebar"]')
  if (!sidebar) return
  const slot = sidebar.querySelector('[data-slot="sidebar.footer.action"]')
  const logoRow = sidebar.querySelector('.hHd-Xa_logoRow')

  const limits = slot?.querySelector('.dsh-limits-card')
  if (slot && limits && slot.firstElementChild !== limits) {
    slot.insertBefore(limits, slot.firstElementChild)
  }
  if (logoRow) ensureGear(logoRow)
  paintWorkspaceIcons()
}

/** Keep the layout applied across React re-renders. */
function observeSidebar() {
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      try {
        composeSidebar()
      } catch (error) {
        console.warn('dsh-claude-ui: sidebar compose failed', error)
      }
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  schedule()
  void loadWorkspaceIcons()
}

/**
 * File links in messages.
 *
 * Agents often paste `file:///abs/path` links; the browser cannot open those and
 * nothing happens. A left click (or the first menu item) routes the path into
 * DSH's own file viewer through a `dsh-resource://file/session/<id>/<path>`
 * address, which accepts absolute paths outside the workspace. The context menu
 * adds "Open in Zed" (host route, active after the next DSH restart) next to the
 * built-in folder launch and a copy-path action.
 */
const FILE_MENU_ATTR = 'data-dsh-file-menu'
let clientContext = null
let fileMenu = null

function currentSessionId() {
  try {
    return clientContext?.uiSession?.adapter?.current?.getSnapshot()?.key
  } catch {
    return undefined
  }
}

/** Absolute path behind a `file://` link, or undefined for anything else. */
function pathOfFileLink(anchor) {
  const href = anchor.getAttribute('href')
  if (!href || !href.startsWith('file://')) return undefined
  try {
    const url = new URL(href)
    if (url.hostname && url.hostname !== 'localhost') return undefined
    const path = decodeURIComponent(url.pathname)
    return path.startsWith('/') ? path : undefined
  } catch {
    return undefined
  }
}

function encodePath(path) {
  return path.split('/').map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':')).join('/')
}

/** Read one absolute file through the workspace-files remote face. */
async function readFileBytes(path) {
  const sessionId = currentSessionId()
  if (!sessionId) throw new Error('нет активной сессии')
  const result = await clientContext.remote.workspaceFiles.readBytes(sessionId, path, {}, new AbortController().signal)
  if (!result?.ok) {
    const message = result?.error?.message ?? result?.error?.code ?? 'файл не прочитан'
    throw new Error(String(message))
  }
  const value = result.value ?? {}
  let bytes
  const data = value.data
  if (data instanceof Uint8Array) bytes = data
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data)
  else if (typeof data === 'string') {
    // The wire may carry base64 instead of raw bytes.
    const binary = atob(data)
    bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  } else if (Array.isArray(data)) bytes = new Uint8Array(data)
  return { bytes: bytes ?? new Uint8Array(), size: value.size ?? bytes?.length ?? 0, absolutePath: value.absolutePath ?? path }
}

/** Open one absolute path in the built-in in-app viewer. */
async function openInDsh(path) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dialog = document.createElement('div')
  dialog.className = 'dsh-file-viewer-mask'
  dialog.innerHTML = ''
  const card = document.createElement('div')
  card.className = 'dsh-file-viewer'
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', `Файл ${name}`)

  const header = document.createElement('header')
  header.className = 'dsh-file-viewer-head'
  const title = document.createElement('div')
  title.className = 'dsh-file-viewer-title'
  const fileName = document.createElement('strong')
  fileName.textContent = name
  const filePath = document.createElement('span')
  filePath.className = 'dsh-file-viewer-path'
  filePath.textContent = path
  title.append(fileName, filePath)

  const actions = document.createElement('div')
  actions.className = 'dsh-file-viewer-actions'
  const button = (label, onClick) => {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = 'dsh-file-viewer-button'
    node.textContent = label
    node.addEventListener('click', onClick)
    return node
  }
  actions.append(
    button('В Zed', () => void openInZed(path)),
    button('Копировать путь', async () => {
      await copyText(path)
      toast('Путь скопирован')
    }),
    button('Закрыть', () => dialog.remove()),
  )
  header.append(title, actions)

  const body = document.createElement('div')
  body.className = 'dsh-file-viewer-body'
  body.textContent = 'Чтение…'
  card.append(header, body)
  dialog.appendChild(card)
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.remove()
  })
  const onKey = (event) => {
    if (event.key === 'Escape') {
      dialog.remove()
      document.removeEventListener('keydown', onKey, true)
    }
  }
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(dialog)

  try {
    const { bytes, size } = await readFileBytes(path)
    if (bytes.length === 0 && size > 0) throw new Error('пустой ответ')
    const isImage = /\.(png|jpe?g|webp|gif|bmp|ico|svg)$/i.test(path)
    const binary = bytes.subarray(0, 2048).includes(0)
    if (isImage && !path.toLowerCase().endsWith('.svg')) {
      const mime = path.toLowerCase().endsWith('.png') ? 'image/png'
        : /\.jpe?g$/i.test(path) ? 'image/jpeg'
        : path.toLowerCase().endsWith('.webp') ? 'image/webp'
        : path.toLowerCase().endsWith('.gif') ? 'image/gif'
        : 'application/octet-stream'
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
      const image = document.createElement('img')
      image.className = 'dsh-file-viewer-image'
      image.src = url
      image.alt = name
      image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true })
      body.textContent = ''
      body.appendChild(image)
      return
    }
    if (binary) {
      body.textContent = `Бинарный файл · ${formatBytes(size)}`
      return
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const truncated = text.length > 200000 ? `${text.slice(0, 200000)}\n… (файл обрезан)` : text
    const scroll = document.createElement('div')
    scroll.className = 'dsh-file-viewer-code'
    const lines = truncated.split('\n')
    const gutterWidth = `${String(lines.length).length}ch`
    const gutter = document.createElement('pre')
    gutter.className = 'dsh-file-viewer-gutter'
    gutter.style.width = gutterWidth
    gutter.textContent = lines.map((_, index) => index + 1).join('\n')
    const code = document.createElement('pre')
    code.className = 'dsh-file-viewer-text'
    code.textContent = truncated
    scroll.append(gutter, code)
    body.textContent = ''
    body.appendChild(scroll)
  } catch (error) {
    body.textContent = `Не удалось прочитать файл: ${error instanceof Error ? error.message : String(error)}`
    body.classList.add('dsh-file-viewer-error')
  }
}

function formatBytes(size) {
  if (!Number.isFinite(size)) return ''
  if (size < 1024) return `${size} Б`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`
}

/** Ask the host half to launch Zed on one path (needs the host route). */
async function openInZed(path) {
  try {
    const response = await fetch('/claude-ui/open', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (response.ok) {
      toast('Открыл в Zed')
      return
    }
    if ([404, 405, 503].includes(response.status)) throw new Error('host-route-missing')
    throw new Error(`open answered ${response.status}`)
  } catch (error) {
    await copyText(path)
    const missing = error instanceof Error && error.message === 'host-route-missing'
    toast(missing ? 'Хост-часть включится после рестарта DSH — путь скопирован' : 'Путь скопирован (Zed не открылся)')
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* fall through to the legacy path */
  }
  const field = document.createElement('textarea')
  field.value = text
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  try {
    document.execCommand('copy')
  } catch {
    /* nothing else to try */
  }
  field.remove()
}

let toastNode = null
function toast(message) {
  toastNode?.remove()
  const node = document.createElement('div')
  node.className = 'dsh-toast'
  node.setAttribute('role', 'status')
  node.textContent = message
  document.body.appendChild(node)
  toastNode = node
  setTimeout(() => {
    node.classList.add('dsh-toast-out')
    setTimeout(() => node.remove(), 220)
  }, 2600)
}

function closeFileMenu() {
  fileMenu?.remove()
  fileMenu = null
}

/** Right-click menu for a file link. */
function openFileMenu(anchor, path, x, y) {
  closeFileMenu()
  const menu = document.createElement('div')
  menu.className = 'dsh-file-menu'
  menu.setAttribute(FILE_MENU_ATTR, '')
  menu.setAttribute('role', 'menu')

  const entry = (label, hint, action) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsh-file-menu-item'
    button.setAttribute('role', 'menuitem')
    const text = document.createElement('span')
    text.className = 'dsh-file-menu-label'
    text.textContent = label
    button.appendChild(text)
    if (hint) {
      const note = document.createElement('span')
      note.className = 'dsh-file-menu-hint'
      note.textContent = hint
      button.appendChild(note)
    }
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      closeFileMenu()
      void action()
    })
    menu.appendChild(button)
  }

  entry('Открыть в DSH', 'боковая панель', () => openInDsh(path))
  entry('Открыть в Zed', 'файл', () => openInZed(path))
  entry('Показать папку в Zed', path.slice(0, path.lastIndexOf('/')), () => openFolderInZed(path))
  entry('Скопировать путь', '', async () => {
    await copyText(path)
    toast('Путь скопирован')
  })

  document.body.appendChild(menu)
  const box = menu.getBoundingClientRect()
  menu.style.left = `${Math.min(x, globalThis.innerWidth - box.width - 8)}px`
  menu.style.top = `${Math.min(y, globalThis.innerHeight - box.height - 8)}px`
  fileMenu = menu
}

/** Folder launch through the built-in open-in-app route (available today). */
async function openFolderInZed(path) {
  const folder = path.slice(0, path.lastIndexOf('/'))
  try {
    const response = await fetch('/open-in-app/open', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'zed', path: folder }),
    })
    if (!response.ok) throw new Error(`open answered ${response.status}`)
    toast('Открыл папку в Zed')
  } catch {
    await copyText(folder)
    toast('Папка скопирована — редактор не принял запрос')
  }
}

document.addEventListener(
  'click',
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest(`[${FILE_MENU_ATTR}]`)) return
    const anchor = target.closest('a[href^="file://"]')
    if (!anchor) {
      closeFileMenu()
      return
    }
    const path = pathOfFileLink(anchor)
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    openInDsh(path)
  },
  true,
)

document.addEventListener(
  'contextmenu',
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a[href^="file://"]')
    if (!anchor) {
      closeFileMenu()
      return
    }
    const path = pathOfFileLink(anchor)
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    openFileMenu(anchor, path, event.clientX, event.clientY)
  },
  true,
)

document.addEventListener('click', (event) => {
  if (!fileMenu) return
  const target = event.target
  if (target instanceof Element && target.closest(`[${FILE_MENU_ATTR}]`)) return
  closeFileMenu()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeFileMenu()
    if (iconPicker) closeIconPicker()
  }
})

/**
 * Client plugin entry.
 * @param ctx - client context; `slots` is declared in the module's inject list.
 */
export function apply(ctx) {
  clientContext = ctx
  try {
    ctx.slots.inject('settings.launcher', () =>
      ctx.slots.register(
        { name: 'settings.launcher', id: 'claude-ui-settings-opener' },
        (props) => {
          if (props && typeof props.openSettings === 'function') {
            globalThis.__claudeOpenSettings = props.openSettings
          }
          return null
        },
      ),
    )
  } catch (error) {
    console.warn('dsh-claude-ui: settings launcher hook failed', error)
  }

  if (typeof document === 'undefined') return
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeSidebar, { once: true })
  } else {
    observeSidebar()
  }
}
