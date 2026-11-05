import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, formulaString, getRecord, listAll, updateRecord } from '@/lib/os-airtable';
import { logActivity, readActivity, readLead, todayET } from '@/lib/os-leads';
import { can, getUser } from '@/lib/os-session';
import { BRANDS, DISPOSITION_REASONS, GRADES, LEAD_STAGES, OWNERS, REASON_STAGES, SOURCES, isOpenStage } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const bad = (error: string, status = 400, code?: string) => NextResponse.json({ error, ...(code ? { code } : {}) }, { status });
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const oneOf = (v: unknown, opts: readonly string[]) => typeof v === 'string' && opts.includes(v);

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  if (!can(user, 'pipeline')) return bad('Not allowed.', 403);
  const { id } = await ctx.params;
  const row = await getRecord(OS_TABLES.contacts, id);
  if (!row) return bad('Lead not found.', 404);
  const acts = await listAll(OS_TABLES.activity, {
    filterByFormula: `{lead_rec} = ${formulaString(id)}`,
    sort: [{ field: 'at', direction: 'desc' }],
    max: 200,
  }).catch(() => []);
  return NextResponse.json({ lead: readLead(row, can(user, 'see_contact')), activity: acts.map(readActivity) }, { headers: { 'Cache-Control': 'no-store' } });
}

// Edits are validated here, not in the browser: unknown select values, missing reasons and
// Do Not Contact are all refused on the server.
export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getUser(req);
  if (!user) return bad('signed_out', 401);
  if (!can(user, 'edit_leads')) return bad('Your role cannot edit leads.', 403);
  const { id } = await ctx.params;
  const row = await getRecord(OS_TABLES.contacts, id);
  if (!row) return bad('Lead not found.', 404);
  const lead = readLead(row, true);
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad('Bad request.');
  }

  try {
    if (body.action === 'stage') {
      const to = body.stage;
      if (!oneOf(to, LEAD_STAGES)) return bad('Unknown stage.');
      if (to === lead.stage) return NextResponse.json({ ok: true, lead });
      if (lead.dnc && to !== 'Do Not Contact' && user.role !== 'Admin')
        return bad('This lead is marked Do Not Contact. Only an admin can move it.', 409, 'dnc');
      const fields: Record<string, unknown> = { pipeline_stage: to, stage_changed_at: todayET() };
      if (REASON_STAGES.includes(to)) {
        if (!oneOf(body.reason, DISPOSITION_REASONS)) return bad('Pick a reason before closing this lead.', 422, 'need_reason');
        fields.disposition_reason = body.reason;
      } else if (to !== 'Closed Won') {
        fields.disposition_reason = null;
      }
      fields.do_not_contact = to === 'Do Not Contact';
      if (isOpenStage(to)) {
        const na = typeof body.next_action === 'string' && body.next_action.trim() ? body.next_action.trim().slice(0, 200) : lead.next_action;
        const due = isDate(body.next_action_due) ? body.next_action_due : lead.next_action_due;
        if (!na || !due) return bad('Open leads need a next action and a date.', 422, 'need_next_action');
        fields.next_action = na;
        fields.next_action_due = due;
      }
      const updated = await updateRecord(OS_TABLES.contacts, id, fields);
      await logActivity(id, {
        type: 'Stage change',
        summary: `${lead.stage} to ${to}${fields.disposition_reason ? ` (${fields.disposition_reason})` : ''}`,
        by: user.name,
        from_stage: lead.stage,
        to_stage: to,
        body: typeof body.note === 'string' ? body.note.slice(0, 2000) : undefined,
      });
      return NextResponse.json({ ok: true, lead: readLead(updated, can(user, 'see_contact')) });
    }

    if (body.action === 'update') {
      const inF = body.fields ?? {};
      const out: Record<string, unknown> = {};
      const text = (k: string, max = 200) => {
        if (k in inF) out[k] = typeof inF[k] === 'string' ? inF[k].trim().slice(0, max) : '';
      };
      ['name', 'title', 'organization', 'warm_path', 'next_action'].forEach((k) => text(k));
      text('pinned_note', 2000);
      if ('linkedin_url' in inF) {
        const u = String(inF.linkedin_url || '').trim();
        if (u && !/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(u)) return bad('LinkedIn link must start with https://www.linkedin.com/');
        out.linkedin_url = u || null;
      }
      if ('next_action_due' in inF) {
        if (inF.next_action_due && !isDate(inF.next_action_due)) return bad('Bad date.');
        out.next_action_due = inF.next_action_due || null;
      }
      if ('athlete_reach' in inF) {
        const n = Number(inF.athlete_reach);
        out.athlete_reach = inF.athlete_reach === '' || inF.athlete_reach == null ? null : Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
      }
      const sel = (k: string, target: string, opts: readonly string[]) => {
        if (!(k in inF)) return true;
        if (!inF[k]) return (out[target] = null), true;
        if (!oneOf(inF[k], opts)) return false;
        out[target] = inF[k];
        return true;
      };
      if (!sel('grade', 'grade', GRADES) || !sel('owner', 'lead_owner', OWNERS) || !sel('source', 'source', SOURCES) || !sel('brand', 'brand', BRANDS))
        return bad('One of the choices is not on the list.');
      if (can(user, 'see_contact')) {
        if ('email' in inF) {
          const e = String(inF.email || '').trim();
          if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return bad('That email does not look right.');
          out.email = e || null;
        }
        if ('phone' in inF) out.phone = String(inF.phone || '').trim().slice(0, 40) || null;
      }
      if ('name' in out && !out.name) return bad('A lead needs a name.');
      if (isOpenStage(lead.stage)) {
        const na = 'next_action' in out ? out.next_action : lead.next_action;
        const due = 'next_action_due' in out ? out.next_action_due : lead.next_action_due;
        if (!na || !due) return bad('Open leads need a next action and a date.', 422, 'need_next_action');
      }
      if (!Object.keys(out).length) return NextResponse.json({ ok: true, lead });
      const updated = await updateRecord(OS_TABLES.contacts, id, out);
      if ('pinned_note' in out && out.pinned_note !== lead.pinned_note)
        await logActivity(id, { type: 'Note', summary: out.pinned_note ? 'Pinned note updated' : 'Pinned note cleared', body: String(out.pinned_note || ''), by: user.name });
      return NextResponse.json({ ok: true, lead: readLead(updated, can(user, 'see_contact')) });
    }
    return bad('Unknown action.');
  } catch (e) {
    console.error('lead POST', e);
    return bad('Could not save. Try again.', 500);
  }
}
