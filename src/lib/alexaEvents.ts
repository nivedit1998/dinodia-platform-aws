import { randomUUID } from 'crypto';
import { AlexaProperty } from '@/lib/alexaProperties';

type AlexaEventTokenCache = {
  token: string;
  expiresAt: number;
};

type AlexaChangeReportCause =
  | 'PHYSICAL_INTERACTION'
  | 'APP_INTERACTION'
  | 'VOICE_INTERACTION'
  | 'PERIODIC_POLL'
  | 'RULE_TRIGGER';

const globalForCache = globalThis as typeof globalThis & {
  __alexaEventTokenCache?: AlexaEventTokenCache;
};

function getGatewayEndpoint() {
  return process.env.ALEXA_EVENT_GATEWAY_ENDPOINT || 'https://api.amazonalexa.com/v3/events';
}

function getClientCredentials() {
  const clientId = process.env.ALEXA_EVENTS_CLIENT_ID;
  const clientSecret = process.env.ALEXA_EVENTS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Alexa events client credentials are not configured');
  }
  return { clientId, clientSecret };
}

function getCache() {
  if (!globalForCache.__alexaEventTokenCache) {
    globalForCache.__alexaEventTokenCache = { token: '', expiresAt: 0 };
  }
  return globalForCache.__alexaEventTokenCache;
}

export async function getAlexaEventAccessToken(): Promise<string> {
  const cache = getCache();
  const now = Date.now();
  if (cache.token && cache.expiresAt - 5000 > now) {
    return cache.token;
  }

  const { clientId, clientSecret } = getClientCredentials();

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'alexa::async_event:send',
  });

  console.log('[alexaEvents] Requesting LWA token', {
    endpoint: 'https://api.amazon.com/auth/o2/token',
    scope: 'alexa::async_event:send',
  });

  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[alexaEvents] Failed to fetch LWA token', res.status, text);
    throw new Error('Failed to fetch Alexa event gateway token');
  }

  type TokenResponse = { access_token: string; expires_in?: number };
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error('Alexa token response missing access_token');
  }

  const defaultTtl = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const maxTtl =
    Number(process.env.ALEXA_ACCESS_TOKEN_TTL_SECONDS ?? Number.MAX_SAFE_INTEGER) || Number.MAX_SAFE_INTEGER;
  const effectiveTtl = Math.max(30, Math.min(defaultTtl, maxTtl));

  cache.token = data.access_token;
  cache.expiresAt = now + (effectiveTtl - 10) * 1000;

  return cache.token;
}

export async function sendAlexaChangeReport(
  endpointId: string,
  properties: AlexaProperty[],
  causeType: AlexaChangeReportCause = 'PHYSICAL_INTERACTION'
) {
  if (!endpointId) {
    console.warn('[alexaEvents] Missing endpointId for ChangeReport');
    return;
  }

  if (!properties || properties.length === 0) {
    console.warn('[alexaEvents] No properties provided for ChangeReport', endpointId);
    return;
  }

  const gateway = getGatewayEndpoint();
  const token = await getAlexaEventAccessToken();

  console.log('[alexaEvents] ChangeReport POST', {
    endpoint: gateway,
    endpointId,
    causeType,
    namespaces: properties.map((p) => p.namespace),
  });

  const changePayload = {
    event: {
      header: {
        namespace: 'Alexa',
        name: 'ChangeReport',
        messageId: randomUUID(),
        payloadVersion: '3',
      },
      endpoint: {
        endpointId,
      },
      payload: {
        change: {
          cause: {
            type: causeType,
          },
          properties,
        },
      },
    },
    context: {
      properties,
    },
  };

  const res = await fetch(gateway, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(changePayload),
  });

  const text = await res.text().catch(() => '');

  console.log('[alexaEvents] ChangeReport response', {
    endpointId,
    status: res.status,
    ok: res.ok,
    bodySnippet: text.slice(0, 200),
  });

  if (!res.ok) {
    console.error(
      '[alexaEvents] ChangeReport failed',
      endpointId,
      res.status,
      text
    );
    return;
  }

  console.log('[alexaEvents] ChangeReport sent', endpointId, causeType);
}
