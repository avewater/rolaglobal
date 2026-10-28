'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PIPELINE_STAGES,
  SAMPLE_FLOOR,
  sectionsFor,
  type Contact,
  type OsData,
  type SectionKey,
  type Tile,
} from '@/lib/os-roles';

type Phase = 'loading' | 'signed_out' | 'ready' | 'error';

export default function OsApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<OsData | null>(null);
  const [error, setError] = useState('');
  const [section, setSection] = useState<SectionKey>('today');
  const [refreshing, setRefreshing] = useState(false);

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

  // The current section lives in the URL hash, so back and shared links work.
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as SectionKey;
      if (sections.some((s) => s.key === h)) setSection(h);
      else if (sections.length) setSection(sections[0].key);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [sections]);

  const go = (key: SectionKey) => {
    window.location.hash = key;
    window.scrollTo({ top: 0 });
  };

  if (phase === 'loading') return <div className="aos-center aos-muted">Loading</div>;
  if (phase === 'signed_out') return <SignIn onDone={load} />;
  if (phase === 'error' || !data)
    return (
      <div className="aos-center">
        <div className="aos-stack">
          <p>{error}</p>
          <button className="aos-btn" onClick={load}>Try again</button>
        </div>
      </div>
    );

  const groups = ['Work', 'Intelligence', 'Resources'] as const;
  const tabs = sections.slice(0, 4);

  return (
    <div className="aos-shell">
      <aside className="aos-side" aria-label="Sections">
        <div className="aos-brand">ROLA <span>OS</span></div>
        {groups.map((g) => {
          const items = sections.filter((s) => s.group === g);
          if (!items.length) return null;
          return (
            <nav key={g} className="aos-side-group">
              <div className="aos-eyebrow">{g}</div>
              {items.map((s) => (
                <button key={s.key} className="aos-side-link" aria-current={section === s.key ? 'page' : undefined} onClick={() => go(s.key)}>
                  {s.label}
                </button>
              ))}
            </nav>
          );
        })}
      </aside>

      <main className="aos-main">
        <header className="aos-top">
          <h1 className="aos-h1">{sections.find((s) => s.key === section)?.label}</h1>
          <button className="aos-ghost" onClick={load} disabled={refreshing}>
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </header>
        {data.errors.length > 0 && <div className="aos-banner">Could not load: {data.errors.join(', ')}. The rest is current.</div>}

        {section === 'today' && <Today data={data} go={go} />}
        {section === 'pipeline' && <Pipeline contacts={data.contacts ?? []} />}
        {section === 'schools' && <Schools data={data} />}
        {section === 'reports' && <Reports data={data} />}
        {section === 'decisions' && <Decisions data={data} />}
        {section === 'agents' && <Agents data={data} />}
        {section === 'account' && <Account data={data} />}
      </main>

      <nav className="aos-tabs" aria-label="Sections">
        {tabs.map((s) => (
          <button key={s.key} aria-current={section === s.key ? 'page' : undefined} onClick={() => go(s.key)}>
            {s.label}
          </button>
        ))}
        <MoreMenu sections={sections.slice(4)} current={section} go={go} />
      </nav>
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

function MoreMenu({ sections, current, go }: { sections: ReturnType<typeof sectionsFor>; current: SectionKey; go: (k: SectionKey) => void }) {
  const [open, setOpen] = useState(false);
  if (!sections.length) return null;
  return (
    <>
      <button aria-expanded={open} aria-current={sections.some((s) => s.key === current) ? 'page' : undefined} onClick={() => setOpen((o) => !o)}>
        More
      </button>
      {open && (
        <div className="aos-sheet" role="dialog" aria-label="More sections" onClick={() => setOpen(false)}>
          <div className="aos-sheet-body" onClick={(e) => e.stopPropagation()}>
            {sections.map((s) => (
              <button key={s.key} className="aos-side-link" onClick={() => { setOpen(false); go(s.key); }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
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

function CopyBtn({ value, label }: { value: string; label: string }) {
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
      {done ? 'Copied' : label}
    </button>
  );
}

function Pipeline({ contacts }: { contacts: Contact[] }) {
  const t = todayLA();
  if (!contacts.length)
    return <p className="aos-muted">No contacts yet. Once the CRM is imported, every athletic department contact appears here by stage.</p>;
  return (
    <div className="aos-board">
      {PIPELINE_STAGES.map((stage) => {
        const items = contacts.filter((c) => c.stage === stage).sort((a, b) => (a.next_action_due || '9999').localeCompare(b.next_action_due || '9999'));
        return (
          <section key={stage} className="aos-col">
            <div className="aos-col-head">
              <span>{stage}</span>
              <span className="aos-count">{items.length}</span>
            </div>
            {items.map((c) => {
              const overdue = c.next_action_due && c.next_action_due <= t && stage !== 'Partnership active';
              return (
                <article key={c.id} className="aos-card">
                  <div className="aos-row-title">{c.name}</div>
                  <div className="aos-muted aos-small">{[c.title, c.institution].filter(Boolean).join(' · ')}</div>
                  {c.next_action && (
                    <div className="aos-small">
                      {c.next_action}
                      {c.next_action_due && <> · <span className={overdue ? 'aos-due' : 'aos-muted'}>{fmtDate(c.next_action_due)}</span></>}
                    </div>
                  )}
                  <div className="aos-chips">
                    {c.owner && <Pill>{c.owner}</Pill>}
                    {c.email && <CopyBtn value={c.email} label="Copy email" />}
                    {c.phone && <CopyBtn value={c.phone} label="Copy phone" />}
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
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

function Account({ data }: { data: OsData }) {
  const signOut = async () => {
    await fetch('/api/os/logout', { method: 'POST' });
    window.location.hash = '';
    window.location.reload();
  };
  return (
    <div className="aos-stack-lg">
      <div className="aos-stack">
        <div className="aos-h2">{data.user.name}</div>
        <div className="aos-muted">{data.user.role}</div>
      </div>
      <div className="aos-stack">
        <div className="aos-eyebrow">What you can see</div>
        <div className="aos-chips">{data.user.perms.map((p) => <Pill key={p}>{p.replace('_', ' ')}</Pill>)}</div>
      </div>
      <p className="aos-muted aos-small">To install on a phone, open this page in Safari or Chrome and choose Add to Home Screen.</p>
      <button className="aos-btn aos-self-start" onClick={signOut}>Sign out</button>
    </div>
  );
}
