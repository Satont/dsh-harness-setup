// dsh-limits-strip — compact Limits card in the left sidebar footer.
// Reads the same-origin snapshot the full Limits panel uses and opens that panel
// on click. No credentials or provider APIs are touched by the browser half.
window.__ModuleLoader__.load({
  id: "dsh-limits-strip",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const h = React.createElement;
    const ENDPOINT = "/plugin-api/usage-limits/limits";
    const STYLE_ID = "dsh-limits-strip/style";

    if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')) {
      const style = document.createElement("style");
      style.dataset.pluginCss = STYLE_ID;
      style.textContent = `
        .dsh-limits-card {
          display: flex; flex-direction: column; gap: 6px; width: 100%;
          box-sizing: border-box; margin: 2px 0 8px; padding: 8px 10px 9px;
          border: 1px solid var(--dsw-alias-border-l2);
          border-radius: 7px;
          background: linear-gradient(180deg, var(--dsw-alias-bg-layer-1), var(--dsw-alias-bg-layer-2));
          color: var(--dsw-alias-label-primary); text-align: left;
          font: 11.5px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer; transition: border-color .15s ease, background .15s ease;
        }
        .dsh-limits-card:hover, .dsh-limits-card:focus-visible {
          border-color: var(--dsw-alias-state-business-primary);
          background: var(--dsw-alias-bg-layer-2);
          outline: none;
        }
        .ls-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .ls-head .ls-title { font-weight: 600; font-size: 11.5px; letter-spacing: .01em; white-space: nowrap; }
        .ls-head .ls-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-business-primary); flex: none; }
        .ls-head .ls-chevron { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 15px; line-height: 1; }
        .ls-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .ls-row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
        .ls-name { color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ls-val { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
        .ls-sub { color: var(--dsw-alias-label-tertiary); font-size: 10.5px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ls-track { position: relative; height: 3px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2)); overflow: hidden; }
        .ls-fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--dsw-alias-state-business-primary); }
        .ls-foot { display: flex; justify-content: space-between; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; }
        .dsh-limits-card[data-tone="warn"] .ls-dot, .dsh-limits-card[data-tone="warn"] .ls-fill { background: var(--dsw-alias-state-warning-primary, #d9a441); }
        .dsh-limits-card[data-tone="error"] .ls-dot, .dsh-limits-card[data-tone="error"] .ls-fill { background: var(--dsw-alias-state-error-primary, #e5484d); }
        .ls-skeleton { color: var(--dsw-alias-label-tertiary); }
      `;
      document.head.appendChild(style);
    }

    const pct = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) + "%" : "—");
    const money = (balance) => {
      if (!balance || typeof balance.total !== "number") return "—";
      const prefix = balance.currency === "USD" ? "$" : balance.currency ? balance.currency + " " : "";
      return prefix + balance.total.toFixed(2);
    };

    function openLimits() {
      const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'));
      const target = nodes.find((el) => el.textContent && el.textContent.trim() === "Limits");
      if (target instanceof HTMLElement) target.click();
    }

    function LimitsCard() {
      const [snapshot, setSnapshot] = React.useState(null);
      const [failed, setFailed] = React.useState(false);

      React.useEffect(() => {
        let alive = true;
        const load = async () => {
          try {
            const res = await fetch(ENDPOINT, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            if (alive) { setSnapshot(data); setFailed(false); }
          } catch { if (alive) setFailed(true); }
        };
        void load();
        const timer = setInterval(load, 60_000);
        return () => { alive = false; clearInterval(timer); };
      }, []);

      const providers = snapshot && Array.isArray(snapshot.providers) ? snapshot.providers : [];
      const get = (id) => providers.find((p) => p && p.id === id);
      const codex = get("openai-codex");
      const opencode = get("opencode-go");
      const deepseek = get("deepseek");
      const codexWindow = codex && Array.isArray(codex.windows) ? codex.windows[0] : null;
      const ocWindows = opencode && Array.isArray(opencode.windows) ? opencode.windows : [];
      const balance = deepseek && Array.isArray(deepseek.balances) ? deepseek.balances[0] : null;
      const used = [
        codexWindow && typeof codexWindow.usedPercent === "number" ? codexWindow.usedPercent : -1,
        ...ocWindows.map((w) => (typeof w.usedPercent === "number" ? w.usedPercent : -1)),
      ];
      const worst = Math.max(...used);
      const tone = worst >= 95 ? "error" : worst >= 80 ? "warn" : "ok";

      const rows = [];
      if (codexWindow) {
        rows.push(h("div", { className: "ls-row", key: "codex" },
          h("span", { className: "ls-name" }, "Codex"),
          h("span", { className: "ls-val" }, pct(codexWindow.usedPercent)),
        ));
        rows.push(h("div", { className: "ls-track", key: "codex-track" },
          h("span", { className: "ls-fill", style: { width: Math.max(0, Math.min(100, codexWindow.usedPercent || 0)) + "%" } }),
        ));
      }
      if (ocWindows.length) {
        rows.push(h("div", { className: "ls-row", key: "oc" },
          h("span", { className: "ls-name" }, "OpenCode"),
          h("span", { className: "ls-sub" }, ocWindows.map((w) => pct(w.usedPercent)).join(" / ")),
        ));
      }
      if (balance) {
        rows.push(h("div", { className: "ls-row", key: "ds" },
          h("span", { className: "ls-name" }, "DeepSeek"),
          h("span", { className: "ls-val" }, money(balance)),
        ));
      }
      if (!rows.length) rows.push(h("div", { className: "ls-skeleton", key: "skeleton" }, failed ? "Limits unavailable" : "Loading limits…"));

      return h("button", {
        type: "button",
        className: "dsh-limits-card",
        "data-tone": tone,
        title: "Open Limits — provider quotas, balances, model and platform limits",
        "aria-label": "Open Limits",
        onClick: openLimits,
      },
        h("div", { className: "ls-head" },
          h("span", { className: "ls-dot", "aria-hidden": "true" }),
          h("span", { className: "ls-title" }, "Limits"),
          h("span", { className: "ls-chevron", "aria-hidden": "true" }, "›"),
        ),
        h("div", { className: "ls-body" }, rows),
        h("div", { className: "ls-foot" },
          h("span", null, "auto · 1m"),
          h("span", null, "click to open"),
        ),
      );
    }

    function apply(ctx) {
      try {
        ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register(
          { name: "sidebar.footer.action", id: "limits-card", order: 30 },
          LimitsCard,
        ));
      } catch (error) {
        console.warn("limits-strip: sidebar registration failed", error);
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
