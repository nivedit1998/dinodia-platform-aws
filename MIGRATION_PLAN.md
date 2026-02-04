# Dinodia Platform → AWS ECS/Fargate migration plan (API/backend)

## Goals

- Keep **all existing functionality** working exactly as it does today for:
  - `dinodia-kiosk` (Android app)
  - `dinodia-ios-app` (iOS app)
  - `Dinodia Hub Agent` (Home Assistant add-on)
  - `Dinodia-Alexa-Skill` (Alexa Smart Home skill)
  - `dinodia-platform` web dashboards (admin/tenant/installer)
- Move the **high-traffic backend** off Vercel’s serverless invocation model to **AWS ECS/Fargate**.
- Continue using **Supabase Postgres** as the database (no DB migration required in the first phase).
- Keep your existing **Cloudflare Tunnel per home** (remote access to each home’s Home Assistant / hub agent) as-is.

## Change policy (staged, low-risk)

This migration is intentionally staged so the current Vercel backend remains live until the very end.

### Do-not-change list (until “Client migration” phase)

Until the plan reaches the **Client migration** phase, do not modify code in:
- `dinodia-platform/`
- `dinodia-ios-app/`
- `dinodia-kiosk/`
- `Dinodia-Alexa-Skill/`
- `Dinodia Hub Agent/`

You may still do **configuration-only canaries** (e.g., change a single test Hub Agent’s `platform_base_url`) during staging tests.

### Vercel API stays available until the end

- Even after production cutover routes `/api/*` to AWS, keep the Vercel deployment (including its `/api/*` routes) **deployed and working** as a rollback option.
- Only consider disabling/removing Vercel API routes in the final decommission phase.

## Non-goals (phase 1)

- No product behavior changes (no “new architecture” rollout to customers).
- No UI rewrite of `dinodia-platform` dashboards.
- No changes to the hard-coded client base URL in the apps (we preserve `https://app.dinodiasmartliving.com`).

## Current state (what exists in this repo)

### `dinodia-platform` (Next.js 16 App Router)
- Hosts both:
  - Web dashboards (`/tenant/*`, `/admin/*`, `/installer/*`, etc.)
  - API routes (`/api/*`) used by:
    - iOS app and Android kiosk app via `https://app.dinodiasmartliving.com/api/...`
    - Hub Agent pairing/sync (`/api/hub-agent/*`)
    - Alexa skill endpoints (`/api/alexa/*`)
- Stores state in Supabase Postgres via Prisma.
- Uses Vercel KV for distributed rate limiting (`src/lib/rateLimit.ts`).
- Has a Vercel cron for `/api/cron/monitoring-snapshot` via `vercel.json`.

### `dinodia-kiosk` (React Native)
- Calls platform API base `https://app.dinodiasmartliving.com` (see `dinodia-kiosk/src/config/env.ts`).
- Uses `/api/kiosk/context` + `/api/kiosk/home-mode/secrets` to get a hub-agent URL + token for “Home mode”.
- Uses platform endpoints for “Cloud mode” reads/writes (`/api/devices`, `/api/device-control`, `/api/automations`, etc.).
- Doorbell/home-security camera refresh is local “Home mode” (direct HA `camera_proxy`) and refreshes every ~15 seconds.

### `dinodia-ios-app` (native SwiftUI)
- Calls platform API base `https://app.dinodiasmartliving.com` (see `dinodia-ios-app/Dinodia/Dinodia/EnvConfig.swift`).
- Same general behavior as kiosk: platform for auth/context, hub-agent for “Home mode” HA calls, platform for “Cloud mode”.

### `Dinodia Hub Agent` (Home Assistant add-on)
- Acts as an authenticated **HTTP/WS bridge** to HA Core and a **platform sync client**.
- Calls platform endpoints:
  - `POST /api/hub-agent/pair`
  - `POST /api/hub-agent/token-state`
- Config includes `platform_base_url: https://app.dinodiasmartliving.com`.

### `Dinodia-Alexa-Skill` (AWS Lambda)
- Calls platform endpoints:
  - `GET /api/alexa/devices`
  - `POST /api/alexa/device-control`
  - `POST /api/alexa/events/accept-grant`
