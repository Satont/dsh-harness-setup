// dsh-workspace-profiles — browser half.
//
// A Zen-style profile bar at the sidebar foot. The active profile decides which
// registered Workspaces stay visible: the shipped Workspace browser keeps
// rendering everything, and this plugin hides the rows of other workspaces (and
// their session rows) with one scoped stylesheet. Rows are addressed through the
// browser's own `data-row-key` attribute: `workspace:<id>`, `session:<id>` and
// `overflow:<id>` inside `[data-sidebar-list-area]`.
//
// Configuration lives on the Host ($DSH_HOME/workspace-profiles.json) and is
// read and written through /workspace-profiles/config.
window.__ModuleLoader__.load({
  id: '@local/dsh-workspace-profiles',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'workspaceProfiles'
    const ROUTE = '/workspace-profiles/config'
    const CACHE_KEY = 'dsh.workspace-profiles.v1'
    const STYLE_CSS = 'dsh-workspace-profiles-css'
    const STYLE_FILTER = 'dsh-workspace-profiles-filter'
    const EMPTY_SNAPSHOT = { items: [], phase: 'pending', error: null }
    const EMPTY_CONFIG = { version: 1, activeProfileId: null, profiles: [] }
    // Fixed hues: cosmetic profile colors must not flip with the theme tokens
    // (state tokens read as status colors, brand-primary is near-white in dark).
    const PALETTE = ['#5B8DEF', '#E0A458', '#52B788', '#D96C8E', '#9B8AFB', '#8A94A6']

    /** Resolved client root Context, set by apply(). */
    let rootCtx = null

    const en = {
      all: 'All',
      profiles: 'Profiles',
      manage: 'Manage profiles',
      groupLabel: 'Workspace profiles',
      activate: 'Show this profile',
      dialogTitle: 'Workspace profiles',
      dialogSub: 'Each profile decides which workspaces the sidebar lists. The active profile is highlighted at the sidebar foot.',
      visible: 'Visible workspaces',
      addProfile: 'New profile',
      newProfile: 'Profile',
      name: 'Profile name',
      nameRequired: 'A profile needs a name',
      delete: 'Delete',
      deleteConfirm: 'Delete profile “{name}”?',
      cancel: 'Cancel',
      moveUp: 'Move up',
      moveDown: 'Move down',
      changeColor: 'Change color',
      selectAll: 'Select all',
      selectNone: 'Select none',
      emptyProfiles: 'No profiles yet. Create one, then tick the workspaces it should show.',
      emptyWorkspaces: 'No workspaces are registered yet.',
      emptyActive: 'Nothing is ticked here yet, so the profile keeps showing every workspace.',
      assignedTo: 'in profile',
      activeBadge: 'active',
      noFilter: 'shows every workspace',
      done: 'Done',
      close: 'Close',
      loading: 'Loading…',
      saving: 'Saving…',
      saved: 'Saved',
      storageError: 'Could not sync the profile settings',
      workspacesPending: 'Loading the workspace list…',
      workspacesError: 'The workspace list is unavailable',
      retry: 'Retry',
      showAll: 'Show all',
      clearFilterHint: 'click again to show every workspace',
      countTitle: '{count} workspaces',
    }

    const ru = {
      all: 'Все',
      profiles: 'Профили',
      manage: 'Настроить профили',
      groupLabel: 'Профили рабочих пространств',
      activate: 'Показать этот профиль',
      dialogTitle: 'Профили рабочих пространств',
      dialogSub: 'Профиль решает, какие рабочие пространства видны в сайдбаре. Активный профиль подсвечен внизу сайдбара.',
      visible: 'Видимые рабочие пространства',
      addProfile: 'Новый профиль',
      newProfile: 'Профиль',
      name: 'Имя профиля',
      nameRequired: 'У профиля должно быть имя',
      delete: 'Удалить',
      deleteConfirm: 'Удалить профиль «{name}»?',
      cancel: 'Отмена',
      moveUp: 'Выше',
      moveDown: 'Ниже',
      changeColor: 'Сменить цвет',
      selectAll: 'Отметить все',
      selectNone: 'Снять все',
      emptyProfiles: 'Профилей пока нет. Создайте профиль и отметьте рабочие пространства, которые он показывает.',
      emptyWorkspaces: 'Рабочих пространств пока нет.',
      emptyActive: 'Здесь пока ничего не отмечено, поэтому профиль показывает все рабочие пространства.',
      assignedTo: 'в профиле',
      activeBadge: 'активен',
      noFilter: 'показывает все',
      done: 'Готово',
      close: 'Закрыть',
      loading: 'Загружаю…',
      saving: 'Сохраняю…',
      saved: 'Сохранено',
      storageError: 'Не удалось синхронизировать настройки',
      workspacesPending: 'Загружаю список рабочих пространств…',
      workspacesError: 'Список рабочих пространств недоступен',
      retry: 'Повторить',
      showAll: 'Показать все',
      clearFilterHint: 'клик ещё раз — показать все',
      countTitle: '{count} рабочих пространств',
    }

    function activeLocale() {
      try {
        const locale = rootCtx?.get?.('locale')
        const value = locale?.getSnapshot?.().active
        return typeof value === 'string' && value !== '' ? value : 'en'
      } catch {
        return 'en'
      }
    }

    /** Local fallback when the slot's locale share is unavailable. */
    function fallbackT(key, vars) {
      const dictionary = activeLocale().toLowerCase().startsWith('ru') ? ru : en
      let text = dictionary[key] ?? en[key] ?? key
      if (vars !== undefined && vars !== null) {
        text = text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''))
      }
      return text
    }

    const FONT = 'var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)'
    const STATIC_CSS = `
      .dwp-bar{position:relative;display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;padding:0 26px 4px}
      .dwp-chips{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px;flex:0 1 auto;min-width:0;max-width:100%;max-height:52px;overflow-x:hidden;overflow-y:auto;scrollbar-width:none}
      .dwp-chips::-webkit-scrollbar{display:none}
      .dwp-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;height:24px;max-width:88px;padding:0 6px;border-radius:6px;border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:500 11px/1 ${FONT};cursor:pointer;white-space:nowrap}
      .dwp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dwp-chip[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
      .dwp-chip-label{overflow:hidden;text-overflow:ellipsis}
      .dwp-dot{flex:none;width:7px;height:7px;border-radius:50%;background:currentColor}
      .dwp-dot[data-empty="true"]{background:transparent;box-shadow:inset 0 0 0 1.2px currentColor}
      .dwp-gear{position:absolute;right:2px;top:0;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
      .dwp-gear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dwp-all{position:absolute;left:2px;top:0;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
      .dwp-all:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dwp-all[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
      .dwp-gear[data-error="true"]{color:var(--dsw-alias-state-error-primary)}
      .dwp-rail{position:relative;flex:none;width:36px;height:36px;border-radius:10px;border:0.5px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer}
      .dwp-rail:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dwp-rail[data-active="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
      .dwp-rail-dot{position:absolute;right:4px;bottom:4px;width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 2px var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base))}
      div:has(> div[data-slot="sidebar.footer.action"] > .dwp-bar),
      div:has(> div[data-slot="sidebar.footer.action"] > .dwp-rail){flex-direction:column;gap:0}
      .dwp-pop{position:fixed;z-index:200;min-width:190px;max-width:264px;padding:4px;border-radius:10px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:0 12px 32px rgba(0,0,0,.32);display:flex;flex-direction:column;gap:1px}
      .dwp-pop-item{display:flex;align-items:center;gap:8px;width:100%;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:400 12px/1 ${FONT};text-align:left;cursor:pointer;white-space:nowrap}
      .dwp-pop-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dwp-pop-item[data-current="true"]{background:var(--dsw-alias-bg-layer-3)}
      .dwp-pop-item .dwp-label{overflow:hidden;text-overflow:ellipsis}
      .dwp-pop-item .dwp-check{margin-left:auto;color:var(--dsw-alias-brand-primary);flex:none;display:inline-flex}
      .dwp-pop-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2)}
      .dwp-layer{position:fixed;inset:0;margin:0;padding:24px;border:0;width:100%;height:100%;max-width:none;max-height:none;background:transparent;color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:center;overflow:hidden}
      .dwp-layer:not([open]){display:none}
      .dwp-layer::backdrop{background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.4))}
      .dwp-dialog{width:min(780px,100%);max-height:min(620px,100%);display:flex;flex-direction:column;border-radius:12px;border:0.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 24px 64px rgba(0,0,0,.42);overflow:hidden}
      .dwp-head{display:flex;align-items:flex-start;gap:8px;padding:12px 14px 10px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
      .dwp-title{margin:0;font-size:13.5px;font-weight:600}
      .dwp-sub{margin:3px 0 0;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);max-width:560px}
      .dwp-close{margin-left:auto;flex:none;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:15px;line-height:1}
      .dwp-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dwp-body{display:flex;min-height:0;flex:1 1 auto}
      .dwp-list{width:236px;flex:none;display:flex;flex-direction:column;gap:2px;padding:10px;overflow-y:auto;border-right:0.5px solid var(--dsw-alias-border-l2)}
      .dwp-row{display:flex;align-items:center;gap:3px;padding:3px 4px;border-radius:7px}
      .dwp-row[data-selected="true"]{background:var(--dsw-alias-bg-layer-3)}
      .dwp-color{flex:none;width:16px;height:16px;border:0;border-radius:50%;padding:0;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.16)}
      .dwp-name{flex:1 1 auto;min-width:0;height:24px;padding:0 5px;border:0.5px solid transparent;border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font:500 12px/1 ${FONT}}
      .dwp-name:hover{border-color:var(--dsw-alias-border-l2)}
      .dwp-name:focus{outline:none;border-color:var(--dsw-alias-border-selected);background:var(--dsw-alias-bg-layer-1)}
      .dwp-count{flex:none;min-width:13px;text-align:right;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
      .dwp-active-badge{flex:none;font-size:9px;line-height:14px;padding:0 4px;border-radius:4px;border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);text-transform:lowercase}
      .dwp-mini{flex:none;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:.55}
      .dwp-mini:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dwp-mini[data-danger="true"]{color:var(--dsw-alias-state-error-primary);opacity:1}
      .dwp-mini:disabled{opacity:.25;cursor:default;background:transparent;color:var(--dsw-alias-label-tertiary)}
      .dwp-confirm{display:flex;align-items:center;gap:8px;padding:1px 6px 5px 27px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .dwp-confirm-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dwp-add{margin-top:6px;height:26px;border:0.5px dashed var(--dsw-alias-border-l3);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:500 11.5px/1 ${FONT};cursor:pointer}
      .dwp-add:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dwp-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;padding:12px 14px;gap:7px}
      .dwp-mainhead{display:flex;align-items:baseline;gap:8px}
      .dwp-h2{margin:0;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dwp-links{margin-left:auto;display:flex;gap:8px;flex:none}
      .dwp-link{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:10.5px;cursor:pointer;padding:0}
      .dwp-link:hover{color:var(--dsw-alias-label-primary);text-decoration:underline}
      .dwp-link:disabled{opacity:.4;cursor:default;text-decoration:none}
      .dwp-link[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}
      .dwp-hint{margin:0;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary)}
      .dwp-items{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:1px;margin:0 -6px;padding:2px 6px}
      .dwp-item{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer}
      .dwp-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .dwp-item input[type="checkbox"]{flex:none;margin:0;width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
      .dwp-item-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
      .dwp-item-path{margin-left:auto;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
      .dwp-item-other{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary);opacity:.8}
      .dwp-foot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:0.5px solid var(--dsw-alias-border-l2)}
      .dwp-status{font-size:10.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dwp-status[data-error="true"]{color:var(--dsw-alias-state-error-primary)}
      .dwp-done{margin-left:auto;flex:none;height:28px;padding:0 14px;border:0;border-radius:6px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-on-color,#fff);font:600 12px/1 ${FONT};cursor:pointer}
      .dwp-done:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
    `

    /** Inject the static stylesheet once per page; the module loader removes it. */
    function ensureStaticCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin="${STYLE_CSS}"]`) !== null) return
      const element = document.createElement('style')
      element.dataset.plugin = STYLE_CSS
      element.textContent = STATIC_CSS
      document.head.appendChild(element)
    }

    /** Replace the filter stylesheet; an empty string removes every rule. */
    function applyFilterCss(css) {
      if (typeof document === 'undefined') return
      let element = document.querySelector(`style[data-plugin="${STYLE_FILTER}"]`)
      if (element === null) {
        element = document.createElement('style')
        element.dataset.plugin = STYLE_FILTER
        document.head.appendChild(element)
      }
      if (element.textContent !== css) element.textContent = css
    }

    // ---------------------------------------------------------------------
    // Configuration state: fetched from the Host, cached for instant paint.
    // ---------------------------------------------------------------------
    function sanitizeConfig(raw) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_CONFIG
      const profiles = []
      const ids = new Set()
      if (Array.isArray(raw.profiles)) {
        for (const entry of raw.profiles) {
          if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
          const id = typeof entry.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(entry.id) ? entry.id : null
          if (id === null || ids.has(id)) continue
          const name = typeof entry.name === 'string' ? entry.name.slice(0, 48) : ''
          const paths = Array.isArray(entry.paths)
            ? entry.paths.filter((value) => typeof value === 'string' && value !== '')
            : []
          const color = Number.isInteger(entry.color) && entry.color >= 0 && entry.color < PALETTE.length
            ? entry.color
            : profiles.length % PALETTE.length
          ids.add(id)
          profiles.push({ id, name, color, paths })
        }
      }
      const activeProfileId = typeof raw.activeProfileId === 'string' && ids.has(raw.activeProfileId)
        ? raw.activeProfileId
        : null
      return { version: 1, activeProfileId, profiles }
    }

    function readCache() {
      try {
        const text = window.localStorage.getItem(CACHE_KEY)
        if (text === null || text === '') return null
        return sanitizeConfig(JSON.parse(text))
      } catch {
        return null
      }
    }

    function writeCache(config) {
      try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(config))
      } catch {
        /* a full or disabled storage must not break the switcher */
      }
    }

    /** Snapshot store shared by the bar, the dialog and the overlay. */
    const store = (() => {
      let state = { config: readCache() ?? EMPTY_CONFIG, status: 'loading', error: null }
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        publish(next) {
          state = next
          for (const listener of listeners) listener()
        },
      }
    })()

    /** Dialog visibility and the profile selected inside it. */
    const uiStore = (() => {
      let state = { dialogOpen: false, selectedId: null }
      const listeners = new Set()
      const publish = () => {
        for (const listener of listeners) listener()
      }
      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        open(selectedId) {
          state = { dialogOpen: true, selectedId }
          publish()
        },
        select(selectedId) {
          if (state.selectedId === selectedId) return
          state = { ...state, selectedId }
          publish()
        },
        close() {
          if (!state.dialogOpen) return
          state = { ...state, dialogOpen: false }
          publish()
        },
      }
    })()

    /** True while a profile has no name yet; such a configuration is not saved. */
    function configIncomplete(config) {
      return config.profiles.some((profile) => profile.name.trim() === '')
    }

    /** Replace the configuration locally and schedule one Host write. */
    function updateConfig(mutate) {
      const next = sanitizeConfig(mutate(store.getSnapshot().config))
      writeCache(next)
      store.publish({ ...store.getSnapshot(), config: next })
      scheduleSave()
    }

    let saveTimer = null
    function scheduleSave() {
      if (saveTimer !== null) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        void saveConfig()
      }, 250)
    }

    /** Write the pending draft immediately (page about to hide or plugin unload). */
    function flushSave() {
      if (saveTimer === null) return
      clearTimeout(saveTimer)
      saveTimer = null
      void saveConfig()
    }

    async function saveConfig() {
      const pending = store.getSnapshot().config
      if (configIncomplete(pending)) {
        // Keep the draft: the row stays in the list, the dialog names the problem.
        store.publish({ ...store.getSnapshot(), status: 'error', error: null })
        return
      }
      store.publish({ ...store.getSnapshot(), status: 'saving' })
      try {
        const response = await fetch(ROUTE, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pending),
        })
        if (!response.ok) {
          throw new Error((await response.text()).trim() || `HTTP ${response.status}`)
        }
        const saved = sanitizeConfig(await response.json())
        const current = store.getSnapshot()
        // Keep newer edits made while this request was in flight.
        if (JSON.stringify(current.config) === JSON.stringify(pending)) {
          writeCache(saved)
          store.publish({ config: saved, status: 'ready', error: null })
        } else {
          store.publish({ ...current, status: 'ready', error: null })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn('workspace-profiles: save failed:', message)
        store.publish({ ...store.getSnapshot(), status: 'error', error: message })
      }
    }

    async function loadConfig() {
      store.publish({ ...store.getSnapshot(), status: 'loading', error: null })
      try {
        const response = await fetch(ROUTE, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error((await response.text()).trim() || `HTTP ${response.status}`)
        }
        const config = sanitizeConfig(await response.json())
        writeCache(config)
        store.publish({ config, status: 'ready', error: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn('workspace-profiles: load failed:', message)
        store.publish({ ...store.getSnapshot(), status: 'error', error: message })
      }
    }

    // ---------------------------------------------------------------------
    // Workspace data and the row filter.
    // ---------------------------------------------------------------------
    function useWorkspaceSnapshot() {
      let list
      try {
        list = rootCtx?.get?.('workspaces')?.list
      } catch {
        list = undefined
      }
      const subscribe = useCallback(
        (listener) => (list !== undefined ? list.subscribe(listener) : () => {}),
        [list],
      )
      const getSnapshot = useCallback(
        () => (list !== undefined ? list.getSnapshot() : EMPTY_SNAPSHOT),
        [list],
      )
      return useSyncExternalStore(subscribe, getSnapshot)
    }

    function attrEscape(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    }

    /**
     * Scoped stylesheet hiding the rows of every workspace outside the active
     * profile. An empty profile means "no filtering".
     * @param {Array<{workspaceId: string, path: string, sessionIds: string[]}>} items
     * @param {{ activeProfileId: string | null, profiles: Array<{id: string, paths: string[]}> }} config
     */
    function filterCss(items, config) {
      const active = config.profiles.find((profile) => profile.id === config.activeProfileId)
      if (active === undefined || active.paths.length === 0) return ''
      const allowed = new Set(active.paths)
      const hidden = items.filter((item) => !allowed.has(item.path))
      if (hidden.length === 0) return ''
      const selectors = []
      for (const item of hidden) {
        const workspaceId = attrEscape(item.workspaceId)
        selectors.push(`[data-sidebar-list-area] [data-row-key="workspace:${workspaceId}"]`)
        selectors.push(`[data-sidebar-list-area] [data-row-key="overflow:${workspaceId}"]`)
        for (const sessionId of item.sessionIds ?? []) {
          selectors.push(`[data-sidebar-list-area] [data-row-key="session:${attrEscape(sessionId)}"]`)
        }
      }
      return `${selectors.join(',')}{display:none!important}`
    }

    /** Short path label: the last two segments of a registered directory. */
    function pathTail(path) {
      const parts = String(path).split(/[\\/]/).filter((part) => part !== '')
      return parts.slice(-2).join('/')
    }

    /** First free "Profile N" style name. */
    function nextProfileName(profiles, label) {
      const taken = new Set(profiles.map((profile) => profile.name))
      let index = profiles.length + 1
      while (taken.has(`${label} ${index}`)) index += 1
      return `${label} ${index}`
    }

    // ---------------------------------------------------------------------
    // Icons
    // ---------------------------------------------------------------------
    function layersIcon(size) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 36 36', 'aria-hidden': 'true', fill: 'none',
      },
      h('rect', { x: 7, y: 7.5, width: 22, height: 6, rx: 3, fill: 'currentColor', opacity: 0.45 }),
      h('rect', { x: 7, y: 15, width: 22, height: 6, rx: 3, fill: 'currentColor' }),
      h('rect', { x: 7, y: 22.5, width: 22, height: 6, rx: 3, fill: 'currentColor', opacity: 0.45 }))
    }

    function gridIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('rect', { x: 2.5, y: 2.5, width: 4.6, height: 4.6, rx: 1.2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('rect', { x: 8.9, y: 2.5, width: 4.6, height: 4.6, rx: 1.2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('rect', { x: 2.5, y: 8.9, width: 4.6, height: 4.6, rx: 1.2, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('rect', { x: 8.9, y: 8.9, width: 4.6, height: 4.6, rx: 1.2, stroke: 'currentColor', strokeWidth: 1.2 }))
    }

    function gearIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('circle', { cx: 8, cy: 8, r: 2.3, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', {
          d: 'M8 1.7v1.9M8 12.4v1.9M1.7 8h1.9M12.4 8h1.9M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round',
        }))
    }

    function plusIcon(size = 12) {
      return h('svg', { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': 'true', fill: 'none' },
        h('path', { d: 'M6 2v8M2 6h8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
    }

    function arrowIcon(direction) {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: direction === 'up' ? 'M6 9.5V2.5M3 5.5 6 2.5l3 3' : 'M6 2.5v7M3 6.5l3 3 3-3',
          stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function trashIcon() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M2.5 3.5h7M4.8 3.5V2.4h2.4v1.1M3.4 3.5l.4 6.1h4.4l.4-6.1',
          stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function checkIcon() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M2.5 6.4 5 8.9l4.5-5.6',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    // ---------------------------------------------------------------------
    // Dialog (registered in the app-level overlay slot)
    // ---------------------------------------------------------------------
    function ProfilesDialog(props) {
      const t = props.t
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const ui = useSyncExternalStore(uiStore.subscribe, uiStore.getSnapshot)
      const snapshot = useWorkspaceSnapshot()
      const items = snapshot.items
      const config = state.config
      const selected = config.profiles.find((profile) => profile.id === ui.selectedId)
        ?? config.profiles[0]
        ?? null
      const [pendingDelete, setPendingDelete] = useState(null)
      const panelRef = useRef(null)
      const dialogRef = useRef(null)

      useEffect(() => {
        const dialog = dialogRef.current
        const panel = panelRef.current
        if (dialog === null || panel === null) return undefined
        const previous = document.activeElement
        if (typeof dialog.showModal === 'function' && !dialog.open) {
          try {
            dialog.showModal()
          } catch {
            dialog.setAttribute('open', '')
          }
        } else if (!dialog.open) {
          dialog.setAttribute('open', '')
        }
        panel.focus()
        const onCancel = (event) => {
          event.preventDefault()
          uiStore.close()
        }
        dialog.addEventListener('cancel', onCancel)
        return () => {
          dialog.removeEventListener('cancel', onCancel)
          if (typeof dialog.close === 'function' && dialog.open) {
            try {
              dialog.close()
            } catch {
              dialog.removeAttribute('open')
            }
          } else {
            dialog.removeAttribute('open')
          }
          if (previous !== null && typeof previous.focus === 'function') previous.focus()
        }
      }, [])

      const addProfile = () => {
        const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
        updateConfig((current) => ({
          ...current,
          profiles: [
            ...current.profiles,
            {
              id,
              name: nextProfileName(current.profiles, t('newProfile')),
              color: current.profiles.length % PALETTE.length,
              paths: [],
            },
          ],
        }))
        uiStore.select(id)
      }

      const rename = (id, name) => {
        updateConfig((current) => ({
          ...current,
          profiles: current.profiles.map((profile) => (profile.id === id ? { ...profile, name } : profile)),
        }))
      }

      const cycleColor = (profile) => {
        updateConfig((current) => ({
          ...current,
          profiles: current.profiles.map((entry) => (
            entry.id === profile.id ? { ...entry, color: (entry.color + 1) % PALETTE.length } : entry
          )),
        }))
      }

      const move = (index, delta) => {
        const target = index + delta
        if (target < 0 || target >= config.profiles.length) return
        updateConfig((current) => {
          const profiles = [...current.profiles]
          const [entry] = profiles.splice(index, 1)
          profiles.splice(target, 0, entry)
          return { ...current, profiles }
        })
      }

      const remove = (profile) => {
        const remaining = config.profiles.filter((entry) => entry.id !== profile.id)
        updateConfig((current) => ({
          ...current,
          activeProfileId: current.activeProfileId === profile.id ? null : current.activeProfileId,
          profiles: current.profiles.filter((entry) => entry.id !== profile.id),
        }))
        if (selected !== null && selected.id === profile.id) uiStore.select(remaining[0]?.id ?? null)
        setPendingDelete(null)
      }

      const togglePath = (path) => {
        if (selected === null) return
        updateConfig((current) => ({
          ...current,
          profiles: current.profiles.map((entry) => {
            if (entry.id !== selected.id) return entry
            const has = entry.paths.includes(path)
            return { ...entry, paths: has ? entry.paths.filter((value) => value !== path) : [...entry.paths, path] }
          }),
        }))
      }

      const setAllPaths = (paths) => {
        if (selected === null) return
        updateConfig((current) => ({
          ...current,
          profiles: current.profiles.map((entry) => (
            entry.id === selected.id ? { ...entry, paths } : entry
          )),
        }))
      }

      const activate = () => {
        if (selected === null) return
        updateConfig((current) => ({ ...current, activeProfileId: selected.id }))
      }

      const profileRows = []
      for (const [index, profile] of config.profiles.entries()) {
        const isActive = profile.id === config.activeProfileId
        const row = h('div', {
          key: profile.id,
          className: 'dwp-row',
          'data-selected': selected !== null && profile.id === selected.id ? 'true' : 'false',
          onMouseDown: () => uiStore.select(profile.id),
        },
        h('button', {
          type: 'button',
          className: 'dwp-color',
          style: { background: PALETTE[profile.color % PALETTE.length] },
          title: t('changeColor'),
          'aria-label': t('changeColor'),
          onClick: (event) => {
            event.stopPropagation()
            cycleColor(profile)
          },
        }),
        h('input', {
          className: 'dwp-name',
          value: profile.name,
          placeholder: t('name'),
          'aria-label': t('name'),
          spellCheck: false,
          onChange: (event) => rename(profile.id, event.target.value),
          onFocus: () => uiStore.select(profile.id),
          onKeyDown: (event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          },
        }),
        isActive ? h('span', { className: 'dwp-active-badge' }, t('activeBadge')) : null,
        h('span', {
          className: 'dwp-count',
          title: t('countTitle', { count: profile.paths.length }),
        }, String(profile.paths.length)),
        h('button', {
          type: 'button', className: 'dwp-mini', title: t('moveUp'), 'aria-label': t('moveUp'),
          disabled: index === 0,
          onClick: (event) => {
            event.stopPropagation()
            move(index, -1)
          },
        }, arrowIcon('up')),
        h('button', {
          type: 'button', className: 'dwp-mini', title: t('moveDown'), 'aria-label': t('moveDown'),
          disabled: index === config.profiles.length - 1,
          onClick: (event) => {
            event.stopPropagation()
            move(index, 1)
          },
        }, arrowIcon('down')),
        h('button', {
          type: 'button',
          className: 'dwp-mini',
          'data-danger': pendingDelete === profile.id ? 'true' : 'false',
          title: t('delete'),
          'aria-label': t('delete'),
          onClick: (event) => {
            event.stopPropagation()
            setPendingDelete((value) => (value === profile.id ? null : profile.id))
          },
        }, trashIcon()))
        const confirm = pendingDelete === profile.id
          ? h('div', { className: 'dwp-confirm', key: `${profile.id}-confirm` },
            h('span', { className: 'dwp-confirm-text' },
              t('deleteConfirm', { name: profile.name || t('newProfile') })),
            h('button', {
              type: 'button',
              className: 'dwp-link',
              'data-danger': 'true',
              onClick: () => remove(profile),
            }, t('delete')),
            h('button', {
              type: 'button',
              className: 'dwp-link',
              onClick: () => setPendingDelete(null),
            }, t('cancel')))
          : null
        profileRows.push(h(React.Fragment, { key: profile.id }, row, confirm))
      }

      const workspaceRows = items.map((item) => {
        const checked = selected !== null && selected.paths.includes(item.path)
        const other = selected === null
          ? undefined
          : config.profiles.find((profile) => profile.id !== selected.id && profile.paths.includes(item.path))
        return h('label', { key: item.workspaceId, className: 'dwp-item', title: item.path },
          h('input', {
            type: 'checkbox',
            checked,
            disabled: selected === null,
            onChange: () => togglePath(item.path),
          }),
          h('span', { className: 'dwp-item-title' }, item.title || pathTail(item.path)),
          other !== undefined
            ? h('span', { className: 'dwp-item-other' },
              `${t('assignedTo')} «${other.name || t('newProfile')}»`)
            : null,
          h('span', { className: 'dwp-item-path', title: item.path }, pathTail(item.path)))
      })

      const workspacesArea = snapshot.phase === 'pending' && items.length === 0
        ? h('p', { className: 'dwp-hint' }, t('workspacesPending'))
        : snapshot.error !== null && items.length === 0
          ? h('p', { className: 'dwp-hint' }, t('workspacesError'))
          : items.length === 0
            ? h('p', { className: 'dwp-hint' }, t('emptyWorkspaces'))
            : h('div', { className: 'dwp-items' }, workspaceRows)

      const statusNode = state.status === 'loading'
        ? t('loading')
        : state.status === 'saving'
          ? t('saving')
          : configIncomplete(config)
            ? t('nameRequired')
            : state.error !== null
              ? t('storageError')
              : t('saved')

      return h('dialog', {
        className: 'dwp-layer',
        ref: dialogRef,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('dialogTitle'),
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) uiStore.close()
        },
      },
      h('div', {
        className: 'dwp-dialog',
        tabIndex: -1,
        ref: panelRef,
      },
      h('div', { className: 'dwp-head' },
        h('div', null,
          h('h2', { className: 'dwp-title' }, t('dialogTitle')),
          h('p', { className: 'dwp-sub' }, t('dialogSub'))),
        h('button', {
          type: 'button',
          className: 'dwp-close',
          title: t('close'),
          'aria-label': t('close'),
          onClick: () => uiStore.close(),
        }, '×')),
      h('div', { className: 'dwp-body' },
        h('div', { className: 'dwp-list' },
          config.profiles.length === 0
            ? h('p', { className: 'dwp-hint' }, t('emptyProfiles'))
            : profileRows,
          h('button', { type: 'button', className: 'dwp-add', onClick: addProfile },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, plusIcon(), t('addProfile')))),
        h('div', { className: 'dwp-main' },
          selected === null
            ? h('p', { className: 'dwp-hint' }, t('emptyProfiles'))
            : h(React.Fragment, null,
              h('div', { className: 'dwp-mainhead' },
                h('h3', { className: 'dwp-h2' }, `${t('visible')} · ${selected.name || t('newProfile')}`),
                h('div', { className: 'dwp-links' },
                  h('button', {
                    type: 'button',
                    className: 'dwp-link',
                    onClick: () => setAllPaths(items.map((item) => item.path)),
                    disabled: items.length === 0,
                  }, t('selectAll')),
                  h('button', {
                    type: 'button',
                    className: 'dwp-link',
                    onClick: () => setAllPaths([]),
                    disabled: selected.paths.length === 0,
                  }, t('selectNone')))),
              selected.paths.length === 0 ? h('p', { className: 'dwp-hint' }, t('emptyActive')) : null,
              workspacesArea,
              selected.id !== config.activeProfileId
                ? h('button', {
                  type: 'button',
                  className: 'dwp-add',
                  style: { alignSelf: 'flex-start', padding: '0 10px' },
                  onClick: activate,
                }, t('activate'))
                : null))),
      h('div', { className: 'dwp-foot' },
        h('span', {
          className: 'dwp-status',
          'data-error': state.error !== null || configIncomplete(config) ? 'true' : 'false',
          title: state.error ?? undefined,
        }, statusNode),
        state.error !== null
          ? h('button', {
            type: 'button',
            className: 'dwp-link',
            onClick: () => {
              void loadConfig()
            },
          }, t('retry'))
          : null,
        config.activeProfileId !== null
          ? h('button', {
            type: 'button',
            className: 'dwp-link',
            onClick: () => {
              updateConfig((current) => ({ ...current, activeProfileId: null }))
            },
          }, t('showAll'))
          : null,
        h('button', { type: 'button', className: 'dwp-done', onClick: () => uiStore.close() }, t('done')))))
    }

    /** Overlay entry: renders the dialog only while it is open. */
    function ProfilesOverlay(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const ui = useSyncExternalStore(uiStore.subscribe, uiStore.getSnapshot)
      if (!ui.dialogOpen) return null
      return h(ProfilesDialog, { t })
    }

    // ---------------------------------------------------------------------
    // Sidebar foot: profile chips (wide) or one button with a menu (rail).
    // ---------------------------------------------------------------------
    function ProfilesBar(props) {
      const wide = props.wide !== false
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const snapshot = useWorkspaceSnapshot()
      const items = snapshot.items
      const config = state.config
      const active = config.profiles.find((profile) => profile.id === config.activeProfileId) ?? null
      const [menuOpen, setMenuOpen] = useState(false)
      const [menuPosition, setMenuPosition] = useState(null)
      const railRef = useRef(null)
      const menuRef = useRef(null)

      const css = filterCss(items, config)
      useEffect(() => {
        applyFilterCss(css)
      }, [css])
      useEffect(() => () => applyFilterCss(''), [])

      // Drop workspace paths that no longer exist in the registry, so a deleted
      // workspace cannot leave a profile that silently hides everything. An
      // empty registry is left alone: it may be a transient Host state.
      useEffect(() => {
        if (snapshot.phase !== 'ready' || items.length === 0) return
        const known = new Set(items.map((item) => item.path))
        const stale = config.profiles.some((profile) => profile.paths.some((path) => !known.has(path)))
        if (!stale) return
        updateConfig((current) => ({
          ...current,
          profiles: current.profiles.map((profile) => ({
            ...profile,
            paths: profile.paths.filter((path) => known.has(path)),
          })),
        }))
      }, [snapshot.phase, items])

      // A Workspace registered after this page loaded joins the active profile,
      // so "Add workspace" never produces a row the active filter hides.
      const mountedAtRef = useRef(Date.now())
      useEffect(() => {
        const current = store.getSnapshot().config
        const currentActive = current.profiles.find((profile) => profile.id === current.activeProfileId)
        if (currentActive === undefined || currentActive.paths.length === 0 || items.length === 0) return
        const fresh = items.filter((item) => {
          const created = Date.parse(item.createdAt ?? '')
          return Number.isFinite(created) && created > mountedAtRef.current - 5000
            && !currentActive.paths.includes(item.path)
        })
        if (fresh.length === 0) return
        const missing = fresh.map((item) => item.path)
        updateConfig((latest) => ({
          ...latest,
          profiles: latest.profiles.map((profile) => (
            profile.id === currentActive.id ? { ...profile, paths: [...profile.paths, ...missing] } : profile
          )),
        }))
      }, [items])

      // Do not lose the last keystroke when the page hides.
      useEffect(() => {
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') flushSave()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          document.removeEventListener('visibilitychange', onVisibility)
          flushSave()
        }
      }, [])

      useEffect(() => {
        if (!menuOpen) return undefined
        const onDown = (event) => {
          if (menuRef.current !== null && menuRef.current.contains(event.target)) return
          if (railRef.current !== null && railRef.current.contains(event.target)) return
          setMenuOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setMenuOpen(false)
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [menuOpen])

      const choose = (id) => {
        updateConfig((current) => ({ ...current, activeProfileId: id }))
        setMenuOpen(false)
      }

      const openDialog = () => {
        setMenuOpen(false)
        const current = store.getSnapshot().config
        uiStore.open(current.activeProfileId ?? current.profiles[0]?.id ?? null)
      }

      const openMenu = () => {
        const rect = railRef.current?.getBoundingClientRect()
        if (rect !== undefined) {
          setMenuPosition({
            left: Math.round(rect.right + 8),
            bottom: Math.round(window.innerHeight - rect.bottom),
          })
        }
        setMenuOpen((value) => !value)
      }

      const dotStyle = (profile) => ({ color: PALETTE[profile.color % PALETTE.length] })

      // No "All" chip: the bar is exactly the user's profiles. Clicking the
      // active profile again clears the filter (shows every workspace).
      const chips = []
      for (const profile of config.profiles) {
        const empty = profile.paths.length === 0
        const isActive = active !== null && active.id === profile.id
        chips.push(h('button', {
          key: profile.id,
          type: 'button',
          className: 'dwp-chip',
          'aria-pressed': isActive ? 'true' : 'false',
          title: isActive
            ? `${profile.name} — ${t('clearFilterHint')}`
            : empty ? `${profile.name} — ${t('noFilter')}` : profile.name,
          onClick: () => choose(isActive ? null : profile.id),
        },
        h('span', {
          className: 'dwp-dot',
          'data-empty': empty ? 'true' : 'false',
          style: dotStyle(profile),
        }),
        h('span', { className: 'dwp-chip-label' }, profile.name || t('newProfile'))))
      }

      const menu = menuOpen && menuPosition !== null
        ? h('div', {
          className: 'dwp-pop',
          ref: menuRef,
          role: 'menu',
          style: { left: menuPosition.left, bottom: menuPosition.bottom },
        },
        h('button', {
          type: 'button', role: 'menuitemradio', 'aria-checked': active === null ? 'true' : 'false',
          className: 'dwp-pop-item', 'data-current': active === null ? 'true' : 'false',
          onClick: () => choose(null),
        },
        h('span', { className: 'dwp-dot', style: { color: 'var(--dsw-alias-label-tertiary)' } }),
        h('span', { className: 'dwp-label' }, t('all')),
        active === null ? h('span', { className: 'dwp-check' }, checkIcon()) : null),
        config.profiles.map((profile) => h('button', {
          key: profile.id,
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': active !== null && active.id === profile.id ? 'true' : 'false',
          className: 'dwp-pop-item',
          'data-current': active !== null && active.id === profile.id ? 'true' : 'false',
          onClick: () => choose(profile.id),
        },
        h('span', {
          className: 'dwp-dot',
          'data-empty': profile.paths.length === 0 ? 'true' : 'false',
          style: dotStyle(profile),
        }),
        h('span', { className: 'dwp-label' }, profile.name || t('newProfile')),
        active !== null && active.id === profile.id ? h('span', { className: 'dwp-check' }, checkIcon()) : null)),
        h('div', { className: 'dwp-pop-sep' }),
        h('button', {
          type: 'button', role: 'menuitem', className: 'dwp-pop-item', onClick: openDialog,
        },
        h('span', { style: { display: 'inline-flex', flex: 'none' } }, gearIcon()),
        h('span', { className: 'dwp-label' }, t('manage'))))
        : null

      const allButton = config.profiles.length === 0
        ? null
        : h('button', {
          type: 'button',
          className: 'dwp-all',
          title: t('showAll'),
          'aria-label': t('all'),
          'aria-pressed': active === null ? 'true' : 'false',
          onClick: () => choose(null),
        }, gridIcon())

      const geometry = wide
        ? h('div', { className: 'dwp-bar' },
          allButton,
          config.profiles.length === 0
            ? h('button', {
              type: 'button',
              className: 'dwp-chip',
              onClick: openDialog,
              title: t('manage'),
            },
            h('span', { className: 'dwp-dot', style: { color: PALETTE[4] } }),
            h('span', { className: 'dwp-chip-label' }, t('profiles')))
            : h('div', { className: 'dwp-chips', role: 'group', 'aria-label': t('groupLabel') }, chips),
          config.profiles.length === 0
            ? null
            : h('button', {
              type: 'button',
              className: 'dwp-gear',
              title: state.status === 'error' ? `${t('manage')} — ${t('storageError')}` : t('manage'),
              'aria-label': t('manage'),
              'data-error': state.error !== null ? 'true' : 'false',
              onClick: openDialog,
            }, plusIcon(14)))
        : h('button', {
          type: 'button',
          className: 'dwp-rail',
          ref: railRef,
          title: active === null ? t('all') : active.name,
          'aria-label': active === null ? t('groupLabel') : `${t('groupLabel')}: ${active.name}`,
          'aria-haspopup': 'menu',
          'aria-expanded': menuOpen ? 'true' : 'false',
          'data-active': active !== null ? 'true' : 'false',
          onClick: openMenu,
        }, layersIcon(18),
        active !== null
          ? h('span', {
            className: 'dwp-rail-dot',
            style: { background: PALETTE[active.color % PALETTE.length] },
          })
          : null)

      return h(React.Fragment, null, geometry, menu)
    }

    // ---------------------------------------------------------------------
    // Plugin entry
    // ---------------------------------------------------------------------
    const inject = ['slots', 'workspaces', 'locale']

    function apply(ctx) {
      rootCtx = ctx
      ctx.effect(() => {
        ensureStaticCss()
        return () => {
          document.querySelector(`style[data-plugin="${STYLE_CSS}"]`)?.remove()
          document.querySelector(`style[data-plugin="${STYLE_FILTER}"]`)?.remove()
        }
      }, 'dsh-workspace-profiles: styles')
      try {
        ctx.effect(
          () => ctx.locale.register(NS, { en, ru }),
          'dsh-workspace-profiles: dictionaries',
        )
      } catch (error) {
        console.warn('workspace-profiles: locale registration failed:', error)
      }
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'workspace-profiles', order: 20, locale: NS },
        ProfilesBar,
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'workspace-profiles-dialog', order: 20, locale: NS },
        ProfilesOverlay,
      ))
      void loadConfig()
    }

    return { inject, apply }
  },
})
