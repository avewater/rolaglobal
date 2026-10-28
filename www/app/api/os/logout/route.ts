import { NextResponse } from 'next/server';
import { COOKIE, cookieOptions } from '@/lib/os-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return res;
}