- It also contains an SQS-worker handler that calls `POST /api/internal/alexa/change-report` (this endpoint does not currently exist in `dinodia-platform` in this workspace; confirm production configuration before cutover).

## Target architecture (phase 1: safest cutover)

Keep the public hostname unchanged:

- `https://app.dinodiasmartliving.com`
  - **Dashboards/UI** origin: **Vercel** (existing `dinodia-platform` deployment)
  - **API** origin: **AWS ECS/Fargate** (new `dinodia-platform-aws` service)

Routing is done at Cloudflare **by path**:

- Requests to `https://app.dinodiasmartliving.com/api/*` → AWS (ALB → ECS)
- All other paths (e.g., `/tenant/*`, `/admin/*`) → Vercel

This preserves:

- Mobile app base URL (no app updates required)
- Cookie scope (same host; JWT cookie works across UI on Vercel + API on AWS)
- Hub Agent base URL (same `platform_base_url`)
- Alexa skill base URL (same `DINODIA_API_BASE_URL`)

## AWS components to provision

### Region
- **AWS region: `eu-north-1` (Stockholm)** for all resources in this plan.

### Networking
- VPC with at least 2 AZs.
- Public subnets for ALB; private subnets for ECS tasks.
- NAT Gateway(s) for ECS egress.
  - Optional but recommended: allocate **Elastic IP(s)** for NAT so Supabase IP allowlisting (if used) stays stable.

### Compute (ECS/Fargate)
- ECS Cluster (Fargate).
- ECS Service for `dinodia-platform-aws` (Next.js server running in a container).
- Application Load Balancer (ALB) with:
  - HTTPS listener (ACM cert for `app.dinodiasmartliving.com` if you want end-to-end TLS to ALB; Cloudflare can also terminate TLS).
  - Target group health checks (e.g., `GET /api/health` or reuse an existing lightweight route).
- Autoscaling policies:
  - Scale on CPU and/or ALB RequestCountPerTarget.

### Container registry + CI/CD
- ECR repository for the container image.
- CI pipeline (GitHub Actions or similar) to:
  - Build `dinodia-platform-aws` image
  - Push to ECR
  - Deploy ECS service (update task definition)
  - Run Prisma migrations as a controlled step (see below)

### Data + state
- Supabase Postgres stays the source of truth.
- Redis (ElastiCache) for:
  - Distributed rate limiting (replacement for Vercel KV)
  - Optional caching (later)
- SQS for async jobs (already used by code paths for Alexa ChangeReport enqueueing).

### Scheduled tasks
- EventBridge Scheduler (or EventBridge rule + Lambda) for:
  - Daily monitoring snapshot (`/api/cron/monitoring-snapshot`) OR
  - An ECS scheduled task that runs a script to perform the same DB writes.

### Secrets and config
- AWS Secrets Manager or SSM Parameter Store for:
  - `DATABASE_URL` / `DIRECT_URL`
  - `JWT_SECRET`
  - `PLATFORM_DATA_ENCRYPTION_KEY`
  - `CRON_SECRET`, `HA_WEBHOOK_SECRET`, Alexa secrets, AWS credentials for SES/SQS, etc.

### Observability and protection
- CloudWatch logs for ECS tasks.
- CloudWatch metrics/alarms:
  - 5xx on ALB
  - Latency p95/p99
  - ECS CPU/memory
  - Redis/SQS health
- AWS WAF on the ALB (recommended) to dampen abuse and bot traffic.

## `dinodia-platform-aws` (new folder) strategy

### Principle
Make `dinodia-platform-aws` a **minimal-risk copy** of `dinodia-platform` that is deployed as a container on ECS.

### Why not “rewrite to Express”?
Because it increases risk and changes behavior. Copying the existing Next API behavior keeps responses/cookies/auth identical.

### What changes are allowed in `dinodia-platform-aws` (and only there)
- Replace Vercel-specific runtime dependencies:
  - Rate limit store: Vercel KV → Redis
  - Cron: Vercel Cron → EventBridge Scheduler
