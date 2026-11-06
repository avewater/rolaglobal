'use client';

// The CRM half of ROLA OS: My Queue, the 12-stage pipeline (board and list), the lead drawer and CSV import.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CLOSED_STAGES,
  DISPOSITION_REASONS,
  GRADES,
  LEAD_STAGES,
  LOG_TYPES,
  OWNERS,
  REASON_STAGES,
  SOURCES,
  HOST_TYPES,
  isOpenStage,
  ownerFor,
  type Account,
  type Activity,
  type Contact,
  type Mention,
  type OsUser,
} from '@/lib/os-roles';

export const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
export const fmtDate = (d: string) => {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
};

export class ApiError extends Error {
  code?: string;
  constructor(msg: string, code?: string) {
    super(msg);
    this.code = code;
  }
}
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let json: any = {};
  try {
    json = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(json.error || 'Something went wrong. Try again.', json.code);
  return json as T;
}

export type Crm = {
  user: OsUser;
  leads: Contact[];
  mentions: Mention[];
  canEdit: boolean;
  canImport: boolean;
  patch: (l: Contact) => void;
  add: (l: Contact) => void;
  open: (id: string) => void;
  move: (l: Contact, stage: string) => void;
  notify: (msg: string) => void;
  reload: () => void;
  accountFor?: (leadId: string) => Account | undefined;
  toAccount?: (lead: Contact, existing?: Account) => void;
};

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  return <span className={`aos-pill aos-pill-${tone}`}>{children}</span>;
}
const stageTone = (s: string) => (s === 'Closed Won' ? 'ok' : s === 'Do Not Contact' || s === 'Closed Lost' ? 'bad' : s === 'Replied' || s === 'Meeting Booked' ? 'warn' : 'neutral');

