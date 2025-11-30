'use client';

type Props = {
  username: string;
};

export default function TenantSettings({ username }: Props) {
  return (
    <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold">Tenant Settings</h1>
          <p className="text-xs text-slate-500">
            Logged in as <span className="font-medium">{username}</span>
          </p>
        </div>
      </header>

      <section className="text-sm border border-slate-200 rounded-xl p-4">
        <h2 className="font-semibold mb-2">Profile</h2>
        <p className="text-xs text-slate-500">
          Password updates will arrive soon. Please contact your Dinodia admin
          if you need to change your login.
        </p>
      </section>
    </div>
  );
}