- Add AWS-friendly operational endpoints:
  - `/api/health` (or similar) for ALB health checks
- Optional: add “internal” endpoints required by AWS workers (only if needed).

## Cloudflare routing (critical to avoid app breakage)

### Requirement
Keep these values unchanged:
- iOS: `EnvConfig.dinodiaPlatformAPI = https://app.dinodiasmartliving.com`
- Kiosk: `ENV.DINODIA_PLATFORM_API = https://app.dinodiasmartliving.com`
- Hub Agent: `platform_base_url = https://app.dinodiasmartliving.com`
- Alexa skill: `DINODIA_API_BASE_URL = https://app.dinodiasmartliving.com`

### Implementation options
Pick one:
1) **Cloudflare Worker (recommended)**: route based on URL path:
   - if path starts with `/api/` → fetch AWS origin
   - else → fetch Vercel origin
2) **Cloudflare Load Balancer with origin rules** (if you already use it).
3) **Cloudflare Transform Rules / URL redirect** is not sufficient by itself (you need origin selection, not redirects).

### Cookie/session note
Because UI and API remain on the same hostname, the `dinodia_token` cookie continues to work:
- UI on Vercel receives cookie and can render server-side pages that read it.
- API on ECS sets/reads cookie as before.

## Migration phases (step-by-step)

## AWS Console runbook (first-time, step-by-step)

This section assumes you are brand new to AWS and currently only have a **root account**.

### 0) Set your AWS region (important)
- In the AWS Console top-right region selector, pick **Stockholm (`eu-north-1`)** and keep it selected for everything below.

### 1) Secure the account (do this before anything else)
1. **Enable MFA on the root user**
   - AWS Console → search **IAM** → left nav **Dashboard** → **Add MFA** for root user.
2. **Create an admin IAM user (so you stop using root)**
   - IAM → **Users** → **Create user**
   - Name: `nivedit-admin` (or similar)
   - Select **Provide user access to the AWS Management Console**
   - Set a password + require password reset (optional)
   - Next → **Attach policies directly** → select **AdministratorAccess**
   - Create user
3. **Enable MFA on that IAM user**
   - IAM → Users → `nivedit-admin` → **Security credentials** → **Assign MFA device**
4. (Optional but recommended) **Create a billing alert / budget**
   - AWS Console → search **Budgets** → create a monthly budget with email alerts.

From here onward: use the **IAM admin user**, not root.

### 2) Create an ECR repo (where your Docker image will live)
1. AWS Console → search **ECR** → **Repositories** → **Create repository**
2. Visibility: Private
3. Name: `dinodia-platform-aws`
4. Create

You’ll use this later to push the container image built from `dinodia-platform-aws/`.

### 3) Create networking (VPC with public + private subnets + NAT)

You can do this with the VPC wizard (recommended):
1. AWS Console → search **VPC** → **Your VPCs** → **Create VPC**
2. Choose **VPC and more**
3. Configure:
   - Name: `dinodia-prod`
   - IPv4 CIDR: `10.0.0.0/16`
   - AZs: 2
   - Public subnets: 2
   - Private subnets: 2
   - NAT gateways: **1 per AZ** (recommended)
   - VPC endpoints: none for now
4. Create VPC

Why NAT matters: ECS tasks in **private subnets** need outbound internet to talk to Supabase, Amazon APIs, etc.

### 4) Create Security Groups (ALB + ECS)
1. VPC → **Security groups** → **Create security group**
2. Create `dinodia-alb-sg`
   - Inbound:
     - HTTPS `443` from:
       - Recommended: Cloudflare IP ranges
       - Temporary (for testing): `0.0.0.0/0`
   - Outbound:
     - Allow all (default) or at minimum HTTP to ECS SG
3. Create `dinodia-ecs-sg`
   - Inbound:
     - TCP `3000` source: `dinodia-alb-sg`
   - Outbound:
     - Allow all (default) or at minimum `443` outbound

### 5) Create an origin hostname in Cloudflare (for AWS API)

To avoid certificate/domain conflicts with Vercel, use a dedicated origin hostname for AWS, e.g.:
- `api-origin.dinodiasmartliving.com` → AWS ALB

