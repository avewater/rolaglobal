'use client';

// LinkedIn-first outreach (Lane A). Rein researches, AI drafts three touches, Rein edits, Michael approves,
// then Michael sends each one by hand from his own LinkedIn in a quick send session. ROLA OS never acts on LinkedIn.
import { useEffect, useMemo, useState } from 'react';
import { OUTREACH, TOUCH_GOAL, isOpenStage, type Account, type Contact, type Item } from '@/lib/os-roles';
import { api, fmtDate, todayET } from './crm';
import type { Acx } from './accounts';

type View = 'ready' | 'rein' | 'approvals' | 'send' | 'scheduled';
type Stats = { stopLoss: { sent: number; replies: number; window: number; threshold: number }; sentToday: number; cap: number };

export function OutreachView({ cx, convert }: { cx: Acx; convert?: (ids: string[]) => Promise<number> }) {
  const approver = cx.user.perms.includes('approve_outreach');
  const [view, setView] = useState<View>(approver ? 'send' : 'ready');
  const [stats, setStats] = useState<Stats | null>(null);
  const loadStats = () => api<Stats>('/api/os/outreach').then(setStats).catch(() => {});
  useEffect(() => {
    loadStats();
  }, []);

  const touches = cx.items.filter((i) => i.touch > 0);
  const byAccount = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of touches) m.set(i.account, [...(m.get(i.account) ?? []), i].sort((a, b) => a.touch - b.touch));
    return m;
  }, [touches]);
  const groupsWhere = (pred: (xs: Item[]) => boolean) => [...byAccount.entries()].filter(([, xs]) => pred(xs)).map(([acc]) => acc);
  const live = (xs: Item[]) => xs.filter((i) => i.review !== 'Stopped');
  const reinIds = groupsWhere((xs) => live(xs).some((i) => i.review === 'Rein' && i.status === 'Open'));
  const approvalIds = groupsWhere((xs) => live(xs).some((i) => i.review === 'Michael' && i.status === 'Open'));
  const today = todayET();
  const dueToday = touches.filter((i) => i.review === 'Approved' && i.status === 'Open' && i.due_date && i.due_date <= today).sort((a, b) => b.touch - a.touch || a.due_date.localeCompare(b.due_date));
  const scheduled = touches.filter((i) => i.review === 'Approved' && i.status === 'Open' && (!i.due_date || i.due_date > today));

  // Rein's queue: Lane A leads still being prepared.
  const accFor = (leadId: string) => cx.accounts.find((a) => a.lead === leadId);
  const laneA = cx.leads.filter((l) => l.lane === 'A' && isOpenStage(l.stage) && !l.dnc);
  const needResearch = laneA.filter((l) => !l.current_work);
  const needAccount = laneA.filter((l) => l.current_work && !accFor(l.id));
  const readyToDraft = laneA.filter((l) => l.current_work && accFor(l.id) && !byAccount.has(accFor(l.id)!.id));
  const readyCount = needResearch.length + needAccount.length + readyToDraft.length;

  const upsert = (its: Item[]) => cx.setItems((xs) => { const ids = new Set(its.map((i) => i.id)); return [...its, ...xs.filter((x) => !ids.has(x.id))]; });

  const tabs: { v: View; label: string; n: number; show: boolean }[] = [
    { v: 'send', label: 'Send today', n: Math.max(0, Math.min(dueToday.length, (stats?.cap ?? OUTREACH.dailyCap) - (stats?.sentToday ?? 0))), show: approver },
    { v: 'approvals', label: 'Approvals', n: approvalIds.length, show: true },
    { v: 'rein', label: 'Rein review', n: reinIds.length, show: OUTREACH.reinFirst },
    { v: 'ready', label: 'Prep', n: readyCount, show: true },
    { v: 'scheduled', label: 'Scheduled', n: scheduled.length, show: true },
  ];

  const sl = stats?.stopLoss;
  const stopLossHit = sl && sl.sent >= sl.window && sl.replies < sl.threshold;

  return (
    <div className="aos-stack-lg">
      <p className="aos-muted">LinkedIn first for Michael's connections: three touches (day 0, day 4, day 9 to 10), drafted by AI from Rein's research, approved by Michael, and sent by Michael from his own LinkedIn. Any reply stops the sequence. Email only after they agree to it on LinkedIn.</p>
      {sl && (
        <div className={stopLossHit ? 'aos-banner' : 'aos-muted aos-small'}>
          {stopLossHit
            ? `Stop-loss: ${sl.replies} replies from the first ${sl.window} first messages, under the ${sl.threshold} we agreed. Rework the message before sending more first touches.`
            : `Stop-loss check: ${sl.replies} replies from ${sl.sent} of the first ${sl.window} first messages (rework if fewer than ${sl.threshold}).`}
        </div>
      )}
      <div className="aos-seg" role="group" aria-label="Outreach view">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.v} aria-pressed={view === t.v} onClick={() => setView(t.v)}>{t.label}<span className="aos-count">{t.n}</span></button>
        ))}
      </div>

      {view === 'send' && approver && <SendSession cx={cx} queue={dueToday} stats={stats} onSent={(its) => { upsert(its); loadStats(); }} stopLossHit={!!stopLossHit} />}

      {view === 'approvals' && (
        <Groups cx={cx} ids={approvalIds} byAccount={byAccount} mode="approve" onChange={upsert} empty="Nothing waiting for approval." />
      )}
      {view === 'rein' && <Groups cx={cx} ids={reinIds} byAccount={byAccount} mode="rein" onChange={upsert} empty="No drafts waiting for Rein." />}
      {view === 'scheduled' && (
        <div className="aos-stack">
          {!scheduled.length && <p className="aos-muted">Nothing scheduled.</p>}
          {scheduled.sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9')).map((i) => (
            <article key={i.id} className="aos-row">
              <div className="aos-row-head">
                <span className="aos-row-title">{i.to_name} · touch {i.touch}</span>
                <span className="aos-pill">{i.due_date ? (i.due_date <= today ? 'Today' : fmtDate(i.due_date)) : 'After the previous touch'}</span>
              </div>
              <div className="aos-small aos-muted aos-body">{i.body}</div>
            </article>
          ))}
        </div>
      )}
      {view === 'ready' && (
        <Prep cx={cx} needResearch={needResearch} needAccount={needAccount} readyToDraft={readyToDraft} accFor={accFor} convert={convert} onDrafted={(its) => cx.setItems((xs) => [...its, ...xs])} />
      )}
    </div>
  );
}

