#!/usr/bin/env bash
# Install the second listener so DSH is reachable on 127.0.0.1 AND the Tailscale IP.
# The proxy forwards Tailscale-IP:PORT -> 127.0.0.1:PORT, rewriting Host/Origin, so a
# single `dsh web` process serves both addresses and the launch cookie keeps working.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
install -m 0755 "$here/dsh-dual-listen" "$HOME/.local/bin/dsh-dual-listen"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/dsh-dual-listen.service" <<'UNIT'
[Unit]
Description=DSH second listener: Tailscale IP -> 127.0.0.1:3099 (single DSH process on both addresses)
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
Environment=PATH=%h/.local/share/mise/installs/node/26.9.0/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/.local/bin/dsh-dual-listen --listen auto --port 3099 --target 127.0.0.1:3099
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now dsh-dual-listen
echo "dsh-dual-listen: $(systemctl --user is-active dsh-dual-listen)"