function CopyBtn({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="aos-chip"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

const store = {
  get(k: string) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {}
  },
};

/* ---------------- My Queue ---------------- */

export function Queue({ crm }: { crm: Crm }) {
  const me = ownerFor(crm.user.name);
  const [scope, setScope] = useState<'mine' | 'all'>(me ? 'mine' : 'all');
  const t = todayET();
  const pool = crm.leads.filter((l) => isOpenStage(l.stage) && (scope === 'all' || l.owner === me));
  const byDue = (a: Contact, b: Contact) => (a.next_action_due || '9999').localeCompare(b.next_action_due || '9999');
  const isFound = (l: Contact) => l.source === 'Online lead' && l.stage === 'New';
  const overdue = pool.filter((l) => l.next_action_due && l.next_action_due < t && l.stage !== 'Replied' && !isFound(l)).sort(byDue);
  const dueToday = pool.filter((l) => l.next_action_due === t && l.stage !== 'Replied' && !isFound(l));
  const replies = pool.filter((l) => l.stage === 'Replied').sort(byDue);
  const missing = pool.filter((l) => !l.next_action || !l.next_action_due);
  const found = pool.filter(isFound);

  const Row = ({ l }: { l: Contact }) => (
    <button className="aos-row aos-row-btn" onClick={() => crm.open(l.id)}>
      <span className="aos-row-head">
        <span className="aos-row-title">{l.name}</span>
        <Pill tone={stageTone(l.stage)}>{l.stage}</Pill>
      </span>
      <span className="aos-muted aos-small">{[l.organization || l.institution, l.title].filter(Boolean).join(' · ')}</span>
      <span className="aos-small">
        {l.next_action || 'No next action'}
        {l.next_action_due && <> · <span className={l.next_action_due < t ? 'aos-due' : 'aos-muted'}>{fmtDate(l.next_action_due)}</span></>}
        {scope === 'all' && l.owner && <span className="aos-muted"> · {l.owner}</span>}
      </span>
    </button>
  );
  const Group = ({ title, items, empty }: { title: string; items: Contact[]; empty: string }) => (
    <section className="aos-stack">
      <div className="aos-eyebrow">{title} <span className="aos-count">{items.length}</span></div>
      {items.length ? items.map((l) => <Row key={l.id} l={l} />) : <p className="aos-muted aos-small">{empty}</p>}
    </section>
  );

  return (
    <div className="aos-stack-lg">
      <div className="aos-toolbar">
        <div className="aos-seg" role="group" aria-label="Whose queue">
          <button aria-pressed={scope === 'mine'} onClick={() => setScope('mine')} disabled={!me}>Mine</button>
          <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Everyone</button>
        </div>
      </div>
      <Group title="Replies waiting" items={replies} empty="No replies waiting." />
      {found.length > 0 && <Group title="New online leads to verify" items={found} empty="" />}
      <Group title="Overdue" items={overdue} empty="Nothing overdue." />
      <Group title="Due today" items={dueToday} empty="Nothing else due today." />
      {missing.length > 0 && <Group title="Missing a next action" items={missing} empty="" />}
      {me && (
        <section className="aos-stack">
          <div className="aos-eyebrow">Mentions, last 14 days <span className="aos-count">{crm.mentions.length}</span></div>
          {crm.mentions.length ? (
            crm.mentions.map((m) => (
              <button key={m.id} className="aos-row aos-row-btn" onClick={() => crm.open(m.lead)}>
                <span className="aos-row-head">
                  <span className="aos-row-title">{m.lead_name}</span>
                  <span className="aos-muted aos-small">{fmtWhen(m.at)}</span>
                </span>
                <span className="aos-small">{m.by}: {m.body || m.summary}</span>
              </button>
            ))
          ) : (
            <p className="aos-muted aos-small">Nobody has mentioned you. Type @{me} in a comment to tag someone.</p>
          )}
        </section>
      )}
    </div>
  );
}

/* ---------------- Pipeline ---------------- */

type SortKey = 'name' | 'organization' | 'stage' | 'grade' | 'owner' | 'next_action_due' | 'last_touch';

export function Pipeline({ crm }: { crm: Crm }) {
  const [view, setView] = useState<'board' | 'list'>(() => (typeof window !== 'undefined' && (store.get('os.view') as 'board' | 'list')) || 'board');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'next_action_due', dir: 1 });
  const [adding, setAdding] = useState(false);
  const [over, setOver] = useState('');
  const t = todayET();

  useEffect(() => store.set('os.view', view), [view]);

  const leads = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return crm.leads.filter(
      (l) =>
        (!owner || l.owner === owner) &&
        (!source || l.source === source) &&
        (!needle || [l.name, l.organization, l.institution, l.title, l.email].some((v) => (v || '').toLowerCase().includes(needle))),
    );
  }, [crm.leads, owner, source, q]);

  const stages = showClosed ? LEAD_STAGES : LEAD_STAGES.filter((s) => !CLOSED_STAGES.includes(s));
  const closedCount = leads.filter((l) => CLOSED_STAGES.includes(l.stage)).length;

  const sorted = useMemo(() => {
    const order = (l: Contact) => (sort.k === 'stage' ? String(LEAD_STAGES.indexOf(l.stage as any)).padStart(2, '0') : String((l as any)[sort.k] || (sort.dir === 1 ? '￿' : '')));
    return [...leads].filter((l) => showClosed || !CLOSED_STAGES.includes(l.stage)).sort((a, b) => order(a).localeCompare(order(b)) * sort.dir);
  }, [leads, sort, showClosed]);

  const head = (k: SortKey, label: string) => (
    <th aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((s) => ({ k, dir: s.k === k ? ((s.dir * -1) as 1 | -1) : 1 }))}>
        {label}
        {sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  return (
    <div className="aos-stack">
      <div className="aos-toolbar">
        <div className="aos-seg" role="group" aria-label="View">
          <button aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
        </div>
        <input className="aos-input aos-search" type="search" placeholder="Search name, organization, email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
        <select className="aos-input" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {SOURCES.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className="aos-input" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">All owners</option>
          {OWNERS.map((o) => <option key={o}>{o}</option>)}
        </select>
        <label className="aos-check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Closed ({closedCount})
        </label>
        {crm.canEdit && <button className="aos-btn aos-btn-sm" onClick={() => setAdding(true)}>New lead</button>}
      </div>

      {!crm.leads.length && <p className="aos-muted">No leads yet. {crm.canImport ? 'Use Import to bring in the Master Pipeline, or add one with New lead.' : 'Add one with New lead.'}</p>}

      {view === 'board' ? (
        <div className="aos-board aos-board-12" style={{ gridTemplateColumns: `repeat(${stages.length}, 240px)` }}>
          {stages.map((stage) => {
            const items = leads.filter((l) => l.stage === stage).sort((a, b) => (a.next_action_due || '9999').localeCompare(b.next_action_due || '9999'));
            return (
              <section
                key={stage}
                className={`aos-col${over === stage ? ' aos-col-over' : ''}`}
                onDragOver={(e) => {
                  if (!crm.canEdit) return;
                  e.preventDefault();
                  setOver(stage);
                }}
                onDragLeave={() => setOver((o) => (o === stage ? '' : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver('');
                  const id = e.dataTransfer.getData('text/plain');
                  const l = crm.leads.find((x) => x.id === id);
                  if (l && l.stage !== stage) crm.move(l, stage);
                }}
              >
                <div className="aos-col-head">
                  <span>{stage}</span>
                  <span className="aos-count">{items.length}</span>
                </div>
                {items.map((l) => (
                  <article
                    key={l.id}
                    className="aos-card aos-card-btn"
                    draggable={crm.canEdit}
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', l.id)}
                    onClick={() => crm.open(l.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && crm.open(l.id)}
                  >
                    <div className="aos-row-head">
                      <span className="aos-row-title">{l.name}</span>
                      {l.grade && <span className="aos-grade">{l.grade}</span>}
                    </div>
                    <div className="aos-muted aos-small">{[l.organization || l.institution, l.title].filter(Boolean).join(' · ')}</div>
                    {l.next_action && isOpenStage(l.stage) && (
                      <div className="aos-small">
                        {l.next_action}
                        {l.next_action_due && <> · <span className={l.next_action_due <= t ? 'aos-due' : 'aos-muted'}>{fmtDate(l.next_action_due)}</span></>}
                      </div>
                    )}
                    {l.disposition_reason && !isOpenStage(l.stage) && <div className="aos-small aos-muted">{l.disposition_reason}</div>}
                    <div className="aos-chips">
                      {l.owner && <Pill>{l.owner}</Pill>}
                      {l.dnc && <Pill tone="bad">Do not contact</Pill>}
                      {l.pinned_note && <Pill tone="warn">Note</Pill>}
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="aos-table-wrap">
          <table className="aos-table">
            <thead>
              <tr>
                {head('name', 'Name')}
                {head('organization', 'Organization')}
                {head('stage', 'Stage')}
                {head('grade', 'Grade')}
                {head('owner', 'Owner')}
                <th>Next action</th>
                {head('next_action_due', 'Due')}
                {head('last_touch', 'Last touch')}
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id} onClick={() => crm.open(l.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && crm.open(l.id)}>
                  <td className="aos-row-title">{l.name}</td>
                  <td>{l.organization || l.institution}</td>
                  <td><Pill tone={stageTone(l.stage)}>{l.stage}</Pill></td>
                  <td>{l.grade}</td>
                  <td>{l.owner}</td>
                  <td>{isOpenStage(l.stage) ? l.next_action : l.disposition_reason}</td>
                  <td className={isOpenStage(l.stage) && l.next_action_due && l.next_action_due <= t ? 'aos-due' : ''}>{fmtDate(l.next_action_due)}</td>
                  <td>{fmtDate(l.last_touch)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sorted.length && crm.leads.length > 0 && <p className="aos-muted aos-small">No leads match.</p>}
        </div>
      )}
      {crm.canEdit && <p className="aos-muted aos-small">Drag a card to change its stage, or open it. Closing a lead or marking Do Not Contact asks for a reason.</p>}
      {adding && <NewLead crm={crm} onClose={() => setAdding(false)} />}
    </div>
  );
}

/* ---------------- Move dialog: reason and next action rules ---------------- */

export function MoveDialog({ lead, stage, onDone, onCancel, notify }: { lead: Contact; stage: string; onDone: (l: Contact) => void; onCancel: () => void; notify: (m: string) => void }) {
  const needReason = REASON_STAGES.includes(stage);
  const open = isOpenStage(stage);
  const [reason, setReason] = useState('');
  const [na, setNa] = useState(lead.next_action);
  const [due, setDue] = useState(lead.next_action_due || todayET());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ lead: Contact }>(`/api/os/lead/${lead.id}`, { action: 'stage', stage, reason, next_action: na, next_action_due: due, note: note || undefined });
      notify(`${lead.name} moved to ${stage}.`);
      onDone(r.lead);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };
  return (
    <Modal title={`Move to ${stage}`} onClose={onCancel}>
      <form className="aos-stack" onSubmit={submit}>
        <p className="aos-muted aos-small">{lead.name}{lead.organization ? `, ${lead.organization}` : ''}: {lead.stage} to {stage}</p>
        {stage === 'Do Not Contact' && <p className="aos-warnbox">Do Not Contact is a hard block. Nobody can log outreach to this person again unless an admin moves them out.</p>}
        {needReason && (
          <fieldset className="aos-fieldset">
            <legend className="aos-eyebrow">Reason (required)</legend>
            <div className="aos-chips">
              {DISPOSITION_REASONS.map((r) => (
                <button type="button" key={r} className="aos-chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>
              ))}
            </div>
          </fieldset>
        )}
        {open && (
          <div className="aos-grid2">
            <label className="aos-field">
              <span>Next action</span>
              <input className="aos-input" value={na} onChange={(e) => setNa(e.target.value)} required maxLength={200} />
            </label>
            <label className="aos-field">
              <span>Date</span>
              <input className="aos-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
            </label>
          </div>
        )}
        <label className="aos-field">
          <span>Note (optional, goes in the timeline)</span>
          <textarea className="aos-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
        {err && <p className="aos-error">{err}</p>}
        <div className="aos-actions">
          <button type="button" className="aos-ghost" onClick={onCancel}>Cancel</button>
          <button className="aos-btn" disabled={busy || (needReason && !reason) || (open && (!na.trim() || !due))}>{busy ? 'Saving' : `Move to ${stage}`}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="aos-modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="aos-modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="aos-row-head">
          <h2 className="aos-h3">{title}</h2>
          <button className="aos-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- New lead ---------------- */

function NewLead({ crm, onClose }: { crm: Crm; onClose: () => void }) {
  const me = ownerFor(crm.user.name);
  const [f, setF] = useState({ name: '', organization: '', title: '', email: '', grade: '', source: '', host_type: '', warm_path: '', owner: me || 'Michael', next_action: 'Research lead', next_action_due: todayET() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ lead: Contact }>('/api/os/lead', f);
      crm.add(r.lead);
      crm.notify(`${r.lead.name} added.`);
      onClose();
      crm.open(r.lead.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };
  return (
    <Modal title="New lead" onClose={onClose}>
      <form className="aos-stack" onSubmit={submit}>
        <div className="aos-grid2">
          <label className="aos-field"><span>Name</span><input className="aos-input" value={f.name} onChange={set('name')} required autoFocus /></label>
          <label className="aos-field"><span>Organization</span><input className="aos-input" value={f.organization} onChange={set('organization')} /></label>
          <label className="aos-field"><span>Title</span><input className="aos-input" value={f.title} onChange={set('title')} /></label>
          {crm.user.perms.includes('see_contact') && <label className="aos-field"><span>Email</span><input className="aos-input" type="email" value={f.email} onChange={set('email')} /></label>}
          <Sel label="Owner" value={f.owner} onChange={set('owner')} opts={OWNERS} />
          <Sel label="Grade" value={f.grade} onChange={set('grade')} opts={GRADES} blank />
          <Sel label="Source" value={f.source} onChange={set('source')} opts={SOURCES} blank />
          <Sel label="Host type" value={f.host_type} onChange={set('host_type')} opts={HOST_TYPES} blank />
          <Sel label="Host type" value={f.host_type} onChange={set('host_type')} opts={HOST_TYPES} blank />
          <label className="aos-field"><span>{f.source === 'Referral' ? 'Referred by' : 'Warm path'}</span><input className="aos-input" value={f.warm_path} onChange={set('warm_path')} placeholder={f.source === 'Referral' ? 'Who referred them' : 'Who can introduce us'} /></label>
          <label className="aos-field"><span>Next action</span><input className="aos-input" value={f.next_action} onChange={set('next_action')} required /></label>
          <label className="aos-field"><span>Date</span><input className="aos-input" type="date" value={f.next_action_due} onChange={set('next_action_due')} required /></label>
        </div>
        {err && <p className="aos-error">{err}</p>}
        <div className="aos-actions">
          <button type="button" className="aos-ghost" onClick={onClose}>Cancel</button>
          <button className="aos-btn" disabled={busy || !f.name.trim()}>{busy ? 'Saving' : 'Add lead'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Sel({ label, value, onChange, opts, blank }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; opts: readonly string[]; blank?: boolean }) {
  return (
    <label className="aos-field">
      <span>{label}</span>
      <select className="aos-input" value={value} onChange={onChange}>
        {blank && <option value="">None</option>}
        {opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
}

/* ---------------- Lead drawer ---------------- */

export function LeadDrawer({ id, crm, onClose }: { id: string; crm: Crm; onClose: () => void }) {
  const [lead, setLead] = useState<Contact | null>(crm.leads.find((l) => l.id === id) ?? null);
  const [acts, setActs] = useState<Activity[] | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const t = todayET();

  const load = async () => {
    try {
      const r = await api<{ lead: Contact; activity: Activity[] }>(`/api/os/lead/${id}`);
      setLead(r.lead);
      setActs(r.activity);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load.');
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // Keep the drawer in step when the board changes the same lead.
  const fromList = crm.leads.find((l) => l.id === id);
  useEffect(() => {
    if (fromList && lead && fromList.stage !== lead.stage) {
      setLead({ ...lead, ...fromList });
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromList?.stage]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const after = (l: Contact, a?: Activity) => {
    setLead(l);
    crm.patch(l);
    load();
    if (a) setActs((x) => [a, ...(x ?? [])]);
  };

  const log = async (type: string, body = '') => {
    if (!lead) return;
    setBusy(type);
    try {
      const r = await api<{ lead: Contact; activity: Activity }>('/api/os/activity', { lead: lead.id, type, body });
      after(r.lead);
      if (type === 'Comment') setComment('');
      crm.notify(type === 'Comment' ? 'Comment posted.' : type === 'Reply received' && r.lead.stage === 'Replied' ? 'Reply logged. Lead moved to Replied.' : `${type.replace(' logged', '')} logged.`);
    } catch (e) {
      crm.notify(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="aos-drawer-wrap" onClick={onClose}>
      <aside className="aos-drawer" role="dialog" aria-modal="true" aria-label={lead?.name || 'Lead'} onClick={(e) => e.stopPropagation()}>
        <div className="aos-row-head">
          <div className="aos-eyebrow">Lead</div>
          <button className="aos-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {!lead ? (
          <p className="aos-muted">{err || 'Loading'}</p>
        ) : (
          <div className="aos-stack-lg">
            <header className="aos-stack">
              <h2 className="aos-h2">{lead.name}</h2>
              <div className="aos-muted">{[lead.title, lead.organization || lead.institution].filter(Boolean).join(' · ')}</div>
              <div className="aos-chips">
                <Pill tone={stageTone(lead.stage)}>{lead.stage}</Pill>
                {lead.grade && <Pill>Grade {lead.grade}</Pill>}
                {lead.owner && <Pill>{lead.owner}</Pill>}
                {lead.source && <Pill tone={lead.source === 'Online lead' ? 'warn' : 'neutral'}>{lead.source}</Pill>}
                {lead.host_type && <Pill>{lead.host_type}</Pill>}
                {lead.dnc && <Pill tone="bad">Do not contact</Pill>}
                {lead.disposition_reason && !isOpenStage(lead.stage) && <Pill>{lead.disposition_reason}</Pill>}
              </div>
              {lead.pinned_note && <div className="aos-pinned"><span className="aos-eyebrow">Pinned</span><div className="aos-body">{lead.pinned_note}</div></div>}
            </header>

            {isOpenStage(lead.stage) && (
              <div className={`aos-next${lead.next_action_due && lead.next_action_due <= t ? ' aos-next-due' : ''}`}>
                <span className="aos-eyebrow">Next action</span>
                <div>{lead.next_action || 'None set'}{lead.next_action_due && <> · {fmtDate(lead.next_action_due)}</>}</div>
              </div>
            )}

            {crm.canEdit && (
              <section className="aos-stack">
                <div className="aos-eyebrow">Stage</div>
                <div className="aos-toolbar">
                  <select className="aos-input" value={lead.stage} onChange={(e) => crm.move(lead, e.target.value)} aria-label="Stage">
                    {LEAD_STAGES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                  {lead.stage !== 'Closed Won' && <button className="aos-ghost" onClick={() => crm.move(lead, 'Closed Won')}>Closed won</button>}
                  {lead.stage !== 'Closed Lost' && <button className="aos-ghost" onClick={() => crm.move(lead, 'Closed Lost')}>Closed lost</button>}
                  {!lead.dnc && <button className="aos-ghost aos-ghost-bad" onClick={() => crm.move(lead, 'Do Not Contact')}>Do not contact</button>}
                </div>
              </section>
            )}

            {crm.canEdit && (
              <section className="aos-stack">
                <div className="aos-eyebrow">Quick log</div>
                <div className="aos-chips">
                  {LOG_TYPES.map((tp) => (
                    <button key={tp} className="aos-chip aos-chip-lg" disabled={!!busy || (lead.dnc && tp !== 'Reply received')} onClick={() => log(tp)}>
                      {busy === tp ? 'Saving' : tp === 'Email logged' ? 'Logged email' : tp === 'LinkedIn logged' ? 'Logged LinkedIn message' : tp === 'Call logged' ? 'Logged call' : 'Reply received'}
                    </button>
                  ))}
                </div>
                {lead.dnc && <p className="aos-muted aos-small">Outreach logging is off for Do Not Contact leads.</p>}
              </section>
            )}

            {crm.toAccount && (
              <section className="aos-stack">
                <div className="aos-eyebrow">Account</div>
                {(() => {
                  const acc = crm.accountFor?.(lead.id);
                  return acc ? (
                    <button className="aos-chip aos-chip-lg aos-self-start" onClick={() => crm.toAccount!(lead, acc)}>Open account: {acc.name}</button>
                  ) : (
                    <>
                      <button className="aos-chip aos-chip-lg aos-self-start" onClick={() => crm.toAccount!(lead)}>Create account from this lead</button>
                      <span className="aos-small aos-muted">Tasks, notes and message drafts live in accounts.</span>
                    </>
                  );
                })()}
              </section>
            )}

            {lead.draft_message && (
              <section className="aos-stack">
                <div className="aos-eyebrow">Drafted first message</div>
                <div className="aos-draft">
                  {lead.draft_subject && <div className="aos-row-title">{lead.draft_subject}</div>}
                  <div className="aos-body aos-small">{lead.draft_message.split('{my_name}').join(crm.user.name.split(' ')[0])}</div>
                </div>
                <div className="aos-chips">
                  <CopyBtn value={[lead.draft_subject ? `Subject: ${lead.draft_subject}` : '', lead.draft_message.split('{my_name}').join(crm.user.name.split(' ')[0])].filter(Boolean).join('\n\n')} label="Copy message" />
                  {lead.grade === 'A' && <Pill tone="warn">Grade A: Michael approves before sending</Pill>}
                </div>
              </section>
            )}

            <section className="aos-stack">
              <div className="aos-eyebrow">Contact</div>
              {lead.source === 'Online lead' && lead.stage === 'New' && <p className="aos-notebox aos-small">Found online by the lead finder. Open the source page and confirm the person, title and contact details before moving this lead forward.</p>}
              <div className="aos-chips">
                {lead.email && <CopyBtn value={lead.email} label={`Copy ${lead.email}`} />}
                {lead.phone && <CopyBtn value={lead.phone} label={`Copy ${lead.phone}`} />}
                {lead.linkedin_url && !lead.dnc && <a className="aos-chip" href={lead.linkedin_url} target="_blank" rel="noopener noreferrer">Open LinkedIn</a>}
                {!lead.email && !lead.phone && !lead.linkedin_url && <span className="aos-muted aos-small">No contact details yet.</span>}
              </div>
              <dl className="aos-dl">
                {lead.warm_path && <><dt>{lead.source === 'Referral' ? 'Referred by' : 'Warm path'}</dt><dd>{lead.warm_path}</dd></>}
                {lead.fit_reason && <><dt>Why they fit</dt><dd>{lead.fit_reason}</dd></>}
                {lead.notes && <><dt>Research notes</dt><dd className="aos-body">{lead.notes}</dd></>}
                {lead.found_url && <><dt>Found at</dt><dd><a href={lead.found_url} target="_blank" rel="noopener noreferrer">{(() => { try { return new URL(lead.found_url).hostname.replace(/^www\./, ''); } catch { return 'Source page'; } })()}</a>{lead.found_on ? ` on ${fmtDate(lead.found_on)}` : ''}</dd></>}
                {lead.athlete_reach > 0 && <><dt>Athlete reach</dt><dd>{lead.athlete_reach.toLocaleString()}</dd></>}
                {lead.last_touch && <><dt>Last touch</dt><dd>{fmtDate(lead.last_touch)}</dd></>}
                {lead.stage_changed_at && <><dt>In stage since</dt><dd>{fmtDate(lead.stage_changed_at)}</dd></>}
              </dl>
              {crm.canEdit && <button className="aos-ghost aos-self-start" onClick={() => setEdit(true)}>Edit details</button>}
            </section>

            {crm.canEdit && (
              <section className="aos-stack">
                <div className="aos-eyebrow">Comment</div>
                <textarea className="aos-input" rows={3} placeholder="Write a note for the team. Type @Rein or @Michael to tag someone." value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />
                <button className="aos-btn aos-btn-sm aos-self-start" disabled={!comment.trim() || !!busy} onClick={() => log('Comment', comment)}>{busy === 'Comment' ? 'Posting' : 'Post comment'}</button>
              </section>
            )}

            <section className="aos-stack">
              <div className="aos-eyebrow">Timeline</div>
              {acts === null && <p className="aos-muted aos-small">Loading</p>}
              {acts?.length === 0 && <p className="aos-muted aos-small">Nothing yet.</p>}
              <ol className="aos-timeline">
                {acts?.map((a) => (
                  <li key={a.id} className={`aos-tl-${a.type.split(' ')[0].toLowerCase()}`}>
                    <div className="aos-row-head">
                      <span className="aos-small"><strong>{a.type === 'Comment' ? a.by : a.summary}</strong></span>
                      <span className="aos-muted aos-small">{fmtWhen(a.at)}</span>
                    </div>
                    {a.type === 'Comment' ? <div className="aos-body aos-small">{a.body}</div> : a.body ? <div className="aos-body aos-small aos-muted">{a.body}</div> : null}
                    {a.type !== 'Comment' && <div className="aos-muted aos-small">{a.by}</div>}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </aside>
      {edit && lead && <EditLead lead={lead} crm={crm} onClose={() => setEdit(false)} onSaved={(l) => { after(l); setEdit(false); }} />}
    </div>
  );
}

function EditLead({ lead, crm, onClose, onSaved }: { lead: Contact; crm: Crm; onClose: () => void; onSaved: (l: Contact) => void }) {
  const init = {
    name: lead.name, title: lead.title, organization: lead.organization, owner: lead.owner, grade: lead.grade, source: lead.source, host_type: lead.host_type, fit_reason: lead.fit_reason, draft_subject: lead.draft_subject, draft_message: lead.draft_message,
    warm_path: lead.warm_path, athlete_reach: lead.athlete_reach ? String(lead.athlete_reach) : '', next_action: lead.next_action,
    next_action_due: lead.next_action_due, linkedin_url: lead.linkedin_url, email: lead.email ?? '', phone: lead.phone ?? '', pinned_note: lead.pinned_note,
  };
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const seeContact = crm.user.perms.includes('see_contact');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== (init as any)[k]));
    if (!Object.keys(changed).length) return onClose();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ lead: Contact }>(`/api/os/lead/${lead.id}`, { action: 'update', fields: changed });
      crm.notify('Saved.');
      onSaved(r.lead);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };
  const open = isOpenStage(lead.stage);
  return (
    <Modal title="Edit lead" onClose={onClose}>
      <form className="aos-stack" onSubmit={submit}>
        <div className="aos-grid2">
          <label className="aos-field"><span>Name</span><input className="aos-input" value={f.name} onChange={set('name')} required /></label>
          <label className="aos-field"><span>Title</span><input className="aos-input" value={f.title} onChange={set('title')} /></label>
          <label className="aos-field"><span>Organization</span><input className="aos-input" value={f.organization} onChange={set('organization')} /></label>
          <Sel label="Owner" value={f.owner} onChange={set('owner')} opts={OWNERS} blank />
          <Sel label="Grade" value={f.grade} onChange={set('grade')} opts={GRADES} blank />
          <Sel label="Source" value={f.source} onChange={set('source')} opts={SOURCES} blank />
          <label className="aos-field"><span>Athlete reach (estimate)</span><input className="aos-input" inputMode="numeric" value={f.athlete_reach} onChange={set('athlete_reach')} /></label>
          <label className="aos-field aos-span2"><span>{f.source === 'Referral' ? 'Referred by' : 'Warm path'}</span><input className="aos-input" value={f.warm_path} onChange={set('warm_path')} placeholder={f.source === 'Referral' ? 'Who referred them, and how they know them' : 'Who can introduce us, and how'} /></label>
          <label className="aos-field aos-span2"><span>Why they fit</span><textarea className="aos-input" rows={2} value={f.fit_reason} onChange={set('fit_reason')} maxLength={2000} /></label>
          <label className="aos-field aos-span2"><span>First message subject</span><input className="aos-input" value={f.draft_subject} onChange={set('draft_subject')} maxLength={200} /></label>
          <label className="aos-field aos-span2"><span>First message (sign it {'{my_name}'} and it fills in your name when copied)</span><textarea className="aos-input" rows={6} value={f.draft_message} onChange={set('draft_message')} maxLength={4000} /></label>
          <label className="aos-field"><span>Next action{open ? ' (required)' : ''}</span><input className="aos-input" value={f.next_action} onChange={set('next_action')} required={open} /></label>
          <label className="aos-field"><span>Date{open ? ' (required)' : ''}</span><input className="aos-input" type="date" value={f.next_action_due} onChange={set('next_action_due')} required={open} /></label>
          {seeContact && <label className="aos-field"><span>Email</span><input className="aos-input" type="email" value={f.email} onChange={set('email')} /></label>}
          {seeContact && <label className="aos-field"><span>Phone</span><input className="aos-input" value={f.phone} onChange={set('phone')} /></label>}
          <label className="aos-field aos-span2"><span>LinkedIn profile</span><input className="aos-input" type="url" value={f.linkedin_url} onChange={set('linkedin_url')} placeholder="https://www.linkedin.com/in/..." /></label>
          <label className="aos-field aos-span2"><span>Pinned note</span><textarea className="aos-input" rows={3} value={f.pinned_note} onChange={set('pinned_note')} placeholder="The one thing anyone opening this lead should know" /></label>
        </div>
        <p className="aos-muted aos-small">No passwords, athlete personal data or signed agreements in lead records.</p>
        {err && <p className="aos-error">{err}</p>}
        <div className="aos-actions">
          <button type="button" className="aos-ghost" onClick={onClose}>Cancel</button>
          <button className="aos-btn" disabled={busy}>{busy ? 'Saving' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- CSV import ---------------- */

const FIELDS: { key: string; label: string; match: string[] }[] = [
  { key: 'name', label: 'Name', match: ['name', 'contact', 'contact name', 'full name', 'lead', 'person', 'lead name'] },
  { key: 'organization', label: 'Organization', match: ['organization', 'org', 'school', 'institution', 'company', 'program', 'team', 'university'] },
  { key: 'title', label: 'Title', match: ['title', 'role', 'position', 'job title'] },
  { key: 'email', label: 'Email', match: ['email', 'e-mail', 'email address', 'work email'] },
  { key: 'phone', label: 'Phone', match: ['phone', 'phone number', 'mobile', 'cell'] },
  { key: 'linkedin_url', label: 'LinkedIn', match: ['linkedin', 'linkedin url', 'linkedin profile', 'li url'] },
  { key: 'stage', label: 'Stage', match: ['stage', 'status', 'pipeline stage'] },
  { key: 'grade', label: 'Grade', match: ['grade', 'priority', 'lead grade'] },
  { key: 'source', label: 'Source', match: ['source', 'lead source', 'channel'] },
  { key: 'host_type', label: 'Host type', match: ['host type', 'type', 'org type', 'organization type', 'category'] },
  { key: 'owner', label: 'Owner', match: ['owner', 'assigned', 'assigned to', 'rep'] },
  { key: 'warm_path', label: 'Warm path', match: ['warm path', 'warm intro', 'intro', 'connection', 'mutual'] },
  { key: 'athlete_reach', label: 'Athlete reach', match: ['athlete reach', 'reach', 'athletes', '# athletes', 'athlete count'] },
  { key: 'next_action', label: 'Next action', match: ['next action', 'next step', 'next'] },
  { key: 'next_action_due', label: 'Next action date', match: ['next action date', 'due', 'due date', 'next date', 'follow up date', 'follow-up date'] },
  { key: 'notes', label: 'Notes', match: ['notes', 'note', 'comments'] },
  { key: 'do_not_contact', label: 'Do not contact', match: ['do not contact', 'dnc'] },
  { key: 'disposition_reason', label: 'Reason', match: ['reason', 'disposition', 'disposition reason'] },
];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const toIso = (v: string) => {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return '';
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
};

export function ImportView({ crm }: { crm: Crm }) {
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [check, setCheck] = useState<{ would_create: number; skipped: { row: number; name: string; why: string }[] } | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: { row: number; name: string; why: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const headers = rows[0] ?? [];
  const body = rows.slice(1);

  const load = (text: string, name: string) => {
    const r = parseCsv(text);
    setRows(r);
    setFileName(name);
    setCheck(null);
    setDone(null);
    setErr('');
    const h = (r[0] ?? []).map((x) => x.trim().toLowerCase());
    const m: Record<string, number> = {};
    for (const f of FIELDS) {
      const i = h.findIndex((x) => f.match.includes(x));
      if (i >= 0 && !Object.values(m).includes(i)) m[f.key] = i;
    }
    setMap(m);
  };

  const payload = () =>
    body.map((r) => {
      const o: Record<string, string> = {};
      for (const [k, i] of Object.entries(map)) if (i >= 0) o[k] = (r[i] ?? '').trim();
      if (o.next_action_due) o.next_action_due = toIso(o.next_action_due);
      return o;
    });

  const run = async (dry: boolean) => {
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/os/import', { rows: payload(), dry_run: dry });
      if (dry) setCheck(r);
      else {
        setDone(r);
        setCheck(null);
        crm.notify(`${r.created} imported.`);
        crm.reload();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aos-stack-lg">
      <p className="aos-muted">Bring in the Master Pipeline and the Priority Board as CSV (in Google Sheets: File, Download, Comma-separated values). Rows with an email or a name and organization already in the OS are skipped, so running a file twice is safe.</p>
      <div className="aos-toolbar">
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text(), f.name); e.target.value = ''; }} />
        <button className="aos-btn aos-btn-sm" onClick={() => fileRef.current?.click()}>Choose CSV</button>
        {fileName && <span className="aos-small">{fileName}: {body.length} rows</span>}
      </div>

      {headers.length > 0 && (
        <section className="aos-stack">
          <div className="aos-eyebrow">Match columns</div>
          <div className="aos-map">
            {FIELDS.map((f) => (
              <label key={f.key} className="aos-field">
                <span>{f.label}{f.key === 'name' ? ' (required)' : ''}</span>
                <select className="aos-input" value={map[f.key] ?? -1} onChange={(e) => { setMap((m) => ({ ...m, [f.key]: Number(e.target.value) })); setCheck(null); }}>
                  <option value={-1}>Not in this file</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {body.length > 0 && (
            <div className="aos-table-wrap">
              <table className="aos-table aos-table-static">
                <thead><tr>{FIELDS.filter((f) => (map[f.key] ?? -1) >= 0).map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
                <tbody>
                  {payload().slice(0, 5).map((r, i) => (
                    <tr key={i}>{FIELDS.filter((f) => (map[f.key] ?? -1) >= 0).map((f) => <td key={f.key}>{r[f.key]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <p className="aos-muted aos-small">First 5 rows. Missing next actions become "Research lead" due today. Missing owners go to Rein. Rows marked Do Not Contact stay Do Not Contact.</p>
            </div>
          )}
          {err && <p className="aos-error">{err}</p>}
          <div className="aos-actions aos-actions-start">
            <button className="aos-ghost" disabled={busy || (map.name ?? -1) < 0} onClick={() => run(true)}>{busy && !check ? 'Checking' : 'Check for duplicates'}</button>
            {check && <button className="aos-btn" disabled={busy || !check.would_create} onClick={() => run(false)}>{busy ? 'Importing' : `Import ${check.would_create} ${check.would_create === 1 ? 'lead' : 'leads'}`}</button>}
          </div>
          {(check || done) && (
            <div className="aos-stack">
              <p>{done ? `${done.created} imported.` : `${check!.would_create} new ${check!.would_create === 1 ? 'lead' : 'leads'} ready.`} {(done ?? check)!.skipped.length} skipped.</p>
              {(done ?? check)!.skipped.length > 0 && (
                <ul className="aos-skips">
                  {(done ?? check)!.skipped.slice(0, 50).map((s, i) => <li key={i} className="aos-small"><span className="aos-muted">Row {s.row}:</span> {s.name}, {s.why}</li>)}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
