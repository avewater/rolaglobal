import 'server-only';

// ROLA OS base. Tables are addressed by ID so a rename in Airtable never breaks the app.
export const OS_TABLES = {
  reps: 'tbl5yj9sITpnlRWeR',
  reports: 'tblgmxZVp11rI0A0b',
  agents: 'tblimMd5T14VGVNLM',
  decisions: 'tblCJcXDAcv4SxQeB',
  institutions: 'tblWw3Dk76wYEijNu',
  contacts: 'tbltk2nmj13U6fz5V',
  inquiries: 'tbltNDu34zkYb86gA',
  athletes: 'tblZIj9HNAE4Sgq2m',
} as const;

export type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> };

export function airtableConnected() {
  return Boolean(process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID);
}

function base() {
  const key = process.env.AIRTABLE_API_KEY;
  const id = process.env.AIRTABLE_BASE_ID;
  if (!key || !id) throw new Error('Airtable is not connected. Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in Vercel.');
  return { key, url: `${process.env.AIRTABLE_API_URL || 'https://api.airtable.com/v0'}/${id}` };
}

async function call(path: string, init: RequestInit = {}, retried = false): Promise<any> {
  const { key, url } = base();
  const res = await fetch(`${url}/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (res.status === 429 && !retried) {
    await new Promise((r) => setTimeout(r, 1200));
    return call(path, init, true);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status} on ${path.split('?')[0]}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Escape user text placed inside a formula string.
export function formulaString(v: string) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export async function listAll(
  table: string,
  opts: { fields?: string[]; filterByFormula?: string; sort?: { field: string; direction?: 'asc' | 'desc' }[]; max?: number } = {},
): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = [];
  const max = opts.max ?? 1000;
  let offset: string | undefined;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    opts.fields?.forEach((f) => q.append('fields[]', f));
    if (opts.filterByFormula) q.set('filterByFormula', opts.filterByFormula);
    opts.sort?.forEach((s, i) => {
      q.set(`sort[${i}][field]`, s.field);
      q.set(`sort[${i}][direction]`, s.direction ?? 'asc');
    });
    if (offset) q.set('offset', offset);
    const page = await call(`${table}?${q.toString()}`);
    out.push(...page.records);
    offset = page.offset;
  } while (offset && out.length < max);
  return out.slice(0, max);
}

export async function getRecord(table: string, id: string): Promise<AirtableRecord | null> {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return null;
  try {
    return await call(`${table}/${id}`);
  } catch {
    return null;
  }
}

// typecast stays false: a select option that does not exist yet is refused, never invented.
export async function createRecord(table: string, fields: Record<string, unknown>): Promise<AirtableRecord> {
  return call(table, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: false }) }).then((r) => r.records[0]);
}

export async function updateRecord(table: string, id: string, fields: Record<string, unknown>): Promise<AirtableRecord> {
  return call(table, { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields }], typecast: false }) }).then((r) => r.records[0]);
}

// Small readers that tolerate missing or oddly typed cells.
export const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v));
export const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
export const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []);
