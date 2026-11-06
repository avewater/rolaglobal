'use client';

// Accounts (customer profiles) and everything inside them: tasks, notes, messages, updates.
// Rules: tasks only exist inside an account; a task with no date is saved as a note;
// no account is created without its first task.
import { useEffect, useMemo, useState } from 'react';
import { Modal, api, fmtDate } from './crm';
import {
  ACCOUNT_TYPES,
  BRANDS,
  CHANNELS,
  isTask,
  itemLabel,
  type Account,
  type Contact,
  type Item,
  type OsUser,
  type SectionKey,
  type Teammate,
} from '@/lib/os-roles';

/* ---------------- shared helpers ---------------- */

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
const when = (i: Pick<Item, 'due_date' | 'due_time'>) => (i.due_date ? `${fmtDate(i.due_date)}${i.due_time ? `, ${fmtTime(i.due_time)}` : ''}` : '');
const fmtStamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const byDue = (a: Item, b: Item) => `${a.due_date}${a.due_time || '99'}`.localeCompare(`${b.due_date}${b.due_time || '99'}`);
const first = (name: string) => name.split(' ')[0];

export type Acx = {
  user: OsUser;
  accounts: Account[];
  items: Item[];
  team: Teammate[];
  leads: Contact[];
  setAccounts: (fn: (xs: Account[]) => Account[]) => void;
  setItems: (fn: (xs: Item[]) => Item[]) => void;
  notify: (m: string) => void;
  go: (key: SectionKey, sub?: string) => void;
  openLead: (id: string) => void;
};
const canAssign = (cx: Acx) => cx.user.perms.includes('assign_tasks');
const isAdmin = (cx: Acx) => cx.user.role === 'Admin';
const upsert = (cx: Acx, it: Item) => cx.setItems((xs) => (xs.some((x) => x.id === it.id) ? xs.map((x) => (x.id === it.id ? it : x)) : [it, ...xs]));

function Sub<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; label: string; n?: number }[]; onChange: (v: T) => void }) {
  return (
    <label className="aos-sub">
      <span className="aos-sr">{label}</span>
      <select className="aos-input aos-sub-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.v} value={o.v}>{o.label}{o.n !== undefined ? ` (${o.n})` : ''}</option>
        ))}
      </select>
    </label>
  );
}

/* ---------------- one item row ---------------- */

