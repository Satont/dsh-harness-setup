# AGENTS.md — restore this DSH setup

You are restoring a working DeepSeek Harness setup from this repository. Read
`README.md`, `RESTORE.md`, `docs/ARCHITECTURE.md`, and `SECRETS.md` before changing
anything. The human owner (Satont) expects a **working, verified** setup, not a best-effort
copy.

## Rules

1. **Never commit or print live credentials.** This repo must stay free of OAuth tokens,
   API keys, passwords, Basic-Auth values, private SSH keys, account IDs and token URLs.
   If you discover a secret in the working tree, stop, remove it, rotate it if needed, and
   tell the owner. `.gitignore` is a safety net, not permission to store secrets.
2. **Back up before replacing.** The restore script backs up profile manifests and local
   plugins. If you edit an existing live profile, copy `package.json`,
   `cordis.patch.yml` and the profile `plugins/` directory to a timestamped `.bak` first.
3. **Do not restart a live DSH server without explicit permission.** The current chat runs
   inside that process. Prepare changes first, report, and let the owner decide when to
   restart. Use a detached `systemd-run --user` restart only when asked.
4. **Work on a scratch `DSH_HOME` first.** Restore into `/tmp/dsh-restore` or another empty
   home, boot it on a spare port, and verify the plugin rows before touching the live
   profile.
5. **Respect versions.** This setup was taken on DSH `0.2.3-alpha.2` (Node `26.13.1`). Some plugins need newer
   runtimes; do not blindly install latest versions. The profile pins known-good versions.
   `dsh-better-sidebar` is now `0.32.1` on DSH `0.2.3-alpha.2`. `@kyf-eng/dsh-threads` is a local patched fork (`plugins/dsh-threads-alpha2`) for the alpha.2 client API.
6. **Secrets are provisioned interactively, never copied from git.** Codex/ChatGPT auth is
   created via Settings → Subscriptions; GitLab via `glab auth login`; VPS values via the
   owner's password manager or `.env` outside the repo.
7. **Verify with a real boot and a screenshot/test.** A profile that installs but fails to
   activate plugins is not restored. Check startup output for failed plugins and then open
   the UI.

## Restore workflow

1. Clone the repo and inspect `git log` / `README.md`.
2. Run `scripts/restore-profile.sh <profile>` with `DSH_HOME` pointing at a **scratch home**
   first, or at `~/.dsh` only after a backup.
3. Copy/keep local plugins under the profile; the script handles `file:` dependencies.
4. `pnpm install` in the profile; do not use `--no-optional` or install latest versions.
5. Start `dsh --profile <profile>` on a spare port; check the startup banner and plugin
   activation. Fix failures before continuing.
6. Sign in to subscriptions, GitLab, MCP providers, enable Hex's `transcribe-files` lab and
   confirm the Whisper model, run `agent-browser install` for the managed browser, and
   install the global `impeccable` skill if requested. These steps require the owner.
7. For mobile: create `~/.config/dsh-mobile/vps.conf` from the owner's secrets, deploy the
   VPS relay from `ops/vps/`, and test token exchange end-to-end.
8. Report what works, what still needs the owner, and every secret that must be re-entered.

## What must not be in git

- `.env`, `.env.*` (except `.env.example`)
- `~/.dsh/.credentials.yaml`, `~/.dsh/plugins/subscriptions/auth.json`
- `~/.config/dsh-mobile/vps.conf`, `~/.local/state/dsh-mobile/*auth*`
- SSH private keys, `*.pem`, `id_*`
- DSH launch-token URLs (`?token=...`) and published artifact token URLs
- Account IDs/emails in screenshots or logs

If a restore requires a secret, write a `TODO(owner): ...` note in your report; never invent
or commit one.
