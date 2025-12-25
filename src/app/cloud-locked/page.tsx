import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { getCloudEnabledForUser } from '@/lib/haConnection';

const IOS_APP_URL = 'https://apps.apple.com';
const ANDROID_APP_URL = 'https://play.google.com/store';
const KIOSK_URL = 'https://dinodiasmartliving.com/kiosk';

export default async function CloudLockedPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== Role.ADMIN && user.role !== Role.TENANT) {
    redirect('/login');
  }

  const cloudEnabled = await getCloudEnabledForUser(user.id);
  if (cloudEnabled) {
    redirect(user.role === Role.ADMIN ? '/admin/dashboard' : '/tenant/dashboard');
  }

  const settingsHref = user.role === Role.ADMIN ? '/admin/settings' : '/tenant/settings';

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-4 py-12">
        <div className="w-full overflow-hidden rounded-3xl border border-slate-200/70 bg-white/80 shadow-lg">
          <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-8 text-white sm:px-10">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -left-12 top-10 h-28 w-28 rounded-full bg-amber-400/20 blur-2xl" />
            <p className="text-[10px] uppercase tracking-[0.35em] text-white/70">
              Dinodia Home
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Cloud mode locked
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-white/80 sm:text-base">
              Cloud mode locked, dashboard unlocks when remote access is enabled by homeowner.
            </p>
          </div>

          <div className="space-y-6 px-6 py-8 sm:px-10">
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50 px-5 py-4 text-sm text-slate-600">
              Until remote access is enabled, you can control your home with the Dinodia mobile
              apps or purchase a Dinodia Kiosk to control your devices when you are at home.
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <a
                href={IOS_APP_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
              >
                Download on iOS
              </a>
              <a
                href={ANDROID_APP_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
              >
                Get it on Android
              </a>
              <a
                href={KIOSK_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                Purchase Dinodia Kiosk
              </a>
            </div>

            <div className="rounded-2xl border border-slate-200/70 bg-white px-5 py-4 text-xs text-slate-600">
              You can access your user settings from here to change password or setup 2FA.
              <Link href={settingsHref} className="ml-2 font-semibold text-slate-900">
                Go to settings
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <span>Need help? Ask the homeowner to enable remote access in Dinodia Cloud.</span>
              <Link
                href="/login"
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Return to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
