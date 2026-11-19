# Profile manifests

- `package.json` — bundles + dependencies. Local plugins are `file:plugins/<name>`
  relative to the profile directory and are copied there by `scripts/restore-profile.sh`.
- `cordis.patch.yml` — DSH profile overrides. It contains placeholders such as
  `/home/YOUR_USER` and `gitlab.example.com`; adjust them to the target machine.
  New sessions default to **full access** (`danger-full-access` + approval `never`,
  set by the `permission` block at the end). Remove or change that block if you want
  workspace-write as the default; existing sessions keep their pinned permission.
- `pnpm-workspace.yaml` — hoisted node_modules, `autoInstallPeers: false`, as used by the
  live profile. It also allows the `agent-browser` install script, needed by the browser
  plugin.
- `dsh-agent-browser` — model-facing `browser_*` tools plus a live viewport panel inside
  the DSH GUI. After restoring, run `agent-browser install` once to fetch Chrome for
  Testing; the system Chromium may be unusable while the managed build is self-contained.

Do not add credentials here. `~/.dsh/.credentials.yaml` and the subscriptions auth store
are intentionally outside this repository.
