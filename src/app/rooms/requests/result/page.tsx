import Image from 'next/image';

function messageForStatus(status: string | null | undefined) {
  const s = (status ?? '').toString().trim().toUpperCase();
  switch (s) {
    case 'APPROVED':
      return { title: 'Approved', body: 'Access has been granted. If you were new, check your email for login details.' };
    case 'REJECTED':
      return { title: 'Rejected', body: 'This request was rejected.' };
    case 'EXPIRED':
      return { title: 'Expired', body: 'This approval link has expired.' };
    case 'CONSUMED':
      return { title: 'Already used', body: 'This approval link was already used.' };
    case 'ALREADY_HANDLED':
      return { title: 'Already handled', body: 'This request was already approved or rejected.' };
    case 'HOME_UNCLAIMED':
      return { title: 'Home not claimed', body: 'This home is not claimed yet. A homeowner must set up the home first.' };
    case 'HOME_MISSING':
      return { title: 'Home unavailable', body: 'This hub is not linked to a home yet.' };
    case 'NOT_FOUND':
      return { title: 'Not found', body: 'This approval link is invalid.' };
    default:
      return { title: 'Done', body: 'This request could not be processed. Please try again.' };
  }
}

export default async function RoomRequestResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.status;
  const status = Array.isArray(raw) ? raw[0] : raw;
  const msg = messageForStatus(status);

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
        <h1 className="text-2xl font-semibold mb-2 text-center">{msg.title}</h1>
        <p className="text-sm text-slate-500 mb-6 text-center">Room access request</p>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          {msg.body}
        </div>
        <a
          href="/login"
          className="mt-6 block text-center text-sm font-semibold text-indigo-600 hover:underline"
        >
          Back to login
        </a>
      </div>
    </div>
  );
}
