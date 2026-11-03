import type { Metadata, Viewport } from 'next';
import './os.css';

export const metadata: Metadata = {
  title: 'ROLA OS',
  description: 'The ROLA team operating system.',
  manifest: '/os/manifest.webmanifest',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'ROLA OS', statusBarStyle: 'default' },
  icons: { icon: '/favicon-32x32.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function OsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&family=Source+Sans+3:wght@400;600;700&display=swap"
        precedence="default"
      />
      <div className="aos-root">{children}</div>
    </>
  );
}
