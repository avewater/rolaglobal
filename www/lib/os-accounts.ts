import 'server-only';
import { OS_TABLES, getRecord, list, str, type AirtableRecord } from './os-airtable';
import { CHANNELS, effectivePerms, isRole, type Account, type Item, type OsUser } from './os-roles';

export const ACCOUNT_READ = ['name', 'account_type', 'brand', 'title', 'organization', 'email', 'phone', 'linkedin', 'instagram', 'x', 'tiktok', 'website', 'about', 'lead_rec', 'owner_name', 'created_by'];
export const ITEM_READ = ['title', 'account_rec', 'kind', 'body', 'due_date', 'due_time', 'status', 'assignee_rec', 'assignee_name', 'created_by', 'created_by_rec', 'channel', 'to_name', 'subject', 'done_at', 'done_by'];

export function readAccount(r: AirtableRecord): Account {
  const f = r.fields;
  return {
    id: r.id,
    name: str(f.name),
    account_type: str(f.account_type),
    brand: str(f.brand) || 'ROLA Global',
    title: str(f.title),
    organization: str(f.organization),
    email: str(f.email),
    phone: str(f.phone),
    linkedin: str(f.linkedin),
    instagram: str(f.instagram),
    x: str(f.x),
    tiktok: str(f.tiktok),
    website: str(f.website),
    about: str(f.about),
    lead: str(f.lead_rec) || list(f.lead)[0] || '',
    owner_name: str(f.owner_name),
    created_by: str(f.created_by),
    created: r.createdTime,
  };
}

export function readItem(r: AirtableRecord): Item {
  const f = r.fields;
  const k = str(f.kind);
  const st = str(f.status);
  return {
    id: r.id,
    account: str(f.account_rec) || list(f.account)[0] || '',
    kind: k === 'Message' ? 'Message' : k === 'Update' ? 'Update' : 'Entry',
    title: str(f.title),
    body: str(f.body),
    channel: str(f.channel),
    to_name: str(f.to_name),
    subject: str(f.subject),
    due_date: str(f.due_date),
    due_time: str(f.due_time),
    status: st === 'Done' || st === 'Sent' ? st : 'Open',
    assignee: str(f.assignee_rec),
    assignee_name: str(f.assignee_name),
    created_by: str(f.created_by),
    created_by_rec: str(f.created_by_rec),
    done_at: str(f.done_at),
    done_by: str(f.done_by),
    created: r.createdTime,
  };
}


const t = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export class Refuse extends Error {
  status: number;
  code?: string;
  constructor(msg: string, status = 400, code?: string) {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

// Turns posted values into Airtable fields for an item. Updates carry no date.
export function itemFields(src: any, kind: 'Entry' | 'Message' | 'Update') {
  const out: Record<string, unknown> = {};
  out.body = typeof src.body === 'string' ? src.body.slice(0, 10000) : '';
  if (kind === 'Update') {
    if (!String(out.body).trim()) throw new Refuse('Write the update first.');
    out.title = String(out.body).trim().split('\n')[0].slice(0, 120);
    return out;
  }
  out.due_date = isDate(src.due_date) ? src.due_date : null;
  out.due_time = out.due_date && isTime(src.due_time) ? src.due_time : null;
  if (kind === 'Message') {
    out.channel = (CHANNELS as readonly string[]).includes(src.channel) ? src.channel : 'Email';
    out.to_name = t(src.to_name) || null;
    out.subject = t(src.subject) || null;
    out.title = t(src.subject) || (out.to_name ? `Message to ${out.to_name}` : 'Message');
    if (!String(out.body).trim()) throw new Refuse('Write the message first.');
  } else {
    out.title = t(src.title) || String(out.body).trim().split('\n')[0].slice(0, 120);
    if (!out.title) throw new Refuse('Give it a title.');
  }
  return out;
}

// Who a task goes to. Assigning to someone else needs assign_tasks, and the person
// receiving it must be active and able to open accounts.
export async function resolveAssignee(user: OsUser, wanted: unknown) {
  if (!wanted || wanted === user.id) return { assignee_rec: user.id, assignee_name: user.name };
  if (!user.perms.includes('assign_tasks')) throw new Refuse('You do not have permission to assign tasks to others.', 403);
  const rep = await getRecord(OS_TABLES.reps, String(wanted));
  if (!rep || rep.fields.active !== true || !isRole(rep.fields.os_role)) throw new Refuse('That teammate was not found.');
  const perms = effectivePerms(rep.fields.os_role, list(rep.fields.os_grant), list(rep.fields.os_revoke));
  if (!perms.includes('accounts')) throw new Refuse(`${str(rep.fields.rep_name)} does not have access to accounts, so cannot be assigned tasks.`);
  return { assignee_rec: rep.id, assignee_name: str(rep.fields.rep_name) };
}

export const accountProfileFields = (b: any, partial: boolean) => {
  const out: Record<string, unknown> = {};
  const has = (k: string) => !partial || k in b;
  const url = (v: unknown, label: string) => {
    let u = t(v, 300);
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      return new URL(u).toString();
    } catch {
      throw new Refuse(`${label} link does not look right.`);
    }
  };
  if (has('name')) {
    out.name = t(b.name, 160);
    if (!out.name) throw new Refuse('The account needs a name.');
  }
  for (const k of ['title', 'organization']) if (has(k)) out[k] = t(b[k], 160) || null;
  for (const k of ['instagram', 'x', 'tiktok']) if (has(k)) out[k] = t(b[k], 120).replace(/^@+/, '@') || null;
  if (has('phone')) out.phone = t(b.phone, 40) || null;
  if (has('email')) {
    const e = t(b.email, 200);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Refuse('That email does not look right.');
    out.email = e || null;
  }
  if (has('linkedin')) out.linkedin = url(b.linkedin, 'LinkedIn');
  if (has('website')) out.website = url(b.website, 'Website');
  if (has('about')) out.about = typeof b.about === 'string' ? b.about.slice(0, 4000) : null;
  const sel = (k: string, opts: readonly string[], fallback?: string) => {
    if (!has(k)) return;
    if (!b[k]) return void (out[k] = fallback ?? null);
    if (!opts.includes(b[k])) throw new Refuse('One of the choices is not on the list.');
    out[k] = b[k];
  };
  sel('account_type', ['Athlete', 'Athletic department', 'Collective', 'Agency', 'Professional organization', 'Nonprofit', 'Brand or sponsor', 'Other']);
  sel('brand', ['ROLA Global', 'AAVE Water'], partial ? undefined : 'ROLA Global');
  return out;
};
