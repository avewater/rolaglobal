import 'server-only';
import { str, list, type AirtableRecord } from './os-airtable';
import type { WorkItem } from './os-roles';

export const WORK_FIELDS = ['title', 'owner_rec', 'kind', 'body', 'channel', 'to_name', 'subject', 'lead_rec', 'due_date', 'due_time', 'status', 'done_at', 'created_by'];

export function readItem(r: AirtableRecord): WorkItem {
  const f = r.fields;
  const status = str(f.status);
  return {
    id: r.id,
    kind: str(f.kind) === 'Message' ? 'Message' : 'Entry',
    title: str(f.title),
    body: str(f.body),
    channel: str(f.channel),
    to_name: str(f.to_name),
    subject: str(f.subject),
    lead: str(f.lead_rec) || list(f.lead)[0] || '',
    due_date: str(f.due_date),
    due_time: str(f.due_time),
    status: status === 'Done' || status === 'Sent' ? status : 'Open',
    done_at: str(f.done_at),
    created_by: str(f.created_by),
    created: r.createdTime,
  };
}
