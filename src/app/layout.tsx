import './globals.css';
import type { Metadata } from 'next';
import { GlobalRefreshProvider } from '@/components/GlobalRefreshProvider';

export const metadata: Metadata = {
  title: 'Dinodia Platform',
  description: 'Dinodia smart home portal for Home Assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">
        <GlobalRefreshProvider>
          <div className="min-h-screen">{children}</div>
        </GlobalRefreshProvider>
      </body>
    </html>
  );
}
