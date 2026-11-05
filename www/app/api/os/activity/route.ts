import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, getRecord, updateRecord } from '@/lib/os-airtable';
import { logActivity, parseMentions, readActivity, readLead, todayET } from '@/lib/os-leads';
import { can, getUser } from '@/lib/os-session';
import { CLOSED_STAGES } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400, code?: string) => NextResponse.json({ error, ...(code ? { code } : {}) }, { status });

// Comments and quick logs. A logged touch stamps last_touch. "Reply received" moves the lead to Replied.
// Logging an outbound touch on a Do Not Contact lead is refused.
const KINDS: Record<string, { summary: string; touch: boolean; outbound: boolean }> = {
  Comment: { summary: 'Comment', touch: false, outbound: false },
  'Email logged': { summary: 'Logged email', touch: true, outbound: true },
  'LinkedIn logged': { summary: 'Logged LinkedIn message', touch: true, outbound: true },
  'Call logged': { summary: 'Logged call', touch: true, outbound: true },
  'Reply received': { summary: 'Reply received', touch: true, outbound: false },
};

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  if (!can(user, 'edit_leads')) return bad('Your role cannot log activity.', 403);
  let b: any;
  try {
    b = await req.json();
  } catch {
    return bad('Bad request.');
  }
  const kind = KINDS[b.type];
  if (!kind) return bad('Unknown activity.');
  const text = typeof b.body === 'string' ? b.body.trim().slice(0, 4000) : '';
  if (b.type === 'Comment' && !text) return bad('Write a comment first.');
  const row = await getRecord(OS_TABLES.contacts, String(b.lead || ''));
  if (!row) return bad('Lead not found.', 404);
  const lead = readLead(row, true);
  if (kind.outbound && lead.dnc) return bad('This lead is marked Do Not Contact. Nothing can be sent or logged as sent.', 409, 'dnc');

  try {
    const mentions = parseMentions(text);
    const act = await logActivity(lead.id, {
      type: b.type,
      summary: b.type === 'Comment' ? text.split('\n')[0].slice(0, 120) : kind.summary,
      body: text || undefined,
      by: user.name,
      mentions: mentions || undefined,
    });
    let updated = row;
    const fields: Record<string, unknown> = {};
    if (kind.touch) fields.last_touch = todayET();
    const moveToReplied = b.type === 'Reply received' && !CLOSED_STAGES.includes(lead.stage) && lead.stage !== 'Replied' && lead.stage !== 'Meeting Booked';
    if (moveToReplied) {
      fields.pipeline_stage = 'Replied';
      fields.stage_changed_at = todayET();
      fields.next_action = 'Answer the reply';
      fields.next_action_due = todayET();
    }
    if (Object.keys(fields).length) updated = await updateRecord(OS_TABLES.contacts, lead.id, fields);
    if (moveToReplied) await logActivity(lead.id, { type: 'Stage change', summary: `${lead.stage} to Replied`, by: user.name, from_stage: lead.stage, to_stage: 'Replied' });
    return NextResponse.json({ ok: true, activity: readActivity(act), lead: readLead(updated, can(user, 'see_contact')) });
  } catch (e) {
    console.error('activity', e);
    return bad('Could not save. Try again.', 500);
  }
}
