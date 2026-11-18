# Mobile access through a VPS

Goal: open the same DSH from a phone over HTTPS, without installing Tailscale on the phone.
The home DSH stays behind Tailscale; only a tiny relay container is public.

## Architecture

```
phone ──HTTPS──► Traefik (VPS, LE cert, Host(public_host))
                    │
                    ▼
                 dsh-relay :3100 (Basic-Auth)
                    │ Tailscale
                    ▼
             home dsh web :3099 (launch token / cookie)
```

The relay runs `dsh-dual-listen` with `--rewrite-host 127.0.0.1:3099` and
`--rewrite-origin`, so DSH's same-origin/token checks keep working. TLS ends at Traefik;
the relay only sees traffic from your tailnet.

## Prerequisites

- A small VPS (1 vCPU/512 MB+ is enough) with Docker and a Traefik instance on the external
  network `traefik-public`, entrypoint `websecure`, Let's Encrypt resolver `le`
- Home DSH running on `127.0.0.1:3099`, reachable over Tailscale
- A DNS name. With `sslip.io`, a name like `203-0-113-10.sslip.io` resolves to the VPS IP
  without DNS edits; a real domain with an A record is also fine
- Secrets stored outside this repo: see `SECRETS.md`

## VPS steps

```bash
# on the VPS
sudo mkdir -p /opt/dsh-relay
# copy ops/vps/* there (scp/rsync)
cd /opt/dsh-relay
cp .env.example .env 2>/dev/null || true
chmod 600 .env
$EDITOR .env          # TAILSCALE_IP, PUBLIC_HOST, BASIC_USER, BASIC_PASS

docker compose -f docker-compose.yml up -d
docker logs --tail=50 dsh-relay
```

Generate a fresh password with `openssl rand -base64 24`. Do not reuse any password from
this repo (the repo contains none).

Traefik must already be running with `le` as a cert resolver. Minimal labels are already in
`ops/vps/docker-compose.yml`. If your Traefik uses different entrypoint/resolver names,
edit the labels.

## Home steps

```bash
# on the home machine
mkdir -p ~/.config/dsh-mobile
cat > ~/.config/dsh-mobile/vps.conf <<'CONF'
VPS_HOST=YOUR_PUBLIC_HOST
BASIC_USER=dsh
BASIC_PASS=<same password as the VPS>
RELAY_PORT=3100
CONF
chmod 600 ~/.config/dsh-mobile/vps.conf

dsh-desktop --server-only          # or dsh-desktop for the app window
dsh-mobile --vps                   # prints HTTPS URL + QR
dsh-mobile --doctor                # loopback / tailnet / VPS token exchanges
ssh <vps-alias> 'docker ps --filter name=dsh-relay'
```

Open the HTTPS URL on the phone: Basic-Auth, then DSH sets its cookie. Add it to the home
screen. If the cookie is lost, reopen the launch-token URL.

## Verification

```bash
# from the home machine: expect 303 (token -> cookie)
curl -s -o /dev/null -w '%{http_code}\n' -u "$BASIC_USER:$BASIC_PASS" \
  "https://$VPS_HOST/?token=$TOKEN"

# from a phone/network without Tailscale: the same URL must load
# disabling public access:
ssh <vps-alias> 'docker stop dsh-relay'
```

## Security notes

- Basic-Auth is the outer gate; DSH's launch token and signed cookie are the inner gate.
  Do not share the URL while the token is in it.
- Docker may expose the Basic-Auth password in `docker inspect` (command-line argument).
  Treat VPS root as trusted; rotate the password if the host is shared. For stronger
  isolation, patch `dsh-dual-listen` to read `DSH_BASIC_AUTH` from an env file and pass it
  without argv, or put the relay behind an authenticated reverse proxy.
- The relay is `restart: unless-stopped`; `dsh-mobile --stop` does **not** stop it
  (`ssh <vps> 'docker stop dsh-relay'` does).
- Tailscale ACLs should still restrict the relay's access to the DSH host.
