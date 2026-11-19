# Plugin inventory (snapshot 2026-11-18)

Versions are pinned in `profile/package.json`. Third-party plugins are installed from npm
unless noted. Local plugins are copied into the profile `plugins/` directory.

## Local plugins

| Bundle | Source | Purpose |
|---|---|---|
| `dsh-claude-ui` | `plugins/dsh-claude-ui` | Warm dark Claude-Code-like theme; CSS/client only |
| `dsh-inline-bash` | `plugins/inline-bash` | `!cmd` in composer, local execution, no model turn |
| `dsh-worktree-lifecycle` | `plugins/worktree-lifecycle` | Cascade-delete DSH worktree + `dsh-*` branch on session delete; per-project create hook (UI tab) |
| `dsh-limits-strip` | `plugins/limits-strip` | Limits card in the left sidebar footer; click opens full Limits |
| `dsh-voice-hex` | `plugins/voice-hex` | Local speech-to-text via Hex: Whisper large-v3-turbo, Parakeet, Qwen3-ASR, GigaAM, ...; DSH provider picker |

## Third-party bundles

| Bundle | Version | Purpose |
|---|---:|---|
| `dsh-plugin-subscriptions` | 0.9.13 | ChatGPT/Codex, Claude, Grok, Copilot, Antigravity as providers; OAuth UI; live catalogs; tools |
| `dsh-artifact` | 0.8.1 | Artifacts tool, right panel, versions, slides |
| `@hualiong/dsh-session-delete` | 0.4.3 | Delete/archive session from the row menu |
| `dsh-plugin-memory` | 0.19.5 | Long-term markdown memory (`~/.memory`) |
| `dsh-plugin-cost-usage` | 0.1.0 | Session/turn cost chip |
| `dsh-notification-hook` | 0.3.0 | Desktop notifications and webhooks |
| `@kyf-eng/dsh-threads` | 0.2.0 | Projects/threads |
| `dsh-project-mcp` | 0.4.3 | Per-project MCP from `.dsh/mcp.json` |
| `@dungsil/dsh-plugin-forge-gitlab` | 0.1.1 | GitLab MR/checks/diff panel |
| `dsh-better-sidebar` | 0.32.0 | Side card: files/editor/changes/tasks/chat. **0.32.1 requires DSH 0.2.2-rc.2** |
| `dsh-context` | 0.85.1 | Context Insights dashboard/commands |
| `dsh-plugin` | 2.3.9 | Settings → Plugin Hub (community marketplace) |
| `whale-girl` | 0.4.0-ru.2 | Russian Whale-girl pet (chat/voice/news, MIT); GitHub `bondiano/whale-girl-ru` |
| `@local/dsh-usage-limits` | github:bondiano/dsh-usage-limits | Full **Limits** page in the left sidebar |
| `dsh-plugin-subscriptions` extras | — | Provides the Codex quota pill used by the full Limits API |

## Install commands (reference)

```bash
# in the profile
pnpm add dsh-better-sidebar@0.32.0 dsh-context@0.85.1 dsh-plugin@2.3.9
pnpm add dsh-plugin-subscriptions@0.9.13 dsh-artifact@0.8.1
pnpm add @hualiong/dsh-session-delete@0.4.3 dsh-plugin-memory@0.19.5
pnpm add dsh-plugin-cost-usage@0.1.0 dsh-notification-hook@0.3.0
pnpm add @kyf-eng/dsh-threads@0.2.0 dsh-project-mcp@0.4.3
pnpm add @dungsil/dsh-plugin-forge-gitlab@0.1.1
pnpm add github:bondiano/dsh-usage-limits \
  "github:bondiano/whale-girl-ru#8e9176e"
pnpm add file:plugins/dsh-claude-ui file:plugins/inline-bash \
  file:plugins/worktree-lifecycle file:plugins/limits-strip file:plugins/voice-hex
```

Add each package name to `dsh.profile.bundles` (the restore profile already does). The
`@local/dsh-usage-limits` package has no npm release; the GitHub source is required.

## Compatibility notes

- The snapshot runs on DSH `0.2.2-rc.1`. Do not update all packages at once.
- `dsh-better-sidebar` 0.32.1 requires `@deepseek-ai/*` `^0.2.2-rc.2`; 0.32.0 is the last
  version compatible with rc.1.
- `dsh-plugin-subscriptions` defaults to Codex client version `0.153.4`, which hides GPT-6.1
  and 6.2. The profile overrides `codexClientVersion: "0.167.2"`.
- `whale-girl` is installed from the Russian fork at commit `8e9176e`; it is a bundle
  (`dsh.bundle` + client) and needs Node >=24. It replaces the old English Whale-chan.
