'use client';

// My Workspace (tasks, notes, message drafts) and the staff profile form.
import { useMemo, useState } from 'react';
import { ApiError, Modal, api, fmtDate } from './crm';
import { CHANNELS, PROFILE_KEYS, itemLabel, profileComplete, type Contact, type OsUser, type Profile, type Teammate, type WorkItem } from '@/lib/os-roles';

// Dates here are the person's own calendar day, from their device.
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const fmtTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const when = (i: WorkItem) => (i.due_date ? `${fmtDate(i.due_date)}${i.due_time ? `, ${fmtTime(i.due_time)}` : ''}` : '');

export type Ws = {
  user: OsUser;
  items: WorkItem[];
  setItems: (fn: (xs: WorkItem[]) => WorkItem[]) => void;
  leads: Contact[];
  team: Teammate[];
  notify: (m: string) => void;
  patchLead: (l: Contact) => void;
  openLead: (id: string) => void;
};

type Tab = 'today' | 'upcoming' | 'undated' | 'done';

export function Workspace({ ws }: { ws: Ws }) {
  const [tab, setTab] = useState<Tab>('today');
  const [editing, setEditing] = useState<{ kind: 'Entry' | 'Message'; item?: WorkItem } | null>(null);
  const today = localToday();
  const open = ws.items.filter((i) => i.status === 'Open');
  const byWhen = (a: WorkItem, b: WorkItem) => `${a.due_date}${a.due_time || '99'}`.localeCompare(`${b.due_date}${b.due_time || '99'}`);
  const groups: Record<Tab, WorkItem[]> = {
    today: open.filter((i) => i.due_date && i.due_date <= today).sort(byWhen),
    upcoming: open.filter((i) => i.due_date && i.due_date > today).sort(byWhen),
    undated: open.filter((i) => !i.due_date).sort((a, b) => b.created.localeCompare(a.created)),
    done: ws.items.filter((i) => i.status !== 'Open').sort((a, b) => b.done_at.localeCompare(a.done_at)),
  };
  const tabs: { k: Tab; label: string }[] = [
    { k: 'today', label: 'Today' },
    { k: 'upcoming', label: 'Scheduled' },
    { k: 'undated', label: 'Notes and drafts' },
    { k: 'done', label: 'Done' },
  ];
  const empty: Record<Tab, string> = {
    today: 'Nothing due today. Anything with today’s date or earlier shows here.',
    upcoming: 'Nothing scheduled. Give a task or message a future date and it waits here until its day.',
    undated: 'No notes or drafts. Anything saved without a date lives here.',
    done: 'Finished tasks and sent messages from the last 30 days show here.',
  };

  return (
    <div className="aos-stack-lg">
      {!profileComplete(ws.user.profile) && (
        <div className="aos-banner">Your profile is missing your title, email or phone. <a href="#account">Finish it in Account.</a></div>
      )}
      <div className="aos-toolbar">
        <button className="aos-btn aos-btn-sm" onClick={() => setEditing({ kind: 'Entry' })}>New task or note</button>
        <button className="aos-ghost" onClick={() => setEditing({ kind: 'Message' })}>New message</button>
      </div>
      <div className="aos-seg" role="tablist" aria-label="Workspace views">
        {tabs.map((x) => (
          <button key={x.k} role="tab" aria-selected={tab === x.k} aria-pressed={tab === x.k} onClick={() => setTab(x.k)}>
            {x.label} <span className="aos-count">{groups[x.k].length}</span>
          </button>
        ))}
      </div>
      <div className="aos-stack">
        {groups[tab].length === 0 && <p className="aos-muted aos-small">{empty[tab]}</p>}
        {groups[tab].map((i) => (
          <ItemCard key={i.id} item={i} ws={ws} today={today} onEdit={() => setEditing({ kind: i.kind, item: i })} />
        ))}
      </div>
      <p className="aos-muted aos-small">
        Give an item today’s date and it is due today. Give it a later date and it is scheduled for that day. Leave the date off and it is saved as a note or a draft, not a task. ROLA OS never sends messages for you: when a message is due, copy it, send it yourself, then click Mark sent.
      </p>
      {editing && <ItemEditor ws={ws} kind={editing.kind} item={editing.item} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function ItemCard({ item, ws, today, onEdit, compact }: { item: WorkItem; ws: Ws; today: string; onEdit?: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const lead = item.lead ? ws.leads.find((l) => l.id === item.lead) : undefined;
  const overdue = item.status === 'Open' && item.due_date && item.due_date < today;
  const act = async (action: string) => {
    if (action === 'delete' && !window.confirm('Delete this item?')) return;
    setBusy(action);
    try {
      const r = await api<{ item?: WorkItem; deleted?: string; lead?: Contact }>('/api/os/workspace', { action, id: item.id });
      if (r.deleted) ws.setItems((xs) => xs.filter((x) => x.id !== r.deleted));
      else if (r.item) ws.setItems((xs) => xs.map((x) => (x.id === item.id ? r.item! : x)));
      if (r.lead) ws.patchLead(r.lead);
      ws.notify(action === 'done' ? 'Done.' : action === 'sent' ? (lead ? `Marked sent and logged on ${lead.name}.` : 'Marked sent.') : action === 'reopen' ? 'Reopened.' : 'Deleted.');
    } catch (e) {
      ws.notify(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy('');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([item.subject ? `Subject: ${item.subject}` : '', item.body].filter(Boolean).join('\n\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const mail = item.kind === 'Message' && item.channel === 'Email' && lead?.email
    ? `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(item.subject)}&body=${encodeURIComponent(item.body)}`
    : '';
  const done = item.status !== 'Open';
  return (
    <article className={`aos-row aos-item${done ? ' aos-item-done' : ''}`}>
      <div className="aos-row-head">
        <span className="aos-item-title">
          {item.kind === 'Entry' && item.due_date && (
            <input type="checkbox" className="aos-tick" checked={done} disabled={!!busy} onChange={() => act(done ? 'reopen' : 'done')} aria-label={done ? 'Mark not done' : 'Mark done'} />
          )}
          <span className="aos-row-title">{item.title}</span>
        </span>
        <span className="aos-chips">
          <span className={`aos-pill ${item.kind === 'Message' ? 'aos-pill-warn' : ''}`}>{itemLabel(item)}</span>
          {item.due_date && <span className={`aos-pill ${overdue ? 'aos-pill-bad' : ''}`}>{when(item)}</span>}
        </span>
      </div>
      {item.kind === 'Message' && (
        <div className="aos-small aos-muted">
          {[item.channel, item.to_name && `to ${item.to_name}`, item.subject && `“${item.subject}”`].filter(Boolean).join(' · ')}
        </div>
      )}
      {item.body && !compact && <div className="aos-body aos-small aos-clamp">{item.body}</div>}
      <div className="aos-chips">
        {lead && <button className="aos-chip" onClick={() => ws.openLead(lead.id)}>Lead: {lead.name}{lead.dnc ? ' (do not contact)' : ''}</button>}
        {item.created_by && item.created_by !== ws.user.name && <span className="aos-pill">From {item.created_by.split(' ')[0]}</span>}
        {item.kind === 'Message' && !done && <button className="aos-chip" onClick={copy}>{copied ? 'Copied' : 'Copy message'}</button>}
        {mail && !done && !lead?.dnc && <a className="aos-chip" href={mail}>Open in email</a>}
        {item.kind === 'Message' && !done && <button className="aos-chip" disabled={!!busy || !!lead?.dnc} onClick={() => act('sent')}>{busy === 'sent' ? 'Saving' : 'Mark sent'}</button>}
        {item.kind === 'Message' && done && <button className="aos-chip" disabled={!!busy} onClick={() => act('reopen')}>Move back to drafts</button>}
        {item.kind === 'Entry' && !item.due_date && !done && <button className="aos-chip" disabled={!!busy} onClick={() => act('done')}>Archive</button>}
        {!done && onEdit && <button className="aos-chip" onClick={onEdit}>Edit</button>}
        {!compact && <button className="aos-chip aos-chip-quiet" disabled={!!busy} onClick={() => act('delete')}>Delete</button>}
      </div>
    </article>
  );
}

type DateMode = 'none' | 'today' | 'tomorrow' | 'week' | 'pick';

export function ItemEditor({ ws, kind, item, lead, onClose }: { ws: Ws; kind: 'Entry' | 'Message'; item?: WorkItem; lead?: Contact; onClose: () => void }) {
  const today = localToday();
  const initialMode: DateMode = !item?.due_date ? (item ? 'none' : kind === 'Entry' ? 'today' : 'none') : item.due_date === today ? 'today' : item.due_date === addDays(today, 1) ? 'tomorrow' : 'pick';
  const [mode, setMode] = useState<DateMode>(initialMode);
  const [picked, setPicked] = useState(item?.due_date || addDays(today, 1));
  const [time, setTime] = useState(item?.due_time || '');
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || '');
  const [channel, setChannel] = useState(item?.channel || 'Email');
  const [toName, setToName] = useState(item?.to_name || lead?.name || '');
  const [subject, setSubject] = useState(item?.subject || '');
  const [leadId, setLeadId] = useState(item?.lead || lead?.id || '');
  const [owner, setOwner] = useState(ws.user.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [leadQ, setLeadQ] = useState('');

  const due = mode === 'none' ? '' : mode === 'today' ? today : mode === 'tomorrow' ? addDays(today, 1) : mode === 'week' ? addDays(today, 7) : picked;
  const label = itemLabel({ kind, due_date: due });
  const leadMatches = useMemo(() => {
    const q = leadQ.trim().toLowerCase();
    if (!q) return [];
    return ws.leads.filter((l) => [l.name, l.organization].some((v) => v.toLowerCase().includes(q))).slice(0, 6);
  }, [leadQ, ws.leads]);
  const chosenLead = ws.leads.find((l) => l.id === leadId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const fields = { title, body, channel, to_name: toName, subject, due_date: due || '', due_time: due ? time : '' };
    try {
      if (item) {
        const r = await api<{ item: WorkItem }>('/api/os/workspace', { action: 'update', id: item.id, fields });
        ws.setItems((xs) => xs.map((x) => (x.id === item.id ? r.item : x)));
        ws.notify('Saved.');
      } else {
        const r = await api<{ item: WorkItem; forOther?: string }>('/api/os/workspace', { action: 'create', kind, ...fields, lead: leadId || undefined, owner });
        if (!r.forOther) ws.setItems((xs) => [r.item, ...xs]);
        ws.notify(r.forOther ? `${label} added for ${r.forOther}.` : `${label} saved.`);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };

  const modes: { k: DateMode; label: string }[] = [
    { k: 'none', label: 'No date' },
    { k: 'today', label: 'Today' },
    { k: 'tomorrow', label: 'Tomorrow' },
    { k: 'week', label: 'In a week' },
    { k: 'pick', label: 'Pick a date' },
  ];

  return (
    <Modal title={item ? `Edit ${label.toLowerCase()}` : kind === 'Message' ? 'New message' : 'New task or note'} onClose={onClose}>
      <form className="aos-stack" onSubmit={submit}>
        {kind === 'Message' ? (
          <>
            <div className="aos-grid2">
              <label className="aos-field">
                <span>Channel</span>
                <select className="aos-input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {CHANNELS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="aos-field"><span>To</span><input className="aos-input" value={toName} onChange={(e) => setToName(e.target.value)} placeholder="Name" /></label>
            </div>
            {channel === 'Email' && <label className="aos-field"><span>Subject</span><input className="aos-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /></label>}
            <label className="aos-field"><span>Message</span><textarea className="aos-input" rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} autoFocus={!item} /></label>
          </>
        ) : (
          <>
            <label className="aos-field"><span>Title</span><input className="aos-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus={!item} placeholder="What needs doing, or what to remember" /></label>
            <label className="aos-field"><span>Details (optional)</span><textarea className="aos-input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} /></label>
          </>
        )}

        <fieldset className="aos-fieldset">
          <legend className="aos-eyebrow">When</legend>
          <div className="aos-chips">
            {modes.map((m) => (
              <button type="button" key={m.k} className="aos-chip" aria-pressed={mode === m.k} onClick={() => setMode(m.k)}>{m.label}</button>
            ))}
          </div>
          {mode === 'pick' && <input className="aos-input aos-self-start" type="date" value={picked} min={today} onChange={(e) => setPicked(e.target.value)} required />}
          {mode !== 'none' && (
            <label className="aos-field aos-self-start">
              <span>Time (optional)</span>
              <input className="aos-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          )}
          <p className="aos-small aos-muted">
            {mode === 'none'
              ? kind === 'Message' ? 'Saved as a draft. It stays in Notes and drafts until you date it or send it.' : 'Saved as a note on your account, not a task.'
              : `${label} for ${fmtDate(due)}${time ? `, ${fmtTime(time)}` : ''}. ${kind === 'Message' ? 'It shows in Today on that day for you to send.' : 'It shows in Today and My Queue on that day.'}`}
          </p>
        </fieldset>

        {!item && ws.leads.length > 0 && (
          <div className="aos-field">
            <span>Link to a lead (optional)</span>
            {chosenLead ? (
              <div className="aos-chips">
                <span className="aos-pill">{chosenLead.name}{chosenLead.organization ? `, ${chosenLead.organization}` : ''}</span>
                <button type="button" className="aos-chip" onClick={() => setLeadId('')}>Remove</button>
              </div>
            ) : (
              <>
                <input className="aos-input" value={leadQ} onChange={(e) => setLeadQ(e.target.value)} placeholder="Search leads by name or organization" />
                {leadMatches.length > 0 && (
                  <div className="aos-chips">
                    {leadMatches.map((l) => (
                      <button type="button" key={l.id} className="aos-chip" onClick={() => { setLeadId(l.id); setLeadQ(''); if (kind === 'Message' && !toName) setToName(l.name); }}>
                        {l.name}{l.organization ? `, ${l.organization}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {kind === 'Message' && <span className="aos-small aos-muted">When you mark a linked message sent, it is logged on the lead’s timeline.</span>}
          </div>
        )}

        {!item && ws.user.role === 'Admin' && ws.team.length > 1 && (
          <label className="aos-field">
            <span>For</span>
            <select className="aos-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
              {ws.team.map((m) => <option key={m.id} value={m.id}>{m.id === ws.user.id ? `Me (${m.name})` : m.name}</option>)}
            </select>
          </label>
        )}

        {err && <p className="aos-error">{err}</p>}
        <div className="aos-actions">
          <button type="button" className="aos-ghost" onClick={onClose}>Cancel</button>
          <button className="aos-btn" disabled={busy || (kind === 'Entry' ? !title.trim() && !body.trim() : !body.trim() && !subject.trim())}>
            {busy ? 'Saving' : `Save ${label.toLowerCase()}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Profile ---------------- */

const PROFILE_LABELS: Record<(typeof PROFILE_KEYS)[number], { label: string; placeholder?: string; type?: string }> = {
  title: { label: 'Title', placeholder: 'e.g. Outreach Coordinator' },
  email: { label: 'Work email', type: 'email' },
  phone: { label: 'Phone', type: 'tel' },
  linkedin: { label: 'LinkedIn', placeholder: 'linkedin.com/in/...' },
  instagram: { label: 'Instagram', placeholder: '@handle' },
  x: { label: 'X', placeholder: '@handle' },
  tiktok: { label: 'TikTok', placeholder: '@handle' },
  website: { label: 'Website', placeholder: 'yoursite.com' },
};

export function ProfileForm({ user, onSaved, notify }: { user: OsUser; onSaved: (u: OsUser) => void; notify: (m: string) => void }) {
  const [f, setF] = useState<Profile & { name: string }>({ name: user.name, ...user.profile });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ user: OsUser }>('/api/os/profile', f);
      onSaved(r.user);
      notify('Profile saved.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="aos-stack" onSubmit={submit}>
      <div className="aos-eyebrow">Your profile</div>
      {!profileComplete(user.profile) && <p className="aos-small aos-muted">Add your title, work email and phone so the team knows how to reach you.</p>}
      <div className="aos-grid2">
        <label className="aos-field"><span>Name</span><input className="aos-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} /></label>
        {PROFILE_KEYS.map((k) => (
          <label key={k} className="aos-field">
            <span>{PROFILE_LABELS[k].label}</span>
            <input className="aos-input" type={PROFILE_LABELS[k].type || 'text'} value={f[k]} placeholder={PROFILE_LABELS[k].placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={300} />
          </label>
        ))}
      </div>
      <p className="aos-small aos-muted">Your role, access and passkey are managed by Michael. Never put passwords here.</p>
      {err && <p className="aos-error">{err}</p>}
      <button className="aos-btn aos-self-start" disabled={busy}>{busy ? 'Saving' : 'Save profile'}</button>
    </form>
  );
}
