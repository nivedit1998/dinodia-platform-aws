'use client';

import { getDeviceLabel, getOrCreateDeviceId } from './clientDevice';

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
