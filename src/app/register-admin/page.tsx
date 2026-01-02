'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import jsQR from 'jsqr';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';

type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | null;

type HubDetails = {
  haBaseUrl?: string;
  haLongLivedToken?: string;
  haUsername?: string;
  haPassword?: string;
};

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function parseHubQrPayload(raw: string): HubDetails | null {
  const text = (raw || '').trim();
  if (!text) return null;

  // New scheme: dinodia://hub?v=1&b=<baseUrl>&t=<token>&u=<user>&p=<pass>
  if (/^dinodia:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      const baseUrl = parsed.searchParams.get('b') || parsed.searchParams.get('baseUrl');
      const token = parsed.searchParams.get('t') || parsed.searchParams.get('token');
      const user = parsed.searchParams.get('u') || parsed.searchParams.get('user');
      const pass = parsed.searchParams.get('p') || parsed.searchParams.get('pass');
      return {
        haBaseUrl: baseUrl || undefined,
        haLongLivedToken: token || undefined,
        haUsername: user || undefined,
        haPassword: pass || undefined,
      };
    } catch {
      // fall through
    }
  }

  // JSON payload fallback
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') {
      return {
        haBaseUrl: data.baseUrl || data.haBaseUrl || undefined,
        haLongLivedToken:
          data.longLivedToken || data.token || data.t || data.llToken || data.haLongLivedToken,
        haUsername: data.haUsername || data.haAdminUser || data.u || undefined,
        haPassword: data.haPassword || data.haAdminPass || data.p || undefined,
      };
    }
  } catch {
    // not JSON
  }

  // Token-only legacy QR
  return { haLongLivedToken: text };
}