export function ItemRow({ item, cx, showAccount, onEdit }: { item: Item; cx: Acx; showAccount?: boolean; onEdit?: (i: Item) => void }) {
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const today = localToday();
  const acc = cx.accounts.find((a) => a.id === item.account);
  const done = item.status !== 'Open';
  const overdue = !done && item.due_date && item.due_date < today;
  const mine = item.assignee === cx.user.id || item.created_by_rec === cx.user.id;
  const canChange = mine || isAdmin(cx);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (action === 'delete' && !window.confirm('Delete this for good?')) return;
    setBusy(action);
    try {
      const r = await api<{ item?: Item; deleted?: string }>('/api/os/items', { action, id: item.id, ...extra });
      if (r.deleted) cx.setItems((xs) => xs.filter((x) => x.id !== r.deleted));
      else if (r.item) upsert(cx, r.item);
      cx.notify(
        action === 'done' ? 'Done.' : action === 'reopen' ? 'Reopened.' : action === 'sent' ? 'Marked sent.' : action === 'unsend' ? 'Moved back to drafts.' : action === 'assign' ? `Assigned to ${first(r.item?.assignee_name || '')}.` : 'Deleted.',
      );
    } catch (e) {
      cx.notify(e instanceof Error ? e.message : 'Could not save.');
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
  const mail = item.kind === 'Message' && item.channel === 'Email' && acc?.email ? `mailto:${encodeURIComponent(acc.email)}?subject=${encodeURIComponent(item.subject)}&body=${encodeURIComponent(item.body)}` : '';

  if (item.kind === 'Update')
    return (
      <article className="aos-update">
        <div className="aos-row-head">
          <span className="aos-small"><strong>{item.created_by}</strong> posted an update{showAccount && acc ? <> on <a href={`#accounts/${acc.id}`}>{acc.name}</a></> : null}</span>
          <span className="aos-muted aos-small">{fmtStamp(item.created)}</span>
        </div>
        <div className="aos-body aos-small">{item.body}</div>
      </article>
    );

  return (
    <article className={`aos-row aos-item${done ? ' aos-item-done' : ''}`}>
      <div className="aos-row-head">
        <span className="aos-item-title">
          {isTask(item) && (
            <input type="checkbox" className="aos-tick" checked={done} disabled={!!busy || !canChange} onChange={() => act(done ? 'reopen' : 'done')} aria-label={done ? 'Mark not done' : 'Mark done'} />
          )}
          <span className="aos-row-title">{item.title}</span>
        </span>
        <span className="aos-chips aos-nowrap">
          <span className={`aos-pill ${item.kind === 'Message' ? 'aos-pill-warn' : ''}`}>{done && item.kind === 'Message' ? 'Sent' : done && isTask(item) ? 'Completed' : done ? 'Archived' : itemLabel(item)}</span>
          {item.due_date && !done && <span className={`aos-pill ${overdue ? 'aos-pill-bad' : ''}`}>{when(item)}</span>}
        </span>
      </div>
      <div className="aos-small aos-muted">
        {[
          showAccount && acc ? acc.name : '',
          item.kind === 'Message' ? [item.channel, item.to_name && `to ${item.to_name}`].filter(Boolean).join(' ') : '',
          isTask(item) && item.assignee_name ? (item.assignee === cx.user.id ? 'Assigned to you' : `Assigned to ${item.assignee_name}`) : '',
          item.created_by && item.created_by_rec !== item.assignee ? `from ${first(item.created_by)}` : '',
          done && item.done_at ? `${item.kind === 'Message' ? 'sent' : 'done'} ${fmtStamp(item.done_at)}${item.done_by ? ` by ${first(item.done_by)}` : ''}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {item.body && <div className="aos-body aos-small aos-clamp">{item.body}</div>}
      <div className="aos-chips">
        {showAccount && acc && <button className="aos-chip" onClick={() => cx.go('accounts', acc.id)}>Open account</button>}
        {item.kind === 'Message' && !done && <button className="aos-chip" onClick={copy}>{copied ? 'Copied' : 'Copy message'}</button>}
        {mail && !done && <a className="aos-chip" href={mail}>Open in email</a>}
        {item.kind === 'Message' && !done && (item.assignee === cx.user.id || isAdmin(cx)) && (
          <button className="aos-chip" disabled={!!busy} onClick={() => act('sent')}>{busy === 'sent' ? 'Saving' : 'Mark sent'}</button>
        )}
        {item.kind === 'Message' && done && (item.assignee === cx.user.id || isAdmin(cx)) && <button className="aos-chip" disabled={!!busy} onClick={() => act('unsend')}>Move back to drafts</button>}
        {item.kind === 'Entry' && !item.due_date && !done && canChange && <button className="aos-chip" disabled={!!busy} onClick={() => act('done')}>Archive note</button>}
        {item.kind === 'Entry' && !item.due_date && done && canChange && <button className="aos-chip" disabled={!!busy} onClick={() => act('reopen')}>Restore note</button>}
        {isTask(item) && !done && canAssign(cx) && cx.team.filter((m) => m.canAccounts).length > 1 && (
          <select className="aos-chip aos-chip-select" value={item.assignee} disabled={!!busy} onChange={(e) => act('assign', { assignee: e.target.value })} aria-label="Assign to">
            {cx.team.filter((m) => m.canAccounts || m.id === item.assignee).map((m) => (
              <option key={m.id} value={m.id}>{m.id === cx.user.id ? 'Assign: me' : `Assign: ${m.name}`}</option>
            ))}
          </select>
        )}
        {!done && canChange && onEdit && <button className="aos-chip" onClick={() => onEdit(item)}>Edit</button>}
        {(item.created_by_rec === cx.user.id || isAdmin(cx)) && <button className="aos-chip aos-chip-quiet" disabled={!!busy} onClick={() => act('delete')}>Delete</button>}
      </div>
    </article>
  );
}

/* ---------------- date and assignee pickers ---------------- */

type DateMode = 'none' | 'today' | 'tomorrow' | 'week' | 'pick';
function useWhen(initialDate: string, initialTime: string, defaultMode: DateMode) {
  const today = localToday();
  const start: DateMode = !initialDate ? defaultMode : initialDate === today ? 'today' : initialDate === addDays(today, 1) ? 'tomorrow' : 'pick';
  const [mode, setMode] = useState<DateMode>(start);
  const [picked, setPicked] = useState(initialDate && start === 'pick' ? initialDate : addDays(today, 1));
  const [time, setTime] = useState(initialTime);
  const due = mode === 'none' ? '' : mode === 'today' ? today : mode === 'tomorrow' ? addDays(today, 1) : mode === 'week' ? addDays(today, 7) : picked;
  return { mode, setMode, picked, setPicked, time, setTime, due, today };
}
function WhenField({ w, kind }: { w: ReturnType<typeof useWhen>; kind: 'Entry' | 'Message' }) {
  const modes: { k: DateMode; label: string }[] = [
    { k: 'none', label: 'No date' },
    { k: 'today', label: 'Today' },
    { k: 'tomorrow', label: 'Tomorrow' },
    { k: 'week', label: 'In a week' },
    { k: 'pick', label: 'Pick a date' },
  ];
  return (
    <fieldset className="aos-fieldset">
      <legend className="aos-eyebrow">Due</legend>
      <div className="aos-chips">
        {modes.map((m) => (
          <button type="button" key={m.k} className="aos-chip" aria-pressed={w.mode === m.k} onClick={() => w.setMode(m.k)}>{m.label}</button>
        ))}
      </div>
      {w.mode === 'pick' && <input className="aos-input aos-self-start" type="date" value={w.picked} min={w.today} onChange={(e) => w.setPicked(e.target.value)} required />}
      {w.mode !== 'none' && (
        <label className="aos-field aos-self-start">
          <span>Time (optional)</span>
          <input className="aos-input" type="time" value={w.time} onChange={(e) => w.setTime(e.target.value)} />
        </label>
      )}
      <p className={`aos-small ${w.mode === 'none' ? 'aos-notebox' : 'aos-muted'}`}>
        {w.mode === 'none'
          ? kind === 'Message' ? 'No date: saved as a draft.' : 'No date: this is saved as a note, not a task.'
          : `${kind === 'Message' ? 'Scheduled message' : 'Task'} due ${fmtDate(w.due)}${w.time ? `, ${fmtTime(w.time)}` : ''}.`}
      </p>
    </fieldset>
  );
}
function AssigneeField({ cx, value, onChange }: { cx: Acx; value: string; onChange: (v: string) => void }) {
  const people = cx.team.filter((m) => m.canAccounts);
  if (!canAssign(cx) || people.length < 2) return null;
  return (
    <label className="aos-field">
      <span>Assign to</span>
      <select className="aos-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {people.map((m) => <option key={m.id} value={m.id}>{m.id === cx.user.id ? `Me (${m.name})` : m.name}</option>)}
      </select>
    </label>
  );
}

/* ---------------- item editor (inside an account) ---------------- */

export function ItemEditor({ cx, account, kind, item, onClose }: { cx: Acx; account: Account; kind: 'Entry' | 'Message'; item?: Item; onClose: () => void }) {
  const w = useWhen(item?.due_date || '', item?.due_time || '', item ? 'none' : 'today');
  const [title, setTitle] = useState(item?.title || '');
  const [body, setBody] = useState(item?.body || '');
  const [channel, setChannel] = useState(item?.channel || 'Email');
  const [toName, setToName] = useState(item?.to_name || account.name);
  const [subject, setSubject] = useState(item?.subject || '');
  const [assignee, setAssignee] = useState(item?.assignee || cx.user.id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const label = itemLabel({ kind, due_date: w.due });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const fields = { title, body, channel, to_name: toName, subject, due_date: w.due, due_time: w.due ? w.time : '' };
    try {
      const r = item
        ? await api<{ item: Item }>('/api/os/items', { action: 'update', id: item.id, fields })
        : await api<{ item: Item }>('/api/os/items', { action: 'create', account: account.id, kind, assignee, ...fields });
      upsert(cx, r.item);
      cx.notify(item ? 'Saved.' : r.item.assignee !== cx.user.id ? `${label} assigned to ${first(r.item.assignee_name)}.` : `${label} saved.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };
  return (
    <Modal title={`${item ? 'Edit' : 'New'} ${kind === 'Message' ? 'message' : 'task or note'} · ${account.name}`} onClose={onClose}>
      <form className="aos-stack" onSubmit={submit}>
        {kind === 'Message' ? (
          <>
            <div className="aos-grid2">
              <label className="aos-field">
                <span>Channel</span>
                <select className="aos-input" value={channel} onChange={(e) => setChannel(e.target.value)}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
              </label>
              <label className="aos-field"><span>To</span><input className="aos-input" value={toName} onChange={(e) => setToName(e.target.value)} /></label>
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
        <WhenField w={w} kind={kind} />
        {kind === 'Entry' && !item && <AssigneeField cx={cx} value={assignee} onChange={setAssignee} />}
        {err && <p className="aos-error">{err}</p>}
        <div className="aos-actions">
          <button type="button" className="aos-ghost" onClick={onClose}>Cancel</button>
          <button className="aos-btn" disabled={busy || (kind === 'Entry' ? !title.trim() : !body.trim())}>{busy ? 'Saving' : `Save ${label.toLowerCase()}`}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Tasks screen ---------------- */

type TaskView = 'today' | 'open' | 'upcoming' | 'done';

function useScope(cx: Acx) {
  const [scope, setScope] = useState<string>('me');
  const options = [{ v: 'me', label: 'Assigned to me' }];
  if (canAssign(cx) || isAdmin(cx)) {
    options.push({ v: 'all', label: 'Everyone' });
    cx.team.filter((m) => m.id !== cx.user.id && m.canAccounts).forEach((m) => options.push({ v: m.id, label: m.name }));
  }
  const match = (i: Item) => (scope === 'all' ? true : (scope === 'me' ? cx.user.id : scope) === i.assignee);
  return { scope, setScope, options, match };
}

export function TasksView({ cx }: { cx: Acx }) {
  const [view, setView] = useState<TaskView>('today');
  const [editing, setEditing] = useState<Item | null>(null);
  const sc = useScope(cx);
  const today = localToday();
  const tasks = cx.items.filter((i) => isTask(i) && sc.match(i));
  const open = tasks.filter((i) => i.status === 'Open');
  const lists: Record<TaskView, Item[]> = {
    today: open.filter((i) => i.due_date <= today).sort(byDue),
    open: [...open].sort(byDue),
    upcoming: open.filter((i) => i.due_date > today).sort(byDue),
    done: tasks.filter((i) => i.status === 'Done').sort((a, b) => b.done_at.localeCompare(a.done_at)),
  };
  const empty: Record<TaskView, string> = {
    today: 'Nothing due today or overdue.',
    open: 'No open tasks.',
    upcoming: 'Nothing scheduled after today.',
    done: 'No tasks completed in the last 30 days. Older ones are in each account’s history.',
  };
  const editAcc = editing ? cx.accounts.find((a) => a.id === editing.account) : undefined;
  return (
    <div className="aos-stack-lg">
      <div className="aos-toolbar">
        <Sub
          label="Which tasks"
          value={view}
          onChange={setView}
          options={[
            { v: 'today', label: 'Tasks due today', n: lists.today.length },
            { v: 'open', label: 'Open tasks', n: lists.open.length },
            { v: 'upcoming', label: 'Upcoming tasks', n: lists.upcoming.length },
            { v: 'done', label: 'Completed tasks', n: lists.done.length },
          ]}
        />
        {sc.options.length > 1 && <Sub label="Whose tasks" value={sc.scope} onChange={sc.setScope} options={sc.options} />}
      </div>
      <div className="aos-stack">
        {lists[view].length === 0 && <p className="aos-muted aos-small">{empty[view]}</p>}
        {lists[view].map((i) => <ItemRow key={i.id} item={i} cx={cx} showAccount onEdit={setEditing} />)}
      </div>
      <p className="aos-muted aos-small">Tasks are created inside an account. <a href="#accounts">Open Accounts</a> to add one. Due today includes anything overdue.</p>
      {editing && editAcc && <ItemEditor cx={cx} account={editAcc} kind="Entry" item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ---------------- Drafts screen ---------------- */

type DraftView = 'drafts' | 'scheduled' | 'sent';
export function DraftsView({ cx }: { cx: Acx }) {
  const [view, setView] = useState<DraftView>('drafts');
  const [editing, setEditing] = useState<Item | null>(null);
  const [scope, setScope] = useState('me');
  const msgs = cx.items.filter((i) => i.kind === 'Message' && (scope === 'all' || i.assignee === cx.user.id));
  const lists: Record<DraftView, Item[]> = {
    drafts: msgs.filter((i) => i.status === 'Open' && !i.due_date).sort((a, b) => b.created.localeCompare(a.created)),
    scheduled: msgs.filter((i) => i.status === 'Open' && i.due_date).sort(byDue),
    sent: msgs.filter((i) => i.status === 'Sent').sort((a, b) => b.done_at.localeCompare(a.done_at)),
  };
  const editAcc = editing ? cx.accounts.find((a) => a.id === editing.account) : undefined;
  return (
    <div className="aos-stack-lg">
      <div className="aos-toolbar">
        <Sub
          label="Which messages"
          value={view}
          onChange={setView}
          options={[
            { v: 'drafts', label: 'Drafts', n: lists.drafts.length },
            { v: 'scheduled', label: 'Scheduled', n: lists.scheduled.length },
            { v: 'sent', label: 'Sent (last 30 days)', n: lists.sent.length },
          ]}
        />
        {isAdmin(cx) && <Sub label="Whose" value={scope} onChange={setScope} options={[{ v: 'me', label: 'Mine' }, { v: 'all', label: 'Everyone' }]} />}
      </div>
      <div className="aos-stack">
        {lists[view].length === 0 && <p className="aos-muted aos-small">Nothing here.</p>}
        {lists[view].map((i) => <ItemRow key={i.id} item={i} cx={cx} showAccount onEdit={setEditing} />)}
      </div>
      <p className="aos-muted aos-small">Messages are written inside an account. ROLA OS never sends them: copy the message, send it yourself, then click Mark sent.</p>
      {editing && editAcc && <ItemEditor cx={cx} account={editAcc} kind="Message" item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ---------------- Accounts list ---------------- */

export function AccountsView({ cx, sub, prefill, clearPrefill }: { cx: Acx; sub: string; prefill: Contact | null; clearPrefill: () => void }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (prefill) setCreating(true);
  }, [prefill]);
  const acc = sub ? cx.accounts.find((a) => a.id === sub) : undefined;
  if (sub) return acc ? <AccountDetail cx={cx} account={acc} /> : <AccountDetailById cx={cx} id={sub} />;

  const today = localToday();
  const rows = cx.accounts
    .filter((a) => (!type || a.account_type === type) && (!q.trim() || [a.name, a.organization, a.email, a.title].some((v) => v.toLowerCase().includes(q.trim().toLowerCase()))))
    .map((a) => {
      const open = cx.items.filter((i) => i.account === a.id && isTask(i) && i.status === 'Open').sort(byDue);
      return { a, open, next: open[0] };
    });
  return (
    <div className="aos-stack">
      <div className="aos-toolbar">
        <input className="aos-input aos-search" type="search" placeholder="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
        <select className="aos-input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Account type">
          <option value="">All types</option>
          {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button className="aos-btn aos-btn-sm" onClick={() => setCreating(true)}>New account</button>
      </div>
      {!cx.accounts.length && <p className="aos-muted">No accounts yet. Create the first one with New account. Every account starts with a task.</p>}
      <div className="aos-table-wrap">
        {rows.length > 0 && (
          <table className="aos-table">
            <thead>
              <tr><th className="aos-th">Account</th><th className="aos-th">Type</th><th className="aos-th">Open tasks</th><th className="aos-th">Next task</th><th className="aos-th">Brand</th></tr>
            </thead>
            <tbody>
              {rows.map(({ a, open, next }) => (
                <tr key={a.id} onClick={() => cx.go('accounts', a.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && cx.go('accounts', a.id)}>
                  <td><div className="aos-row-title">{a.name}</div><div className="aos-muted aos-small">{[a.title, a.organization].filter(Boolean).join(', ')}</div></td>
                  <td>{a.account_type}</td>
                  <td>{open.length}</td>
                  <td>{next ? <><span className={next.due_date < today ? 'aos-due' : ''}>{fmtDate(next.due_date)}</span> · {next.title}</> : <span className="aos-muted">None</span>}</td>
                  <td>{a.brand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && (
        <NewAccount
          cx={cx}
          lead={prefill}
          onClose={() => {
            setCreating(false);
            clearPrefill();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- New account (with required first task) ---------------- */

const PROFILE_FIELDS: { k: keyof Account; label: string; type?: string; placeholder?: string }[] = [
  { k: 'title', label: 'Title' },
  { k: 'organization', label: 'Organization or school' },
  { k: 'email', label: 'Email', type: 'email' },
  { k: 'phone', label: 'Phone', type: 'tel' },
  { k: 'linkedin', label: 'LinkedIn', placeholder: 'linkedin.com/in/...' },
  { k: 'instagram', label: 'Instagram', placeholder: '@handle' },
  { k: 'x', label: 'X', placeholder: '@handle' },
  { k: 'tiktok', label: 'TikTok', placeholder: '@handle' },
  { k: 'website', label: 'Website' },
];

function ProfileFields({ f, set }: { f: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <div className="aos-grid2">
      <label className="aos-field"><span>Name (required)</span><input className="aos-input" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={160} /></label>
      <label className="aos-field">
        <span>Type</span>
        <select className="aos-input" value={f.account_type} onChange={(e) => set('account_type', e.target.value)}>
          <option value="">Choose</option>
          {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      {PROFILE_FIELDS.map((p) => (
        <label key={p.k} className="aos-field">
          <span>{p.label}</span>
          <input className="aos-input" type={p.type || 'text'} value={f[p.k] ?? ''} placeholder={p.placeholder} onChange={(e) => set(p.k, e.target.value)} maxLength={300} />
        </label>
      ))}
      <label className="aos-field">
        <span>Brand</span>
        <select className="aos-input" value={f.brand} onChange={(e) => set('brand', e.target.value)}>{BRANDS.map((b) => <option key={b}>{b}</option>)}</select>
      </label>
      <label className="aos-field aos-span2"><span>About (optional)</span><textarea className="aos-input" rows={2} value={f.about} onChange={(e) => set('about', e.target.value)} maxLength={4000} placeholder="Who they are and why they matter" /></label>
    </div>
  );
}

function NewAccount({ cx, lead, onClose }: { cx: Acx; lead: Contact | null; onClose: () => void }) {
  const [f, setF] = useState<Record<string, string>>({
    name: lead?.name || '',
    account_type: '',
    brand: lead?.brand || 'ROLA Global',
    title: lead?.title || '',
    organization: lead?.organization || lead?.institution || '',
    email: lead?.email || '',
    phone: lead?.phone || '',
    linkedin: lead?.linkedin_url || '',
    instagram: '',
    x: '',
    tiktok: '',
    website: '',
    about: '',
  });
  const [taskTitle, setTaskTitle] = useState('');
  const [taskBody, setTaskBody] = useState('');
  const [assignee, setAssignee] = useState(cx.user.id);
  const w = useWhen('', '', 'today');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ account: Account; item: Item }>('/api/os/accounts', {
        ...f,
        lead: lead?.id,
        first: { title: taskTitle, body: taskBody, due_date: w.due, due_time: w.due ? w.time : '', assignee },
      });
      cx.setAccounts((xs) => [...xs, r.account].sort((a, b) => a.name.localeCompare(b.name)));
      upsert(cx, r.item);
      cx.notify(`${r.account.name} created with its first ${r.item.due_date ? 'task' : 'note'}.`);
      onClose();
      cx.go('accounts', r.account.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };
  return (
    <Modal title={lead ? `New account from ${lead.name}` : 'New account'} onClose={onClose}>
      <form className="aos-stack" onSubmit={submit}>
        <ProfileFields f={f} set={set} />
        <section className="aos-firsttask aos-stack">
          <div className="aos-eyebrow">First task (required)</div>
          <p className="aos-small aos-muted">Every account starts with a task, so nobody is added without a next step.</p>
          <label className="aos-field"><span>Task</span><input className="aos-input" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} required maxLength={200} placeholder="e.g. Send intro email" /></label>
          <label className="aos-field"><span>Details (optional)</span><textarea className="aos-input" rows={2} value={taskBody} onChange={(e) => setTaskBody(e.target.value)} maxLength={10000} /></label>
          <WhenField w={w} kind="Entry" />
          <AssigneeField cx={cx} value={assignee} onChange={setAssignee} />
        </section>
        <p className="aos-muted aos-small">Business contact details only. No passwords, financial details or personal data about minors.</p>
        {err && <p className="aos-error">{err}</p>}
        <div className="aos-actions">
          <button type="button" className="aos-ghost" onClick={onClose}>Cancel</button>
          <button className="aos-btn" disabled={busy || !f.name.trim() || !taskTitle.trim()}>{busy ? 'Saving' : 'Create account'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Account detail: the main working screen ---------------- */

function AccountDetailById({ cx, id }: { cx: Acx; id: string }) {
  const [state, setState] = useState<'loading' | 'missing'>('loading');
  useEffect(() => {
    api<{ account: Account }>(`/api/os/accounts/${id}`)
      .then((r) => cx.setAccounts((xs) => (xs.some((x) => x.id === r.account.id) ? xs : [...xs, r.account])))
      .catch(() => setState('missing'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return <p className="aos-muted">{state === 'loading' ? 'Loading' : <>Account not found. <a href="#accounts">All accounts</a></>}</p>;
}

type Composer = 'task' | 'message' | 'update';

function AccountDetail({ cx, account }: { cx: Acx; account: Account }) {
  const [history, setHistory] = useState<Item[] | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editor, setEditor] = useState<{ kind: 'Entry' | 'Message'; item?: Item } | null>(null);
  const [composer, setComposer] = useState<Composer>('task');
  const [update, setUpdate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ account: Account; items: Item[] }>(`/api/os/accounts/${account.id}`)
      .then((r) => {
        setHistory(r.items);
        cx.setAccounts((xs) => xs.map((x) => (x.id === r.account.id ? r.account : x)));
        // Merge anything older than the main load into the shared list so edits stay in sync.
        cx.setItems((xs) => {
          const known = new Set(xs.map((x) => x.id));
          return [...xs, ...r.items.filter((i) => !known.has(i.id))];
        });
      })
      .catch(() => setHistory([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  const items = cx.items.filter((i) => i.account === account.id);
  const openTasks = items.filter((i) => isTask(i) && i.status === 'Open').sort(byDue);
  const notes = items.filter((i) => i.kind === 'Entry' && !i.due_date && i.status === 'Open').sort((a, b) => b.created.localeCompare(a.created));
  const messages = items.filter((i) => i.kind === 'Message' && i.status === 'Open').sort((a, b) => (a.due_date || 'z').localeCompare(b.due_date || 'z'));
  const timeline = items
    .filter((i) => i.kind === 'Update' || i.status !== 'Open')
    .sort((a, b) => (b.done_at || b.created).localeCompare(a.done_at || a.created));
  const lead = account.lead ? cx.leads.find((l) => l.id === account.lead) : undefined;

  const postUpdate = async () => {
    setBusy(true);
    try {
      const r = await api<{ item: Item }>('/api/os/items', { action: 'create', account: account.id, kind: 'Update', body: update });
      upsert(cx, r.item);
      setUpdate('');
      cx.notify('Update posted.');
    } catch (e) {
      cx.notify(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const social = [
    account.linkedin && { label: 'LinkedIn', href: account.linkedin },
    account.instagram && { label: `Instagram ${account.instagram}`, href: `https://instagram.com/${account.instagram.replace(/^@/, '')}` },
    account.x && { label: `X ${account.x}`, href: `https://x.com/${account.x.replace(/^@/, '')}` },
    account.tiktok && { label: `TikTok ${account.tiktok}`, href: `https://www.tiktok.com/@${account.tiktok.replace(/^@/, '')}` },
    account.website && { label: 'Website', href: account.website },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="aos-stack-lg">
      <button className="aos-ghost aos-self-start" onClick={() => cx.go('accounts')}>All accounts</button>
      <header className="aos-acct-head">
        <div className="aos-stack">
          <div className="aos-eyebrow">{[account.account_type || 'Account', account.brand].join(' · ')}</div>
          {(account.title || account.organization) && <div className="aos-muted">{[account.title, account.organization].filter(Boolean).join(', ')}</div>}
          <div className="aos-chips">
            {account.email && <CopyChip value={account.email} />}
            {account.phone && <CopyChip value={account.phone} />}
            {social.map((s) => <a key={s.label} className="aos-chip" href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>)}
            {lead && <button className="aos-chip" onClick={() => cx.openLead(lead.id)}>Lead: {lead.stage}{lead.dnc ? ' (do not contact)' : ''}</button>}
          </div>
          {account.about && <div className="aos-body aos-small">{account.about}</div>}
          <div className="aos-muted aos-small">Created by {account.created_by || 'unknown'}{account.created ? ` on ${fmtStamp(account.created)}` : ''}</div>
        </div>
        <button className="aos-ghost aos-self-start" onClick={() => setEditingProfile(true)}>Edit profile</button>
      </header>

      <section className="aos-compose">
        <div className="aos-seg" role="tablist" aria-label="Add to this account">
          <button role="tab" aria-pressed={composer === 'task'} onClick={() => setComposer('task')}>Task or note</button>
          <button role="tab" aria-pressed={composer === 'message'} onClick={() => setComposer('message')}>Message draft</button>
          <button role="tab" aria-pressed={composer === 'update'} onClick={() => setComposer('update')}>Update</button>
        </div>
        {composer === 'update' ? (
          <div className="aos-stack">
            <textarea className="aos-input" rows={3} value={update} onChange={(e) => setUpdate(e.target.value)} placeholder="What happened? A call recap, a status change, anything the team should know." maxLength={10000} />
            <button className="aos-btn aos-btn-sm aos-self-start" disabled={busy || !update.trim()} onClick={postUpdate}>{busy ? 'Posting' : 'Post update'}</button>
          </div>
        ) : (
          <div className="aos-stack">
            <p className="aos-small aos-muted">
              {composer === 'task'
                ? 'Give it a date and it is a task. Leave the date off and it is saved as a note on this account.'
                : 'Give it a date to schedule it, or leave it as a draft. ROLA OS never sends it for you.'}
            </p>
            <button className="aos-btn aos-btn-sm aos-self-start" onClick={() => setEditor({ kind: composer === 'task' ? 'Entry' : 'Message' })}>
              {composer === 'task' ? 'Add a task or note' : 'Write a message'}
            </button>
          </div>
        )}
      </section>

      <Group title="Open tasks" items={openTasks} cx={cx} onEdit={(i) => setEditor({ kind: 'Entry', item: i })} empty="No open tasks. Add one above so this account has a next step." warn={!openTasks.length} />
      <Group title="Messages" items={messages} cx={cx} onEdit={(i) => setEditor({ kind: 'Message', item: i })} empty="No drafts or scheduled messages." />
      <Group title="Notes" items={notes} cx={cx} onEdit={(i) => setEditor({ kind: 'Entry', item: i })} empty="No notes." />
      <section className="aos-stack">
        <div className="aos-eyebrow">History <span className="aos-count">{timeline.length}</span></div>
        {history === null && <p className="aos-muted aos-small">Loading full history</p>}
        {timeline.length === 0 && history !== null && <p className="aos-muted aos-small">Completed tasks, sent messages and updates show here.</p>}
        {timeline.map((i) => <ItemRow key={i.id} item={i} cx={cx} />)}
      </section>

      {editor && <ItemEditor cx={cx} account={account} kind={editor.kind} item={editor.item} onClose={() => setEditor(null)} />}
      {editingProfile && <EditAccount cx={cx} account={account} onClose={() => setEditingProfile(false)} />}
    </div>
  );
}

function Group({ title, items, cx, onEdit, empty, warn }: { title: string; items: Item[]; cx: Acx; onEdit: (i: Item) => void; empty: string; warn?: boolean }) {
  return (
    <section className="aos-stack">
      <div className="aos-eyebrow">{title} <span className="aos-count">{items.length}</span></div>
      {items.length === 0 ? <p className={`aos-small ${warn ? 'aos-warntext' : 'aos-muted'}`}>{empty}</p> : items.map((i) => <ItemRow key={i.id} item={i} cx={cx} onEdit={onEdit} />)}
    </section>
  );
}

function CopyChip({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="aos-chip"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
    >
      {done ? 'Copied' : value}
    </button>
  );
}

function EditAccount({ cx, account, onClose }: { cx: Acx; account: Account; onClose: () => void }) {
  const init = useMemo(
    () => Object.fromEntries(['name', 'account_type', 'brand', 'title', 'organization', 'email', 'phone', 'linkedin', 'instagram', 'x', 'tiktok', 'website', 'about'].map((k) => [k, String((account as any)[k] ?? '')])),
    [account],
  );
  const [f, setF] = useState<Record<string, string>>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== init[k]));
    if (!Object.keys(changed).length) return onClose();
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ account: Account }>(`/api/os/accounts/${account.id}`, { fields: changed });
      cx.setAccounts((xs) => xs.map((x) => (x.id === r.account.id ? r.account : x)));
      cx.notify('Profile saved.');
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  };
  return (
    <Modal title={`Edit ${account.name}`} onClose={onClose}>
      <form className="aos-stack" onSubmit={submit}>
        <ProfileFields f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} />
        {err && <p className="aos-error">{err}</p>}
        <div className="aos-actions">
          <button type="button" className="aos-ghost" onClick={onClose}>Cancel</button>
          <button className="aos-btn" disabled={busy}>{busy ? 'Saving' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- My Queue: what is due for me ---------------- */

export function DueForMe({ cx }: { cx: Acx }) {
  const today = localToday();
  const due = cx.items.filter((i) => i.status === 'Open' && i.kind !== 'Update' && i.assignee === cx.user.id && i.due_date && i.due_date <= today).sort(byDue);
  return (
    <section className="aos-stack">
      <div className="aos-row-head">
        <div className="aos-eyebrow">My tasks and messages due <span className="aos-count">{due.length}</span></div>
        <button className="aos-ghost" onClick={() => cx.go('tasks')}>All tasks</button>
      </div>
      {due.length ? due.map((i) => <ItemRow key={i.id} item={i} cx={cx} showAccount />) : <p className="aos-muted aos-small">Nothing due today.</p>}
    </section>
  );
}
