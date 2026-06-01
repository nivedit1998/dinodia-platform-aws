import Image from 'next/image';
import { RoomAccessApprovalKind, RoomAccessRequestStatus } from '@prisma/client';
import { previewRoomAccessDecisionByToken } from '@/lib/roomAccess';
import { RoomAccessDecisionClient } from '@/app/rooms/requests/RoomAccessDecisionClient';

function titleForPreview(args: { status: string; requestStatus: RoomAccessRequestStatus | null }) {
  const status = args.status.toUpperCase();
  if (status === 'ACTIONABLE') return 'Approve room access?';
  if (status === 'ALREADY_HANDLED') {
    if (args.requestStatus === RoomAccessRequestStatus.APPROVED) return 'Already approved';
    if (args.requestStatus === RoomAccessRequestStatus.REJECTED) return 'Already rejected';
    return 'Already handled';
  }
  if (status === 'CONSUMED') return 'Link already used';
  if (status === 'EXPIRED') return 'Link expired';
  if (status === 'HOME_UNCLAIMED') return 'Home not claimed';
  if (status === 'HOME_MISSING') return 'Home unavailable';
  if (status === 'NOT_FOUND') return 'Not found';
  return 'Room access request';
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export default async function RoomRequestApprovePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.toString().trim() ?? '';

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-md bg-white shadow-lg rounded-2xl p-8">
          <div className="mb-6 flex items-center justify-center">
            <Image
              src="/brand/logo-lockup.png"
              alt="Dinodia Smart Living"
              width={220}
              height={64}
              className="h-auto w-48 sm:w-56"
              priority
            />
          </div>
          <h1 className="text-2xl font-semibold mb-2 text-center">Not found</h1>
          <p className="text-sm text-slate-500 mb-6 text-center">Room access request</p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
            This approval link is invalid.
          </div>
          <a href="/login" className="mt-6 block text-center text-sm font-semibold text-indigo-600 hover:underline">
            Back to login
          </a>
        </div>
      </div>
    );
  }

  const preview = await previewRoomAccessDecisionByToken({ tokenRaw: token, kind: RoomAccessApprovalKind.APPROVE });
  const title = titleForPreview({ status: preview.status, requestStatus: preview.requestStatus });
  const expiresAt = formatDate(preview.expiresAt);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white shadow-lg rounded-2xl p-8">
        <div className="mb-6 flex items-center justify-center">
          <Image
            src="/brand/logo-lockup.png"
            alt="Dinodia Smart Living"
            width={220}
            height={64}
            className="h-auto w-48 sm:w-56"
            priority
          />
        </div>
        <h1 className="text-2xl font-semibold mb-2 text-center">{title}</h1>
        <p className="text-sm text-slate-500 mb-6 text-center">Room access request</p>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-800 space-y-3">
          <div>
            <div className="text-xs text-slate-500">Room</div>
            <div className="font-semibold">{preview.roomDisplayName ?? 'Unknown room'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Requested by</div>
            <div className="font-semibold">
              {(preview.requestedName ?? 'Unknown')} · {(preview.requestedEmail ?? 'Unknown')}
            </div>
            {preview.requestedPhoneNumber ? (
              <div className="mt-1 font-semibold">{preview.requestedPhoneNumber}</div>
            ) : null}
          </div>
          {expiresAt ? (
            <div>
              <div className="text-xs text-slate-500">Link expires</div>
              <div className="font-semibold">{expiresAt}</div>
            </div>
          ) : null}

          {preview.status === 'ACTIONABLE' ? (
            <RoomAccessDecisionClient kind="approve" token={token} />
          ) : (
            <div className="pt-2 text-sm text-slate-500">No further action is needed.</div>
          )}
        </div>
        <a href="/login" className="mt-6 block text-center text-sm font-semibold text-indigo-600 hover:underline">
          Back to login
        </a>
      </div>
    </div>
  );
}