You will later route `app.dinodiasmartliving.com/api/*` to this origin using a Cloudflare Worker (path routing).

Create the DNS record now (you’ll fill the ALB DNS name later):
1. Cloudflare → your zone → **DNS** → **Add record**
2. Type: CNAME
3. Name: `api-origin`
4. Target: (placeholder for now)
5. Proxy status: Proxied (orange cloud) is fine

### 6) Create an ACM certificate for the AWS origin hostname
1. AWS Console → search **ACM** (Certificate Manager)
2. **Request a certificate**
3. Domain: `api-origin.dinodiasmartliving.com`
4. Validation: DNS
5. Request
6. ACM will show a CNAME record to add → add it in Cloudflare DNS
7. Wait until certificate status is **Issued**

### 7) Create an Application Load Balancer (ALB)
1. AWS Console → search **EC2** → left nav **Load Balancers** → **Create load balancer**
2. Choose **Application Load Balancer**
3. Settings:
   - Name: `dinodia-api-alb`
   - Scheme: Internet-facing
   - IP type: IPv4
4. Network mapping:
   - VPC: `dinodia-prod`
   - Mappings: select the **public subnets** in 2 AZs
5. Security groups: choose `dinodia-alb-sg`
6. Listeners:
   - HTTPS `443` with ACM cert for `api-origin.dinodiasmartliving.com`
7. Target group:
   - Create a new target group:
     - Type: **IP**
     - Protocol: HTTP
     - Port: `3000`
     - Health check path: `/` (temporary). Later we’ll prefer `/api/health`.
8. Create load balancer

After creation:
- Copy the ALB **DNS name** (looks like `dinodia-api-alb-....elb.amazonaws.com`)
- Go back to Cloudflare DNS and set:
  - CNAME `api-origin` → that ALB DNS name

### 8) Create secrets in AWS (Secrets Manager)
1. AWS Console → search **Secrets Manager** → **Store a new secret**
2. Secret type: “Other type of secret”
3. Add key/value pairs. Minimum for the API to start:
   - `DATABASE_URL` (Supabase *pooled* connection string recommended for runtime)
   - `DIRECT_URL` (Supabase direct connection string for migrations)
   - `JWT_SECRET`
   - `PLATFORM_DATA_ENCRYPTION_KEY`
   - `NEXT_PUBLIC_APP_URL` = `https://app.dinodiasmartliving.com`
4. Name the secret: `dinodia/platform/prod`

You can add other env vars later (SES, Alexa, webhook secrets, etc.).

### 9) Create an ECS cluster (Fargate)
1. AWS Console → search **ECS** → **Clusters** → **Create cluster**
2. Cluster name: `dinodia-prod`
3. Infrastructure: **AWS Fargate (serverless)**
4. Create

### 10) Create IAM roles for ECS tasks (execution role + task role)

You need two roles:

**A) Task execution role** (pulls from ECR, writes logs, reads secrets)
1. IAM → **Roles** → **Create role**
2. Trusted entity: **AWS service** → use case: **Elastic Container Service** → **ECS Task**
3. Permissions:
   - `AmazonECSTaskExecutionRolePolicy`
   - Plus permissions to read the secret you created:
     - easiest for now: `SecretsManagerReadWrite` (over-permissive)
     - better: a minimal policy granting `secretsmanager:GetSecretValue` on `dinodia/platform/prod`
4. Name: `dinodiaEcsTaskExecutionRole`

**B) Task role** (only if your app needs AWS APIs at runtime)
- If `dinodia-platform-aws` will call SQS/SES directly using IAM, create a task role with those permissions.
- If you use static AWS keys as env vars (not recommended), you can skip this initially.

### 11) Create an ECS Task Definition (the container spec)
1. ECS → **Task definitions** → **Create new task definition**
2. Launch type: **Fargate**
3. Name: `dinodia-platform-aws`
4. Task size: start with `0.5 vCPU / 1GB` (tune later)
5. Container:
   - Name: `web`
   - Image: from ECR (you’ll paste it after pushing)
   - Port mapping: `3000`
   - Logging: CloudWatch (awslogs)
   - Environment / Secrets:
     - Add secrets from `dinodia/platform/prod` (map keys to env vars)