function Prep({ cx, needResearch, needAccount, readyToDraft, accFor, convert, onDrafted }: {
  cx: Acx; needResearch: Contact[]; needAccount: Contact[]; readyToDraft: Contact[]; accFor: (id: string) => Account | undefined; convert?: (ids: string[]) => Promise<number>; onDrafted: (its: Item[]) => void;
}) {
  const [busy, setBusy] = useState('');
  const draft = async (l: Contact) => {
    const acc = accFor(l.id);
    if (!acc) return false;
    setBusy(l.id);
    try {
      const r = await api<{ items: Item[] }>('/api/os/outreach', { action: 'draft', account: acc.id });
      onDrafted(r.items);
      return true;
    } catch (e) {
      cx.notify(`${l.name}: ${e instanceof Error ? e.message : 'Could not draft.'}`);
      return false;
    } finally {
      setBusy('');
    }
  };
  const draftAll = async () => {
    let n = 0;
    for (const l of readyToDraft) if (await draft(l)) n++;
    cx.notify(`Drafted messages for ${n} of ${readyToDraft.length}.`);
  };
  return (
    <div className="aos-stack-lg">
      <section className="aos-stack">
        <div className="aos-row-head"><div className="aos-eyebrow">Ready for AI drafts ({readyToDraft.length})</div>{readyToDraft.length > 1 && <button className="aos-btn aos-btn-sm" disabled={!!busy} onClick={draftAll}>Draft all</button>}</div>
        {readyToDraft.map((l) => (
          <article key={l.id} className="aos-row">
            <div className="aos-row-head"><span className="aos-row-title">{l.name}</span>{l.rel_strength && <span className="aos-pill">{l.rel_strength}</span>}</div>
            <div className="aos-small aos-muted">{l.current_work}</div>
            <div className="aos-chips"><button className="aos-btn aos-btn-sm" disabled={!!busy} onClick={async () => { if (await draft(l)) cx.notify(`Drafted 3 messages for ${l.name}.`); }}>{busy === l.id ? 'Drafting' : 'Draft with AI'}</button><button className="aos-ghost" onClick={() => cx.openLead(l.id)}>Open lead</button></div>
          </article>
        ))}
        {!readyToDraft.length && <p className="aos-muted aos-small">None. Leads show here once they have research notes and an account.</p>}
      </section>
      <section className="aos-stack">
        <div className="aos-row-head"><div className="aos-eyebrow">Researched, needs an account ({needAccount.length})</div>{convert && needAccount.length > 0 && <button className="aos-btn aos-btn-sm" disabled={!!busy} onClick={async () => { setBusy('convert'); await convert(needAccount.slice(0, 50).map((l) => l.id)); setBusy(''); }}>Convert all</button>}</div>
        {needAccount.map((l) => <LeadLine key={l.id} l={l} cx={cx} />)}
        {!needAccount.length && <p className="aos-muted aos-small">None.</p>}
      </section>
      <section className="aos-stack">
        <div className="aos-eyebrow">Needs research ({needResearch.length})</div>
        <p className="aos-small aos-muted">Open the lead, Edit details, and fill in What they're working on now (required), How well Michael knows them, Why they fit and Must mention.</p>
        {needResearch.map((l) => <LeadLine key={l.id} l={l} cx={cx} />)}
        {!needResearch.length && <p className="aos-muted aos-small">None.</p>}
      </section>
    </div>
  );
}

