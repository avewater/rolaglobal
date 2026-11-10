'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, ImportView, LeadDrawer, MoveDialog, Pipeline, Queue, api, type Crm } from './crm';
import { ConnectionsView } from './connections';
import { OutreachView } from './outreach';
import { TeamReport } from './team';
import { AccountsView, DraftsView, DueForMe, TasksView, type Acx } from './accounts';
import { ProfileForm } from './profile';
import {
  REASON_STAGES,
  SAMPLE_FLOOR,
  isOpenStage,
  sectionsFor,
  type Account,
  type Contact,
  type Item,
  type OsData,
  type OsUser,
  type SectionKey,
  type Tile,
} from '@/lib/os-roles';

type Phase = 'loading' | 'signed_out' | 'ready' | 'error';

export default function OsApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<OsData | null>(null);
  const [error, setError] = useState('');
  const [section, setSection] = useState<SectionKey>('queue');
  const [sub, setSub] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [leads, setLeads] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ lead: Contact; stage: string } | null>(null);
  const [toast, setToast] = useState('');
  const [prefill, setPrefill] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/os/data', { cache: 'no-store' });
      if (res.status === 401) {
        setPhase('signed_out');
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'The OS could not load.');
      setData(json);
      setLeads(json.contacts ?? []);
      setAccounts(json.accounts ?? []);
      setItems(json.items ?? []);
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The OS could not load.');
      setPhase('error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/os/sw.js', { scope: '/os/' }).catch(() => {});
    load();
  }, [load]);

  const sections = useMemo(() => (data ? sectionsFor(data.user.perms) : []), [data]);

  // The current screen lives in the URL hash (#accounts/rec...), so back, refresh and shared links work.
  useEffect(() => {
    const read = () => {
      const [h, rest] = window.location.hash.slice(1).split('/') as [SectionKey, string?];
      if (sections.some((s) => s.key === h)) {
        setSection(h);
        setSub(rest && /^rec[A-Za-z0-9]{14}$/.test(rest) ? rest : '');
      } else if (sections.length) {
        setSection(sections[0].key);
        setSub('');
      }
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [sections]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const patch = useCallback((l: Contact) => setLeads((xs) => xs.map((x) => (x.id === l.id ? { ...x, ...l } : x))), []);

  const go = useCallback((key: SectionKey, subId?: string) => {
    window.location.hash = subId ? `${key}/${subId}` : key;
    window.scrollTo({ top: 0 });
  }, []);

  // A stage move goes straight through when the rules allow it, otherwise it asks for what is missing.
  const move = useCallback(
    async (lead: Contact, stage: string) => {
      if (lead.dnc && stage !== 'Do Not Contact' && data?.user.role !== 'Admin') {
        setToast('This lead is marked Do Not Contact. Only an admin can move it.');
        return;
      }
      if (REASON_STAGES.includes(stage) || (isOpenStage(stage) && (!lead.next_action || !lead.next_action_due))) {
        setMoving({ lead, stage });
        return;
      }
      const before = lead;
      patch({ ...lead, stage });
      try {
        const r = await api<{ lead: Contact }>(`/api/os/lead/${lead.id}`, { action: 'stage', stage });
        patch(r.lead);
        setToast(`${lead.name} moved to ${stage}.`);
      } catch (e) {
        patch(before);
        if (e instanceof ApiError && (e.code === 'need_reason' || e.code === 'need_next_action')) setMoving({ lead: before, stage });
        else setToast(e instanceof Error ? e.message : 'Could not move.');
      }
    },
    [data?.user.role, patch],
  );

  const canAccounts = !!data?.user.perms.includes('accounts');
  const crm: Crm | null = data
    ? {
        user: data.user,
        leads,
        mentions: data.mentions ?? [],
        canEdit: data.user.perms.includes('edit_leads'),
        canImport: data.user.perms.includes('import_leads'),
        patch,
        add: (l) => setLeads((xs) => [l, ...xs]),
        open: setOpenId,
        move,
        notify: setToast,
        reload: load,
        accountFor: canAccounts ? (leadId) => accounts.find((a) => a.lead === leadId) : undefined,
        convert:
          canAccounts && data.user.perms.includes('edit_leads')
            ? async (ids: string[], openAfter?: boolean) => {
                const r = await fetch('/api/os/leads/convert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) {
                  setToast(j.error || 'Could not convert.');
                  return 0;
                }
                const accs: Account[] = j.accounts ?? [];
                setAccounts((xs) => [...accs, ...xs]);
                setItems((xs) => [...(j.items ?? []), ...xs]);
                const skip = (j.skipped ?? []).length;
                setToast(`${accs.length} account${accs.length === 1 ? '' : 's'} created${skip ? `, ${skip} skipped (already converted or Do Not Contact)` : ''}.`);
                if (openAfter && accs[0]) {
                  setOpenId(null);
                  go('accounts', accs[0].id);
                }
                return accs.length;
              }
            : undefined,
        toAccount: canAccounts
          ? (lead, existing) => {
              setOpenId(null);
              if (existing) go('accounts', existing.id);
              else {
                setPrefill(lead);
                go('accounts');
              }
            }
          : undefined,
      }
    : null;

  const cx: Acx | null = data
    ? { user: data.user, accounts, items, team: data.team ?? [], leads, setAccounts, setItems, notify: setToast, go, openLead: setOpenId }
    : null;
  const setUser = (u: OsUser) => setData((d) => (d ? { ...d, user: u } : d));

  if (phase === 'loading') return <div className="aos-center aos-muted">Loading</div>;
  if (phase === 'signed_out') return <SignIn onDone={load} />;
  if (phase === 'error' || !data || !crm || !cx)
    return (
      <div className="aos-center">
        <div className="aos-stack">
          <p>{error}</p>
          <button className="aos-btn" onClick={load}>Try again</button>
        </div>
      </div>
    );

  const current = sections.find((s) => s.key === section);
  const subAccount = section === 'accounts' && sub ? accounts.find((a) => a.id === sub) : undefined;

  return (
    <div className="aos-app">
      <header className="aos-appbar">
        <div className="aos-appbar-in">
          <a className="aos-brand" href="#queue">ROLA <span>OS</span></a>
          <NavMenu sections={sections} current={section} go={go} />
          <div className="aos-appbar-right">
            <button className="aos-ghost" onClick={load} disabled={refreshing}>{refreshing ? 'Refreshing' : 'Refresh'}</button>
          </div>
        </div>
      </header>

      <main className="aos-main">
        <h1 className="aos-h1">{subAccount ? subAccount.name : current?.label}</h1>
        {data.errors.length > 0 && <div className="aos-banner">Could not load: {data.errors.join(', ')}. The rest is current.</div>}

        {section === 'queue' && (
          <div className="aos-stack-lg">
            {canAccounts && <DueForMe cx={cx} />}
            {data.user.perms.includes('pipeline') && <Queue crm={crm} />}
          </div>
        )}
        {section === 'tasks' && <TasksView cx={cx} />}
        {section === 'accounts' && <AccountsView cx={cx} sub={sub} prefill={prefill} clearPrefill={() => setPrefill(null)} />}
        {section === 'drafts' && <DraftsView cx={cx} />}
        {section === 'pipeline' && <Pipeline crm={crm} />}
        {section === 'today' && <Today data={data} go={go} />}
        {section === 'import' && <ImportView crm={crm} />}
        {section === 'connections' && <ConnectionsView crm={crm} />}
        {section === 'outreach' && <OutreachView cx={cx} convert={crm.convert} />}
        {section === 'team' && <TeamReport go={go} />}
        {section === 'schools' && <Schools data={data} />}
        {section === 'reports' && <Reports data={data} />}
        {section === 'decisions' && <Decisions data={data} />}
        {section === 'agents' && <Agents data={data} />}
        {section === 'profile' && <ProfileSection data={data} onSaved={setUser} notify={setToast} />}
      </main>

      {openId && <LeadDrawer key={openId} id={openId} crm={crm} onClose={() => setOpenId(null)} />}
      {moving && (
        <MoveDialog
          lead={moving.lead}
          stage={moving.stage}
          notify={setToast}
          onCancel={() => setMoving(null)}
          onDone={(l) => {
            patch(l);
            setMoving(null);
          }}
        />
      )}
      {toast && <div className="aos-toast" role="status">{toast}</div>}
    </div>
  );
}

// The main menu: one dropdown with every screen this person can open.
function NavMenu({ sections, current, go }: { sections: ReturnType<typeof sectionsFor>; current: SectionKey; go: (k: SectionKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const groups = ['Work', 'Overview', 'Intelligence', 'Settings'] as const;
  const label = sections.find((s) => s.key === current)?.label || 'Menu';
  return (
    <div className="aos-nav" ref={ref}>
      <button className="aos-nav-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="aos-nav-icon" aria-hidden>☰</span>
        {label}
        <span aria-hidden className="aos-nav-caret">▾</span>
      </button>
      {open && (
        <div className="aos-nav-menu" role="menu">
          {groups.map((g) => {
            const list = sections.filter((s) => s.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="aos-nav-group" role="group" aria-label={g}>
                <div className="aos-eyebrow">{g}</div>
                {list.map((s) => (
                  <button
                    key={s.key}
                    role="menuitem"
                    className="aos-nav-item"
                    aria-current={s.key === current ? 'page' : undefined}
                    onClick={() => {
                      setOpen(false);
                      go(s.key);
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [passkey, setPasskey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/os/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passkey }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sign-in failed.');
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed.');
      setBusy(false);
    }
  };
  return (
    <div className="aos-center">
      <form className="aos-signin" onSubmit={submit}>
        <div className="aos-brand aos-brand-lg">ROLA <span>OS</span></div>
        <label htmlFor="passkey" className="aos-eyebrow">Your passkey</label>
        <input id="passkey" type="password" autoComplete="current-password" value={passkey} onChange={(e) => setPasskey(e.target.value)} autoFocus />
        {err && <p className="aos-error">{err}</p>}
        <button className="aos-btn" disabled={busy || passkey.length < 8}>{busy ? 'Signing in' : 'Sign in'}</button>
        <p className="aos-muted aos-small">Michael issues passkeys. Ask him if you need one.</p>
      </form>
    </div>
  );
}

const fmtDate = (d: string) => {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const todayLA = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tile['tone'] }) {
  return <span className={`aos-pill aos-pill-${tone}`}>{children}</span>;
}

function Today({ data, go }: { data: OsData; go: (k: SectionKey) => void }) {
  const first = data.user.name.split(' ')[0];
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
  return (
    <div className="aos-stack-lg">
      <p className="aos-lede">{date}. Good to see you, {first}.</p>
      <div className="aos-tiles">
        {data.tiles.map((t) => (
          <button key={t.key} className={`aos-tile aos-tone-${t.tone}`} onClick={() => t.go && go(t.go)}>
            <span className="aos-tile-label">{t.label}</span>
            <span className="aos-tile-value">{t.value}</span>
            {t.note && <span className="aos-tile-note">{t.note}</span>}
          </button>
        ))}
      </div>
      {data.reports && (
        <section className="aos-stack">
          <div className="aos-eyebrow">Latest reports</div>
          {data.reports.length === 0 && <p className="aos-muted">No agent reports yet. They appear here once the scheduled agents start running.</p>}
          {data.reports.slice(0, 3).map((r) => (
            <button key={r.id} className="aos-row aos-row-btn" onClick={() => go('reports')}>
              <span className="aos-row-title">{r.title}</span>
              <span className="aos-muted aos-small">{r.agent} · {fmtDate(r.date)}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function Schools({ data }: { data: OsData }) {
  const schools = data.schools ?? [];
  if (!schools.length) return <p className="aos-muted">No schools yet. Add institutions in Airtable and they appear here with their research sample count.</p>;
  return (
    <div className="aos-stack">
      <p className="aos-muted aos-small">A school's numbers can be reported once {SAMPLE_FLOOR} core-sample athletes have taken part.</p>
      {schools.map((s) => {
        const pct = Math.min(100, (s.core / SAMPLE_FLOOR) * 100);
        return (
          <article key={s.id} className="aos-row">
            <div className="aos-row-head">
              <span className="aos-row-title">{s.name}</span>
              <span className="aos-num">{s.core}/{SAMPLE_FLOOR}</span>
            </div>
            <div className="aos-bar" role="img" aria-label={`${s.core} of ${SAMPLE_FLOOR} athletes`}>
              <span style={{ width: `${pct}%` }} className={s.core >= SAMPLE_FLOOR ? 'aos-bar-full' : ''} />
            </div>
            <div className="aos-chips">
              {s.conference && <Pill>{s.conference}</Pill>}
              {s.tier && <Pill>Tier {s.tier}</Pill>}
              <Pill tone={s.page_public ? 'ok' : 'neutral'}>{s.page_public ? 'Page public' : 'Page private'}</Pill>
              {s.core >= SAMPLE_FLOOR && <Pill tone="ok">At the floor</Pill>}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Reports({ data }: { data: OsData }) {
  const [open, setOpen] = useState<string | null>(null);
  const reports = data.reports ?? [];
  const r = reports.find((x) => x.id === open);
  if (r)
    return (
      <article className="aos-stack">
        <button className="aos-ghost aos-self-start" onClick={() => setOpen(null)}>All reports</button>
        <div className="aos-eyebrow">{r.agent} · {fmtDate(r.date)}</div>
        <h2 className="aos-h2">{r.title}</h2>
        {r.status === 'Failed' && <Pill tone="bad">Failed</Pill>}
        <div className="aos-body">{r.body}</div>
      </article>
    );
  if (!reports.length) return <p className="aos-muted">No agent reports yet.</p>;
  return (
    <div className="aos-stack">
      {reports.map((x) => (
        <button key={x.id} className="aos-row aos-row-btn" onClick={() => setOpen(x.id)}>
          <span className="aos-row-head">
            <span className="aos-row-title">{x.title}</span>
            {x.status === 'Failed' && <Pill tone="bad">Failed</Pill>}
          </span>
          <span className="aos-muted aos-small">{x.agent} · {fmtDate(x.date)}</span>
        </button>
      ))}
    </div>
  );
}

function Decisions({ data }: { data: OsData }) {
  const items = data.decisions ?? [];
  return (
    <div className="aos-stack">
      {items.map((d) => (
        <article key={d.id} className="aos-row">
          <div className="aos-row-head">
            <span className="aos-row-title"><span className="aos-code">{d.code}</span> {d.decision}</span>
            <Pill tone={d.status === 'Open' ? 'warn' : 'ok'}>{d.status}</Pill>
          </div>
          {d.outcome && <p className="aos-small">{d.outcome}</p>}
          <div className="aos-muted aos-small">{[d.area, d.decided_on ? `decided ${fmtDate(d.decided_on)}` : d.opened_on ? `opened ${fmtDate(d.opened_on)}` : ''].filter(Boolean).join(' · ')}</div>
        </article>
      ))}
    </div>
  );
}

function Agents({ data }: { data: OsData }) {
  const tone = (h: string) => (h === 'Active' ? 'ok' : h === 'Parked' ? 'neutral' : 'warn') as Tile['tone'];
  return (
    <div className="aos-stack">
      {(data.agents ?? []).map((a) => (
        <article key={a.id} className="aos-row">
          <div className="aos-row-head">
            <span className="aos-row-title">{a.agent}</span>
            <Pill tone={tone(a.heat)}>{a.heat || 'Unset'}</Pill>
          </div>
          <div className="aos-small">{a.discipline}</div>
          <div className="aos-muted aos-small">{[a.schedule, a.build_status].filter(Boolean).join(' · ')}</div>
        </article>
      ))}
    </div>
  );
}

function ProfileSection({ data, onSaved, notify }: { data: OsData; onSaved: (u: OsUser) => void; notify: (m: string) => void }) {
  const signOut = async () => {
    await fetch('/api/os/logout', { method: 'POST' });
    window.location.hash = '';
    window.location.reload();
  };
  return (
    <div className="aos-stack-lg">
      <div className="aos-stack">
        <div className="aos-h2">{data.user.name}</div>
        <div className="aos-muted">{[data.user.profile.title, data.user.role === 'VA' ? 'Outreach' : data.user.role].filter(Boolean).join(' · ')}</div>
      </div>
      <ProfileForm key={data.user.name + data.user.profile.title} user={data.user} onSaved={onSaved} notify={notify} />
      <div className="aos-stack">
        <div className="aos-eyebrow">What you can see</div>
        <div className="aos-chips">{data.user.perms.map((p) => <Pill key={p}>{p.replace('_', ' ')}</Pill>)}</div>
      </div>
      <p className="aos-muted aos-small">To install on a phone, open this page in Safari or Chrome and choose Add to Home Screen.</p>
      <button className="aos-btn aos-self-start" onClick={signOut}>Sign out</button>
    </div>
  );
}
