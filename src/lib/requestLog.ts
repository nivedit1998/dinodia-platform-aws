import { NextRequest } from 'next/server';

type Extra = Record<string, unknown>;

/**
 * Lightweight structured log for CloudWatch/Edge to attribute API traffic by route.
 * Avoids sensitive data; focuses on request metadata useful for volume baselines.
 */
export function logApiHit(req: NextRequest, route: string, extra: Extra = {}): void {
  try {
    const forwardedFor = req.headers.get('x-forwarded-for');
    const clientIp = forwardedFor ? forwardedFor.split(',')[0]?.trim() || null : null;
    const entry = {
      msg: 'api_hit',
      route,
      method: req.method,
      path: req.nextUrl.pathname,
      search: req.nextUrl.search || '',
      ip: clientIp,
      deviceId: req.headers.get('x-device-id') || null,
      deviceLabel: req.headers.get('x-device-label') || null,
      userAgent: req.headers.get('user-agent') || null,
      ts: new Date().toISOString(),
      ...extra,
    };
    console.log(JSON.stringify(entry));
  } catch {
    // never throw from logging
  }
}
