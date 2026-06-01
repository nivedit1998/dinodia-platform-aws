import 'server-only';

import { hashForLog, safeLog } from '@/lib/safeLogger';

type Context = Record<string, unknown>;

const HASH_KEYS = new Set([
  'ip',
  'userId',
  'homeId',
  'tenantId',
  'deviceId',
  'serial',
  'hubInstallId',
  'haConnectionId',
  'requestId',
]);

function withHashedContext(context: Context): Context {
  const out: Context = {};
  for (const [key, value] of Object.entries(context)) {
    if (HASH_KEYS.has(key) && value != null) {
      out[`${key}Hash`] = hashForLog(String(value));
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function logServerError(message: string, err: unknown, context: Context = {}): void {
  safeLog('error', message, { err, ...withHashedContext(context) });
}

