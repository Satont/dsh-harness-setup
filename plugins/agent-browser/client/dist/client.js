window.__ModuleLoader__.load({
	id: "dsh-agent-browser",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.ts
var index_exports = {};
__export(index_exports, {
  BrowserPanel: () => BrowserPanel,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var MODE_KEY = "dsh-agent-browser.mode";
var WIDTH_KEY = "dsh-agent-browser.sidebar-width";
function loadMode() {
  try {
    if (localStorage.getItem("dsh-agent-browser.docked-v1") !== "1") {
      localStorage.setItem("dsh-agent-browser.docked-v1", "1");
      localStorage.setItem(MODE_KEY, "sidebar");
    }
    const v = localStorage.getItem(MODE_KEY);
    return v === "float" || v === "sidebar" || v === "chip" ? v : "sidebar";
  } catch {
    return "sidebar";
  }
}
function saveMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
  }
}
function loadWidth() {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(v)) return Math.min(Math.max(v, 320), 760);
  } catch {
  }
  return 480;
}
async function fetchInventory() {
  try {
    const res = await fetch("/browser/sessions", { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
function normalizeTabs(raw) {
  const list = Array.isArray(raw) ? raw : raw !== null && typeof raw === "object" && Array.isArray(raw.tabs) ? raw.tabs : [];
  return list.slice(0, 16).map((entry, i) => {
    const t = entry ?? {};
    return {
      id: String(t.tabId ?? t.id ?? t.targetId ?? "t" + (i + 1)),
      title: typeof t.title === "string" ? t.title : "",
      url: typeof t.url === "string" ? t.url : "",
      active: t.active === true
    };
  });
}
async function fetchTabs(session) {
  try {
    const q = session ? "?session=" + encodeURIComponent(session) : "";
    const res = await fetch("/browser/tabs" + q, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const body = await res.json();
    return body.ok === true ? normalizeTabs(body.tabs) : [];
  } catch {
    return [];
  }
}
async function postTab(session, action, payload = {}) {
  try {
    const res = await fetch("/browser/tabs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session, action, ...payload })
    });
    if (!res.ok) return [];
    const body = await res.json();
    return body.ok === true ? normalizeTabs(body.tabs) : [];
  } catch {
    return [];
  }
}
var btnStyle = {
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
  padding: "3px 6px",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "transparent",
  color: "inherit"
};
function Viewer(props) {
  const canvasRef = (0, import_react.useRef)(null);
  const wsRef = (0, import_react.useRef)(null);
  const [status, setStatus] = (0, import_react.useState)("connecting");
  const [ageMs, setAgeMs] = (0, import_react.useState)(null);
  const [feed, setFeed] = (0, import_react.useState)([]);
  (0, import_react.useEffect)(() => {
    let ws = null;
    let disposed = false;
    let bitmap = null;
    const fps = props.fps ?? 12;
    const params = new URLSearchParams({ maxFps: String(fps), pacing: "ack" });
    if (props.session) params.set("session", props.session);
    const ticker = window.setInterval(() => {
      setAgeMs((prev) => prev === null ? prev : prev + 500);
    }, 500);
    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(proto + "//" + location.host + "/browser/stream?" + params.toString());
      ws.binaryType = "arraybuffer";
      ws.onopen = () => setStatus("live");
      wsRef.current = ws;
      ws.onerror = () => setStatus("error");
      ws.onclose = () => setStatus((s) => disposed ? s : "idle");
      ws.onmessage = async (ev) => {
        if (typeof ev.data !== "string") return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "console") {
            const line = typeof msg.text === "string" ? msg.text : JSON.stringify(msg);
            setFeed((prev) => [...prev.slice(-4), line.slice(0, 160)]);
            return;
          }
          if (msg.type === "url" && typeof msg.url === "string") {
            setFeed((prev) => [...prev.slice(-4), "\u2192 " + msg.url]);
            return;
          }
          if (msg.type === "tabs") {
            props.onTabs?.(normalizeTabs(msg.tabs));
            return;
          }
          if (msg.type !== "frame" || typeof msg.data !== "string") return;
          const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
          const next = await createImageBitmap(new Blob([bytes.buffer], { type: "image/jpeg" }));
          bitmap?.close();
          bitmap = next;
          setAgeMs(0);
          const canvas = canvasRef.current;
          if (canvas) {
            const ctx2d = canvas.getContext("2d");
            if (ctx2d) {
              canvas.width = next.width;
              canvas.height = next.height;
              ctx2d.drawImage(next, 0, 0);
            }
          }
          if (msg.seq !== void 0 && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ack", seq: msg.seq }));
          }
        } catch {
        }
      };
    } catch {
      setStatus("error");
    }
    return () => {
      disposed = true;
      window.clearInterval(ticker);
      bitmap?.close();
      wsRef.current = null;
      ws?.close();
    };
  }, [props.session, props.fps]);
  const freshness = status === "live" && ageMs === null ? "" : ageMs !== null && ageMs > 3e3 ? " (" + Math.round(ageMs / 1e3) + "s stale)" : "";
  const sendMouse = (0, import_react.useCallback)(
    (eventType) => (ev) => {
      if (!props.takeover || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((ev.clientX - rect.left) / rect.width * canvas.width);
      const y = Math.round((ev.clientY - rect.top) / rect.height * canvas.height);
      const button = ev.button === 2 ? "right" : ev.button === 1 ? "middle" : "left";
      const mods = (ev.altKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0) | (ev.metaKey ? 4 : 0) | (ev.shiftKey ? 8 : 0);
      wsRef.current.send(
        JSON.stringify({
          type: "input_mouse",
          eventType,
          x,
          y,
          button,
          clickCount: eventType === "mousePressed" ? 1 : 0,
          modifiers: mods
        })
      );
    },
    [props.takeover]
  );
  const sendKey = (0, import_react.useCallback)(
    (eventType) => (ev) => {
      if (!props.takeover || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      ev.preventDefault();
      ev.stopPropagation();
      const text = eventType === "keyDown" && ev.key.length === 1 ? ev.key : void 0;
      wsRef.current.send(
        JSON.stringify({
          type: "input_keyboard",
          eventType,
          key: ev.key,
          code: ev.code,
          ...text !== void 0 ? { text } : {},
          windowsVirtualKeyCode: ev.key.length === 1 ? ev.key.charCodeAt(0) : 0,
          modifiers: (ev.altKey ? 1 : 0) | (ev.ctrlKey ? 2 : 0) | (ev.metaKey ? 4 : 0) | (ev.shiftKey ? 8 : 0)
        })
      );
    },
    [props.takeover]
  );
  const canvasStyle = props.fill ? {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#111",
    borderRadius: 8,
    cursor: props.takeover ? "crosshair" : "default",
    outline: "none"
  } : {
    width: "100%",
    height: "auto",
    background: "#111",
    borderRadius: 8,
    cursor: props.takeover ? "crosshair" : "default",
    outline: "none"
  };
  return (0, import_react.createElement)(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
        flex: 1,
        ...props.fill ? { minHeight: 0 } : {}
      }
    },
    (0, import_react.createElement)("canvas", {
      ref: canvasRef,
      width: 640,
      height: 360,
      tabIndex: 0,
      style: canvasStyle,
      onMouseDown: sendMouse("mousePressed"),
      onMouseUp: sendMouse("mouseReleased"),
      onMouseMove: props.takeover ? sendMouse("mouseMoved") : void 0,
      onContextMenu: (e) => e.preventDefault(),
      onKeyDown: props.takeover ? sendKey("keyDown") : void 0,
      onKeyUp: props.takeover ? sendKey("keyUp") : void 0,
      onWheel: props.takeover ? (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = Math.round((e.clientX - rect.left) / rect.width * canvas.width);
        const y = Math.round((e.clientY - rect.top) / rect.height * canvas.height);
        wsRef.current.send(
          JSON.stringify({
            type: "input_mouse",
            eventType: "mouseWheel",
            x,
            y,
            button: "none",
            clickCount: 0,
            deltaX: e.deltaX,
            deltaY: e.deltaY
          })
        );
      } : void 0
    }),
    (0, import_react.createElement)(
      "div",
      { style: { fontSize: 11, opacity: 0.7 } },
      status + freshness + " \xB7 session: " + (props.label ?? props.session ?? "default") + (props.takeover ? " \xB7 takeover ON" : "")
    ),
    feed.length > 0 ? (0, import_react.createElement)(
      "div",
      { style: { fontSize: 10, opacity: 0.6, maxHeight: 64, overflow: "hidden", whiteSpace: "pre-wrap" } },
      feed.join("\n")
    ) : null
  );
}
function SessionTabs(props) {
  return (0, import_react.createElement)(
    "div",
    { style: { display: "flex", gap: 2, overflowX: "auto", flex: 1, minWidth: 0, scrollbarWidth: "thin" } },
    props.names.map(
      (n) => (0, import_react.createElement)(
        "button",
        {
          key: n,
          "data-session-tab": n,
          "data-active": n === props.picked ? "1" : "0",
          onClick: () => props.onPick(n),
          title: "Show session " + n,
          style: {
            ...btnStyle,
            whiteSpace: "nowrap",
            maxWidth: 140,
            overflow: "hidden",
            textOverflow: "ellipsis",
            borderColor: n === props.picked ? "var(--dsw-alias-border-l2, #444)" : "transparent",
            background: n === props.picked ? "var(--dsw-alias-bg-raised, #26262b)" : "transparent"
          }
        },
        n
      )
    )
  );
}
function BrowserTabStrip(props) {
  if (props.tabs.length === 0) return null;
  return (0, import_react.createElement)(
    "div",
    {
      "data-browser-tabs": "",
      style: {
        display: "flex",
        alignItems: "center",
        gap: 2,
        overflowX: "auto",
        paddingBottom: 2,
        borderBottom: "1px solid var(--dsw-alias-border-l1, #2a2a2e)",
        scrollbarWidth: "thin",
        pointerEvents: "auto"
      }
    },
    ...props.tabs.map(
      (t) => (0, import_react.createElement)(
        "span",
        {
          key: t.id,
          "data-browser-tab": t.id,
          "data-active": t.active ? "1" : "0",
          title: t.title ? t.title + "\n" + t.url : t.url,
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            whiteSpace: "nowrap",
            maxWidth: 150,
            padding: "2px 4px 2px 8px",
            borderRadius: 6,
            cursor: "pointer",
            background: t.active ? "var(--dsw-alias-bg-raised, #26262b)" : "transparent",
            border: "1px solid " + (t.active ? "var(--dsw-alias-border-l2, #444)" : "transparent")
          },
          onClick: () => {
            if (!t.active) props.onSwitch(t.id);
          }
        },
        (0, import_react.createElement)("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, t.title || t.url || t.id),
        (0, import_react.createElement)("button", {
          title: "Close tab " + t.id,
          onClick: (ev) => {
            ev.stopPropagation();
            props.onClose(t.id);
          },
          style: { ...btnStyle, fontSize: 10, opacity: 0.6, padding: "0 3px" }
        }, "\xD7")
      )
    ),
    (0, import_react.createElement)("button", {
      title: "New tab (about:blank)",
      onClick: props.onNew,
      style: { ...btnStyle, fontSize: 13, padding: "0 6px" }
    }, "+")
  );
}
function BrowserPanel(props) {
  const currentSessionId = props?.currentSessionId;
  const scoped = currentSessionId !== void 0;
  const [inventory, setInventory] = (0, import_react.useState)(null);
  const [mode, setMode] = (0, import_react.useState)(() => loadMode());
  const [picked, setPicked] = (0, import_react.useState)(null);
  const [sidebarWidth, setSidebarWidth] = (0, import_react.useState)(() => loadWidth());
  const [bTabs, setBTabs] = (0, import_react.useState)([]);
  const open = mode !== "chip";
  const autoOpenedRef = (0, import_react.useRef)(false);
  const applyMode = (0, import_react.useCallback)((next) => {
    setMode(next);
    saveMode(next);
  }, []);
  (0, import_react.useEffect)(() => {
    let alive = true;
    const poll = async () => {
      if (document.visibilityState === "hidden") return;
      const inv = await fetchInventory();
      if (!alive || inv === null) return;
      setInventory(inv);
      if (!autoOpenedRef.current && inv.autoOpenPanel && inv.sessions.length > 0 && loadMode() === "chip") {
        autoOpenedRef.current = true;
        applyMode("float");
      }
      setPicked((prev) => scoped ? currentSessionId : prev ?? inv.sessions[0]?.name ?? null);
    };
    void poll();
    const timer = window.setInterval(poll, 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [applyMode, scoped, currentSessionId]);
  (0, import_react.useEffect)(() => {
    if (scoped) setPicked(currentSessionId);
  }, [scoped, currentSessionId]);
  (0, import_react.useEffect)(() => {
    setBTabs([]);
    if (!open) return;
    void fetchTabs(picked).then(setBTabs);
  }, [picked, open]);
  const popOut = (0, import_react.useCallback)(() => {
    const q = picked ? "?session=" + encodeURIComponent(picked) : "";
    window.open("/browser/viewer" + q, "_blank", "width=900,height=700");
  }, [picked]);
  const allNames = inventory?.sessions.map((s) => s.name ?? "(default)") ?? [];
  const names = scoped ? allNames.filter((n) => n === currentSessionId) : allNames;
  const activeRow = inventory?.sessions.find((s) => (s.name ?? null) === picked);
  const toggleTakeover = (0, import_react.useCallback)(async () => {
    const res = await fetch("/browser/takeover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: picked, enabled: !(activeRow?.takeover ?? false) })
    });
    if (res.ok) {
      const inv = await fetchInventory();
      if (inv) setInventory(inv);
    }
  }, [picked, activeRow]);
  const startResize = (0, import_react.useCallback)(
    (down) => {
      down.preventDefault();
      const startX = down.clientX;
      const startW = sidebarWidth;
      const clamp = (rawX) => Math.min(Math.max(startW + (startX - rawX), 320), Math.min(760, window.innerWidth - 80));
      const move = (ev) => setSidebarWidth(clamp(ev.clientX));
      const up = (ev) => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        const w = clamp(ev.clientX);
        setSidebarWidth(w);
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [sidebarWidth]
  );
  const rootRef = (0, import_react.useRef)(null);
  const paddedRef = (0, import_react.useRef)([]);
  (0, import_react.useEffect)(() => {
    const overlay = (() => {
      let node = rootRef.current?.parentElement ?? null;
      while (node && !node.hasAttribute("data-shell-overlay")) node = node.parentElement;
      return node ?? document.querySelector("[data-shell-overlay]");
    })();
    const frame = overlay?.parentElement ?? null;
    const restore = () => {
      for (const entry of paddedRef.current) {
        entry.el.style.paddingRight = entry.paddingRight;
        entry.el.style.boxSizing = entry.boxSizing;
      }
      paddedRef.current = [];
    };
    const apply2 = () => {
      restore();
      if (mode !== "sidebar" || !frame || !overlay) return;
      if (scoped && (currentSessionId === null || names.length === 0)) return;
      const width = Math.min(Math.max(sidebarWidth, 280), Math.max(280, window.innerWidth - 60));
      const coverLeft = frame.getBoundingClientRect().right - width;
      const next = [];
      for (const child of Array.from(frame.children)) {
        if (child === overlay || child.hasAttribute("data-shell-overlay")) continue;
        if (getComputedStyle(child).position === "absolute") continue;
        const box = child.getBoundingClientRect();
        if (box.width < 8) continue;
        const overlap = box.right - coverLeft;
        if (overlap <= 1) continue;
        next.push({
          el: child,
          paddingRight: child.style.paddingRight,
          boxSizing: child.style.boxSizing
        });
        child.style.boxSizing = "border-box";
        child.style.paddingRight = Math.round(overlap) + "px";
      }
      paddedRef.current = next;
    };
    apply2();
    if (!frame) return restore;
    const observer = new ResizeObserver(() => apply2());
    observer.observe(frame);
    window.addEventListener("resize", apply2);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply2);
      restore();
    };
  }, [mode, sidebarWidth, scoped, currentSessionId, names.length]);
  if (scoped && (currentSessionId === null || names.length === 0)) return null;
  const effWidth = Math.min(Math.max(sidebarWidth, 280), Math.max(280, window.innerWidth - 60));
  const containerBase = {
    pointerEvents: open ? "auto" : "none",
    background: "var(--dsw-alias-bg-base, #1b1b1f)",
    color: "var(--dsw-alias-text-primary, #ddd)",
    display: "flex",
    flexDirection: "column",
    gap: 8
  };
  const containerStyle = mode === "sidebar" ? {
    ...containerBase,
    // Absolute within the shell's overlay layer (which spans the frame).
    // Center/details columns are inset by the effect above so chat isn't covered.
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: effWidth,
    zIndex: 40,
    padding: 10,
    borderLeft: "1px solid var(--dsw-alias-border-l2, #333)",
    boxShadow: "-8px 0 24px rgba(0,0,0,.25)"
  } : {
    ...containerBase,
    position: "absolute",
    right: 12,
    bottom: 12,
    zIndex: 30,
    maxWidth: 420,
    maxHeight: "70vh",
    border: "1px solid var(--dsw-alias-border-l2, #333)",
    borderRadius: 12,
    padding: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,.25)"
  };
  const header = (0, import_react.createElement)(
    "div",
    {
      // Explicitly opt back into hit-testing: the root is pointer-events:none
      // while collapsed (so the chip doesn't block the app), and none would
      // otherwise inherit into every control — the pill included.
      style: { display: "flex", alignItems: "center", gap: 6, minHeight: 24, pointerEvents: "auto" }
    },
    mode === "sidebar" ? (0, import_react.createElement)("strong", { style: { fontSize: 12, whiteSpace: "nowrap" } }, "\u{1F5A5} Browser") : (0, import_react.createElement)(
      "button",
      {
        onClick: () => applyMode(open ? "chip" : "float"),
        style: { cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" },
        title: open ? "Collapse the browser panel" : "Toggle the live browser panel"
      },
      "\u{1F5A5} Browser" + (names.length > 0 ? " (" + names.length + ")" : "")
    ),
    open && names.length > 0 && !scoped ? (0, import_react.createElement)(SessionTabs, {
      names,
      picked: picked ?? "",
      onPick: (n) => setPicked(n === "(default)" ? null : n)
    }) : (0, import_react.createElement)("span", { style: { flex: 1 } }),
    open ? (0, import_react.createElement)(
      "span",
      { style: { display: "inline-flex", gap: 2 } },
      (0, import_react.createElement)("button", {
        onClick: toggleTakeover,
        title: "Toggle human-takeover input forwarding",
        style: { ...btnStyle, whiteSpace: "nowrap" }
      }, activeRow?.takeover ?? false ? "\u{1F5B1} ON" : "\u{1F5B1}"),
      mode === "float" ? (0, import_react.createElement)("button", { onClick: () => applyMode("sidebar"), title: "Dock as right sidebar", style: btnStyle }, "\u25A4") : (0, import_react.createElement)("button", { onClick: () => applyMode("float"), title: "Undock to floating panel", style: btnStyle }, "\u2750"),
      (0, import_react.createElement)("button", { onClick: popOut, title: "Pop out to a separate window", style: btnStyle }, "\u29C9"),
      (0, import_react.createElement)("button", { onClick: () => applyMode("chip"), title: "Close the browser panel", style: btnStyle }, "\u2715")
    ) : null
  );
  return (0, import_react.createElement)(
    "div",
    {
      ref: rootRef,
      "data-browser-panel": open ? "open" : "closed",
      "data-browser-mode": mode,
      style: containerStyle
    },
    mode === "sidebar" ? (0, import_react.createElement)("div", {
      onMouseDown: startResize,
      title: "Drag to resize the sidebar",
      style: { position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize", pointerEvents: "auto" }
    }) : null,
    header,
    open ? (0, import_react.createElement)(BrowserTabStrip, {
      tabs: bTabs,
      onSwitch: (id) => void postTab(picked, "switch", { tab: id }).then(setBTabs),
      onClose: (id) => void postTab(picked, "close", { tab: id }).then(setBTabs),
      onNew: () => void postTab(picked, "new").then(setBTabs)
    }) : null,
    open ? names.length === 0 ? (0, import_react.createElement)(
      "div",
      { style: { fontSize: 11, opacity: 0.65, padding: "8px 2px" } },
      "No live browser sessions yet. Ask the agent to open a page."
    ) : (0, import_react.createElement)(Viewer, {
      session: picked,
      label: scoped ? "this chat" : picked,
      takeover: activeRow?.takeover === true,
      fill: mode === "sidebar",
      onTabs: setBTabs
    }) : null
  );
}
var inject = ["slots", "uiSession"];
function apply(ctx) {
  const uiSession = ctx.uiSession;
  function ScopedBrowserPanel(props) {
    const read = () => {
      const value = uiSession?.current?.getSnapshot?.();
      return value?.key ?? null;
    };
    const [currentSessionId, setCurrentSessionId] = (0, import_react.useState)(read);
    (0, import_react.useEffect)(() => {
      if (!uiSession?.current?.subscribe) return;
      const sync = () => setCurrentSessionId(read());
      return uiSession.current.subscribe(sync);
    }, []);
    return (0, import_react.createElement)(BrowserPanel, {
      ...props,
      ...(uiSession ? { currentSessionId } : {})
    });
  }
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register({ name: "shell.overlay", id: "browser-panel", order: 40 }, ScopedBrowserPanel)
  );
}

		return module.exports;
	}
});
