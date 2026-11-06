import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, updateRecord } from '@/lib/os-airtable';
import { getUser } from '@/lib/os-session';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// Each person edits only their own profile. Role, passkey and access stay with Michael in Airtable.
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  let b: any;
  try {
    b = await req.json();
  } catch {
    return bad('Bad request.');
  }
  const t = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = t(b.name);
  if (!name) return bad('Your name is required.');
  const email = t(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('That email does not look right.');
  const url = (v: unknown, label: string) => {
    let u = t(v, 300);
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      const p = new URL(u);
      if (p.protocol !== 'https:' && p.protocol !== 'http:') throw new Error();
      return p.toString();
    } catch {
      throw new Error(`${label} link does not look right.`);
    }
  };
  // Social handles: store as typed, without a leading @ duplicated.
  const handle = (v: unknown) => t(v, 120).replace(/^@+/, '@') || null;
  try {
    const fields = {
      rep_name: name,
      profile_title: t(b.title) || null,
      profile_email: email || null,
      profile_phone: t(b.phone, 40) || null,
      profile_linkedin: url(b.linkedin, 'LinkedIn'),
      profile_website: url(b.website, 'Website'),
      profile_instagram: handle(b.instagram),
      profile_x: handle(b.x),
      profile_tiktok: handle(b.tiktok),
    };
    await updateRecord(OS_TABLES.reps, user.id, fields);
    const fresh = await getUser(req);
    return NextResponse.json({ ok: true, user: fresh });
  } catch (e) {
    if (e instanceof Error && e.message.endsWith('look right.')) return bad(e.message);
    console.error('profile', e);
    return bad('Could not save. Try again.', 500);
  }
}
