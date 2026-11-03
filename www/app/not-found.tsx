export const metadata = { title: 'Page not found | ROLA' };

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', background: '#ffffff', color: '#0b1b2b', display: 'grid', placeItems: 'center', fontFamily: "'Source Sans 3', system-ui, sans-serif", padding: 24 }}>
      <div style={{ maxWidth: 520, textAlign: 'center', display: 'grid', gap: 16, justifyItems: 'center' }}>
        <img src="/images/rola-mark.png" alt="" style={{ height: 44, width: 'auto' }} />
        <h1 style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 600, fontSize: 36, margin: 0 }}>This page does not exist.</h1>
        <p style={{ color: '#56616e', margin: 0 }}>The link may be old or mistyped.</p>
        <a href="/" style={{ color: '#0b1b2b', fontWeight: 600 }}>Go to rolaglobal.com</a>
      </div>
    </main>
  );
}
