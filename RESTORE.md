# Restore runbook

This is the operational procedure. Follow it in order. Do not skip the scratch boot:
the profile has 18 bundles, local `file:` plugins, and several client add-ons.

## 0. Prerequisites

- Linux with a graphical session (Arch/Omarchy recommended; the desktop wrapper is Linux-only)
- Node.js 22.19+ or 24+ (this backup used Node 26.9)
- `pnpm` 12.x
- DeepSeek Harness CLI on `PATH` (`dsh --version`; this backup used `0.2.2-rc.1`)
- `git`, `gh` (for GitHub forge), `glab` (for GitLab forge), `tailscale` (mobile route)
- Optional: Docker + Traefik on a VPS for public mobile access; nginx/static host for artifacts
- Chromium/Helium and Playwright cache only if you keep the Playwright MCP row

Install DSH if it is missing:

```bash
npm install -g @deepseek-ai/dsh@0.2.2-rc.1
dsh --version
```

## 1. Clone and inspect

```bash
git clone <this-repo> dsh-harness-setup
cd dsh-harness-setup
git log --oneline -5
```

Read `SECRETS.md` before creating any config. Nothing in this repo is a live secret.

## 2. Restore the profile (scratch first)

For a safe test:

```bash
DSH_HOME=/tmp/dsh-restore ./scripts/restore-profile.sh web
DSH_HOME=/tmp/dsh-restore dsh --profile web --port 3097 --no-open --host 127.0.0.1
```

For the real profile after backing it up:

```bash
./scripts/restore-profile.sh web
dsh --profile web
```

The script:
1. backs up existing `package.json`, `cordis.patch.yml`, `pnpm-workspace.yaml` and `plugins/`;
2. copies the repository profile manifests;
3. copies `plugins/*` into `<profile>/plugins/` (the `file:` dependencies are profile-relative);
4. runs `pnpm install` with the profile's `autoInstallPeers: false` setting.

Do not run `pnpm update` or install latest versions: the versions in `profile/package.json`
are known to load on DSH `0.2.2-rc.1`.

## 3. Start and verify the harness

Open the URL printed by `dsh web`. In the sidebar you should see:

- **Plugins**, **Artifacts**, **Automation tasks**, **Context Insights**, **Projects**,
  **Limits**, **More**
- a **Limits** card in the sidebar footer with Codex/OpenCode/DeepSeek values
- a Russian **Whale-girl** pet in the lower-right corner
- the **Limits** card click opens the full panel with provider quotas and model/platform limits

If a bundle is missing, read the startup output for `did not activate` / `pending` and fix
that before adding secrets.

## 4. Sign in to providers (owner action)

### ChatGPT / Codex

1. Open **Settings → Subscriptions**.
2. Choose **Codex (ChatGPT) → Log in** and complete the browser OAuth flow.
3. The profile sets `codexClientVersion: "0.167.2"` so the live catalog exposes
   `gpt-6.1-sol` / `gpt-6.2-sol`; without that override the plugin's old default hides those
   models.
4. Verify **Limits → OpenAI Codex** shows a plan and weekly percentage.
5. Pick the model in the composer: provider group **codex** (`GPT-6.1-Sol` / `GPT-6.2-Sol`).

Optional: also log in to Claude, Grok, GitHub Copilot and Google Antigravity on the same
page; the limits panel and tools update automatically.

### DeepSeek

DeepSeek API access is configured via credentials/`DEEPSEEK_API_KEY`; use **Settings → Models**
or your usual secret provisioning. The Limits card reads the DeepSeek balance through the
host credential seam.

### Kimi subagents (optional)

The profile allows **Kimi K3 / K3.1 Pro** as subagent routes for new Sessions (Plugins →
Subagent). Put the Moonshot coding key in `~/.dsh/.credentials.yaml` as
`KIMI_CODING_API_KEY`; it is never committed. Existing Sessions keep their recorded route
list — start a new Session to use Kimi there.

### GitLab

```bash
glab auth login --hostname "${GITLAB_HOST}"   # replace with the real host
glab auth status
```

The profile's forge row points at `gitlab.example.com`; edit
`profile/cordis.patch.yml` (or the live copy) to the real hostname. The token stays in the
glab keyring, not in this repo.

### MCP

- Global `context7` and `grepapp` are configured in `profile/cordis.patch.yml`.
- `context7` reads `~/.config/opencode/secrets/context7-key`; create that file with your key
  (`chmod 600`), or change the row to use an environment variable.
- Project MCP servers live in `<project>/.dsh/mcp.json`; they are per-project data and
  intentionally not included here.

## 4.1 Voice input (Hex)

The voice button uses the local Hex app instead of cloud speech:

```bash
# once per machine
hex labs on transcribe-files
hex model list --json                 # confirm whisper_large_v3_turbo is installed
hex transcribe --json --model whisper_large_v3_turbo --language ru /tmp/test.wav
```

The profile has `defaultProvider: hex-whisper-large-v3-turbo` and `language: ru`.
Open **Plugins -> Voice Input -> Speech recognition** to pick another Hex model
(Parakeet v3, Qwen3-ASR, GigaAM, SenseVoice, ...). Installing an uninstalled model is
offered in the same dialog and runs `hex model install`; that temporarily switches Hex's
global model, so the plugin restores the previous selection afterwards.

No audio leaves the machine: browser -> DSH speech service -> host plugin -> `hex transcribe`.

## 4.2 Agent browser (live viewport)

