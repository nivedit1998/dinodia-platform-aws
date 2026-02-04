# dinodia-platform-aws (ECS/Fargate deploy, arm64)

This document assumes:
- AWS region: **eu-north-1 (Stockholm)**
- ECS runtime: **Fargate arm64**
- Origin hostname: **api-origin.dinodiasmartliving.com**

## 1) Account safety (do this first)

You are currently using the root account. Create an admin IAM user and enable MFA.

1. AWS Console → **IAM** → **Users** → **Create user**
2. Name: `nivedit-admin`
3. Provide console access + set a password
4. Attach policy: **AdministratorAccess**
5. Create user
6. Enable MFA on this user
7. Log out of root and continue as `nivedit-admin`

## 2) Core AWS resources (prod only)

Create these in **eu-north-1**:

### Networking
- VPC with **2 AZs**, **2 public subnets**, **2 private subnets**
- NAT Gateway (1 per AZ recommended)

### Security Groups
- `dinodia-alb-sg`: inbound **443** from Cloudflare IP ranges (or `0.0.0.0/0` temporarily)
- `dinodia-ecs-sg`: inbound **3000** from `dinodia-alb-sg`
- `dinodia-redis-sg`: inbound **6379** from `dinodia-ecs-sg`

### ACM Certificate
- Request cert for `api-origin.dinodiasmartliving.com` (DNS validation in Cloudflare)

### ALB
- Internet-facing ALB in public subnets
- HTTPS 443 with the ACM cert
- Target group: HTTP **3000**, health check path **/api/health**

### ECR
- Repository name: `dinodia-platform-aws`

### ElastiCache Redis
- Create a Redis cluster (single node is fine initially)
- Attach `dinodia-redis-sg`
- Note the endpoint → use it to build `REDIS_URL`

### ECS
- ECS cluster: `dinodia-prod`
- Task definition: `dinodia-platform-aws` (arm64)
- Service: `dinodia-platform-aws-api` (desired count 2, private subnets, ALB target group)

### Secrets Manager
Create secret `dinodia/platform/prod` with keys:
- `DATABASE_URL` (Supabase pooled)
- `DIRECT_URL` (Supabase direct)
- `JWT_SECRET`
- `PLATFORM_DATA_ENCRYPTION_KEY`
- `NEXT_PUBLIC_APP_URL=https://app.dinodiasmartliving.com`
- `REDIS_URL=redis://<redis-endpoint>:6379`
- (Add other existing env vars used in prod: SES, Alexa, webhook secrets, etc.)

## 3) Build & push image (arm64)

### A) Login to ECR

```
aws configure
aws ecr get-login-password --region eu-north-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com
```

### B) Build image (arm64 native)

```
docker build -t dinodia-platform-aws ./dinodia-platform-aws
```

### C) Tag + push

```
docker tag dinodia-platform-aws:latest <ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com/dinodia-platform-aws:latest
docker push <ACCOUNT_ID>.dkr.ecr.eu-north-1.amazonaws.com/dinodia-platform-aws:latest
```

## 4) Task definition setup (key fields)

- Runtime: **arm64**
- Container port: **3000**
- Health check: `/api/health`
- Secrets: load from `dinodia/platform/prod`

## 5) One-off Prisma migrations

Do **not** run migrations on every boot.

From ECS → **Run Task**:
- Task definition: `dinodia-platform-aws`
- Command override: `npx prisma migrate deploy`
- Ensure `DIRECT_URL` is set in secrets

## 6) Verify (before Cloudflare cutover)

Once ALB is healthy and ECS is running:

```
curl -i https://api-origin.dinodiasmartliving.com/api/health
```

Expect HTTP 200.
