import { Role } from '@prisma/client';

export function getAppleReviewDemoUsername(): string {
  return (process.env.APPLE_REVIEW_DEMO_USERNAME || '').trim().toLowerCase();
}

export function isAppleReviewDemoBypassEnabled(): boolean {
  return (process.env.APPLE_REVIEW_DEMO_BYPASS_ENABLED || '').toLowerCase() === 'true';
}

export function isAppleReviewDemoUsername(username: string | null | undefined): boolean {
  const configured = getAppleReviewDemoUsername();
  return (
    isAppleReviewDemoBypassEnabled() &&
    configured.length > 0 &&
    typeof username === 'string' &&
    username.trim().toLowerCase() === configured
  );
}

export function isAppleReviewDemoTenantUser(user: {
  username: string | null;
  role: Role;
}): boolean {
  return user.role === Role.TENANT && isAppleReviewDemoUsername(user.username);
}

export function shouldSkipAppleReviewDemoRateLimit(username: string | null | undefined): boolean {
  return isAppleReviewDemoUsername(username);
}