export default function RegisterAdminPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    username: '',
    password: '',
    email: '',
    confirmEmail: '',
    dinodiaSerial: '',
    bootstrapSecret: '',
    haBaseUrl: '',
    haLongLivedToken: '',
    haUsername: '',
    haPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<ChallengeStatus>(null);
  const [completing, setCompleting] = useState(false);
  const [deviceId] = useState(() =>
    typeof window === 'undefined' ? '' : getOrCreateDeviceId()
  );
  const [deviceLabel] = useState(() =>
    typeof window === 'undefined' ? '' : getDeviceLabel()
  );
  const hubDetected = useMemo(
    () =>
      form.haBaseUrl.trim().length > 0 &&
      form.haLongLivedToken.trim().length > 0 &&
      form.haUsername.trim().length > 0 &&
      form.haPassword.trim().length > 0,
    [form.haBaseUrl, form.haLongLivedToken, form.haPassword, form.haUsername]
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const awaitingVerification = !!challengeId;

  function updateField(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setScanError(null);
  }

  const stopScanner = useCallback(() => {
    setScanning(false);
    setShowScanner(false);
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const handleScanResult = useCallback(
    (raw: string) => {
      const parsed = parseHubQrPayload(raw);
      if (!parsed) {
        setScanError('QR code not recognized. Please scan the Dinodia Hub QR.');
        return;
      }

      setScanError(null);
      if (
        !parsed.haBaseUrl ||
        !parsed.haLongLivedToken ||
        !parsed.haUsername ||
        !parsed.haPassword
      ) {
        setScanError('QR code is missing hub details. Please scan the Dinodia Hub QR.');
      }
      setInfo('Dinodia Hub detected via QR.');
      setForm((prev) => ({
        ...prev,
        haBaseUrl: normalizeBaseUrl(parsed.haBaseUrl || prev.haBaseUrl || ''),
        haLongLivedToken: (parsed.haLongLivedToken || prev.haLongLivedToken).trim(),
        haUsername: (parsed.haUsername || prev.haUsername).trim(),
        haPassword: (parsed.haPassword || prev.haPassword).trim(),
      }));
    },
    []
  );

  const scanFrame = useCallback(() => {
    const run = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) {
        frameRef.current = requestAnimationFrame(run);
        return;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      const code = jsQR(imageData.data, width, height);

      if (code?.data) {
        handleScanResult(code.data);
        stopScanner();
        return;
      }

      frameRef.current = requestAnimationFrame(run);
    };

    run();
  }, [handleScanResult, stopScanner]);

  const startScanner = useCallback(async () => {
    setScanError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanError('Camera is not available in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      streamRef.current = stream;
      setShowScanner(true);
      setScanning(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      frameRef.current = requestAnimationFrame(scanFrame);
    } catch (err) {
      setScanning(false);
      setShowScanner(false);
      setScanError(
        err instanceof Error
          ? err.message
          : 'Unable to access the camera. Please allow camera permissions.'
      );
      stopScanner();
    }
  }, [scanFrame, stopScanner]);

  const resetVerification = useCallback(() => {
    setChallengeId(null);
    setChallengeStatus(null);
    setCompleting(false);
    setInfo(null);
  }, []);

  const completeChallenge = useCallback(
    async (id: string) => {
      if (!deviceId) {
        setError('Device information missing. Please try again.');
        resetVerification();
        return;
      }

      setCompleting(true);
      const res = await fetch(`/api/auth/challenges/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, deviceLabel }),
      });
      const data = await res.json();
      setCompleting(false);

      if (!res.ok) {
        setError(data.error || 'Verification failed. Please try again.');
        resetVerification();
        return;
      }

      const cloudEnabled = data.cloudEnabled === true;
      if (!cloudEnabled) {
        router.push('/cloud-locked');
        return;
      }
      router.push('/admin/dashboard');
    },
    [deviceId, deviceLabel, resetVerification, router]
  );

  useEffect(() => {
    if (!awaitingVerification || !challengeId) return;
    const id = challengeId;
    let cancelled = false;

    async function pollStatus() {
      try {
        const res = await fetch(`/api/auth/challenges/${id}`);
        if (!res.ok) {
          if (!cancelled) {
            setError('Verification expired. Please try again.');
            resetVerification();
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setChallengeStatus(data.status);

        if (data.status === 'APPROVED' && !completing) {
          await completeChallenge(id);
          return;
        }

        if (data.status === 'EXPIRED' || data.status === 'CONSUMED') {
          setError('Verification expired. Please try again.');
          resetVerification();
        }
      } catch {
        // ignore transient errors
      }
    }

    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [awaitingVerification, challengeId, completing, completeChallenge, resetVerification]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!deviceId) {
      setError('Preparing your device info. Try again in a moment.');
      return;
    }
    if (!form.email) {
      setError('Please enter an admin email.');
      return;
    }
    if (form.email !== form.confirmEmail) {
      setError('Email addresses must match.');
      return;
    }
    if (!form.dinodiaSerial.trim() || !form.bootstrapSecret.trim()) {
      setError('Enter the Dinodia serial and bootstrap secret from the installer.');
      return;
    }
    if (
      !form.haBaseUrl.trim() ||
      !form.haLongLivedToken.trim() ||
      !form.haUsername.trim() ||
      !form.haPassword.trim()
    ) {
      setError('Scan the Dinodia Hub QR code to fill in the hub details.');
      return;
    }

    setLoading(true);
    const res = await fetch('/api/auth/register-admin', {
      method: 'POST',
      body: JSON.stringify({
        username: form.username,
        password: form.password,
        email: form.email,
        haBaseUrl: normalizeBaseUrl(form.haBaseUrl),
        haUsername: form.haUsername.trim(),
        haPassword: form.haPassword,
        haLongLivedToken: form.haLongLivedToken.trim(),
        deviceId,
        deviceLabel,
        dinodiaSerial: form.dinodiaSerial.trim(),
        bootstrapSecret: form.bootstrapSecret.trim(),
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(
        data.error ||
          'We couldn’t finish setting up the homeowner account. Please check the details and try again.'
      );
      return;
    }

    if (data.challengeId) {
      setChallengeId(data.challengeId);
      setChallengeStatus('PENDING');
      setInfo('Check your email to verify and finish setup.');
      return;
    }

    setError('We could not start email verification. Please try again.');
  }

  async function handleResend() {
    if (!challengeId) return;
    setError(null);
    setInfo(null);
    const res = await fetch(`/api/auth/challenges/${challengeId}/resend`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      setError(
        data.error || 'Unable to resend the verification email right now.'
      );
      return;
    }
    setInfo('We’ve resent the verification email.');
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl bg-white shadow-lg rounded-2xl p-8">
        <h1 className="text-2xl font-semibold mb-4 text-center">
          Set up the homeowner account
        </h1>
        <p className="text-xs text-slate-500 mb-4 text-center">
          This setup is for a brand-new Dinodia home. Taking over from a previous homeowner?{' '}
          <button
            type="button"
            className="text-indigo-600 hover:underline"
            onClick={() => router.push('/claim')}
          >
            Claim a home
          </button>
        </p>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {info}
          </div>
        )}

        {!awaitingVerification && (
          <form onSubmit={handleSubmit} className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium mb-1">Set Username</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Set Password</label>
                <input
                  type="password"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium mb-1">Admin email</label>
                <input
                  type="email"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Confirm email</label>
                <input
                  type="email"
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.confirmEmail}
                  onChange={(e) => updateField('confirmEmail', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-medium mb-1">Dinodia Serial Number</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.dinodiaSerial}
                  onChange={(e) => updateField('dinodiaSerial', e.target.value)}
                  placeholder="e.g. DIN-GB-00001234"
                  required
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Bootstrap Secret</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form.bootstrapSecret}
                  onChange={(e) => updateField('bootstrapSecret', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1 h-2.5 w-2.5 rounded-full ${
                      hubDetected ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-800">Dinodia Hub detected</div>
                    <p className="text-xs text-slate-500">
                      Scan the Dinodia Hub QR code to auto-fill the hub address and access token.
                    </p>
                    {hubDetected ? (
                      <p className="text-xs text-emerald-700 mt-1">
                        Hub details loaded for this setup.
                      </p>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={scanning ? stopScanner : startScanner}
                  className={`flex-none rounded-lg border px-3 py-2 text-xs font-medium ${
                    scanning
                      ? 'border-red-200 text-red-700 bg-red-50 hover:bg-red-100'
                      : 'border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100'
                  }`}
                >
                  {scanning ? 'Stop scanning' : 'Scan Dinodia Hub QR code'}
                </button>
              </div>

              {scanError ? (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {scanError}
                </div>
              ) : null}

              {showScanner ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <video
                    ref={videoRef}
                    className="w-full rounded-md bg-black aspect-video"
                    muted
                    playsInline
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  <p className="text-xs text-slate-600">
                    Point the camera at the Dinodia Hub QR. We’ll autofill the hub details when it’s
                    detected.
                  </p>
                </div>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-indigo-600 text-white rounded-lg py-2 font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Connecting Dinodia Hub…' : 'Connect your Dinodia Hub'}
            </button>
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to Login
            </button>
          </form>
        )}

        {awaitingVerification && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-700">
              Check your email and click the verification link. We’ll finish creating your admin
              session on this device after approval.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-medium text-slate-700">Status</div>
              <div>{challengeStatus ?? 'Waiting for approval…'}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleResend}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Resend email
              </button>
              <button
                onClick={resetVerification}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Start over
              </button>
            </div>
            {completing && (
              <p className="text-xs text-slate-500">Finishing setup…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
