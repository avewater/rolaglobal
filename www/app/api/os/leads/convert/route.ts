import { NextRequest, NextResponse } from 'next/server';
import { OS_TABLES, createRecords, listAll, str } from '@/lib/os-airtable';
import { readAccount, readItem } from '@/lib/os-accounts';
import { LEAD_FIELDS, CONTACT_FIELDS, readLead, todayET } from '@/lib/os-leads';
import { can, getUser } from '@/lib/os-session';
import type { Account, Contact, Item } from '@/lib/os-roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// What kind of account a lead becomes, from its host type.
const TYPE: Record<string, string> = {
  SAAC: 'Athletic department',
  'Athletic department': 'Athletic department',
  'Campus organization': 'Athletic department',
  Collective: 'Collective',
  Agency: 'Agency',
  'Professional organization': 'Professional organization',
  Nonprofit: 'Nonprofit',
  'Sports management program': 'Other',
  Other: 'Other',
};

// Convert one or more leads into accounts in one step. Each new account gets:
// the lead's details, a first task (the lead's next action, or "Send first message" today),
// and, if the lead has a drafted first message, that draft as a message on the account.
// Leads that already have an account are skipped. The lead stays in the pipeline, linked.
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  if (!can(user, 'accounts') || !can(user, 'edit_leads')) return NextResponse.json({ error: 'Your role cannot convert leads.' }, { status: 403 });
  let b: any;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }
  const ids: string[] = Array.isArray(b.ids) ? [...new Set(b.ids.filter((x: unknown) => typeof x === 'string' && /^rec[A-Za-z0-9]{14}$/.test(x as string)))] as string[] : [];
  if (!ids.length) return NextResponse.json({ error: 'Pick at least one lead.' }, { status: 400 });
  if (ids.length > 50) return NextResponse.json({ error: 'Convert at most 50 leads at a time.' }, { status: 400 });

  try {
    const formula = `OR(${ids.map((id) => `RECORD_ID() = '${id}'`).join(',')})`;
    const [leadRows, existing] = await Promise.all([
      listAll(OS_TABLES.contacts, { fields: [...LEAD_FIELDS, ...CONTACT_FIELDS], filterByFormula: formula, max: 50 }),
      listAll(OS_TABLES.accounts, { fields: ['lead_rec'], max: 5000 }),
    ]);
    const already = new Set(existing.map((r) => str(r.fields.lead_rec)).filter(Boolean));
    const leads: Contact[] = leadRows.map((r) => readLead(r, true));
    const skipped: { name: string; why: string }[] = [];
    const todo = leads.filter((l) => {
      if (already.has(l.id)) return skipped.push({ name: l.name, why: 'already has an account' }), false;
      if (l.dnc) return skipped.push({ name: l.name, why: 'Do Not Contact' }), false;
      return true;
    });
    if (!todo.length) return NextResponse.json({ ok: true, accounts: [], items: [], skipped });

    const today = todayET();
    const accRows = await createRecords(
      OS_TABLES.accounts,
      todo.map((l) => ({
        name: l.name,
        ...(l.title ? { title: l.title } : {}),
        ...(l.organization || l.institution ? { organization: l.organization || l.institution } : {}),
        ...(l.email ? { email: l.email } : {}),
        ...(l.phone ? { phone: l.phone } : {}),
        ...(l.linkedin_url ? { linkedin: l.linkedin_url } : {}),
        ...(TYPE[l.host_type] ? { account_type: TYPE[l.host_type] } : {}),
        ...(l.fit_reason ? { about: l.fit_reason } : {}),
        lead: [l.id],
        lead_rec: l.id,
        owner_rec: user.id,
        owner_name: user.name,
        created_by: user.name,
      })),
    );
    const accounts: Account[] = accRows.map(readAccount);
    const byLead = new Map(accounts.map((a) => [a.lead, a]));

    const itemFields: Record<string, unknown>[] = [];
    for (const l of todo) {
      const a = byLead.get(l.id);
      if (!a) continue;
      const base = { account: [a.id], account_rec: a.id, created_by: user.name, created_by_rec: user.id, assignee_rec: user.id, assignee_name: user.name, status: 'Open' };
      itemFields.push({
        ...base,
        kind: 'Entry',
        title: l.next_action && l.next_action !== 'Verify and research' && l.next_action !== 'Research lead' ? l.next_action : 'Send first message',
        due_date: l.next_action_due && l.next_action_due > today ? l.next_action_due : today,
        body: l.fit_reason || '',
      });
      if (l.draft_message) {
        itemFields.push({
          ...base,
          kind: 'Message',
          channel: 'Email',
          to_name: l.name,
          ...(l.draft_subject ? { subject: l.draft_subject } : {}),
          title: l.draft_subject || `Message to ${l.name}`,
          body: l.draft_message,
        });
      }
    }
    const itemRows = itemFields.length ? await createRecords(OS_TABLES.items, itemFields) : [];
    const items: Item[] = itemRows.map(readItem);

    await createRecords(
      OS_TABLES.activity,
      todo.filter((l) => byLead.has(l.id)).map((l) => ({
        summary: 'Converted to account',
        lead: [l.id],
        lead_rec: l.id,
        type: 'Note',
        by: user.name,
        at: new Date().toISOString(),
      })),
    ).catch(() => {});

    return NextResponse.json({ ok: true, accounts, items, skipped });
  } catch (e) {
    console.error('convert', e);
    return NextResponse.json({ error: 'Could not convert. Nothing was half-saved per lead; try again and converted leads will be skipped.' }, { status: 500 });
  }
}
