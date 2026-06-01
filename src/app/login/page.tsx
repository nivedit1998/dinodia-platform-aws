export default function LoginChooserPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">Login</h1>
        <p className="mt-2 text-sm text-slate-600">Choose how you’d like to sign in.</p>

        <div className="mt-6 space-y-3">
          <a
            href="/login/tenant"
            className="block rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            Tenant login
          </a>
          <a
            href="/login/homeowner"
            className="block rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
          >
            Homeowner login
          </a>
        </div>
      </div>
    </div>
  );
}
