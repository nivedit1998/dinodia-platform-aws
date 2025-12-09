# Dinodia Smart Living

Multi-tenant tablet UI for Home Assistant built with Next.js App Router, Prisma, and Tailwind. Dinodia admins wire up a Home Assistant instance once, then wall-mounted tablets provide premium control dashboards per tenant/area.

## Stack

- Next.js 16 (App Router, TypeScript, TailwindCSS)
- Prisma ORM
- PostgreSQL (Supabase) in production, SQLite acceptable for quick local prototyping
- Custom auth (username/password with JWT cookies)
- Home Assistant REST + template APIs

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.production.example` to `.env.local` and fill in values that make sense for dev (see **Environment** below). SQLite still works locally by pointing `DATABASE_URL` to `file:./prisma/dev.db`.
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Lint / type-check before opening a PR:
   ```bash
   npm run lint
   npm run build
   ```

## Environment

All deployments (local, preview, production) must define the following variables. `.env.production.example` documents the production-ready defaults (e.g. Supabase URL) while `.env.local` is ignored by git for local overrides.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Connection string for Prisma. Use `file:./prisma/dev.db` for SQLite locally or `postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require` for Supabase Postgres. |
| `JWT_SECRET` | Secret string used to sign the auth JWT cookie. Generate a long random value. |
| `NEXT_PUBLIC_APP_URL` | Base URL served to clients (e.g. `https://app.dinodiasmartliving.com`). Needed for share links or future deep links. |
| `CRON_SECRET` | Shared secret used to secure the monitoring snapshot cron route (`/api/cron/monitoring-snapshot`). |

> Production builds fail fast if `JWT_SECRET` or `DATABASE_URL` are missing.

## Database (Supabase Postgres)

1. Create a new Supabase project + Postgres instance.
2. Copy the provided connection string into `DATABASE_URL` (remember to include `?sslmode=require`).
3. Run Prisma migrations against the new database:
   ```bash
   npx prisma migrate dev --name init-postgres
   ```
   This replays the schema on Postgres while preserving existing models.
4. (Optional) Generate the Prisma client for type safety:
   ```bash
   npx prisma generate
   ```

For production/CI use `npx prisma migrate deploy` so only committed migrations run.

## Security & auth

- Sessions are JWT-based and stored in the `dinodia_token` cookie with `httpOnly`, `sameSite: 'lax'`, `secure` in production, and a 7-day expiry. Ensure `JWT_SECRET` is long and random in every environment.
- Home Assistant base URLs and long-lived tokens never leave the backend. They live in the database and are consumed only inside server utilities (`src/lib/homeAssistant.ts`, API routes). Clients interact exclusively through our `/api/*` routes.
- `/api/device-control` is rate limited per user (30 commands per 10 seconds) to avoid accidentally overwhelming Home Assistant. Limits are enforced server-side in `src/lib/rateLimit.ts`.

### Kiosk auto-login (HTTP Basic Auth)

- Enable with `ENABLE_BASIC_AUTH_AUTOLOGIN=true`. When disabled the `/kiosk/autologin` entry point responds with 404 to avoid accidental discovery.
- Point Fully Kiosk Browser (or another trusted kiosk) to `https://app.dinodiasmartliving.com/kiosk/autologin?redirect=/tenant/dashboard` as its Start URL.
- Configure the kiosk’s HTTP Basic Auth username/password to match a real Dinodia user (tenant or admin). The backend decodes the `Authorization` header, reuses the normal credential check, issues the standard cookie session, and then redirects to the requested path. Session guards (e.g. `/tenant/dashboard`) see a normal logged-in user.
- Invalid or missing credentials return `401` with a `WWW-Authenticate` challenge so unsecured devices do not bypass the login page.
- Only deploy this flow on devices you physically control; anyone with kiosk access inherits the user account stored in the Basic Auth settings.

## Deployment (Vercel)

1. Push this repo to GitHub and create a new Vercel project from it.
2. In Vercel → Settings → Environment Variables, add:
   - `DATABASE_URL` (Supabase connection string)
   - `JWT_SECRET`
   - `NEXT_PUBLIC_APP_URL` (`https://app.dinodiasmartliving.com`)
3. Configure Supabase to accept Vercel connections (SSL required).
4. Define the build & install commands (defaults work):
   - Install: `npm install`
   - Build: `npm run build`
   - Post-build migration: set a deploy hook or `npm run prisma:deploy` (e.g. `npx prisma migrate deploy`) via Vercel build command or a CI step.
5. After the first deployment, add the custom domain:
   - In Vercel project → Domains, add `app.dinodiasmartliving.com`.
   - Create a CNAME record pointing `app.dinodiasmartliving.com` → `cname.vercel-dns.com`.
   - Wait for propagation; Vercel will issue certificates automatically.

### Production checklist

- `DATABASE_URL` points to Supabase (Postgres provider in `prisma/schema.prisma`).
- `npx prisma migrate deploy` runs during deployment.
- Environment variables are set for every Vercel environment (Production, Preview).
- Rate limiting is active (see `src/lib/rateLimit.ts`).
- `npm run build` succeeds locally before pushing.

## Monitoring snapshots

- Schema: `MonitoringReading` stores daily readings per Home Assistant connection: `haConnectionId`, `entityId`, raw `state`, optional `numericValue` (parsed from `state`), `unit` from `attributes.unit_of_measurement`, and `capturedAt` (`NOW()` default). Indexed by `(haConnectionId, entityId, capturedAt)`.
- Cron endpoint (no user auth, secured by a shared secret): `GET /api/cron/monitoring-snapshot?secret=<CRON_SECRET>`.
- Configure Vercel Cron in the dashboard to call `https://<your-domain>/api/cron/monitoring-snapshot?secret=<CRON_SECRET>` every day at 00:00 (UTC or your preferred timezone).
- Set `CRON_SECRET` in Vercel → Environment Variables (and `.env.local` if testing locally). Requests without the correct secret return HTTP 401; missing env returns HTTP 500.
- Apply the migration to your database: `npx prisma migrate dev --name monitoring-readings` for local/dev, then `npx prisma migrate deploy` against Supabase/production. Regenerate the client if needed: `npx prisma generate`.
- Manual trigger in development: `curl "http://localhost:3000/api/cron/monitoring-snapshot?secret=$CRON_SECRET"` (after starting `npm run dev`).

## API rate limiting

`/api/device-control` guards against rapid-fire requests:

- Limit: 30 actions per 10 seconds per authenticated user.
- Implementation: `src/lib/rateLimit.ts` (Map-backed token bucket). Ready to swap for Redis later if needed.
- Behavior: When exceeded, the API returns HTTP 429 with `Too many actions, please slow down.` and no command is sent to Home Assistant.

## Contribution notes

- Keep Home Assistant credentials server-side. Never introduce `NEXT_PUBLIC_` variables for HA data.
- Run `npm run lint` before opening a PR.
- For schema changes, create a new Prisma migration (`npx prisma migrate dev --name <change>`). Remember to update Supabase via `npx prisma migrate deploy`.