`dsh-agent-browser` exposes `browser_open`, `browser_snapshot`, `browser_find`,
`browser_act`, `browser_get`, `browser_eval`, `browser_screenshot`, `browser_tabs` and
`browser_session` to every model, and streams the page into the GUI.

```bash
# once per machine (the profile already allows this build script)
agent-browser install
agent-browser --help              # sanity check

# after starting DSH, ask any model to browse; the panel appears automatically
```

The panel opens directly in the **right sidebar** for the current chat; switching to a chat
with no browser hides it, while its page/tabs stay attached to that chat. **🖱** toggles human
takeover, so you can click/scroll in the live page yourself. The managed Chrome lives in
`~/.agent-browser/browsers/`, independent of the distro Chromium. The local fork under
`plugins/agent-browser` carries the per-chat scope and docked-by-default behavior.

If `browser_open` fails with `Chrome exited early`, run `agent-browser install` (do not
point it at a broken `/usr/bin/chromium`). The profile sets `allowTakeover: true`; the tool
still requires normal DSH permission for eval.

## 5. Skills

Global skills are not part of this repo. To recreate the design skill:

```bash
npx impeccable@latest install --providers=dsh --scope=global --yes --no-hooks
```

Project skills are committed in each repository (`.dsh/skills` or `.agents/skills`), not
here. `~/.dsh/skills/impeccable` is a global runtime install and must be recreated with the
command above.

## 6. Desktop wrapper

```bash
cd ops
./install.sh          # copies dsh-desktop, desktop file, autostart and icon
dsh-desktop --status
dsh-desktop           # server + app window
```

The wrapper uses port `3099` and a private Chromium/Helium profile. `systemd/` contains an
opt-in user unit (`dsh-harness.service`); do not enable it together with the autostart file.

## 7. Mobile access through the VPS

Read [docs/MOBILE-VPS.md](docs/MOBILE-VPS.md). Short version:

1. Put the home Tailscale IP and VPS values in `.env` **outside git**.
2. On the VPS deploy `ops/vps/docker-compose.yml` and the relay script; Traefik terminates
   TLS with Let's Encrypt.
3. On the home machine create `~/.config/dsh-mobile/vps.conf` (0600) with `VPS_HOST`,
   `BASIC_USER`, `BASIC_PASS`, `RELAY_PORT`.
4. Run `dsh-mobile --vps` and open the printed HTTPS URL on the phone.
5. Verify `dsh-mobile --doctor` token exchanges return `303`.

The home DSH server must be running; the relay proxies to it over Tailscale. Stopping the
relay (`ssh <vps> 'docker stop dsh-relay'`) removes public access without touching home.

## 8. Artifact sharing

`ops/dsh-share` publishes a local artifact snapshot to a static HTTPS host. Configure:

```bash
export DSH_SHARE_SSH_HOST=<ssh-alias>
export DSH_SHARE_REMOTE_DIR=/srv/dsh-share
export DSH_SHARE_PUBLIC_BASE=https://share.YOUR_PUBLIC_HOST
ops/dsh-share --latest
```

The static host must serve files with a sandbox CSP and no cookies; see
`docs/OPERATIONS.md`. Published links are snapshots, not live artifact updates.

## 9. Verification checklist

- [ ] `dsh web` starts with zero failed/pending plugins
- [ ] Sidebar has Limits, Context Insights, Plugin Hub (`Settings → Plugin Hub`)
- [ ] Sidebar footer has the Limits card; click opens the full Limits page
- [ ] Codex subscription is connected; Limits shows plan + weekly %; composer shows GPT-6.1/6.2
- [ ] New chat answers a trivial prompt; model route is **codex**, not legacy `openai-codex`
- [ ] `dsh-better-sidebar` side card opens; `dsh-context` dashboard opens
- [ ] Whale-girl (RU) is visible, speaks Russian, and opens its menu
- [ ] Worktree checkbox creates a worktree and branch; deleting that session removes both
- [ ] GitLab/GitHub forge panel sees the repo; `gh auth status` / `glab auth status` are clean
- [ ] `dsh-share` publishes a page; `curl -I` shows sandbox CSP; revoke works
- [ ] Phone route: HTTPS URL loads; Basic-Auth + launch token work; `dsh-mobile --doctor` = 303
- [ ] No secret is present in `git status`, `git log -p`, or the working tree

## 10. Upgrading later

- DSH `0.2.2-rc.2`/`rc.3` unlocks newer plugin versions (e.g. `dsh-better-sidebar 0.32.1`,
  `@linxin666/dsh-usage`), but can break pinned bundles. Upgrade on a **copy** of the
  profile, verify, then switch the live one.
- Re-check `codexClientVersion` after upgrading `dsh-plugin-subscriptions`: newer versions
  may ship a newer default. Keep the explicit value if it still gives the desired catalog.
- Re-run the subscription login only if refresh fails; tokens live in
  `~/.dsh/plugins/subscriptions/auth.json` and are not in this repo.

## Troubleshooting

- **`web boot: ... did not activate`** — open the browser console; a client plugin is waiting
  for a missing service or failed registration. Do not add secrets while the boot is broken.
- **No Limits card** — the client bundle did not load; hard-refresh the page, check
  `Settings → Plugin Hub` for errors, or boot a clean profile on another port.
- **Codex 401 / empty catalog** — re-login in Settings → Subscriptions; verify
  `codexClientVersion: "0.167.2"`; check the system clock.
- **VPS 502** — home DSH desktop server is down or the relay cannot reach the Tailscale IP.
- **Phone loops on Basic-Auth** — check `vps.conf` values; use an incognito tab; ensure the
  relay container is running.
