import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, formulaString, getRecord, listAll, updateRecord } from '@/lib/os-airtable';
import { ITEM_READ, Refuse, accountProfileFields, readAccount, readItem } from '@/lib/os-accounts';
import { can, getUser } from '@/lib/os-session';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// Full account with every item ever recorded on it (the main data load only carries recent items).
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  if (!can(user, 'accounts')) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  const { id } = await ctx.params;
  const row = await getRecord(OS_TABLES.accounts, id);
  if (!row) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  const items = await listAll(OS_TABLES.items, { fields: ITEM_READ, filterByFormula: `{account_rec} = ${formulaString(id)}`, max: 1000 }).catch(() => []);
  return NextResponse.json({ account: readAccount(row), items: items.map(readItem) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  if (!can(user, 'accounts')) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  const { id } = await ctx.params;
  const row = await getRecord(OS_TABLES.accounts, id);
  if (!row) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  try {
    const b = await req.json();
    const fields = accountProfileFields(b.fields ?? {}, true);
    if (!Object.keys(fields).length) return NextResponse.json({ ok: true, account: readAccount(row) });
    const upd = await updateRecord(OS_TABLES.accounts, id, fields);
    return NextResponse.json({ ok: true, account: readAccount(upd) });
  } catch (e) {
    if (e instanceof Refuse) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('account update', e);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
  }
}
