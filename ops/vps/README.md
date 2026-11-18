# VPS relay templates

Copy this directory to the VPS (for example `/opt/dsh-relay`), then:

```bash
cp .env.example .env && chmod 600 .env
$EDITOR .env                     # TAILSCALE_IP, PUBLIC_HOST, BASIC_USER, BASIC_PASS
docker compose up -d
docker logs --tail=50 dsh-relay
```

The static artifact host is separate: `share-compose.yml` + `share-nginx.conf` + `site/`.
See `docs/MOBILE-VPS.md` and `docs/OPERATIONS.md`.

Never commit `.env`; it is ignored by `.gitignore`.
