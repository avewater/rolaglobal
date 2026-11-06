import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecord, getRecord, updateRecord } from '@/lib/os-airtable';

export const dynamic = 'force-dynamic';

// Two-step Research Partnership form.
// step "snapshot": saves screen 1 answers as a partial record, returns a signed token.
// step "contact": completes that record with contact details and adds the person to the pipeline.

const COUNT = ['0', '1 to 5', '6 to 20', '21 to 50', '50+', 'Not sure'];
const STRUCT = ['None', 'Some', 'Most', "Don't track"];
const TOTAL = ['Under $250K', '$250K to $1M', '$1M to $5M', '$5M+', 'Not sure'];

const VERSIONS = {
  'Athletic department': {
    audience: 'Athletic department or university',
    band_set: 'College $5K/$25K/$100K',
    roster: ['Under 100', '100 to 300', '300 to 600', '600+'],
    extra: { total_nil_band: TOTAL, rev_share: ['Yes', 'Not yet', 'Prefer not to say'] },
  },
  'Collective or agency': {
    audience: 'Collective, agency or pro org',
    band_set: 'College $5K/$25K/$100K',
    roster: ['Under 25', '25 to 100', '100 to 300', '300+'],
    extra: { total_nil_band: TOTAL, org_subtype: ['NIL collective', 'Athlete agency', 'Other'] },
  },
  'Professional organization': {
    audience: 'Collective, agency or pro org',
    band_set: 'Pro $100K/$1M/$5M',
    roster: ['Under 15', '15 to 50', '50 to 150', '150+'],
    extra: { biz_education: ['Yes', 'Not yet', 'Exploring'] },
  },
} as const;
type OrgType = keyof typeof VERSIONS;

const BAND_FIELDS = ['nil_band1_count', 'nil_band2_count', 'nil_band3_count'] as const;
const STRUCT_FIELDS = ['struct_llc', 'struct_nonprofit', 'struct_trust', 'struct_life_ins', 'struct_cpa'] as const;

const clip = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n);
const pick = (v: unknown, allowed: readonly string[]) => {
  const s = clip(v, 60);
  return allowed.includes(s) ? s : null;
};
const todayLA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

function sign(id: string) {
  const s = process.env.OS_SESSION_SECRET || '';
  return crypto.createHmac('sha256', s).update(`inquiry:${id}`).digest('base64url');
}
function tokenOk(id: string, token: string) {
  const a = Buffer.from(sign(id));
  const b = Buffer.from(String(token || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function snapshotFields(b: Record<string, unknown>) {
  const org = clip(b.org_type, 40) as OrgType;
  const v = VERSIONS[org];
  if (!v) return { error: 'Choose who you represent.' };
  const roster = pick(b.roster_size, v.roster);
  if (!roster) return { error: 'Choose your roster size.' };
  const f: Record<string, unknown> = {
    org_type: org,
    audience_path: v.audience,
    band_set: v.band_set,
    roster_size: roster,
    form_stage: 'Snapshot only',
    status: 'New',
    source_utm: clip(b.utm, 300) || 'direct',
    submitted_at: new Date().toISOString(),
  };
  for (const k of BAND_FIELDS) {
    const x = pick(b[k], COUNT);
    if (!x) return { error: 'Answer each income row.' };
    f[k] = x;
  }
  for (const k of STRUCT_FIELDS) {
    const x = pick(b[k], STRUCT);
    if (!x) return { error: 'Answer each structure row.' };
    f[k] = x;
  }
  for (const [k, allowed] of Object.entries(v.extra)) {
    const x = pick(b[k], allowed as readonly string[]);
    if (x) f[k] = x;
    else if (k === 'org_subtype') return { error: 'Choose what best describes you.' };
  }
  return { fields: f, org };
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: 'The form could not be read. Try again.' }, { status: 400 });
  }
  if (clip(b.website)) return NextResponse.json({ ok: true, id: 'rec0', token: 'x' });

  try {
    if (b.step === 'snapshot') {
      const s = snapshotFields(b);
      if ('error' in s) return NextResponse.json({ error: s.error }, { status: 400 });
      const rec = await createRecord(OS_TABLES.inquiries, { ...s.fields, inquiry: `${s.org} · snapshot · ${todayLA()}` });
      return NextResponse.json({ ok: true, id: rec.id, token: sign(rec.id) });
    }

    if (b.step === 'contact') {
      const name = clip(b.name, 120);
      const org = clip(b.organization, 160);
      const email = clip(b.email, 160);
      const role = clip(b.role, 80);
      const phone = clip(b.phone, 40);
      if (!name || !org || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Name, organization and a valid work email are required.' }, { status: 400 });
      }

      const contactFields: Record<string, unknown> = {
        contact_name: name,
        organization: org,
        email,
        contact_role: role,
        form_stage: 'Complete',
        inquiry: `${org} · ${name} · ${todayLA()}`,
        ...(phone ? { phone } : {}),
      };

      let recId = clip(b.id, 20);
      let snap: Record<string, unknown> | null = null;
      if (recId && tokenOk(recId, clip(b.token, 100))) {
        const rec = await getRecord(OS_TABLES.inquiries, recId);
        if (rec) {
          snap = rec.fields;
          await updateRecord(OS_TABLES.inquiries, recId, contactFields);
        } else recId = '';
      } else recId = '';

      if (!recId) {
        // Snapshot save failed earlier: store everything in one record now.
        const s = snapshotFields(b);
        const base = 'error' in s ? { status: 'New', submitted_at: new Date().toISOString() } : s.fields;
        snap = base;
        await createRecord(OS_TABLES.inquiries, { ...base, ...contactFields });
      }

      const summary = [
        `Org type: ${snap?.org_type ?? 'Not given'}${snap?.org_subtype ? ` (${snap.org_subtype})` : ''}`,
        `Roster: ${snap?.roster_size ?? 'Not given'}`,
        `Income bands (${snap?.band_set ?? ''}): ${snap?.nil_band1_count ?? '?'} / ${snap?.nil_band2_count ?? '?'} / ${snap?.nil_band3_count ?? '?'}`,
        `LLC ${snap?.struct_llc ?? '?'} · Nonprofit ${snap?.struct_nonprofit ?? '?'} · Trust ${snap?.struct_trust ?? '?'} · Life insurance ${snap?.struct_life_ins ?? '?'} · CPA ${snap?.struct_cpa ?? '?'}`,
        snap?.total_nil_band ? `Total NIL: ${snap.total_nil_band}` : '',
        snap?.rev_share ? `Revenue share: ${snap.rev_share}` : '',
        snap?.biz_education ? `Business education: ${snap.biz_education}` : '',
        role ? `Role: ${role}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      await createRecord(OS_TABLES.contacts, {
        name,
        title: [role, org].filter(Boolean).join(', '),
        organization: org,
        channel: 'Email',
        pipeline_stage: 'Replied',
        lead_source: 'Inbound form',
        lead_owner: 'Michael',
        stage_changed_at: todayLA(),
        next_action: 'Send private briefing',
        next_action_due: todayLA(),
        email,
        ...(phone ? { phone } : {}),
        notes: summary,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown step.' }, { status: 400 });
  } catch (e) {
    console.error('inquiry', e);
    return NextResponse.json({ error: 'We could not save your answers. Try again in a minute.' }, { status: 500 });
  }
}
