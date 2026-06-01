'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';

type Props = {
  onCode: (code: string) => void;
};

export function RoomQrScanner({ onCode }: Props) {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const supported = useMemo(() => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia), []);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  async function startScan() {
    setScanError(null);
    if (!supported) {
      setScanError('Camera scanning is not supported on this device.');
      return;
    }
    if (!videoRef.current || !canvasRef.current) {
      setScanError('Scanner is not ready yet.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      scanLoop();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unable to start camera scan.');
      setScanning(false);
    }
  }

  function stopScan() {
    setScanning(false);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function scanLoop() {
    if (!scanning) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code?.data) {
        stopScan();
        onCode(code.data);
        return;
      }
    }

    animationRef.current = requestAnimationFrame(scanLoop);
  }

  async function handleFile(file: File | null) {
    setScanError(null);
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Unable to load image.'));
    }).catch((err) => {
      URL.revokeObjectURL(url);
      setScanError(err instanceof Error ? err.message : 'Unable to load image.');
    });
    URL.revokeObjectURL(url);

    const canvas = canvasRef.current;
    if (!canvas) {
      setScanError('Scanner is not ready yet.');
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setScanError('Unable to read image.');
      return;
    }
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, canvas.width, canvas.height);
    if (!code?.data) {
      setScanError('No QR code detected in the image.');
      return;
    }
    onCode(code.data);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700">Room QR</div>
        <button
          type="button"
          onClick={() => (scanning ? stopScan() : void startScan())}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          {scanning ? 'Stop scan' : 'Start scan'}
        </button>
      </div>
      {scanError ? <div className="text-xs text-red-600">{scanError}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-2">
          <video ref={videoRef} className="h-40 w-full rounded-lg object-cover" muted playsInline />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <label className="block text-xs font-semibold text-slate-700">Upload QR image</label>
          <input
            type="file"
            accept="image/*"
            className="mt-2 w-full text-xs"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          <p className="mt-2 text-[11px] text-slate-500">If camera scan doesn&apos;t work, upload a photo of the QR.</p>
        </div>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
