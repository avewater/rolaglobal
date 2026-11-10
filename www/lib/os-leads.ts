import 'server-only';
import { OS_TABLES, createRecord, list, num, str, type AirtableRecord } from './os-airtable';
import { LEAD_STAGES, LEGACY_STAGE, OWNERS, type Activity, type Contact } from './os-roles';

export const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

export const LEAD_FIELDS = [
  'name', 'title', 'organization', 'institution', 'pipeline_stage', 'stage', 'grade', 'lead_owner', 'owner', 'source', 'lead_source', 'host_type', 'found_url', 'fit_reason', 'found_on', 'draft_subject', 'draft_message', 'notes',
  'channel', 'warm_path', 'athlete_reach', 'next_action', 'next_action_due', 'last_touch', 'stage_changed_at', 'pinned_note',
  'disposition_reason', 'do_not_contact', 'linkedin_url',
  'lane', 'rel_strength', 'current_work', 'must_mention', 'li_connected_on', 'email_consent', 'email_consent_on', 'email_consent_note',
];
export const CONTACT_FIELDS = ['email', 'phone'];

export function readLead(r: AirtableRecord, seeContact: boolean, instName?: Map<string, string>): Contact {
  const f = r.fields;
  const legacy = LEGACY_STAGE[str(f.stage)];
  const stage = str(f.pipeline_stage) || legacy || LEAD_STAGES[0];
  const oldOwner = str(f.owner);
  return {
    id: r.id,
    name: str(f.name),
    title: str(f.title),
    organization: str(f.organization),
    institution: instName ? list(f.institution).map((id) => instName.get(id) || '').filter(Boolean).join(', ') : '',
    stage,
    grade: str(f.grade),
    owner: str(f.lead_owner) || (oldOwner === 'VA' ? 'Rein' : oldOwner === 'Ladi' ? 'Hussain' : oldOwner),
    // Older rows used one "source" list that mixed channel and organization type.
    source: str(f.lead_source) || ({ 'Inbound form': 'Inbound form', Referral: 'Referral', LinkedIn: 'LinkedIn', Event: 'Event' } as Record<string, string>)[str(f.source)] || '',
    host_type: str(f.host_type) || ({ SAAC: 'SAAC', Collective: 'Collective', AD: 'Athletic department', Program: 'Sports management program' } as Record<string, string>)[str(f.source)] || '',
    found_url: str(f.found_url),
    fit_reason: str(f.fit_reason),
    found_on: str(f.found_on),
    draft_subject: str(f.draft_subject),
    draft_message: str(f.draft_message),
    notes: str(f.notes),
    channel: str(f.channel),
    warm_path: str(f.warm_path),
    athlete_reach: num(f.athlete_reach),
    next_action: str(f.next_action),
    next_action_due: str(f.next_action_due),
    last_touch: str(f.last_touch),
    stage_changed_at: str(f.stage_changed_at),
    pinned_note: str(f.pinned_note),
    disposition_reason: str(f.disposition_reason),
    dnc: f.do_not_contact === true || stage === 'Do Not Contact',
    linkedin_url: str(f.linkedin_url),
    lane: str(f.lane) || (str(f.li_connected_on) ? 'A' : 'B'),
    rel_strength: str(f.rel_strength),
    current_work: str(f.current_work),
    must_mention: str(f.must_mention),
    li_connected_on: str(f.li_connected_on),
    email_consent: f.email_consent === true,
    email_consent_on: str(f.email_consent_on),
    email_consent_note: str(f.email_consent_note),
    ...(seeContact ? { email: str(f.email), phone: str(f.phone) } : {}),
  };
}

export function readActivity(r: AirtableRecord): Activity {
  const f = r.fields;
  return {
    id: r.id,
    type: str(f.type),
    summary: str(f.summary),
    body: str(f.body),
    by: str(f.by),
    at: str(f.at) || r.createdTime,
    from_stage: str(f.from_stage),
    to_stage: str(f.to_stage),
    mentions: str(f.mentions),
    lead: str(f.lead_rec),
  };
}

// @Rein, @michael -> "Rein, Michael". Only team names count.
export function parseMentions(text: string) {
  const found = new Set<string>();
  for (const m of text.matchAll(/@([A-Za-z]+)/g)) {
    const o = OWNERS.find((x) => x.toLowerCase() === m[1].toLowerCase());
    if (o) found.add(o);
  }
  return [...found].join(', ');
}

export async function logActivity(
  leadId: string,
  a: { type: string; summary: string; body?: string; by: string; from_stage?: string; to_stage?: string; mentions?: string },
) {
  return createRecord(OS_TABLES.activity, {
    summary: a.summary.slice(0, 200),
    lead: [leadId],
    lead_rec: leadId,
    type: a.type,
    by: a.by,
    at: new Date().toISOString(),
    ...(a.body ? { body: a.body } : {}),
    ...(a.from_stage ? { from_stage: a.from_stage } : {}),
    ...(a.to_stage ? { to_stage: a.to_stage } : {}),
    ...(a.mentions ? { mentions: a.mentions } : {}),
  });
}
