import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecord, deleteRecord, getRecord, str, updateRecord } from '@/lib/os-airtable';
import { logActivity, readLead, todayET } from '@/lib/os-leads';
import { Refuse, itemFields, readItem, resolveAssignee } from '@/lib/os-accounts';
import { can, getUser } from '@/lib/os-session';

export const dynamic = 'force-dynamic';

// Tasks, notes, messages and updates. Everything belongs to an account.
// Accounts are shared by the team; who may change an item:
//   edit, complete, reopen: the assignee, the creator, or an admin
//   reassign: anyone with assign_tasks (to a teammate who can open accounts)
//   mark sent: the message's owner or an admin. The OS never sends anything.
//   delete: the creator or an admin
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  if (!can(user, 'accounts')) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  try {
    const b = await req.json();
    const admin = user.role === 'Admin';

    if (b.action === 'create') {
      const kind = b.kind === 'Message' ? 'Message' : b.kind === 'Update' ? 'Update' : 'Entry';
      const acc = await getRecord(OS_TABLES.accounts, String(b.account || ''));
      if (!acc) throw new Refuse('Tasks, notes and messages must belong to an account.');
      const fields = itemFields(b, kind);
      const assignee = kind === 'Entry' ? await resolveAssignee(user, b.assignee) : { assignee_rec: user.id, assignee_name: user.name };
      const rec = await createRecord(OS_TABLES.items, {
        ...fields,
        ...assignee,
        kind,
        status: kind === 'Update' ? 'Done' : 'Open',
        ...(kind === 'Update' ? { done_at: new Date().toISOString(), done_by: user.name } : {}),
        account: [acc.id],
        account_rec: acc.id,
        created_by: user.name,
        created_by_rec: user.id,
      });
      return NextResponse.json({ ok: true, item: readItem(rec) });
    }

    const row = await getRecord(OS_TABLES.items, String(b.id || ''));
    if (!row) throw new Refuse('Item not found.', 404);
    const item = readItem(row);
    const mine = item.assignee === user.id || item.created_by_rec === user.id;

    if (b.action === 'update') {
      if (!mine && !admin) throw new Refuse('Only the person it is assigned to, its creator or an admin can edit this.', 403);
      if (item.kind === 'Update') throw new Refuse('Updates cannot be edited.');
      const fields = itemFields({ ...item, ...(b.fields ?? {}) }, item.kind);
      const rec = await updateRecord(OS_TABLES.items, item.id, fields);
      return NextResponse.json({ ok: true, item: readItem(rec) });
    }
    if (b.action === 'assign') {
      if (item.kind !== 'Entry') throw new Refuse('Only tasks and notes can be assigned.');
      const a = await resolveAssignee(user, b.assignee);
      if (!can(user, 'assign_tasks') && !mine) throw new Refuse('You do not have permission to assign tasks.', 403);
      const rec = await updateRecord(OS_TABLES.items, item.id, a);
      return NextResponse.json({ ok: true, item: readItem(rec) });
    }
    if (b.action === 'done' || b.action === 'reopen') {
      if (!mine && !admin) throw new Refuse('Only the person it is assigned to, its creator or an admin can change this.', 403);
      if (item.kind !== 'Entry') throw new Refuse('Only tasks and notes can be completed.');
      const rec = await updateRecord(
        OS_TABLES.items,
        item.id,
        b.action === 'done' ? { status: 'Done', done_at: new Date().toISOString(), done_by: user.name } : { status: 'Open', done_at: null, done_by: null },
      );
      return NextResponse.json({ ok: true, item: readItem(rec) });
    }
    if (b.action === 'sent' || b.action === 'unsend') {
      if (item.kind !== 'Message') throw new Refuse('Only messages can be marked sent.');
      if (item.assignee !== user.id && !admin) throw new Refuse('Only the person who drafted this message can mark it sent.', 403);
      // If the account came from a lead, a sent message counts as a touch on that lead, and Do Not Contact blocks it.
      if (b.action === 'sent') {
        const acc = await getRecord(OS_TABLES.accounts, item.account);
        const leadId = acc ? str(acc.fields.lead_rec) : '';
        const leadRow = leadId ? await getRecord(OS_TABLES.contacts, leadId) : null;
        if (leadRow) {
          const lead = readLead(leadRow, true);
          if (lead.dnc) throw new Refuse('This account is linked to a Do Not Contact lead. Do not send this message.', 409, 'dnc');
          const type = item.channel === 'Email' ? 'Email logged' : item.channel === 'LinkedIn' ? 'LinkedIn logged' : 'Note';
          await logActivity(lead.id, {
            type,
            summary: type === 'Email logged' ? 'Logged email' : type === 'LinkedIn logged' ? 'Logged LinkedIn message' : `Sent ${item.channel.toLowerCase()} message`,
            body: [item.subject, item.body].filter(Boolean).join('\n\n').slice(0, 4000),
            by: user.name,
          });
          await updateRecord(OS_TABLES.contacts, lead.id, { last_touch: todayET() });
        }
      }
      const rec = await updateRecord(
        OS_TABLES.items,
        item.id,
        b.action === 'sent' ? { status: 'Sent', done_at: new Date().toISOString(), done_by: user.name } : { status: 'Open', done_at: null, done_by: null },
      );
      return NextResponse.json({ ok: true, item: readItem(rec) });
    }
    if (b.action === 'delete') {
      if (item.created_by_rec !== user.id && !admin) throw new Refuse('Only the person who created this, or an admin, can delete it.', 403);
      await deleteRecord(OS_TABLES.items, item.id);
      return NextResponse.json({ ok: true, deleted: item.id });
    }
    throw new Refuse('Unknown action.');
  } catch (e) {
    if (e instanceof Refuse) return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: e.status });
    console.error('items', e);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
  }
}