6. Task role:
   - Execution role: `dinodiaEcsTaskExecutionRole`
   - Task role: optional (see above)
7. Create

### 12) Create the ECS Service (always-on) behind the ALB
1. ECS → Clusters → `dinodia-prod` → **Services** → **Create**
2. Compute: **Fargate**
3. Application type: Service
4. Task definition: `dinodia-platform-aws` (latest revision)
5. Service name: `dinodia-platform-aws-api`
6. Networking:
   - VPC: `dinodia-prod`
   - Subnets: **private subnets**
   - Security group: `dinodia-ecs-sg`
7. Load balancing:
   - Type: Application Load Balancer
   - Select `dinodia-api-alb`
   - Target group: the one created earlier (HTTP:3000, IP target)
8. Desired tasks: `2`
9. Create service

### 13) Push your Docker image to ECR (from your laptop)

You will need:
- Docker installed
- AWS CLI installed
- Access keys on an IAM user (not root)

Steps:
1. IAM → Users → `nivedit-admin` → **Security credentials** → **Create access key**
2. Install AWS CLI locally, then:
   - `aws configure` (set default region `eu-north-1`)
3. Login Docker to ECR (ECR console has copy-paste commands per repo), generally:
   - `aws ecr get-login-password --region eu-north-1 | docker login --username AWS --password-stdin <account_id>.dkr.ecr.eu-north-1.amazonaws.com`
4. Build and push:
   - `docker build -t dinodia-platform-aws -f dinodia-platform-aws/Dockerfile dinodia-platform-aws`
   - `docker tag dinodia-platform-aws:latest <account_id>.dkr.ecr.eu-north-1.amazonaws.com/dinodia-platform-aws:latest`
   - `docker push <account_id>.dkr.ecr.eu-north-1.amazonaws.com/dinodia-platform-aws:latest`
5. Update the ECS task definition container image to the pushed image (or create a new revision), then redeploy the service.

### 14) Supabase configuration changes (minimal)

**A) Connection strings**
- Prefer:
  - `DATABASE_URL` = Supabase **pooled** connection string (PgBouncer) for runtime
  - `DIRECT_URL` = Supabase **direct** connection string for migrations

**B) Network restrictions / allowlisting**
- If you enable Supabase network restrictions, you must allow the ECS egress IP(s).
- With ECS in private subnets, the stable egress IPs are your **NAT Gateway Elastic IPs**.
- Add those NAT EIP(s) to Supabase allowlist (if applicable).

**C) SSL**
- Supabase requires SSL; ensure your connection strings include SSL settings as provided by Supabase.

### 15) Verification (before Cloudflare path routing)
- Hit the AWS origin directly:
  - `https://api-origin.dinodiasmartliving.com/api/auth/me`
  - `https://api-origin.dinodiasmartliving.com/api/hub-agent/pair` (with a test payload)
- Check CloudWatch logs for errors.

After this is stable, you can implement Cloudflare path routing so:
- `app.dinodiasmartliving.com/api/*` goes to `api-origin...`
- dashboards remain on Vercel.

### Phase 0 — Inventory and baselines
- Export a list of all currently used platform endpoints by:
  - `dinodia-kiosk` and `dinodia-ios-app` (search for `/api/` usage)
  - Hub Agent endpoints (`/api/hub-agent/*`)
  - Alexa endpoints (`/api/alexa/*`)
  - Web dashboards (`dinodia-platform/src/app/**` client fetches to `/api/*`)
- Capture current Vercel metrics:
  - function invocations/day
  - top routes by invocations
  - error rate/latency
- Decide scaling assumptions for ECS:
  - expected homes
  - expected tablets per home
  - expected background refresh intervals

### Phase 1 — Create `dinodia-platform-aws` and run locally in a container
- Create new folder `dinodia-platform-aws` by copying `dinodia-platform` (do not edit `dinodia-platform/`).
- Add containerization:
  - Multi-stage Dockerfile (build, then run `next start`)
  - `prisma generate` at build time (and/or at start)
