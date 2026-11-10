import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecords, deleteRecord, getRecord, listAll, str, updateRecord } from '@/lib/os-airtable';
import { ITEM_READ, Refuse, readAccount, readItem } from '@/lib/os-accounts';
import { AiError, checkDraft, draftTouches } from '@/lib/os-ai';
import { logActivity, readLead, todayET } from '@/lib/os-leads';
import { can, getUser } from '@/lib/os-session';
import { OUTREACH, isOpenStage, type Item, type OsUser } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// LinkedIn-first outreach (Lane A): AI drafts three touches from Rein's notes, Rein edits, Michael approves,
// and Michael sends each one by hand from his own LinkedIn. ROLA OS never acts on LinkedIn.
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const REPLIED = ['Replied', 'Meeting Booked', 'Closed Won'];

async function touchItems(accountId: string) {
  const rows = await listAll(OS_TABLES.items, { fields: ITEM_READ, filterByFormula: `AND({account_rec} = '${accountId}', {touch} > 0)` });
  return rows.map(readItem).filter((i) => i.touch > 0).sort((a, b) => a.touch - b.touch);
}
async function leadFor(accountId: string) {
  const acc = await getRecord(OS_TABLES.accounts, accountId);
  if (!acc) throw new Refuse('Account not found.', 404);
  const account = readAccount(acc);
  const row = account.lead ? await getRecord(OS_TABLES.contacts, account.lead) : null;
  return { account, lead: row ? readLead(row, true) : null };
}
async function recentFirstTouches(exceptAccount: string) {
  const since = addDays(todayET(), -7);
  const rows = await listAll(OS_TABLES.items, { fields: ['body', 'account_rec', 'touch'], filterByFormula: `AND({touch} = 1, IS_AFTER(CREATED_TIME(), '${since}'))`, max: 500 });
  return rows.filter((r) => str(r.fields.account_rec) !== exceptAccount).map((r) => str(r.fields.body));
}
const recheck = async (it: Item, body: string, currentWork: string) => checkDraft(body, { touch: it.touch, currentWork, others: it.touch === 1 ? await recentFirstTouches(it.account) : [] });

// Stop-loss: replies among the first 50 Touch 1 messages ever sent.
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  if (!can(user, 'edit_leads')) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  const sent = await listAll(OS_TABLES.items, { fields: ['account_rec', 'done_at'], filterByFormula: `AND({touch} = 1, {status} = 'Sent')`, sort: [{ field: 'done_at', direction: 'asc' }], max: OUTREACH.stopLossWindow });
  const accIds = sent.map((r) => str(r.fields.account_rec));
  const accs = accIds.length ? await listAll(OS_TABLES.accounts, { fields: ['lead_rec'], filterByFormula: `OR(${accIds.map((id) => `RECORD_ID() = '${id}'`).join(',')})`, max: 100 }) : [];
  const leadIds = accs.map((a) => str(a.fields.lead_rec)).filter(Boolean);
  const leads = leadIds.length ? await listAll(OS_TABLES.contacts, { fields: ['pipeline_stage'], filterByFormula: `OR(${leadIds.map((id) => `RECORD_ID() = '${id}'`).join(',')})`, max: 100 }) : [];
  const replies = leads.filter((l) => REPLIED.includes(str(l.fields.pipeline_stage))).length;
  const sentToday = (await listAll(OS_TABLES.items, { fields: ['done_at'], filterByFormula: `AND({touch} > 0, {status} = 'Sent', IS_AFTER({done_at}, '${addDays(todayET(), -1)}'))`, max: 200 })).filter(
    (r) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(str(r.fields.done_at))) === todayET(),
  ).length;
  return NextResponse.json({ stopLoss: { sent: sent.length, replies, window: OUTREACH.stopLossWindow, threshold: OUTREACH.stopLossReplies }, sentToday, cap: OUTREACH.dailyCap });
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  let b: any;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  try {
    const out = await act(user, b);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof Refuse) return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: e.status });
    if (e instanceof AiError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error('outreach', e);
    return NextResponse.json({ error: 'Could not save. Try again.' }, { status: 500 });
  }
}

