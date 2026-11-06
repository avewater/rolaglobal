import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecord } from '@/lib/os-airtable';
import { logActivity, readLead, todayET } from '@/lib/os-leads';
import { can, getUser } from '@/lib/os-session';
import { GRADES, LEAD_STAGES, OWNERS, SOURCES, ownerFor } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const pick = (v: unknown, opts: readonly string[]) => (typeof v === 'string' && opts.includes(v) ? v : undefined);
const t = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// New lead from the board. Always starts in an open stage, so a next action is required.
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  if (!can(user, 'edit_leads')) return bad('Your role cannot add leads.', 403);
  let b: any;
  try {
    b = await req.json();
  } catch {
    return bad('Bad request.');
  }
  const name = t(b.name);
  const organization = t(b.organization);
  const next_action = t(b.next_action) || 'Research lead';
  const due = typeof b.next_action_due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.next_action_due) ? b.next_action_due : todayET();
  if (!name) return bad('A lead needs a name.');
  const email = t(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('That email does not look right.');
  const stage = pick(b.stage, LEAD_STAGES.slice(0, 4)) || 'New';
  try {
    const rec = await createRecord(OS_TABLES.contacts, {
      name,
      ...(organization ? { organization } : {}),
      ...(t(b.title) ? { title: t(b.title) } : {}),
      pipeline_stage: stage,
      ...(pick(b.grade, GRADES) ? { grade: b.grade } : {}),
      ...(pick(b.source, SOURCES) ? { source: b.source } : {}),
      lead_owner: pick(b.owner, OWNERS) || ownerFor(user.name) || 'Michael',
      next_action,
      next_action_due: due,
      stage_changed_at: todayET(),
      ...(email && can(user, 'see_contact') ? { email } : {}),
    });
    await logActivity(rec.id, { type: 'Stage change', summary: `Lead added in ${stage}`, by: user.name, to_stage: stage });
    return NextResponse.json({ ok: true, lead: readLead(rec, can(user, 'see_contact')) });
  } catch (e) {
    console.error('lead create', e);
    return bad('Could not save. Try again.', 500);
  }
}
