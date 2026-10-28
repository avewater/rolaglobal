import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, formulaString, listAll, str } from '@/lib/os-airtable';
import { COOKIE, cookieOptions, signSession } from '@/lib/os-auth';
import { isRole } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  let passkey = '';
  try {
    passkey = String((await req.json())?.passkey ?? '').trim();
  } catch {}
  if (passkey.length < 8 || passkey.length > 100) {
    await pause(500);
    return NextResponse.json({ error: 'That code is not valid. Check it and try again.' }, { status: 400 });
  }
  try {
    const rows = await listAll(OS_TABLES.reps, {
      fields: ['rep_name', 'os_role', 'os_passkey', 'active'],
      filterByFormula: `AND({os_passkey} = ${formulaString(passkey)}, {active})`,
      max: 2,
    });
    const row = rows.find((r) => r.fields.os_passkey === passkey);
    if (!row) {
      await pause(600);
      return NextResponse.json({ error: 'That code is not valid. Check it and try again.' }, { status: 401 });
    }
    const role = row.fields.os_role;
    if (!isRole(role)) return NextResponse.json({ error: 'You have no role yet. Ask Michael to set one.' }, { status: 403 });
    const name = str(row.fields.rep_name);
    const res = NextResponse.json({ name, role });
    res.cookies.set(COOKIE, signSession({ sub: row.id, name, role }), cookieOptions);
    return res;
  } catch (e) {
    console.error('login', e);
    return NextResponse.json({ error: 'Sign-in is unavailable right now. Try again in a minute.' }, { status: 500 });
  }
}
