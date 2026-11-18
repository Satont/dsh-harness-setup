#!/usr/bin/env bash
# Install the DSH Linux desktop wrapper into the current user's XDG directories.
#
#   ./install.sh              install launcher, icon, app entry, autostart (no systemd unit)
#   ./install.sh --with-systemd   also install the opt-in systemd user unit (not enabled)
#   ./install.sh --no-autostart   skip ~/.config/autostart
#
# Everything is idempotent; existing files are overwritten.
set -euo pipefail

SRC_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BIN_DIR=$HOME/.local/bin
APPS_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/applications
ICONS_DIR=${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor
AUTOSTART_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/autostart
UNIT_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user

INSTALL_AUTOSTART=1
INSTALL_SYSTEMD=0
for arg in "$@"; do
  case $arg in
    --with-systemd) INSTALL_SYSTEMD=1 ;;
    --no-autostart) INSTALL_AUTOSTART=0 ;;
    -h | --help)
      sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "install.sh: unknown option: $arg" >&2; exit 1 ;;
  esac
done

say() { printf 'install: %s\n' "$*"; }

mkdir -p "$BIN_DIR" "$APPS_DIR" "$ICONS_DIR/scalable/apps" "$ICONS_DIR/256x256/apps"
install -m 755 "$SRC_DIR/dsh-desktop.sh" "$BIN_DIR/dsh-desktop"
say "$BIN_DIR/dsh-desktop"

install -m 644 "$SRC_DIR/dsh-harness.svg" "$ICONS_DIR/scalable/apps/dsh-harness.svg"
install -m 644 "$SRC_DIR/dsh-harness-256.png" "$ICONS_DIR/256x256/apps/dsh-harness.png"
say "$ICONS_DIR/{scalable,256x256}/apps/dsh-harness.*"

# Substitute $HOME so the repo copy stays portable; for this host it is a no-op.
sed "s|/home/YOUR_USER|$HOME|g" "$SRC_DIR/dsh-harness.desktop" >"$APPS_DIR/dsh-harness.desktop"
chmod 644 "$APPS_DIR/dsh-harness.desktop"
say "$APPS_DIR/dsh-harness.desktop"

if ((INSTALL_AUTOSTART)); then
  mkdir -p "$AUTOSTART_DIR"
  sed "s|/home/YOUR_USER|$HOME|g" "$SRC_DIR/dsh-harness.autostart.desktop" >"$AUTOSTART_DIR/dsh-harness.desktop"
  chmod 644 "$AUTOSTART_DIR/dsh-harness.desktop"
  say "$AUTOSTART_DIR/dsh-harness.desktop (opens the app at login; see README to disable)"
fi

if ((INSTALL_SYSTEMD)); then
  mkdir -p "$UNIT_DIR"
  sed "s|/home/YOUR_USER|$HOME|g" "$SRC_DIR/dsh-harness.service" >"$UNIT_DIR/dsh-harness.service"
  chmod 644 "$UNIT_DIR/dsh-harness.service"
  say "$UNIT_DIR/dsh-harness.service (opt-in, NOT enabled)"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload || true
  fi
fi

# Refresh desktop/icon caches when the helpers exist; harmless otherwise.
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$ICONS_DIR" >/dev/null 2>&1 || true

cat <<'EOF'

Done. Next steps:
  * Launch from the app menu ("DeepSeek Harness") or run: dsh-desktop
  * Check the resolved binaries/server:  dsh-desktop --status
  * Disable login autostart:             rm ~/.config/autostart/dsh-harness.desktop
  * Notifications: see docs/OPERATIONS.md (recommended plugin: dsh-notification-hook)
EOF
