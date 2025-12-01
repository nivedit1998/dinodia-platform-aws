'use client';

export async function logout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
  } catch (err) {
    console.error('Failed to logout', err);
  } finally {
    window.location.href = '/login';
  }
}
