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
| `PLATFORM_DATA_ENCRYPTION_KEY` | 32-byte key (base64 recommended) for encrypting Home Assistant credentials and other secrets at rest. Required in all environments. |
| `NEXT_PUBLIC_APP_URL` | Base URL served to clients (e.g. `https://app.dinodiasmartliving.com`). Needed for share links or future deep links. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN` | (Recommended) Vercel KV endpoints/keys for distributed rate limiting. When unset, limits fall back to per-instance memory. |
| `CRON_SECRET` | Shared secret used to secure the monitoring snapshot cron route (`/api/cron/monitoring-snapshot`). Send it via `Authorization: Bearer` (query param is disabled by default). |
| `DISABLE_CRON_QUERY_SECRET` | Defaults to `true`; set to `false` only if you must support `?secret=` cron calls. |
| `AWS_REGION` | Default AWS region (fallback for SES/SQS). |
| `AWS_SES_REGION` | AWS region for SES email (overrides `AWS_REGION` when set). |
| `AWS_SQS_REGION` | AWS region for Alexa ChangeReport SQS queue (overrides `AWS_REGION` when set). |
| `AWS_ACCESS_KEY_ID` | AWS access key with permission to send via SES. |
| `AWS_SECRET_ACCESS_KEY` | Secret for the SES access key. |
| `SES_FROM_EMAIL` | Verified SES sender address/name (e.g. `Dinodia Smart Living <no-reply@dinodiasmartliving.com>`). |
| `APPLE_REVIEW_DEMO_BYPASS_ENABLED`, `APPLE_REVIEW_DEMO_USERNAME` | Optional: bypass mobile-login email/device verification for a specific demo user (use only during App Review). |

SES variables are required for the new email verification/device-trust flows once they are enabled.

Installer auto-provisioning is controlled by `INSTALLER_AUTO_PROVISION_ENABLED` (default true) and `INSTALLER_ALLOW_UPDATES` (default false to avoid overwriting credentials unless explicitly intended).

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

### Secrets at rest

- Home Assistant credentials (username/password/token) are stored encrypted (AES-256-GCM) using `PLATFORM_DATA_ENCRYPTION_KEY`. Set this env before deploying the migration.
- A hashed column (`longLivedTokenHash`) is used for duplicate detection; plaintext columns are nullable and can be backfilled to ciphertext via `npm run secrets:backfill` after migrating.
- Keep `.env.local` free of production secrets; do not commit `.env` files.

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
   - `PLATFORM_DATA_ENCRYPTION_KEY` (32-byte key for encrypted HA secrets)
   - `CRON_SECRET` (and leave `DISABLE_CRON_QUERY_SECRET` at `true`)
   - `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN` (recommended for rate limiting)
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
- Cron endpoint (no user auth, secured by a shared secret): `GET /api/cron/monitoring-snapshot` with `Authorization: Bearer <CRON_SECRET>`. Query params are disabled by default (`DISABLE_CRON_QUERY_SECRET=true`) to avoid leaking secrets via logs; set it to `false` only if you must support `?secret=`.
- Configure Vercel Cron in the dashboard to call `https://<your-domain>/api/cron/monitoring-snapshot` daily and attach the `Authorization` header.
- Set `CRON_SECRET` in Vercel → Environment Variables (and `.env.local` if testing locally). Requests without the correct secret return HTTP 401; missing env returns HTTP 500.
- Apply the migration to your database: `npx prisma migrate dev --name monitoring-readings` for local/dev, then `npx prisma migrate deploy` against Supabase/production. Regenerate the client if needed: `npx prisma generate`.
- Manual trigger in development: `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/monitoring-snapshot"` (after starting `npm run dev`). If you temporarily allow query secrets, append `?secret=$CRON_SECRET`.

## API rate limiting

- Backed by Vercel KV when `KV_REST_API_URL/TOKEN` are set; falls back to in-memory buckets per instance.
- `/api/auth/login` (10/min per IP+username) and `/api/auth/mobile-login` (12/min) throttle credential checks.
- Alexa Smart Home: `/api/alexa/oauth/authorize` (10/min per IP+username), `/api/alexa/oauth/token` (60/min per client+IP+grant), `/api/alexa/devices` (20/min per user), `/api/alexa/device-control` (30 per 10s per user).
- Challenge resend: `/api/auth/challenges/[id]/resend` limited to 3 attempts per 2 minutes per IP/challenge.
- App device control: `/api/device-control` remains 30 actions per 10 seconds per user.
- All limits return HTTP 429 with a friendly retry message and skip downstream HA calls.

## Tenant Matter commissioning

- Tenants can add Matter-over-Wi-Fi devices at `/tenant/devices/add` (also linked from the dashboard header/menu). The wizard collects the target area, pairing code (QR scan/upload/manual), optional Dinodia type/name/HA label, and Wi-Fi credentials. Wi-Fi passwords are never persisted; they are only forwarded to Home Assistant for the active config flow.
- Backend endpoints: `/api/tenant/homeassistant/labels` for HA label registry, `/api/tenant/matter/sessions` for session lifecycle (create, poll, step, cancel). Successful commissioning snapshots the HA registries, writes `Device` overrides for new entity IDs (area/name/label), and applies the selected HA label when supported.
- Vercel/serverless: set `HaConnection.cloudUrl` to your Nabu Casa URL so config-flow and registry websocket calls succeed from Vercel. The app automatically prefers `cloudUrl` when present; `baseUrl` is still used on LAN.

## Tenant discovery add

- `/tenant/devices/discovered` lists HA config-entry flows with discovery sources (zeroconf/ssdp/dhcp/homekit/bluetooth) that match an allowlist of handlers. Tenants pick a card, choose their allowed area, optional HA label + Dinodia type override, and complete any HA-requested fields (PIN/host/confirm). Forms asking for credentials/tokens are blocked with a friendly “setup in Home Assistant” message.
- Backend: `/api/tenant/homeassistant/discovery` lists flows (handler allowlist defaults to `samsungtv,lgwebos,androidtv,cast,roku` or override via `TENANT_DISCOVERY_HANDLER_ALLOWLIST`). `/api/tenant/discovery/sessions` handles create/step/cancel, snapshots registries, upserts `Device` overrides, applies HA labels, and assigns HA area_ids for new device_ids.
- Areas are enforced via the tenant’s `AccessRule` rows; new HA devices only surface in Dinodia when the override `Device.area` matches an allowed area.

## Contribution notes

- Keep Home Assistant credentials server-side. Never introduce `NEXT_PUBLIC_` variables for HA data.
- Run `npm run lint` before opening a PR.
- For schema changes, create a new Prisma migration (`npx prisma migrate dev --name <change>`). Remember to update Supabase via `npx prisma migrate deploy`.
# dinodia-platform-aws
