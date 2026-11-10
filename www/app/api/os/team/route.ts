import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, listAll, str } from '@/lib/os-airtable';
import { can, getUser } from '@/lib/os-session';
import { LEAD_STAGES, isOpenStage } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const TZ = 'America/Los_Angeles';

// Admin-only productivity report: end of day (today), end of week (Monday to now) and last week, Pacific time.
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
function ptMidnight(day: string) {
  // UTC instant of 00:00 Pacific on `day` (handles PST and PDT).
  const guess = new Date(`${day}T08:00:00Z`);
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(guess));
  return new Date(guess.getTime() - h * 3600e3);
}
function range(kind: string) {
  const now = new Date();
  const today = ymd(now);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((dow + 6) % 7));
  const mon = monday.toISOString().slice(0, 10);
  if (kind === 'week') return { start: ptMidnight(mon), end: now, label: `This week (since Monday ${mon})` };
  if (kind === 'lastweek') {
    const prev = new Date(`${mon}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 7);
    return { start: ptMidnight(prev.toISOString().slice(0, 10)), end: ptMidnight(mon), label: `Last week (from Monday ${prev.toISOString().slice(0, 10)})` };
  }
  return { start: ptMidnight(today), end: now, label: `Today (${today})` };
}

type Row = Record<string, number>;
const METRICS = ['accounts', 'tasks_done', 'added', 'sent', 'updates', 'stage_moves', 'outreach_logged', 'replies', 'comments', 'triaged'] as const;

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  if (!can(user, 'manage_team')) return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
  const r = range(req.nextUrl.searchParams.get('range') || 'today');
  const s = r.start.toISOString();
  const inRange = (iso: string) => !!iso && iso >= s && iso < r.end.toISOString();
  const since = `IS_AFTER(CREATED_TIME(), '${s}')`;

  const [accounts, items, acts, contacts, conns] = await Promise.all([
    listAll(OS_TABLES.accounts, { fields: ['name', 'organization', 'account_type', 'created_by'], max: 20000 }),
    listAll(OS_TABLES.items, { fields: ['kind', 'title', 'due_date', 'status', 'created_by', 'done_at', 'done_by', 'touch'], filterByFormula: `IS_AFTER(LAST_MODIFIED_TIME(), '${s}')`, max: 5000 }),
    listAll(OS_TABLES.activity, { fields: ['type', 'by', 'at'], filterByFormula: since, max: 5000 }),
    listAll(OS_TABLES.contacts, { fields: ['pipeline_stage', 'stage', 'lead_source', 'do_not_contact'], max: 20000 }),
    listAll(OS_TABLES.connections, { fields: ['triage', 'triaged_by', 'triaged_at'], max: 20000 }).catch(() => []),
  ]);

  const people: Record<string, Row> = {};
  const bump = (who: string, k: (typeof METRICS)[number]) => {
    const name = who || 'Unknown';
    people[name] ??= Object.fromEntries(METRICS.map((m) => [m, 0]));
    people[name][k]++;
  };

  const newAccounts = accounts.filter((a) => inRange(a.createdTime));
  newAccounts.forEach((a) => bump(str(a.fields.created_by), 'accounts'));
  for (const it of items) {
    const f = it.fields;
    const kind = str(f.kind);
    if (inRange(it.createdTime)) {
      if (kind === 'Update') bump(str(f.created_by), 'updates');
      else if (kind === 'Entry') bump(str(f.created_by), 'added');
    }
    if (inRange(str(f.done_at))) {
      if (str(f.status) === 'Sent') bump(str(f.done_by), 'sent');
      else if (str(f.status) === 'Done' && kind === 'Entry') bump(str(f.done_by), 'tasks_done');
    }
  }
  for (const a of acts) {
    const at = str(a.fields.at) || a.createdTime;
    if (!inRange(at)) continue;
    const t = str(a.fields.type);
    const by = str(a.fields.by);
    if (t === 'Stage change') bump(by, 'stage_moves');
    else if (t === 'Email logged' || t === 'LinkedIn logged' || t === 'Call logged') bump(by, 'outreach_logged');
    else if (t === 'Reply received') bump(by, 'replies');
    else if (t === 'Comment') bump(by, 'comments');
  }
  // Triage dates are stored as days, so count them when the day falls in the range.
  const startDay = ymd(r.start), endDay = ymd(new Date(r.end.getTime() - 1));
  for (const c of conns) {
    const d = str(c.fields.triaged_at);
    if (d && d >= startDay && d <= endDay && str(c.fields.triage) !== 'Untriaged') bump(str(c.fields.triaged_by), 'triaged');
  }

  const stageOf = (f: Record<string, unknown>) => str(f.pipeline_stage) || 'New';
  const byStage = Object.fromEntries(LEAD_STAGES.map((st) => [st, 0]));
  contacts.forEach((c) => { const st = stageOf(c.fields); if (st in byStage) byStage[st]++; });
  const newLeads = contacts.filter((c) => inRange(c.createdTime));

  return NextResponse.json({
    label: r.label,
    totals: {
      accounts: accounts.length,
      accounts_new: newAccounts.length,
      leads: contacts.length,
      leads_open: contacts.filter((c) => isOpenStage(stageOf(c.fields))).length,
      leads_new: newLeads.length,
      online_leads_new: newLeads.filter((c) => str(c.fields.lead_source) === 'Online lead').length,
    },
    byStage,
    people: Object.entries(people).map(([name, m]) => ({ ...m, name }) as Row & { name: string }).sort((a, b) => b.accounts - a.accounts || a.name.localeCompare(b.name)),
    newAccounts: newAccounts
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
      .slice(0, 300)
      .map((a) => ({ id: a.id, name: str(a.fields.name), organization: str(a.fields.organization), type: str(a.fields.account_type), by: str(a.fields.created_by), at: a.createdTime })),
  });
}
