# Secrets and credentials

This repository is intentionally **state-free**: it contains code and configuration, but
none of the values that grant access to accounts or machines.

## What lives where (never in git)

| Secret | Location (home machine) | How to recreate |
|---|---|---|
| ChatGPT/Codex OAuth session | `~/.dsh/plugins/subscriptions/auth.json` (0600) | Settings → Subscriptions → Codex → Log in |
| Other subscription OAuth (Claude/Grok/Copilot/Antigravity) | same auth.json | Settings → Subscriptions → Log in |
| LLM API keys/grants | `~/.dsh/.credentials.yaml` | provider login / API key UI |
| GitLab token | glab's keyring (`glab auth login`) | `glab auth login --hostname <host>` |
| GitHub token | gh's keyring (`gh auth login`) | `gh auth login` |
| Hex local transcription | no secret; local CLI/socket | `hex labs on transcribe-files` and install models |
| Context7 API key | `~/.config/opencode/secrets/context7-key` (0600) | paste your key / change MCP row |
| VPS SSH access | `~/.ssh/config` + keys | your normal SSH setup |
| VPS relay Basic-Auth | `/opt/dsh-relay/.env` (0600) | `openssl rand -base64 24`, update both sides |
| Mobile route config | `~/.config/dsh-mobile/vps.conf` (0600) | copy values from password manager |
| DSH launch token | generated per `dsh web` launch in the printed URL | reopen `dsh web` / desktop |
| Public artifact index/tokens | `~/.dsh/share-index.json` | recreate by publishing |
| Tailscale node auth | managed by tailscaled | `tailscale up` and authenticate |

The `.gitignore` excludes the usual paths, but **never rely on it alone**. Before every
commit:

```bash
git status --short
git diff --cached
grep -RInE 'sk-|ghp_|glpat-|BEGIN .*PRIVATE|token=|password|secret|api[_-]?key' .
```

Review even matches that look like code (e.g. `DEEPSEEK_API_KEY` variable names are fine;
values are not). If a secret ever lands in git history, rotate it; deleting the file in a
new commit is not enough.

## Initial secret provisioning after restore

1. Start DSH and open it.
2. **Settings → Subscriptions**: log in to Codex (and any other providers).
3. **Settings → Models**: add the provider API key(s), or use the provider login cards.
4. `glab auth login` and `gh auth login`.
5. Create `~/.config/opencode/secrets/context7-key` if you use Context7.
6. Create the VPS `.env` from `.env.example`; create `~/.config/dsh-mobile/vps.conf`.
7. Never paste these values into issues, commits, screenshots, or shared token URLs.

## Rotation

- VPS Basic-Auth: update `/opt/dsh-relay/.env`, `docker compose up -d`, and
  `~/.config/dsh-mobile/vps.conf`.
- Codex/Claude: log out and log in again on the Subscriptions page; delete the auth file only
  if the UI cannot recover.
- GitLab/GitHub: `glab auth logout` / `gh auth logout`, then log in again.
- Tailscale: revoke the node/key in the Tailscale admin console if a device is lost.
