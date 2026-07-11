# Depanel

A self-hosted, multi-team control panel for [depa.id](https://depa.id) cloud VPS instances.

Depanel is the shared "door" for a team to manage depa.id servers with a **single API key stored securely server-side** — because depa's own panel can't multi-login. It started as an auto start/stop scheduler (depa bills hourly, so powering demo/staging servers off overnight saves credit) and grew into a full workspace: monitoring, snapshots & backups, MySQL database backups, billing insight, teams with granular roles, and a super-admin console.

> ⚠️ **Unofficial project.** Depanel is a community tool and is not affiliated with, endorsed by, or operated by depa.id.

## Features

**Servers**
- List every VPS across multiple depa API keys, grouped per account, with custom ordering.
- Manual start / stop / restart (buttons disable to match live power state).
- Live **monitoring** from depa's own metrics API: CPU, memory, network, disk I/O charts + full spec/cost detail (cached to respect depa's rate limit).

**Scheduling**
- Per-server weekly on/off schedule built from freely-added actions ("on Mon–Fri at 08:00 → start", "at 18:00 → stop").
- A separate worker reconciles desired vs. actual state every 5 minutes. Production-flagged servers are **never** auto-stopped.

**Backups**
- depa **snapshots** (create / rollback / delete) and depa's scheduled **backup archives** (create schedule / restore / delete).
- **MySQL database backups** (à la self-hosted DB backup tools): save connections, pick databases, schedule daily/weekly/monthly or a custom cron, and ship the gzip'd dump to a **local path, FTP, or S3** (SMB via a mounted path). Pure-JS dump — no `mysqldump` binary required.

**Teams & access control**
- Workspace model: every user gets a personal team; shared teams are created freely.
- All depa accounts, servers, DB connections, and logs are scoped to the active team, with a team switcher that remembers your last used team.
- Roles: **owner** (exactly one, full control + transfer ownership), **admin** (appointed by owner), **member**.
- Per-member permissions: view billing, manage schedules, access backups, and choose exactly which servers each member can see.

**Billing** — balance, real vs. recorded balance, hourly cost, top-up history, credit ledger, and billing reports per account.

**Admin** — a **super admin** (the first account) can manage all users and teams, and impersonate any user.

**Quality of life** — light/dark mode, top-bar or side-bar layout (per user), and a responsive mobile layout.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Turbopack) · React 19 · Tailwind CSS v4
- Prisma 6 + SQLite
- Custom auth: JWT ([`jose`](https://github.com/panva/jose)) + `bcryptjs`, httpOnly cookies
- API keys & DB credentials encrypted at rest with **AES-256-GCM**
- Standalone scheduler worker: `node-cron` + reconciliation loop
- MySQL dumps via `mysql2`; delivery via `basic-ftp` / `@aws-sdk/client-s3`

## Getting started

Requires Node.js 22+ (uses the built-in `process.loadEnvFile`).

```bash
# 1. install
npm install

# 2. configure environment
cp .env.example .env
# then generate real secrets (see below) and edit .env

# 3. create the database
npm run db:push

# 4. create the first admin account (this account becomes super admin)
npm run user -- you@example.com "your-password" "Your Name" admin
```

Generate the two required secrets:

```bash
# APP_SECRET (JWT signing)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# ENCRYPTION_KEY (must be 64 hex chars = 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Running

One command runs the web app **and** the scheduler worker together (recommended — the scheduler is the whole point, and if either process dies both stop):

```bash
npm run all          # development
# or for production on a server / VM:
npm run build
npm run all:prod
```

They can also be run separately:

```bash
npm run dev          # web only  -> http://localhost:3000
npm run worker       # scheduler only (reconcile every 5 min + MySQL backups every minute)
```

For an always-on deployment, wrap `npm run all:prod` in `pm2`, `systemd`, or `launchd`.

### Docker / Coolify

A multi-stage Alpine `Dockerfile` is included. It runs the web app **and** the
scheduler worker in one container, and applies the database schema on boot.

```bash
docker build -t depanel .
docker run -d --name depanel \
  -e DATABASE_URL="file:/app/data/depanel.db" \
  -e APP_SECRET="…" \
  -e ENCRYPTION_KEY="…" \
  -v depanel-data:/app/data \
  -p 3000:3000 \
  depanel
```

Create the first admin (becomes super admin):

```bash
docker exec depanel node dist/create-user.cjs you@example.com "your-password" "Your Name" admin
```

**On Coolify:** deploy from this repository (Dockerfile build pack), set the
environment variables above, and **mount a persistent volume at `/app/data`**
so the SQLite database survives restarts. Coolify's assigned `PORT` is honored
automatically.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite location, e.g. `file:./dev.db` |
| `APP_SECRET` | JWT session signing key |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) — encrypts depa API keys & DB passwords |
| `DEPA_API_BASE` | depa API base, default `https://api.depa.id/v1` |
| `RECONCILE_CRON` | optional, worker reconcile cadence (default `*/5 * * * *`) |

> Keep `.env` and your SQLite database out of version control (already covered by `.gitignore`). If `ENCRYPTION_KEY` is lost or changed, previously stored API keys can no longer be decrypted and must be re-entered.

## Security notes

- depa API keys and MySQL passwords are encrypted (AES-256-GCM) and never sent to the browser.
- Access control is enforced server-side, not just hidden in the UI: hidden servers and disabled permissions are rejected at the API layer.
- Production-flagged servers are protected from automatic shutdown by the scheduler.

## License

MIT — see [LICENSE](LICENSE).
