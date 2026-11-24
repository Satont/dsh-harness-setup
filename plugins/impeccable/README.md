# Impeccable detector for DSH

The `impeccable-detector` row uses DSH's `tools/post-execute` hook. It passes successfully changed project paths from `write`, `edit`, and `apply_patch` to the installed Impeccable skill's `hook` command and attaches its findings as model context. It never blocks edits. Paths outside the current session directory and deleted files are skipped. The launcher runs locally with the host's permissions and a bounded timeout.

This integration does not intercept shell edits or run the deep Stop pass. Run `$HOME/.dsh/skills/impeccable/scripts/impeccable detect --changed` from the project for a full scan. Impeccable's `hooks status` checks only its upstream integrations and does not recognize this DSH plugin. The plugin honors the engine's project settings, including `hook.enabled`, and suppresses clean-file acknowledgments.

Remove the `dsh-impeccable-detector` bundle from the web profile to uninstall the hook; the skill is independent. The package is pinned to the DSH release it was verified on. Reverify the event and tool value contracts before upgrading it for a new runtime.
