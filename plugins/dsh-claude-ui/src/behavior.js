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
 * Client plugin entry.
 * @param ctx - client context; `slots` is declared in the module's inject list.
 */
export function apply(ctx) {
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
