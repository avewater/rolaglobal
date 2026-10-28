import type { Metadata, Viewport } from 'next';
import './os.css';

export const metadata: Metadata = {
  title: 'ROLA OS',
  description: 'The ROLA team operating system.',
  manifest: '/os/manifest.webmanifest',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'ROLA OS', statusBarStyle: 'black-translucent' },
  icons: { icon: '/favicon-32x32.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#070707',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function OsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap"
        precedence="default"
      />
      <div className="aos-root">{children}</div>
    </>
  );
}
