#!/usr/bin/env bash
# Restore the DSH profile from this repository.
#
# Usage:
#   ./scripts/restore-profile.sh [profile]        # default: web
#   DSH_HOME=/tmp/dsh-restore ./scripts/restore-profile.sh web
#
# The target profile is backed up first (manifests + plugins). Secrets are NOT
# copied: sign in again after the restore.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PROFILE=${1:-web}
DSH_HOME=${DSH_HOME:-$HOME/.dsh}
TARGET="$DSH_HOME/profiles/$PROFILE"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

command -v pnpm >/dev/null || { echo "restore: pnpm is required" >&2; exit 1; }
command -v dsh >/dev/null || echo "restore: warning: dsh is not on PATH yet" >&2

mkdir -p "$TARGET/plugins"

if [[ -f "$TARGET/package.json" ]]; then
  bak="$TARGET/.restore-backup-$STAMP"
  mkdir -p "$bak"
  cp -a "$TARGET/package.json" "$TARGET/cordis.patch.yml" "$TARGET/pnpm-workspace.yaml" "$bak"/ 2>/dev/null || true
  if [[ -d "$TARGET/plugins" ]]; then cp -a "$TARGET/plugins" "$bak/plugins"; fi
  echo "restore: existing manifests/plugins backed up to $bak"
fi

cp "$ROOT/profile/package.json" "$TARGET/package.json"
cp "$ROOT/profile/cordis.patch.yml" "$TARGET/cordis.patch.yml"
cp "$ROOT/profile/pnpm-workspace.yaml" "$TARGET/pnpm-workspace.yaml"

# Local plugins are file: dependencies relative to the profile directory.
for dir in "$ROOT"/plugins/*/; do
  name=$(basename "$dir")
  rm -rf "$TARGET/plugins/$name"
  mkdir -p "$TARGET/plugins/$name"
  (cd "$dir" && tar -cf - --exclude=node_modules --exclude=.git .) | (cd "$TARGET/plugins/$name" && tar -xf -)
  echo "restore: copied local plugin $name"
done

cd "$TARGET"
echo "restore: pnpm install in $TARGET"
pnpm install --config.auto-install-peers=false
echo
printf 'Profile restored: %s\n' "$TARGET"
printf 'Next:\n  DSH_HOME=%q dsh --profile %q\n' "$DSH_HOME" "$PROFILE"
printf 'Then sign in at Settings -> Subscriptions (Codex etc.). No secrets were restored.\n'
