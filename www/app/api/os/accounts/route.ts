import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecord, deleteRecord, getRecord } from '@/lib/os-airtable';
import { Refuse, accountProfileFields, itemFields, readAccount, readItem, resolveAssignee } from '@/lib/os-accounts';
import { can, getUser } from '@/lib/os-session';

export const dynamic = 'force-dynamic';

// New account. No account is created without its first task (a dateless first entry is saved as a note).
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  if (!can(user, 'accounts')) return NextResponse.json({ error: 'Your role cannot create accounts.' }, { status: 403 });
  let b: any;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  let accountId = '';
  try {
    const profile = accountProfileFields(b, false);
    if (!String(b.first?.title ?? '').trim()) throw new Refuse('Every account needs a first task. Add one before creating the account.');
    const first = itemFields(b.first ?? {}, 'Entry');
    const assignee = await resolveAssignee(user, b.first?.assignee);
    let leadLink = {};
    if (b.lead && can(user, 'pipeline')) {
      const lead = await getRecord(OS_TABLES.contacts, String(b.lead));
      if (lead) leadLink = { lead: [lead.id], lead_rec: lead.id };
    }
    const acc = await createRecord(OS_TABLES.accounts, { ...profile, ...leadLink, owner_rec: user.id, owner_name: user.name, created_by: user.name });
    accountId = acc.id;
    const item = await createRecord(OS_TABLES.items, {
      ...first,
      ...assignee,
      kind: 'Entry',
      status: 'Open',
      account: [acc.id],
      account_rec: acc.id,
      created_by: user.name,
      created_by_rec: user.id,
    });
    return NextResponse.json({ ok: true, account: readAccount(acc), item: readItem(item) });
  } catch (e) {
    // Keep the rule: if the first task did not save, the account is removed again.
    if (accountId) await deleteRecord(OS_TABLES.accounts, accountId).catch(() => {});
    if (e instanceof Refuse) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('account create', e);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
  }
}
