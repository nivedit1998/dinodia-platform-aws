'use client';

import { getDeviceLabel, getOrCreateDeviceId } from './clientDevice';
import { ClientApiError, parseClientApiError } from './clientError';

export function withDeviceHeaders(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? {});
  const deviceId = getOrCreateDeviceId();
  const deviceLabel = getDeviceLabel();
  headers.set('x-device-id', deviceId);
  headers.set('x-device-label', deviceLabel);

  return {
    ...init,
    headers,
  };
}

export function platformFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, withDeviceHeaders(init));
}

export async function platformFetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  fallbackMessage = 'Request failed. Please refresh and try again.'
): Promise<T> {
  const response = await platformFetch(input, init);

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    const trimmed = text.trim();
    payload = trimmed ? { error: trimmed } : null;
  }

  if (!response.ok) {
    const parsed = parseClientApiError(payload, fallbackMessage, response.status);
    throw new ClientApiError(parsed.message, response.status, parsed.errorCode, payload);
  }

  return payload as T;
}