async function act(user: OsUser, b: any): Promise<Record<string, unknown>> {
  const approver = can(user, 'approve_outreach');
  if (!can(user, 'edit_leads') || !can(user, 'accounts')) throw new Refuse('Not allowed.', 403);
  const t = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  if (b.action === 'draft') {
    const accountId = t(b.account, 20);
    const { account, lead } = await leadFor(accountId);
    if (!lead) throw new Refuse('This account is not linked to a lead.');
    if (lead.dnc) throw new Refuse('This lead is Do Not Contact.', 409);
    if (!lead.linkedin_url && !account.linkedin) throw new Refuse('Add their LinkedIn link to the lead first.');
    if (!lead.current_work) throw new Refuse("Add what they're working on now to the lead first. The first line is built on it.", 422);
    const existing = await touchItems(accountId);
    if (existing.some((i) => i.status === 'Sent' || i.review === 'Approved')) throw new Refuse('Messages for this account are already approved or sent.', 409);
    const others = await recentFirstTouches(accountId);
    let touches = await draftTouches(lead);
    let checks = touches.map((body, i) => checkDraft(body, { touch: i + 1, currentWork: lead.current_work, others: i === 0 ? others : [] }));
    // One retry when a draft breaks a hard rule (other than the placeholder Touch 2 is meant to carry).
    const fixable = checks.flatMap((c) => c.hard.filter((h) => !h.startsWith('Fill in')));
    if (fixable.length) {
      touches = await draftTouches(lead, fixable);
      checks = touches.map((body, i) => checkDraft(body, { touch: i + 1, currentWork: lead.current_work, others: i === 0 ? others : [] }));
    }
    for (const old of existing) await deleteRecord(OS_TABLES.items, old.id);
    const url = lead.linkedin_url || account.linkedin;
    const rows = await createRecords(
      OS_TABLES.items,
      touches.map((body, i) => ({
        account: [accountId],
        account_rec: accountId,
        kind: 'Message',
        channel: 'LinkedIn',
        to_name: lead.name,
        title: `LinkedIn touch ${i + 1} to ${lead.name}`,
        body,
        touch: i + 1,
        review: OUTREACH.reinFirst ? 'Rein' : 'Michael',
        flags: checks[i].flags,
        ai_drafted: true,
        linkedin_url: url,
        status: 'Open',
        created_by: user.name,
        created_by_rec: user.id,
        assignee_rec: user.id,
        assignee_name: user.name,
      })),
    );
    return { items: rows.map(readItem) };
  }

  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string').slice(0, 30) : typeof b.id === 'string' ? [b.id] : [];
  if (!ids.length) throw new Refuse('Nothing selected.');
  const items: Item[] = [];
  for (const id of ids) {
    const r = await getRecord(OS_TABLES.items, id);
    if (!r) throw new Refuse('Message not found.', 404);
    const it = readItem(r);
    if (!it.touch) throw new Refuse('Not an outreach message.');
    items.push(it);
  }
  const first = items[0];
  const { lead } = await leadFor(first.account);

  if (b.action === 'edit') {
    const body = t(b.body);
    if (!body) throw new Refuse('A message cannot be empty.');
    if (first.status === 'Sent') throw new Refuse('Already sent.');
    if (first.review === 'Approved' && !approver) throw new Refuse('Only Michael can change an approved message.', 403);
    const c = await recheck(first, body, lead?.current_work ?? '');
    const rec = await updateRecord(OS_TABLES.items, first.id, { body, flags: c.flags });
    return { items: [readItem(rec)] };
  }

  if (b.action === 'to_michael') {
    const out: Item[] = [];
    for (const it of items) out.push(readItem(await updateRecord(OS_TABLES.items, it.id, { review: 'Michael' })));
    return { items: out };
  }

  if (b.action === 'approve') {
    if (!approver) throw new Refuse('Only Michael approves outreach.', 403);
    if (lead?.dnc) throw new Refuse('This lead is Do Not Contact.', 409);
    for (const it of items) {
      const c = await recheck(it, it.body, lead?.current_work ?? '');
      if (c.hard.length) throw new Refuse(`Touch ${it.touch}: ${c.hard.join('; ')}. Edit it, then approve.`, 422);
    }
    const out: Item[] = [];
    for (const it of items) {
      const firstTouch = it.touch === 1;
      out.push(readItem(await updateRecord(OS_TABLES.items, it.id, { review: 'Approved', ...(firstTouch ? { due_date: todayET() } : {}) })));
    }
    return { items: out };
  }

  if (b.action === 'back_to_rein') {
    const out: Item[] = [];
    for (const it of items) out.push(readItem(await updateRecord(OS_TABLES.items, it.id, { review: 'Rein' })));
    return { items: out };
  }

  if (b.action === 'sent') {
    if (!approver) throw new Refuse('Only Michael sends from his LinkedIn.', 403);
    if (first.review !== 'Approved') throw new Refuse('Approve it first.');
    if (first.status === 'Sent') return { items: [first] };
    if (lead?.dnc) throw new Refuse('This lead is Do Not Contact. Do not send.', 409);
    const today = todayET();
    const sentRec = readItem(await updateRecord(OS_TABLES.items, first.id, { status: 'Sent', done_at: new Date().toISOString(), done_by: user.name, due_date: first.due_date || today }));
    const out: Item[] = [sentRec];
    const all = await touchItems(first.account);
    const next = all.find((i) => i.touch === first.touch + 1 && i.status === 'Open' && i.review !== 'Stopped');
    const cad = lead?.lane === 'B' ? OUTREACH.laneB : OUTREACH.laneA;
    if (next) out.push(readItem(await updateRecord(OS_TABLES.items, next.id, { due_date: addDays(today, cad[first.touch] - cad[first.touch - 1]) })));
    if (lead) {
      await logActivity(lead.id, { type: 'LinkedIn logged', summary: `LinkedIn touch ${first.touch} sent`, body: first.body, by: user.name });
      const stage = `Touch ${first.touch}`;
      const order = ['New', 'Researched', 'Draft Ready', 'Approved', 'Touch 1', 'Touch 2', 'Touch 3'];
      const move = isOpenStage(lead.stage) && order.indexOf(lead.stage) >= 0 && order.indexOf(lead.stage) < order.indexOf(stage);
      await updateRecord(OS_TABLES.contacts, lead.id, {
        last_touch: today,
        ...(move ? { pipeline_stage: stage, stage_changed_at: today } : {}),
        ...(next
          ? { next_action: `LinkedIn touch ${next.touch}`, next_action_due: addDays(today, cad[first.touch] - cad[first.touch - 1]) }
          : { next_action: 'No reply? Close as No response and resurface in 90 days', next_action_due: addDays(today, 3) }),
      });
    }
    return { items: out };
  }

  if (b.action === 'stop') {
    // Reply received (or no longer relevant): stop the rest of the sequence.
    const all = await touchItems(first.account);
    const out: Item[] = [];
    for (const it of all.filter((i) => i.status === 'Open')) out.push(readItem(await updateRecord(OS_TABLES.items, it.id, { review: 'Stopped' })));
    if (b.replied && lead) {
      await logActivity(lead.id, { type: 'Reply received', summary: 'Replied on LinkedIn', by: user.name });
      if (isOpenStage(lead.stage) && !REPLIED.includes(lead.stage))
        await updateRecord(OS_TABLES.contacts, lead.id, { pipeline_stage: 'Replied', stage_changed_at: todayET(), next_action: 'Answer the reply', next_action_due: todayET() });
    }
    return { items: out };
  }

  throw new Refuse('Unknown action.');
}
