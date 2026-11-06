import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecord, deleteRecord, getRecord, str, updateRecord } from '@/lib/os-airtable';
import { logActivity, readLead, todayET } from '@/lib/os-leads';
import { readItem } from '@/lib/os-workspace';
import { can, getUser } from '@/lib/os-session';
import { CHANNELS } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400, code?: string) => NextResponse.json({ error, ...(code ? { code } : {}) }, { status });
const t = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// My Workspace: tasks, notes and message drafts. Everyone works only on their own items.
// An admin may also create an item for a teammate (assigning a task).
// Messages are never sent by the OS: "Mark sent" records that the person sent it themselves.
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  let b: any;
  try {
    b = await req.json();
  } catch {
    return bad('Bad request.');
  }

  const fieldsFrom = (src: any, kind: 'Entry' | 'Message') => {
    const out: Record<string, unknown> = {};
    out.title = t(src.title) || (kind === 'Message' ? t(src.subject) || `Message to ${t(src.to_name) || 'someone'}` : '');
    out.body = typeof src.body === 'string' ? src.body.slice(0, 10000) : '';
    out.due_date = isDate(src.due_date) ? src.due_date : null;
    out.due_time = out.due_date && isTime(src.due_time) ? src.due_time : null;
    if (kind === 'Message') {
      out.channel = CHANNELS.includes(src.channel) ? src.channel : 'Email';
      out.to_name = t(src.to_name) || null;
      out.subject = t(src.subject) || null;
    }
    return out;
  };

  try {
    if (b.action === 'create') {
      const kind = b.kind === 'Message' ? 'Message' : 'Entry';
      const fields = fieldsFrom(b, kind);
      if (!fields.title && !fields.body) return bad('Write something first.');
      if (!fields.title) fields.title = String(fields.body).split('\n')[0].slice(0, 120);
      let ownerId = user.id;
      let ownerName = user.name;
      if (b.owner && b.owner !== user.id) {
        if (user.role !== 'Admin') return bad('Only an admin can add items for someone else.', 403);
        const rep = await getRecord(OS_TABLES.reps, String(b.owner));
        if (!rep || rep.fields.active !== true) return bad('That teammate was not found.');
        ownerId = rep.id;
        ownerName = str(rep.fields.rep_name);
      }
      let leadLink = {};
      if (b.lead && can(user, 'pipeline')) {
        const lead = await getRecord(OS_TABLES.contacts, String(b.lead));
        if (lead) leadLink = { lead: [lead.id], lead_rec: lead.id, ...(fields.to_name ? {} : kind === 'Message' ? { to_name: str(lead.fields.name) } : {}) };
      }
      const rec = await createRecord(OS_TABLES.workspace, {
        ...fields,
        ...leadLink,
        kind,
        owner_rec: ownerId,
        owner_name: ownerName,
        created_by: user.name,
        status: 'Open',
      });
      return NextResponse.json({ ok: true, item: readItem(rec), forOther: ownerId !== user.id ? ownerName : undefined });
    }

    const row = await getRecord(OS_TABLES.workspace, String(b.id || ''));
    if (!row || str(row.fields.owner_rec) !== user.id) return bad('Item not found.', 404);
    const item = readItem(row);

    if (b.action === 'update') {
      const fields = fieldsFrom({ ...item, ...b.fields }, item.kind);
      if (!fields.title && !fields.body) return bad('Write something first.');
      if (!fields.title) fields.title = String(fields.body).split('\n')[0].slice(0, 120);
      const rec = await updateRecord(OS_TABLES.workspace, item.id, fields);
      return NextResponse.json({ ok: true, item: readItem(rec) });
    }

    if (b.action === 'done' || b.action === 'reopen') {
      const rec = await updateRecord(OS_TABLES.workspace, item.id, b.action === 'done' ? { status: 'Done', done_at: new Date().toISOString() } : { status: 'Open', done_at: null });
      return NextResponse.json({ ok: true, item: readItem(rec) });
    }

    if (b.action === 'sent') {
      if (item.kind !== 'Message') return bad('Only messages can be marked sent.');
      let leadOut;
      if (item.lead && can(user, 'pipeline')) {
        const leadRow = await getRecord(OS_TABLES.contacts, item.lead);
        if (leadRow) {
          const lead = readLead(leadRow, true);
          if (lead.dnc) return bad('This lead is marked Do Not Contact. Do not send this message.', 409, 'dnc');
          const type = item.channel === 'Email' ? 'Email logged' : item.channel === 'LinkedIn' ? 'LinkedIn logged' : 'Note';
          await logActivity(lead.id, {
            type,
            summary: type === 'Note' ? `Sent ${item.channel.toLowerCase()} message` : type === 'Email logged' ? 'Logged email' : 'Logged LinkedIn message',
            body: [item.subject, item.body].filter(Boolean).join('\n\n').slice(0, 4000),
            by: user.name,
          });
          leadOut = readLead(await updateRecord(OS_TABLES.contacts, lead.id, { last_touch: todayET() }), can(user, 'see_contact'));
        }
      }
      const rec = await updateRecord(OS_TABLES.workspace, item.id, { status: 'Sent', done_at: new Date().toISOString() });
      return NextResponse.json({ ok: true, item: readItem(rec), lead: leadOut });
    }

    if (b.action === 'delete') {
      await deleteRecord(OS_TABLES.workspace, item.id);
      return NextResponse.json({ ok: true, deleted: item.id });
    }
    return bad('Unknown action.');
  } catch (e) {
    console.error('workspace', e);
    return bad('Could not save. Try again.', 500);
  }
}
