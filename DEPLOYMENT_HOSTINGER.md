# Ship Hostinger Deployment

Minimal VPS deployment for Ship on a single Hostinger box.

## What it runs

- `postgres` for app data
- `api` for Express + WebSockets
- `web` for static Vite build
- `caddy` for HTTPS and reverse proxy

## Public URL

Default bootstrap URL uses `sslip.io` and the current VPS IP:

- `https://ship.187.77.7.226.sslip.io`

This live public deploy can be used for smoke tests and manual verification.

Replace `PUBLIC_HOST` later with a real domain when ready.

## One-time setup

```bash
cd /Users/maxpetrusenko/Desktop/Gauntlet/ShipShapeProject/ShipShape
cp .env.hostinger.example .env.hostinger
```

Set at minimum:

- `PUBLIC_HOST`
- `POSTGRES_PASSWORD`
- `SESSION_SECRET`
- `DATABASE_SSL=false` when using the bundled local Postgres service

Optional:

- `S3_UPLOADS_BUCKET` if you want S3-backed uploads in production
- `CAIA_*` if you need CAIA auth

## Deploy

```bash
./scripts/deploy-hostinger.sh
```

The deploy script seeds demo data by default, including:

- email: `dev@ship.local`
- password: `admin123`

Defaults:

- host: `ubuntu@187.77.7.226`
- ssh key: `~/.ssh/hostinger_agent`
- remote dir: `/opt/ship`

Override if needed:

```bash
HOSTINGER_HOST=ubuntu@your-host \
HOSTINGER_SSH_KEY=~/.ssh/your_key \
HOSTINGER_APP_DIR=/opt/ship \
./scripts/deploy-hostinger.sh
```

Skip seed on later deploys:

```bash
HOSTINGER_SEED_DEMO_DATA=0 ./scripts/deploy-hostinger.sh
```

## Smoke test

Use the live public deploy for a quick health + login smoke:

```bash
pnpm smoke:hostinger
```

Override target or credentials:

```bash
SMOKE_BASE_URL=https://your-domain.example \
SMOKE_EMAIL=dev@ship.local \
SMOKE_PASSWORD=admin123 \
./scripts/smoke-hostinger.sh
```

## Notes

- Production boot no longer requires AWS SSM if direct env vars are present.
- If `S3_UPLOADS_BUCKET` is blank, uploads fall back to local disk on the VPS.
- Caddy terminates TLS automatically once the hostname resolves to the server.