- Ensure local container can:
  - connect to Supabase
  - run migrations (controlled, not automatic every boot)
  - serve API routes

Acceptance criteria:
- `curl` for key routes works against the local container (auth/login, `/api/auth/me`, `/api/devices`, hub-agent pairing, Alexa endpoints).

### Phase 2 — Replace Vercel KV dependency in `dinodia-platform-aws`
- Implement a Redis-backed rate limiter and make it default in AWS.
- Keep behavior identical: same keys, same windows, same 429 messages.
- Keep an in-memory fallback for local dev.
- Add an ALB-friendly health endpoint (e.g. `/api/health`) that does not touch Supabase.
- Keep cron behavior identical, but do not disable Vercel Cron yet.

Acceptance criteria:
- Rate limits behave consistently across multiple ECS tasks (shared counters).

### Phase 3 — AWS production environment (no traffic changes yet)

There is no separate staging environment in this approach. We deploy AWS in production first, but keep live traffic on the Vercel API until we are confident.

- Provision production AWS resources (VPC, ALB, ECS service, Redis, SQS) in `eu-north-1`.
- Create a Cloudflare DNS hostname for the AWS origin (example):
  - `api-origin.dinodiasmartliving.com` → Cloudflare → ALB → ECS
- Configure production environment/secrets.

Acceptance criteria:
- ECS tasks are healthy in the ALB target group.
- `https://api-origin.dinodiasmartliving.com/api/auth/me` responds (even if unauthenticated).

### Phase 4 — Deploy and validate AWS in production (no Cloudflare cutover yet)

- Deploy `dinodia-platform-aws` to ECS behind the ALB.
- Run Prisma migrations as a one-off ECS task or CI job (`prisma migrate deploy`).
- Validate critical API endpoints by calling the AWS origin hostname directly (curl/Postman):
  - `/api/auth/*`, `/api/kiosk/context`, `/api/kiosk/home-mode/secrets`
  - `/api/devices`, `/api/device-control`
  - `/api/hub-agent/pair`, `/api/hub-agent/token-state`
  - `/api/alexa/*`

Acceptance criteria:
- The endpoints above behave the same when called via `api-origin...` as they do on Vercel today.

### Phase 5 — Canary routing in production (recommended)

Without creating a separate environment or changing client code, reduce risk by canarying inside production:

- Deploy a Cloudflare Worker on `app.dinodiasmartliving.com` that chooses the backend for `/api/*`:
  - Default: route to **Vercel** (current backend)
  - Canary: route to **AWS** only for a small allowlist (examples):
    - requests from your IP(s)
    - requests with a cookie you set manually in a browser session (e.g. `dinodia_backend=aws`)
    - requests with `x-device-id` matching an allowlist (both iOS and kiosk already send `x-device-id` after login)
- Start with allowlist = only your own devices/users/homes.
- Monitor CloudWatch logs/metrics and Supabase behavior.

Acceptance criteria:
- Canary users can use dashboards and apps normally with AWS-backed `/api/*`.
- No unexplained error rate increase vs Vercel.

### Phase 6 — Production cutover (only `/api/*`)
- In Cloudflare for `app.dinodiasmartliving.com`, enable path routing:
  - `/api/*` → AWS (ALB)
  - other paths → Vercel
- Keep Vercel deployment untouched and **still deployed** (dashboards still served; API remains available for rollback).

Note: if you implement the canary Worker in Phase 5, “cutover” is just flipping the Worker default from Vercel → AWS (and optionally keeping the allowlist as a reverse-allowlist for rollback testing).

Acceptance criteria (real production):
- iOS and kiosk apps continue to work without updating base URL.
- Hub Agent continues to pair/sync.
- Alexa skill continues to discover/control devices.
- Vercel function invocations drop sharply (API traffic no longer hits Vercel).

### Phase 7 — Move cron off Vercel (optional but consistent)
- Disable Vercel Cron jobs for `dinodia-platform`.
- Add EventBridge schedule to call the AWS API (or run an ECS scheduled task).

