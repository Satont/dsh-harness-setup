# Architecture

One DSH process serves the web UI. Everything else is a plugin or a small network proxy.

```
┌───────────────────────────── home Linux host ─────────────────────────────┐
│  Chromium/Helium app window ──► 127.0.0.1:3099  (dsh web)                 │
│                                      │                                    │
│  dsh-dual-listen ── Tailscale IP:3099 ─┘  (same process, second listener) │
│                                      │                                    │
│  ~/.dsh/profiles/web: bundles + local plugins + cordis.patch.yml          │
│  ~/.dsh/artifacts: self-contained HTML artifacts                          │
│  ~/.memory: markdown long-term memory (outside this repo)                 │
└──────────────────────────────────────┬────────────────────────────────────┘
                                       │ Tailscale
                                       ▼
┌──────────────────────────── VPS (Docker/Traefik) ─────────────────────────┐
│  traefik-public network                                                   │
│    dsh-relay (node:22-alpine + dsh-dual-listen) :3100                     │
│      --basic-auth ${BASIC_USER}:${BASIC_PASS}                             │
│      --target ${TAILSCALE_IP}:3099 --rewrite-host 127.0.0.1:3099          │
│    Traefik: Host(`${PUBLIC_HOST}`) → relay:3100, websecure, LE resolver   │
│    static share host: Host(`${SHARE_HOST}`) → nginx artifacts             │
└───────────────────────────────────────────────────────────────────────────┘
                                       ▲
                                  phone browser (HTTPS, no VPN)
```

## Why two listeners

DSH binds one address per process. The desktop wrapper starts it on loopback for the app
window; `dsh-dual-listen` adds a transparent proxy on the Tailscale IP so the phone or VPS
can reach the same process. It rewrites `Host`/`Origin` to `127.0.0.1:3099`, which keeps the
launch-token and cookie origin checks valid.

## Profile composition

`~/.dsh/profiles/web/package.json` lists bundles in `dsh.profile.bundles`. Each bundle
contributes Cordis rows; `cordis.patch.yml` then overrides config and inserts extra rows.
Local plugins are installed as `file:plugins/<name>` so the profile is self-contained.

Important rows in `profile/cordis.patch.yml`:

- `llm-pi-ai` — legacy `openai-codex` fallback models
- `agent-default-model` — `provider: codex`, `model: gpt-6.2-sol`, medium effort
- `ui-theme` — dark preference, fonts
- `claude-ui` — local theme client plugin
- `mcp-context7`, `mcp-grepapp`, `mcp-playwright`
- `preset-standard` — tools, skills, compaction block (generated; see `tools/model-tuning/`)
- `llm-subscriptions` — `codexClientVersion: "0.167.2"` (critical for GPT-6.1/6.2)
- `notify-hook`, `dsh-memory`, `locale en`, `inline-bash`

## Data that is intentionally outside git

- `~/.dsh/.credentials.yaml` (provider grants, secrets)
- `~/.dsh/plugins/subscriptions/auth.json` (OAuth sessions)
- `~/.dsh/storages/` (sessions/projections)
- `~/.dsh/artifacts/` (generated pages and snapshots)
- `~/.memory/` (personal long-term memory)
- `~/.config/dsh-mobile/vps.conf` (Basic-Auth and VPS host)
- DSH launch tokens and public artifact token URLs

The repo is the **configuration/code**; the home directory is the **state**.
