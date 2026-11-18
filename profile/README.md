# Profile manifests

- `package.json` — bundles + dependencies. Local plugins are `file:plugins/<name>`
  relative to the profile directory and are copied there by `scripts/restore-profile.sh`.
- `cordis.patch.yml` — DSH profile overrides. It contains placeholders such as
  `/home/YOUR_USER` and `gitlab.example.com`; adjust them to the target machine.
- `pnpm-workspace.yaml` — hoisted node_modules, `autoInstallPeers: false`, as used by the
  live profile.

Do not add credentials here. `~/.dsh/.credentials.yaml` and the subscriptions auth store
are intentionally outside this repository.
