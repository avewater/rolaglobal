import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecords, listAll, str } from '@/lib/os-airtable';
import { todayET } from '@/lib/os-leads';
import { can, getUser } from '@/lib/os-session';
import { DISPOSITION_REASONS, GRADES, LEAD_STAGES, OWNERS, REASON_STAGES, SOURCES } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const t = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : String(v).trim().slice(0, max));
const ci = (v: string, opts: readonly string[]) => opts.find((o) => o.toLowerCase() === v.toLowerCase());
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

// CSV import of the Master Pipeline and Priority Board. Admin only.
// Duplicates are skipped: same email, or same name at the same organization.
// dry_run returns the counts without writing anything.
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  if (!can(user, 'import_leads')) return bad('Only an admin can import.', 403);
  let b: any;
  try {
    b = await req.json();
  } catch {
    return bad('Bad request.');
  }
  const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return bad('No rows to import.');
  if (rows.length > 1000) return bad('Import at most 1,000 rows at a time.');

  const existing = await listAll(OS_TABLES.contacts, { fields: ['name', 'organization', 'email'] });
  const emails = new Set(existing.map((r) => str(r.fields.email).toLowerCase()).filter(Boolean));
  const pairs = new Set(existing.map((r) => `${norm(str(r.fields.name))}|${norm(str(r.fields.organization))}`));

  const out: Record<string, unknown>[] = [];
  const skipped: { row: number; name: string; why: string }[] = [];
  const today = todayET();
  rows.forEach((r, i) => {
    const name = t(r.name);
    const organization = t(r.organization);
    const email = t(r.email).toLowerCase();
    if (!name) return skipped.push({ row: i + 2, name: organization || '(blank)', why: 'no name' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return skipped.push({ row: i + 2, name, why: 'bad email' });
    const pair = `${norm(name)}|${norm(organization)}`;
    if (email && emails.has(email)) return skipped.push({ row: i + 2, name, why: 'email already in the OS' });
    if (pairs.has(pair)) return skipped.push({ row: i + 2, name, why: 'same name and organization already in the OS' });
    if (email) emails.add(email);
    pairs.add(pair);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(t(r.next_action_due)) ? t(r.next_action_due) : today;
    const reach = Number(String(r.athlete_reach ?? '').replace(/[^0-9.]/g, ''));
    const li = t(r.linkedin_url);
    // Do Not Contact in the sheet stays Do Not Contact here: never imported as an open lead.
    const dncFlag = /^(y|yes|true|1|x|dnc)$/i.test(t(r.do_not_contact));
    const stage = dncFlag ? 'Do Not Contact' : ci(t(r.stage), LEAD_STAGES) || 'New';
    const closedWithReason = REASON_STAGES.includes(stage);
    out.push({
      name,
      ...(organization ? { organization } : {}),
      ...(t(r.title) ? { title: t(r.title) } : {}),
      ...(email ? { email } : {}),
      ...(t(r.phone) ? { phone: t(r.phone, 40) } : {}),
      ...(/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(li) ? { linkedin_url: li } : {}),
      pipeline_stage: stage,
      ...(stage === 'Do Not Contact' ? { do_not_contact: true } : {}),
      ...(closedWithReason ? { disposition_reason: ci(t(r.disposition_reason), DISPOSITION_REASONS) || 'Other' } : {}),
      ...(ci(t(r.grade), GRADES) ? { grade: ci(t(r.grade), GRADES) } : {}),
      ...(ci(t(r.source), SOURCES) ? { source: ci(t(r.source), SOURCES) } : {}),
      lead_owner: ci(t(r.owner), OWNERS) || 'Rein',
      ...(t(r.warm_path) ? { warm_path: t(r.warm_path) } : {}),
      ...(reach > 0 ? { athlete_reach: Math.round(reach) } : {}),
      next_action: t(r.next_action) || 'Research lead',
      next_action_due: due,
      stage_changed_at: today,
      ...(t(r.notes) ? { notes: t(r.notes, 4000) } : {}),
    });
  });

  if (b.dry_run) return NextResponse.json({ ok: true, would_create: out.length, skipped });
  try {
    const made = await createRecords(OS_TABLES.contacts, out);
    return NextResponse.json({ ok: true, created: made.length, skipped });
  } catch (e) {
    console.error('import', e);
    return bad('The import stopped partway. Check Airtable before running it again; duplicates will be skipped.', 500);
  }
}
