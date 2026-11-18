// dsh-worktree-lifecycle — browser half.
//
// A Settings → Plugins tab that edits the per-project worktree create hook
// (`<project>/.dsh/worktree-create.json`) through the host's same-origin routes.
// Hand-authored ModuleLoader bundle: only react comes from the shell module
// table.
window.__ModuleLoader__.load({
  id: "dsh-worktree-lifecycle",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let React = require("react");

    const SLOT = "settings.plugins.tab";
    const ROUTE = "/worktree-lifecycle/hooks";
    const CSS_ID = "dsh-worktree-lifecycle/settings.css";
    if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-worktree-lifecycle";
      style.dataset.pluginCss = CSS_ID;
      style.textContent = `
        .wl-page{display:flex;flex-direction:column;gap:18px;max-width:760px;padding:22px 24px 30px;color:var(--dsw-alias-label-primary)}
        .wl-head{display:flex;flex-direction:column;gap:4px}
        .wl-title{font-size:16px;font-weight:600;line-height:24px}
        .wl-sub{font-size:13px;line-height:19px;color:var(--dsw-alias-label-secondary)}
        .wl-field{display:flex;flex-direction:column;gap:6px}
        .wl-label{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-secondary)}
        .wl-select,.wl-textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:9px 10px;outline:none}
        .wl-select{font-family:inherit}
        .wl-select:focus,.wl-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}
        .wl-textarea{min-height:120px;resize:vertical}
        .wl-hint{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
        .wl-actions{display:flex;align-items:center;gap:10px}
        .wl-save{border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-inverse,#fff);border-radius:6px;padding:7px 14px;font:13px/1.2 inherit;cursor:pointer}
        .wl-save:disabled{opacity:.55;cursor:default}
        .wl-status{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary)}
        .wl-status[data-tone="ok"]{color:var(--dsw-alias-state-business-primary)}
        .wl-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
        .wl-badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-tertiary)}
        .wl-meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
      `;
      document.head.appendChild(style);
    }

    function SettingsPage() {
      const [projects, setProjects] = React.useState(null);
      const [selected, setSelected] = React.useState("");
      const [text, setText] = React.useState("");
      const [status, setStatus] = React.useState(null);
      const [busy, setBusy] = React.useState(false);

      const load = React.useCallback(async () => {
        setStatus(null);
        try {
          const res = await fetch(ROUTE, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body || body.ok !== true) throw new Error(body?.error || `HTTP ${res.status}`);
          const list = Array.isArray(body.projects) ? body.projects : [];
          setProjects(list);
          const next = list.some((project) => project.path === selected) ? selected : (list[0]?.path ?? "");
          setSelected(next);
          const project = list.find((entry) => entry.path === next);
          setText(project ? project.run.join("\n") : "");
        } catch (error) {
          setProjects([]);
          setStatus({ tone: "error", text: `Не удалось загрузить проекты: ${error instanceof Error ? error.message : String(error)}` });
        }
      }, [selected]);

      React.useEffect(() => { void load(); /* once */ }, []);

      const project = (projects || []).find((entry) => entry.path === selected) || null;

      const pick = (path) => {
        setSelected(path);
        const next = (projects || []).find((entry) => entry.path === path);
        setText(next ? next.run.join("\n") : "");
        setStatus(null);
      };

      const save = async () => {
        if (!project) return;
        setBusy(true);
        setStatus(null);
        try {
          const run = text.split("\n").map((line) => line.trim()).filter(Boolean);
          const res = await fetch(ROUTE, {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ path: project.path, run }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok || !body || body.ok !== true) throw new Error(body?.error || `HTTP ${res.status}`);
          setStatus({ tone: "ok", text: `Сохранено: ${body.file}` });
          setProjects((current) => (current || []).map((entry) => (entry.path === project.path ? { ...entry, run, hasHook: run.length > 0 } : entry)));
        } catch (error) {
          setStatus({ tone: "error", text: `Не сохранилось: ${error instanceof Error ? error.message : String(error)}` });
        } finally {
          setBusy(false);
        }
      };

      return React.createElement("div", { className: "wl-page" },
        React.createElement("div", { className: "wl-head" },
          React.createElement("div", { className: "wl-title" }, "Хуки worktree"),
          React.createElement("div", { className: "wl-sub" }, "Команды, которые выполняются один раз внутри нового worktree сессии (после создания, до вашей работы)."),
        ),
        projects === null
          ? React.createElement("div", { className: "wl-status" }, "Загрузка…")
          : projects.length === 0
            ? React.createElement("div", { className: "wl-status" }, "Нет зарегистрированных проектов: добавь рабочую область в сайдбаре, затем вернись сюда.")
            : React.createElement(React.Fragment, null,
                React.createElement("div", { className: "wl-field" },
                  React.createElement("label", { className: "wl-label", htmlFor: "wl-project" }, "Проект"),
                  React.createElement("select", { id: "wl-project", className: "wl-select", value: selected, onChange: (event) => pick(event.target.value) },
                    projects.map((entry) => React.createElement("option", { key: entry.path, value: entry.path },
                      `${entry.title} — ${entry.path}`,
                    )),
                  ),
                ),
                project
                  ? React.createElement("div", { className: "wl-meta" },
                      React.createElement("span", null, "Файл: ", React.createElement("code", null, project.hookFile)),
                      project.hasHook ? React.createElement("span", { className: "wl-badge" }, "hook есть") : null,
                      project.script ? React.createElement("span", { className: "wl-badge" }, "есть .sh") : null,
                      project.hookDir ? React.createElement("span", { className: "wl-badge" }, "есть .d/") : null,
                    )
                  : null,
                React.createElement("div", { className: "wl-field" },
                  React.createElement("label", { className: "wl-label", htmlFor: "wl-run" }, "Команды (по одной в строке)"),
                  React.createElement("textarea", {
                    id: "wl-run",
                    className: "wl-textarea",
                    value: text,
                    placeholder: "bun install\nbun run db:generate",
                    onChange: (event) => setText(event.target.value),
                    spellCheck: false,
                  }),
                  React.createElement("div", { className: "wl-hint" }, "Пишутся в ", project ? project.hookFile : "<project>/.dsh/worktree-create.json", ". Выполняются в worktree с env WORKTREE_PATH / WORKTREE_BRANCH / WORKTREE_REPO / SESSION_ID; пустой список — hook выключен. Fire-and-forget: первый tool-call агента может стартовать до завершения setup."),
                ),
                React.createElement("div", { className: "wl-actions" },
                  React.createElement("button", { type: "button", className: "wl-save", disabled: busy || !project, onClick: save }, busy ? "Сохранение…" : "Сохранить"),
                  React.createElement("button", { type: "button", className: "wl-save", style: { background: "transparent", color: "var(--dsw-alias-label-primary)" }, disabled: busy, onClick: () => void load() }, "Обновить"),
                  status ? React.createElement("span", { className: "wl-status", "data-tone": status.tone }, status.text) : null,
                ),
              ),
      );
    }

    const inject = ["slots"];

    function apply(ctx) {
      try {
        ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT,
          id: "worktree-lifecycle-hooks",
          order: 42,
          label: () => "Хуки worktree",
        }, SettingsPage));
      } catch (error) {
        console.error("dsh-worktree-lifecycle: settings tab registration failed", error);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