### Phase 8 — Hardening, scaling, and cost controls
- Add WAF managed rules.
- Tune ECS autoscaling:
  - keep minimum tasks > 1 to avoid cold-start spikes
  - set max tasks based on DB connection constraints
- Add a connection pooling strategy for Prisma + Supabase:
  - Use Supabase pooler for `DATABASE_URL`
  - Use direct URL for migrations via `DIRECT_URL`
- Load test “tablet-like” traffic against staging AWS.

### Phase 9 — Client migration (only after AWS cutover is stable)

Only after Phase 6 has been stable in production for a while should you consider code changes in other folders. Examples:
- Add a staging/QA base URL switch in `dinodia-kiosk/` and `dinodia-ios-app/` (optional).
- Change `Dinodia-Alexa-Skill/` env vars to hit a dedicated API hostname (optional).
- Update `Dinodia Hub Agent/` docs/defaults if you introduce a dedicated API hostname (optional).

### Phase 10 — Decommission Vercel API (final step)

Only after AWS has been stable for a long period and you no longer need Vercel as a rollback:
- Keep Vercel serving dashboards/UI.
- Disable or remove `/api/*` handling in the Vercel project (optional), and/or lock it down so only AWS serves `/api/*`.
- Update documentation to reflect the new steady-state.

## Component-by-component: what changes (high level)

### `dinodia-platform` (Vercel dashboards)
- Keep as-is initially.
- Ensure Vercel still has required env for SSR pages that query Prisma (some pages import `prisma` directly).
- Vercel becomes “UI origin” only; `/api/*` traffic is routed away at Cloudflare.

### `dinodia-platform-aws` (new)
- New deployment target for `/api/*`.
- Replace Vercel KV with Redis.
- Add AWS-friendly health endpoint.
- Migrations run via CI job or one-off ECS task.

### `dinodia-kiosk` + `dinodia-ios-app`
- No production changes if `app.dinodiasmartliving.com` stays the base URL.
- Do not change code until Phase 9.

### `Dinodia Hub Agent`
- No changes if `platform_base_url` remains `https://app.dinodiasmartliving.com`.
- Confirm Cloudflare routing sends `/api/hub-agent/*` to AWS (it matches `/api/*`).
- Do not change code until Phase 9 (config-only canaries are OK).

### `Dinodia-Alexa-Skill`
- No changes if `DINODIA_API_BASE_URL` remains `https://app.dinodiasmartliving.com`.
- Validate the ChangeReport pipeline:
  - Confirm whether SQS worker path is used in production.
  - Confirm whether `/api/internal/alexa/change-report` is required; if yes, implement it in `dinodia-platform-aws` only and secure it with an internal secret.

## Testing checklist (must-pass)

### Auth/session
- Login (mobile + kiosk + web) sets cookie and stays logged in.
- `/api/auth/me` works from both apps.

### Device read/control
- `/api/devices` returns correct devices in cloud mode.
- `/api/device-control` works and rate-limits as expected.

### Hub Agent
- Pairing: `/api/hub-agent/pair` works with HMAC + replay protection.
- Sync: `/api/hub-agent/token-state` works and updates token hashes.

### Alexa
- OAuth authorize/token flows work.
- Discovery works.
- Control works.
- AcceptGrant storage works (`/api/alexa/events/accept-grant`).

### Monitoring
- Daily snapshot runs (Vercel cron until moved, then EventBridge).

## Rollback plan

- Cloudflare routing is the cutover lever:
  - Rollback = route `/api/*` back to Vercel origin immediately.
- Keep AWS deployment running during early rollout so you can flip back and forth while validating.
- Keep DB unchanged throughout, so rollback is routing-only (no data migration rollback).

## Open questions to resolve before implementation

1) Do you have any Supabase IP allowlists enabled today?
   - If yes, plan for NAT + fixed EIP(s) for ECS egress.
2) Is the Alexa ChangeReport SQS worker currently used in production?
   - If yes, confirm what endpoint it calls and where it runs.
3) Do you want a separate hostname for AWS API (e.g. `api.dinodiasmartliving.com`) for future cleanliness?
   - Phase 1 avoids this to prevent app updates; it can be introduced later with a controlled client update.
