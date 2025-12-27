import DinodiaQrCodeClient from './client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = {
  title: 'Generate Dinodia Hub QR',
  description: 'Installer-only QR generator for Dinodia Hub setup',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function DinodiaQrCodePage() {
  return <DinodiaQrCodeClient />;
}
