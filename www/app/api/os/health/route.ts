import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Safe setup check: reports which settings are present and whether Airtable answers. Never returns a secret.
export async function GET() {
  const key = process.env.AIRTABLE_API_KEY || '';
  const base = process.env.AIRTABLE_BASE_ID || '';
  const secret = process.env.OS_SESSION_SECRET || '';
  const out: Record<string, string> = {
    AIRTABLE_BASE_ID: base ? (base === 'appCmpvREM4pWbpsu' ? 'set, correct' : 'set, but not the ROLA OS base') : 'MISSING',
    AIRTABLE_API_KEY: key ? (key.startsWith('pat') ? 'set' : 'set, but does not look like an Airtable token (should start with pat)') : 'MISSING',
    OS_SESSION_SECRET: secret ? (secret.length >= 32 ? 'set' : 'set, but too short (needs 32+ characters)') : 'MISSING',
    environment: process.env.VERCEL_ENV || 'unknown',
  };
  if (key && base) {
    try {
      const res = await fetch(`https://api.airtable.com/v0/${base}/tbl5yj9sITpnlRWeR?maxRecords=1&fields[]=rep_name`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
        cache: 'no-store',
      });
      out.airtable =
        res.ok ? 'connected'
        : res.status === 401 ? 'token rejected (wrong or expired token)'
        : res.status === 403 ? 'token has no access to the ROLA OS base, or is missing the data.records:read scope'
        : res.status === 404 ? 'base or Reps table not found'
        : `error ${res.status}`;
    } catch {
      out.airtable = 'could not reach Airtable';
    }
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
