import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecord } from '@/lib/os-airtable';

export const dynamic = 'force-dynamic';

const AUDIENCE: Record<string, string> = {
  athletic_dept: 'Athletic department or university',
  agent: 'Collective, agency or pro org',
  pro_org: 'Collective, agency or pro org',
  other: 'Researcher, journalist or industry',
};
const LABEL: Record<string, Record<string, string>> = {
  role: { athletic_dept: 'Athletic department or NIL collective', agent: 'Sports agent or player manager', pro_org: 'Professional sports organization', other: 'Other' },
  edu: { formal: 'Yes, formal program', informal: 'Yes, informally', building: 'No, actively building', none: 'No, not yet' },
  challenge: {
    deal_flow: 'Insufficient brand deal pipeline',
    readiness: 'Athlete business readiness',
    compliance: 'Compliance and risk management',
    recruiting: 'Recruiting and retention differentiation',
    systems: 'No scalable systems or infrastructure',
  },
  timeline: { now: 'Immediately', quarter: 'Within 90 days', exploring: 'Exploring options' },
};

const clip = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n);
const money = (v: unknown) => {
  const n = Number(v) || 0;
  return n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;
};
const todayLA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: 'The form could not be read. Try again.' }, { status: 400 });
  }
  // Bots fill the hidden website field. Pretend success and store nothing.
  if (clip(b.website)) return NextResponse.json({ ok: true });

  const first = clip(b.fn, 80);
  const last = clip(b.ln, 80);
  const org = clip(b.org, 160);
  const email = clip(b.em, 160);
  if (!first || !last || !org || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Name, organization and a valid email are required.' }, { status: 400 });
  }
  const role = clip(b.role, 40);
  const phone = clip(b.ph, 40);
  const name = `${first} ${last}`;

  const message = [
    `Role: ${LABEL.role[role] || role || 'Not given'}`,
    `Athletes in program: ${clip(b.athletes, 20) || 'Not given'}`,
    `Current annual NIL revenue: ${money(b.curr)}`,
    `12-month NIL target: ${money(b.targ)}`,
    `Business education today: ${LABEL.edu[clip(b.edu, 20)] || 'Not given'}`,
    `Biggest challenge: ${LABEL.challenge[clip(b.challenge, 20)] || 'Not given'}`,
    `Timeline: ${LABEL.timeline[clip(b.timeline, 20)] || 'Not given'}`,
    phone ? `Phone: ${phone}` : '',
    clip(b.ref) ? `Heard about ROLA from: ${clip(b.ref)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const source = [clip(b.utm, 300), clip(b.ref) ? `ref=${clip(b.ref)}` : ''].filter(Boolean).join(' | ');

  try {
    await createRecord(OS_TABLES.inquiries, {
      inquiry: `${org} · ${name} · ${todayLA()}`,
      audience_path: AUDIENCE[role] || AUDIENCE.other,
      contact_name: name,
      organization: org,
      email,
      message,
      source_utm: source || 'direct',
      status: 'New',
      submitted_at: new Date().toISOString(),
    });
    // Put the person straight into the pipeline so Michael sees them on Today.
    await createRecord(OS_TABLES.contacts, {
      name,
      title: org,
      channel: 'Email',
      stage: 'Response received',
      owner: 'Michael',
      next_action: 'Reply to research partnership request',
      next_action_due: todayLA(),
      email,
      ...(phone ? { phone } : {}),
      notes: message,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('inquiry', e);
    return NextResponse.json({ error: 'We could not save your request. Try again in a minute.' }, { status: 500 });
  }
}
