import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecord, createRecords, getRecord, listAll, str, updateRecord, type AirtableRecord } from '@/lib/os-airtable';
import { fitScore } from '@/lib/os-connections';
import { logActivity, todayET } from '@/lib/os-leads';
import { can, getUser } from '@/lib/os-session';
import { CONNECTION_TRIAGE, type Connection } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const t = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const normUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
const FIELDS = ['name', 'title', 'company', 'email', 'linkedin_url', 'connected_on', 'triage', 'lead_rec'];

function read(r: AirtableRecord): Connection {
  const f = r.fields;
  return {
    id: r.id,
    name: str(f.name),
    title: str(f.title),
    company: str(f.company),
    email: str(f.email),
    linkedin_url: str(f.linkedin_url),
    connected_on: str(f.connected_on),
    triage: str(f.triage) || 'Untriaged',
    lead: str(f.lead_rec),
    score: fitScore(str(f.title), str(f.company)),
  };
}

// Michael's 1st-degree LinkedIn connections, from LinkedIn's own data export. Rein triages them here.
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  if (!can(user, 'edit_leads')) return bad('Not allowed.', 403);
  const rows = await listAll(OS_TABLES.connections, { fields: FIELDS, max: 20000 });
  const seeContact = can(user, 'see_contact');
  return NextResponse.json({ connections: rows.map(read).map((c) => (seeContact ? c : { ...c, email: '' })) });
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  let b: any;
  try {
    b = await req.json();
  } catch {
    return bad('Bad request.');
  }

  if (b.action === 'import') {
    if (!can(user, 'import_leads')) return bad('Only an admin can import connections.', 403);
    const rows: any[] = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return bad('No rows.');
    if (rows.length > 500) return bad('Send at most 500 rows at a time.');
    const existing = await listAll(OS_TABLES.connections, { fields: ['linkedin_url', 'name', 'company'], max: 20000 });
    const seen = new Set(existing.map((r) => normUrl(str(r.fields.linkedin_url)) || `${str(r.fields.name)}|${str(r.fields.company)}`.toLowerCase()));
    const out: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const r of rows) {
      const name = t(r.name);
      const url = t(r.linkedin_url, 300);
      if (!name) { skipped++; continue; }
      if (url && !/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(url)) { skipped++; continue; }
      const key = normUrl(url) || `${name}|${t(r.company)}`.toLowerCase();
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      const email = t(r.email).toLowerCase();
      out.push({
        name,
        ...(t(r.title) ? { title: t(r.title) } : {}),
        ...(t(r.company) ? { company: t(r.company) } : {}),
        ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}),
        ...(url ? { linkedin_url: url } : {}),
        ...(t(r.connected_on) ? { connected_on: t(r.connected_on, 20) } : {}),
        triage: 'Untriaged',
      });
    }
    if (b.dry_run) return NextResponse.json({ ok: true, would_create: out.length, skipped });
    try {
      const made = await createRecords(OS_TABLES.connections, out);
      return NextResponse.json({ ok: true, created: made.length, skipped });
    } catch (e) {
      console.error('connections import', e);
      return bad('The import stopped partway. Run the same file again; anything already imported is skipped.', 500);
    }
  }

  if (b.action === 'triage') {
    if (!can(user, 'edit_leads')) return bad('Not allowed.', 403);
    const id = t(b.id, 20);
    const triage = t(b.triage, 20);
    if (!(CONNECTION_TRIAGE as readonly string[]).includes(triage)) return bad('Pick Fit, Not now or No.');
    const row = await getRecord(OS_TABLES.connections, id);
    if (!row) return bad('Connection not found.', 404);
    const c = read(row);
    const today = todayET();
    let leadId = c.lead;
    try {
      if (triage === 'Fit' && !leadId) {
        // Reuse a lead that already exists for this person, otherwise create one in Lane A.
        const contacts = await listAll(OS_TABLES.contacts, { fields: ['name', 'linkedin_url', 'email', 'do_not_contact'], max: 20000 });
        const match = contacts.find(
          (r) => (c.linkedin_url && normUrl(str(r.fields.linkedin_url)) === normUrl(c.linkedin_url)) || (c.email && str(r.fields.email).toLowerCase() === c.email.toLowerCase()),
        );
        if (match?.fields.do_not_contact === true) return bad(`${c.name} is marked Do Not Contact.`, 409);
        if (match) {
          leadId = match.id;
          await updateRecord(OS_TABLES.contacts, match.id, { lane: 'A', ...(c.connected_on ? { li_connected_on: c.connected_on } : {}), ...(c.linkedin_url ? { linkedin_url: c.linkedin_url } : {}) });
        } else {
          const lead = await createRecord(OS_TABLES.contacts, {
            name: c.name,
            ...(c.title ? { title: c.title } : {}),
            ...(c.company ? { organization: c.company } : {}),
            ...(c.email ? { email: c.email } : {}),
            ...(c.linkedin_url ? { linkedin_url: c.linkedin_url } : {}),
            lead_source: 'LinkedIn',
            lane: 'A',
            ...(c.connected_on ? { li_connected_on: c.connected_on } : {}),
            warm_path: `1st-degree LinkedIn connection of Michael${c.connected_on ? ` since ${c.connected_on}` : ''}`,
            pipeline_stage: 'New',
            lead_owner: 'Rein',
            next_action: 'Research connection',
            next_action_due: today,
            stage_changed_at: today,
          });
          leadId = lead.id;
          await logActivity(lead.id, { type: 'Note', summary: 'Added from LinkedIn connections', by: user.name });
        }
      }
      const updated = await updateRecord(OS_TABLES.connections, id, { triage, triaged_by: user.name, triaged_at: today, ...(leadId ? { lead_rec: leadId } : {}) });
      return NextResponse.json({ ok: true, connection: read(updated), lead: leadId || '' });
    } catch (e) {
      console.error('triage', e);
      return bad('Could not save. Try again.', 500);
    }
  }
  return bad('Unknown action.');
}