function LeadLine({ l, cx }: { l: Contact; cx: Acx }) {
  return (
    <button className="aos-row aos-row-btn" onClick={() => cx.openLead(l.id)}>
      <span className="aos-row-title">{l.name}</span>
      <span className="aos-small aos-muted">{[l.title, l.organization].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

function Groups({ cx, ids, byAccount, mode, onChange, empty }: { cx: Acx; ids: string[]; byAccount: Map<string, Item[]>; mode: 'rein' | 'approve'; onChange: (its: Item[]) => void; empty: string }) {
  if (!ids.length) return <p className="aos-muted">{empty}</p>;
  return (
    <div className="aos-stack-lg">
      {ids.map((acc) => (
        <TouchGroup key={acc} cx={cx} account={cx.accounts.find((a) => a.id === acc)} items={(byAccount.get(acc) ?? []).filter((i) => i.review !== 'Stopped')} mode={mode} onChange={onChange} />
      ))}
    </div>
  );
}

function TouchGroup({ cx, account, items, mode, onChange }: { cx: Acx; account?: Account; items: Item[]; mode: 'rein' | 'approve'; onChange: (its: Item[]) => void }) {
  const approver = cx.user.perms.includes('approve_outreach');
  const lead = cx.leads.find((l) => l.id === account?.lead);
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.body])));
  const open = items.filter((i) => i.status === 'Open');
  const call = async (action: string, extra: Record<string, unknown>, msg?: string) => {
    setBusy(action);
    try {
      const r = await api<{ items: Item[] }>('/api/os/outreach', { action, ...extra });
      onChange(r.items);
      if (msg) cx.notify(msg);
      return true;
    } catch (e) {
      cx.notify(e instanceof Error ? e.message : 'Could not save.');
      return false;
    } finally {
      setBusy('');
    }
  };
  const save = async (i: Item) => {
    const body = drafts[i.id]?.trim();
    if (!body || body === i.body) return true;
    return call('edit', { id: i.id, body });
  };
  const saveAll = async () => { for (const i of open) if (!(await save(i))) return false; return true; };
  const hard = (f: string) => f.split('\n').filter((x) => x && (x.startsWith('Contains') || x.startsWith('Fill in') || x.startsWith('Touch 1 has')));
  const blocked = open.some((i) => hard(i.flags).length);
  return (
    <section className="aos-panel aos-stack">
      <div className="aos-row-head">
        <span className="aos-row-title">{account?.name ?? 'Account'}</span>
        <span className="aos-chips">{lead?.rel_strength && <span className="aos-pill">{lead.rel_strength}</span>}{lead && <button className="aos-ghost" onClick={() => cx.openLead(lead.id)}>Lead</button>}</span>
      </div>
      {lead && (
        <dl className="aos-dl aos-small">
          {lead.current_work && <><dt>Working on</dt><dd>{lead.current_work}</dd></>}
          {lead.must_mention && <><dt>Must mention</dt><dd>{lead.must_mention}</dd></>}
          {lead.warm_path && <><dt>Connection</dt><dd>{lead.warm_path}</dd></>}
        </dl>
      )}
      {open.map((i) => (
        <div key={i.id} className="aos-stack">
          <div className="aos-eyebrow">Touch {i.touch} · {TOUCH_GOAL[i.touch]}{i.touch === 1 ? ' · day 0' : i.touch === 2 ? ' · day 4' : ' · day 9 to 10'}</div>
          <textarea className="aos-input" rows={i.touch === 1 ? 6 : 5} value={drafts[i.id] ?? i.body} onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))} onBlur={() => save(i)} maxLength={2000} disabled={mode === 'approve' && !approver} />
          {i.flags && (
            <ul className="aos-flags">
              {i.flags.split('\n').filter(Boolean).map((f) => <li key={f} className={hard(f).length ? 'aos-due' : 'aos-muted'}>{f}</li>)}
            </ul>
          )}
        </div>
      ))}
      <div className="aos-chips">
        {mode === 'rein' && <button className="aos-btn aos-btn-sm" disabled={!!busy} onClick={async () => { if (await saveAll()) await call('to_michael', { ids: open.map((i) => i.id) }, 'Sent to Michael for approval.'); }}>{busy === 'to_michael' ? 'Sending' : 'Looks good, send to Michael'}</button>}
        {mode === 'approve' && approver && (
          <>
            <button className="aos-btn aos-btn-sm" disabled={!!busy || blocked} title={blocked ? 'Fix the items in red first' : ''} onClick={async () => { if (await saveAll()) await call('approve', { ids: open.map((i) => i.id) }, 'Approved. Touch 1 is in Send today.'); }}>{busy === 'approve' ? 'Approving' : 'Approve all three'}</button>
            {OUTREACH.reinFirst && <button className="aos-chip" disabled={!!busy} onClick={() => call('back_to_rein', { ids: open.map((i) => i.id) }, 'Sent back to Rein.')}>Back to Rein</button>}
          </>
        )}
        {mode === 'approve' && !approver && <span className="aos-small aos-muted">Waiting for Michael.</span>}
        <button className="aos-ghost" disabled={!!busy} onClick={() => window.confirm(`Stop outreach to ${account?.name ?? 'this account'}?`) && call('stop', { id: open[0]?.id }, 'Stopped.')}>Stop</button>
      </div>
    </section>
  );
}

