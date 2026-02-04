# dinodia-platform-aws (local Docker run)

This folder is a deployable copy of `dinodia-platform` intended for AWS ECS/Fargate.
For Phase 1, only Docker local run is required.

## Prereqs

- Docker Desktop running
- Access to your **existing Supabase DB**

## 1) Create local env file

Create `dinodia-platform-aws/.env.local` and populate at least:

```
DATABASE_URL=...        # Supabase pooled connection string (runtime)
DIRECT_URL=...          # Supabase direct connection string (migrations only)
JWT_SECRET=...          # long random string
PLATFORM_DATA_ENCRYPTION_KEY=...  # 32-byte key (base64 recommended)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Optional (if you want cron/webhooks to work locally):
```
CRON_SECRET=...
HA_WEBHOOK_SECRET=...
```

Optional (Redis for rate limiting across instances):
```
REDIS_URL=redis://localhost:6379
```

Local Redis quick start:
```
docker run -d -p 6379:6379 --name dinodia-redis redis:7
```

## 2) Build image

```
docker build -t dinodia-platform-aws ./dinodia-platform-aws
```

Notes:
- The Docker build uses placeholder env vars for Prisma/Next build-time checks. Your real secrets are only needed at runtime (next step).

## 3) Run container

```
docker run --rm -p 3000:3000 --env-file ./dinodia-platform-aws/.env.local dinodia-platform-aws
```

## 4) Quick smoke checks

```
curl -i http://localhost:3000/api/auth/me
```

Expect `401` if you are not logged in — this confirms the server is up.

## Important notes

- This container does **not** run Prisma migrations automatically.
- Avoid destructive endpoints while pointing at your production DB.
