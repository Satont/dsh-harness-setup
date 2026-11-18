# Operations

## Desktop wrapper

`ops/dsh-desktop` starts `dsh web` on `127.0.0.1:3099` and opens it in a Chromium-family
app window with a private profile.

```bash
cd ops
./install.sh              # dsh-desktop, .desktop, autostart, icon
dsh-desktop --status
dsh-desktop               # app window + server
dsh-desktop --server-only # server only (systemd/autostart)
dsh-desktop --stop
```

The `systemd/` directory has an optional user unit; do not enable it together with the
autostart entry. Paths in units use `%h`/`$HOME` and must be adjusted for your user.

## Second listener (Tailscale)

```bash
ops/install-dual-listener.sh   # installs dsh-dual-listen + user unit
systemctl --user enable --now dsh-dual-listen.service
systemctl --user status dsh-dual-listen.service
```

It listens on the Tailscale IP and proxies to `127.0.0.1:3099`, rewriting `Host`/`Origin`.
The DSH process remains a single process; do not start a second `dsh web` on the tailnet IP.

## Artifact sharing

`ops/dsh-share` publishes a snapshot of `~/.dsh/artifacts/<name>.html` to a static host:

```bash
export DSH_SHARE_SSH_HOST=dsh-vps
export DSH_SHARE_REMOTE_DIR=/srv/dsh-share
export DSH_SHARE_PUBLIC_BASE=https://share.YOUR_PUBLIC_HOST
ops/dsh-share <name>
ops/dsh-share --list
ops/dsh-share --revoke <token-or-url>
```

The static host (`ops/vps/share-nginx.conf`) serves files with a sandbox CSP and no cookies.
Traefik routes `${SHARE_HOST}` to the nginx container. Published pages are immutable
snapshots: rewriting an artifact does not update an existing link; publish again for a new
URL.

## Worktree lifecycle

- New-session worktree checkbox creates a real worktree under `<repo>/.agents/worktrees/`
  and a branch `dsh-<session8>-<4hex>` from the selected base.
- `dsh-worktree-lifecycle` removes that worktree and branch when the session is deleted;
  safety checks require a DSH-created `.git/worktrees` registration, a `dsh-*` branch, and no
  other session using it.
- Per-project create hook: **Settings → Built-in plugins → Worktree hooks** or
  `<project>/.dsh/worktree-create.{json,sh}` (plus `.dsh/worktree-create.d/*`).
- The hook is fire-and-forget; the first agent tool call may start before setup finishes.
  Keep long installs out of the critical path or use a lock/wait in the hook.

## Voice input via Hex

The microphone button uses the local Hex app (`hex transcribe`) through the `dsh-voice-hex`
provider plugin. On a new machine:

```bash
hex labs on transcribe-files
hex model list --json                 # whisper_large_v3_turbo must be installed
hex transcribe --json --model whisper_large_v3_turbo --language ru /tmp/test.wav
```

Then open **Plugins -> Voice Input -> Speech recognition** and pick a provider (Whisper
large-v3-turbo, Parakeet v3, Qwen3-ASR, SenseVoice, GigaAM, ...). The profile defaults to
`hex-whisper-large-v3-turbo` + language `ru`. Uninstalled models offer **Download and
prepare**; the plugin runs `hex model install` and restores Hex's previous global model.
Audio stays on the host; only the final text enters the draft.

## Model and context tuning

`tools/model-tuning/sync-standard-preset.mjs` regenerates the `preset-standard` block in
`profile/cordis.patch.yml`. Current values: threshold `0.8`, headroom `32768`, retain `0.2`,
summary max `32768`, auto compaction on. See the script's `README.md` for the formula and
commands. Re-run it only against the repo copy, then diff before applying to a live profile.

## Skills and MCP

- Global skill: `~/.dsh/skills/impeccable` (installed via `npx impeccable install --providers=dsh --scope=global --yes --no-hooks`).
- Project skills: `.dsh/skills` (rank 100) and `.agents/skills` (rank 200); flat `.md` or
  `<name>/SKILL.md`; changes are watched live. `.claude/skills` is not scanned.
- Global MCP: Context7 and grep.app rows in `profile/cordis.patch.yml`.
- Project MCP: `<project>/.dsh/mcp.json`, mounted only into that project's sessions.

## Useful checks

```bash
dsh --profile web --dump-config | grep -E 'id: (llm-subscriptions|usage-limits|limits-strip|better-sidebar|context)'
curl -s http://127.0.0.1:3099/ -o /dev/null -w '%{http_code}\n'   # 401 without token is expected
systemctl --user status dsh-dual-listen.service
docker ps --filter name=dsh-relay
```