function SendSession({ cx, queue, stats, onSent, stopLossHit }: { cx: Acx; queue: Item[]; stats: Stats | null; onSent: (its: Item[]) => void; stopLossHit: boolean }) {
  const cap = stats?.cap ?? OUTREACH.dailyCap;
  const left = Math.max(0, cap - (stats?.sentToday ?? 0));
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');
  const list = queue.filter((i) => !skipped.includes(i.id) && !(stopLossHit && i.touch === 1)).slice(0, left);
  const cur = list[0];
  const lead = cur ? cx.leads.find((l) => l.id === cx.accounts.find((a) => a.id === cur.account)?.lead) : undefined;

  const copy = async (i: Item) => {
    try {
      await navigator.clipboard.writeText(i.body);
      setCopied(i.id);
    } catch {
      cx.notify('Could not copy. Select the message and copy it by hand.');
    }
  };
  const act = async (action: 'sent' | 'stop') => {
    if (!cur) return;
    setBusy(action);
    try {
      const r = await api<{ items: Item[] }>('/api/os/outreach', action === 'sent' ? { action, id: cur.id } : { action, id: cur.id, replied: true });
      onSent(r.items);
      cx.notify(action === 'sent' ? `Touch ${cur.touch} to ${cur.to_name} logged.` : `Reply logged. The rest of ${cur.to_name}'s sequence is stopped.`);
      setCopied('');
    } catch (e) {
      cx.notify(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy('');
    }
  };

  if (!left) return <p className="aos-muted">Today's {cap} are done. Nice work. The rest wait for tomorrow.</p>;
  if (!cur) return <p className="aos-muted">Nothing to send right now.{stopLossHit ? ' First touches are paused by the stop-loss.' : ''}</p>;
  return (
    <section className="aos-panel aos-stack aos-send">
      <div className="aos-row-head">
        <span className="aos-small aos-muted">{list.length} to send now · {stats?.sentToday ?? 0} of {cap} sent today</span>
        <span className="aos-pill">Touch {cur.touch} · {TOUCH_GOAL[cur.touch]}</span>
      </div>
      <div>
        <div className="aos-row-title">{cur.to_name}</div>
        {lead && <div className="aos-small aos-muted">{[lead.title, lead.organization].filter(Boolean).join(' · ')}</div>}
      </div>
      <div className="aos-body aos-send-msg">{cur.body}</div>
      <ol className="aos-small aos-muted aos-steps">
        <li>Copy and open LinkedIn. In LinkedIn, tap Message, paste, send.</li>
        <li>Come back here and tap Sent.</li>
      </ol>
      <div className="aos-chips">
        <a className="aos-btn" href={cur.linkedin_url || '#'} target="_blank" rel="noopener noreferrer" onClick={() => copy(cur)}>{copied === cur.id ? 'Copied. Opening LinkedIn' : 'Copy and open LinkedIn'}</a>
        <button className="aos-btn aos-btn-gold" disabled={!!busy} onClick={() => act('sent')}>{busy === 'sent' ? 'Saving' : 'Sent, next'}</button>
      </div>
      <div className="aos-chips">
        <button className="aos-chip" disabled={!!busy} onClick={() => act('stop')}>They already replied</button>
        <button className="aos-ghost" onClick={() => { setSkipped((s) => [...s, cur.id]); setCopied(''); }}>Skip for now</button>
      </div>
    </section>
  );
}
