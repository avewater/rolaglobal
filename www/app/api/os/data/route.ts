import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, listAll, num, str, list, type AirtableRecord } from '@/lib/os-airtable';
import { COOKIE, cookieOptions } from '@/lib/os-auth';
import { can, getUser } from '@/lib/os-session';
import { CONTACT_FIELDS, LEAD_FIELDS, readActivity, readLead } from '@/lib/os-leads';
import {
  CLOSED_STAGES,
  ROLE_REPORT_AGENTS,
  ownerFor,
  type Mention,
  SAMPLE_FLOOR,
  type Agent,
  type Contact,
  type Decision,
  type OsData,
  type Report,
  type School,
  type Tile,
} from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

async function safe<T>(label: string, errors: string[], fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    console.error(label, e);
    errors.push(label);
    return undefined;
  }
}

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await getUser(req);
  } catch (e) {
    console.error('getUser', e);
    return NextResponse.json({ error: 'The OS cannot reach its data right now. Try again in a minute.' }, { status: 500 });
  }
  if (!user) {
    const res = NextResponse.json({ error: 'signed_out' }, { status: 401 });
    res.cookies.set(COOKIE, '', { ...cookieOptions, maxAge: 0 });
    return res;
  }

  const errors: string[] = [];
  const wantPipeline = can(user, 'pipeline');
  const seeContact = can(user, 'see_contact');

  const [instRows, contactRows, reportRows, decisionRows, agentRows, inquiryRows, mentionRows] = await Promise.all([
    wantPipeline || can(user, 'athletes')
      ? safe('Schools', errors, () => listAll(OS_TABLES.institutions, { fields: ['name', 'type', 'conference', 'tier', 'core_sample_count', 'page_public', 'floor_crossed_on'] }))
      : undefined,
    wantPipeline
      ? safe('Pipeline', errors, () =>
          listAll(OS_TABLES.contacts, {
            fields: [...LEAD_FIELDS, ...(seeContact ? CONTACT_FIELDS : [])],
          }),
        )
      : undefined,
    can(user, 'reports')
      ? safe('Reports', errors, () => listAll(OS_TABLES.reports, { sort: [{ field: 'report_date', direction: 'desc' }], max: 60 }))
      : undefined,
    can(user, 'decisions') ? safe('Decisions', errors, () => listAll(OS_TABLES.decisions)) : undefined,
    can(user, 'agents') ? safe('Agents', errors, () => listAll(OS_TABLES.agents, { sort: [{ field: 'sort' }] })) : undefined,
    wantPipeline ? safe('Inquiries', errors, () => listAll(OS_TABLES.inquiries, { fields: ['status'] })) : undefined,
    wantPipeline && ownerFor(user.name)
      ? safe('Mentions', errors, () =>
          listAll(OS_TABLES.activity, {
            filterByFormula: `AND(FIND('${ownerFor(user.name)}', {mentions}), IS_AFTER({at}, DATEADD(TODAY(), -14, 'days')))`,
            sort: [{ field: 'at', direction: 'desc' }],
            max: 30,
          }),
        )
      : undefined,
  ]);

  const instName = new Map((instRows ?? []).map((r) => [r.id, str(r.fields.name)]));

  const schools: School[] | undefined = instRows?.map((r) => ({
    id: r.id,
    name: str(r.fields.name),
    type: str(r.fields.type),
    conference: str(r.fields.conference),
    tier: str(r.fields.tier),
    core: num(r.fields.core_sample_count),
    page_public: r.fields.page_public === true,
    floor_crossed_on: str(r.fields.floor_crossed_on),
  })).sort((a, b) => b.core - a.core || a.name.localeCompare(b.name));

  const contacts: Contact[] | undefined = contactRows
    ?.filter((r) => str(r.fields.name).trim() && !/^test\b/i.test(str(r.fields.name)))
    .map((r) => readLead(r, seeContact, instName));

  const leadName = new Map((contacts ?? []).map((c) => [c.id, c.name]));
  const mentions: Mention[] | undefined = mentionRows?.map((r) => {
    const a = readActivity(r);
    return { ...a, lead_name: leadName.get(a.lead) || 'A lead' };
  });

  const allowedAgents = new Set(ROLE_REPORT_AGENTS[user.role]);
  const reports: Report[] | undefined = reportRows
    ?.filter((r) => allowedAgents.has(str(r.fields.agent)))
    .map((r) => ({ id: r.id, title: str(r.fields.title), date: str(r.fields.report_date), agent: str(r.fields.agent), status: str(r.fields.status), body: str(r.fields.body) }));

  const decisions: Decision[] | undefined = decisionRows
    ?.map((r: AirtableRecord) => ({
      id: r.id,
      code: str(r.fields.code),
      decision: str(r.fields.decision),
      area: str(r.fields.area),
      status: str(r.fields.status),
      outcome: str(r.fields.outcome),
      opened_on: str(r.fields.opened_on),
      decided_on: str(r.fields.decided_on),
    }))
    .sort((a, b) => (a.status === b.status ? Number(a.code.slice(3)) - Number(b.code.slice(3)) : a.status === 'Open' ? -1 : 1));

  const agents: Agent[] | undefined = agentRows?.map((r) => ({
    id: r.id,
    agent: str(r.fields.agent),
    sort: num(r.fields.sort),
    discipline: str(r.fields.discipline),
    heat: str(r.fields.heat),
    build_status: str(r.fields.build_status),
    schedule: str(r.fields.schedule),
    focus: str(r.fields.focus),
  }));

  // Today tiles, in a fixed order, only for what this person may see.
  const t = today();
  const tiles: Tile[] = [];
  if (contacts) {
    const open = contacts.filter((c) => !CLOSED_STAGES.includes(c.stage));
    const mine = ownerFor(user.name);
    const queue = open.filter((c) => !mine || c.owner === mine);
    const due = queue.filter((c) => c.stage !== 'Replied' && c.next_action_due && c.next_action_due <= t).length;
    const replies = queue.filter((c) => c.stage === 'Replied').length;
    tiles.push({ key: 'queue', label: 'In my queue', value: String(due + replies), note: due + replies ? `${due} due or overdue, ${replies} replies waiting` : 'all clear', go: 'queue', tone: due + replies ? 'warn' : 'ok' });
    tiles.push({ key: 'pipeline', label: 'Open leads', value: String(open.length), note: 'across both brands', go: 'pipeline', tone: 'neutral' });
    tiles.push({ key: 'meetings', label: 'Meetings booked', value: String(contacts.filter((c) => c.stage === 'Meeting Booked').length), go: 'pipeline', tone: 'neutral' });
    tiles.push({ key: 'won', label: 'Closed won', value: String(contacts.filter((c) => c.stage === 'Closed Won').length), go: 'pipeline', tone: 'neutral' });
  }
  if (inquiryRows) {
    const fresh = inquiryRows.filter((r) => str(r.fields.status) === 'New' || !r.fields.status).length;
    tiles.push({ key: 'inquiries', label: 'New inquiries', value: String(fresh), note: 'from rolaglobal.com', go: 'pipeline', tone: fresh ? 'warn' : 'neutral' });
  }
  if (schools) {
    const core = schools.reduce((s, x) => s + x.core, 0);
    const atFloor = schools.filter((s) => s.core >= SAMPLE_FLOOR).length;
    const next = schools.find((s) => s.core < SAMPLE_FLOOR && s.core > 0);
    tiles.push({ key: 'core', label: 'Athletes in core sample', value: String(core), note: 'consented, adult, $5K+ NIL', go: 'schools', tone: 'neutral' });
    tiles.push({
      key: 'floor',
      label: 'Schools at the 10 floor',
      value: String(atFloor),
      note: next ? `next: ${next.name} at ${next.core} of ${SAMPLE_FLOOR}` : 'no school is close yet',
      go: 'schools',
      tone: atFloor ? 'ok' : 'neutral',
    });
  }
  if (decisions) {
    const open = decisions.filter((d) => d.status === 'Open').length;
    tiles.push({ key: 'decisions', label: 'Decisions waiting', value: String(open), go: 'decisions', tone: open ? 'warn' : 'ok' });
  }
  if (reports) {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const recent = reports.filter((r) => r.date >= weekAgo);
    const failed = recent.filter((r) => r.status === 'Failed').length;
    tiles.push({ key: 'reports', label: 'Agent reports this week', value: String(recent.length), note: failed ? `${failed} failed` : undefined, go: 'reports', tone: failed ? 'bad' : 'neutral' });
  }

  const data: OsData = { user, generatedAt: new Date().toISOString(), tiles, contacts, mentions, schools, reports, decisions, agents, errors };
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
