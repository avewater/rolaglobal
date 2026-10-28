export const metadata = { title: 'Page not found | ROLA' };

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', background: '#070707', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: 'center', display: 'grid', gap: 16 }}>
        <div style={{ color: '#d3b579', letterSpacing: '0.12em', fontSize: 12, textTransform: 'uppercase' }}>ROLA</div>
        <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 36, margin: 0 }}>This page does not exist.</h1>
        <p style={{ color: '#8a8a8a', margin: 0 }}>The link may be old or mistyped.</p>
        <a href="/" style={{ color: '#d3b579' }}>Go to rolaglobal.com</a>
      </div>
    </main>
  );
}
