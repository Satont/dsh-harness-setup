#!/usr/bin/env bash
# Remove the DSH Linux desktop wrapper files installed by install.sh.
#
#   ./uninstall.sh           remove launcher, app entry, icon and autostart; keep app data
#   ./uninstall.sh --purge   also stop the managed server and delete its state + Chromium profile
#
# User data removed by --purge lives in ~/.local/share/dsh-harness and
# ~/.local/state/dsh-desktop. The DSH profile (~/.dsh) is never touched.
set -euo pipefail

APPS_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/applications
ICONS_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor
AUTOSTART_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/autostart
UNIT_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
BIN_DIR=$HOME/.local/bin

PURGE=0
[[ ${1:-} == --purge ]] && PURGE=1 || true

say() { printf 'uninstall: %s\n' "$*"; }
rm_f() { [[ -e $1 ]] && { rm -f -- "$1"; say "removed $1"; } || true; }

if [[ -x $BIN_DIR/dsh-desktop ]]; then
  "$BIN_DIR/dsh-desktop" --stop >/dev/null 2>&1 || true
fi

rm_f "$BIN_DIR/dsh-desktop"
rm_f "$APPS_DIR/dsh-harness.desktop"
rm_f "$ICONS_DIR/scalable/apps/dsh-harness.svg"
rm_f "$ICONS_DIR/256x256/apps/dsh-harness.png"
rm_f "$AUTOSTART_DIR/dsh-harness.desktop"
rm_f "$UNIT_DIR/dsh-harness.service"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$ICONS_DIR" >/dev/null 2>&1 || true

if ((PURGE)); then
  rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/dsh-desktop"
  rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/dsh-harness"
  say "removed state and Chromium profile (--purge)"
fi

say 'done'
