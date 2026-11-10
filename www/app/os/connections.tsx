'use client';

// Michael's LinkedIn connections: import LinkedIn's own export, then Rein triages each one.
// A Fit becomes a Lane A lead (LinkedIn first) for Rein to research.
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Connection } from '@/lib/os-roles';
import { liDate } from '@/lib/os-connections';
import { api, fmtDate, parseCsv, type Crm } from './crm';

type Tab = 'Untriaged' | 'Fit' | 'Not now' | 'No';
const TABS: Tab[] = ['Untriaged', 'Fit', 'Not now', 'No'];

// LinkedIn's Connections.csv starts with a few "Notes" lines before the real header row.
function parseLinkedIn(text: string) {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === 'first name'));
  if (h < 0) return null;
  const head = rows[h].map((c) => c.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const [fi, la, ur, em, co, po, cn] = ['first name', 'last name', 'url', 'email address', 'company', 'position', 'connected on'].map(col);
  return rows
    .slice(h + 1)
    .map((r) => ({
      name: `${(r[fi] ?? '').trim()} ${(r[la] ?? '').trim()}`.trim(),
      linkedin_url: (r[ur] ?? '').trim(),
      email: em >= 0 ? (r[em] ?? '').trim() : '',
      company: (r[co] ?? '').trim(),
      title: (r[po] ?? '').trim(),
      connected_on: cn >= 0 ? liDate(r[cn] ?? '') : '',
    }))
    .filter((r) => r.name);
}

export function ConnectionsView({ crm }: { crm: Crm }) {
  const [all, setAll] = useState<Connection[] | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('Untriaged');
  const [q, setQ] = useState('');
  const [likely, setLikely] = useState(false);
  const [shown, setShown] = useState(60);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const r = await api<{ connections: Connection[] }>('/api/os/connections');
      setAll(r.connections);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load connections.');
    }
  };
  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t, (all ?? []).filter((c) => c.triage === t).length])) as Record<Tab, number>, [all]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all ?? [])
      .filter((c) => c.triage === tab && (!likely || c.score >= 3) && (!needle || [c.name, c.title, c.company].some((v) => v.toLowerCase().includes(needle))))
      .sort((a, b) => b.score - a.score || b.connected_on.localeCompare(a.connected_on));
  }, [all, tab, q, likely]);

  const triage = async (c: Connection, to: Tab) => {
    setBusy(c.id);
    try {
      const r = await api<{ connection: Connection; lead: string }>('/api/os/connections', { action: 'triage', id: c.id, triage: to });
      setAll((xs) => (xs ?? []).map((x) => (x.id === c.id ? r.connection : x)));
      if (to === 'Fit') {
        crm.notify(`${c.name} added to Leads for research.`);
        crm.reload();
      }
    } catch (e) {
      crm.notify(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="aos-stack-lg">
      <p className="aos-muted">
        Michael's 1st-degree LinkedIn connections. Mark each one Fit, Not now or No. A Fit becomes a lead (LinkedIn first, owner Rein) with next action Research connection. Likely fits, by title and company, are at the top.
      </p>
      {crm.canImport && <ImportConnections onDone={load} notify={crm.notify} />}
      {err && <p className="aos-error">{err}</p>}
      {all === null && !err && <p className="aos-muted">Loading</p>}
      {all && all.length === 0 && <p className="aos-muted">No connections yet. {crm.canImport ? 'Import the Connections file from LinkedIn above.' : 'Michael imports them from LinkedIn.'}</p>}
      {all && all.length > 0 && (
        <>
          <div className="aos-toolbar">
            <div className="aos-seg" role="group" aria-label="Triage">
              {TABS.map((t) => (
                <button key={t} aria-pressed={tab === t} onClick={() => { setTab(t); setShown(60); }}>
                  {t}<span className="aos-count">{counts[t]}</span>
                </button>
              ))}
            </div>
            <input className="aos-input aos-search" type="search" placeholder="Search name, title, company" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search connections" />
            <label className="aos-check"><input type="checkbox" checked={likely} onChange={(e) => setLikely(e.target.checked)} /> Likely fits only</label>
          </div>
          <div className="aos-stack">
            {list.slice(0, shown).map((c) => (
              <article key={c.id} className="aos-row">
                <div className="aos-row-head">
                  <span className="aos-row-title">{c.name}</span>
                  {c.score >= 3 && <span className="aos-pill aos-pill-ok">Likely fit</span>}
                </div>
                <div className="aos-muted aos-small">{[c.title, c.company].filter(Boolean).join(' · ') || 'No title listed'}{c.connected_on ? ` · connected ${/^\d{4}-/.test(c.connected_on) ? fmtDate(c.connected_on) + ' ' + c.connected_on.slice(0, 4) : c.connected_on}` : ''}</div>
                <div className="aos-chips">
                  {c.linkedin_url && <a className="aos-chip" href={c.linkedin_url} target="_blank" rel="noopener noreferrer">Open LinkedIn</a>}
                  {TABS.filter((t) => t !== 'Untriaged' && t !== c.triage).map((t) => (
                    <button key={t} className={t === 'Fit' ? 'aos-btn aos-btn-sm' : 'aos-chip'} disabled={busy === c.id} onClick={() => triage(c, t)}>{t}</button>
                  ))}
                  {c.triage !== 'Untriaged' && <button className="aos-ghost" disabled={busy === c.id} onClick={() => triage(c, 'Untriaged')}>Undo</button>}
                  {c.lead && <button className="aos-ghost" onClick={() => crm.open(c.lead)}>Open lead</button>}
                </div>
              </article>
            ))}
            {list.length > shown && <button className="aos-chip aos-self-start" onClick={() => setShown((n) => n + 60)}>Show more ({list.length - shown} left)</button>}
            {!list.length && <p className="aos-muted aos-small">Nothing here.</p>}
          </div>
        </>
      )}
    </div>
  );
}

function ImportConnections({ onDone, notify }: { onDone: () => void; notify: (m: string) => void }) {
  const [rows, setRows] = useState<ReturnType<typeof parseLinkedIn>>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const run = async () => {
    if (!rows) return;
    setErr('');
    let created = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < rows.length; i += 500) {
        setBusy(`Importing ${Math.min(i + 500, rows.length)} of ${rows.length}`);
        const r = await api<{ created: number; skipped: number }>('/api/os/connections', { action: 'import', rows: rows.slice(i, i + 500) });
        created += r.created;
        skipped += r.skipped;
      }
      notify(`${created} connections imported${skipped ? `, ${skipped} already here or skipped` : ''}.`);
      setRows(null);
      setName('');
      onDone();
    } catch (e) {
      setErr(`${e instanceof Error ? e.message : 'Import failed.'} ${created} were saved; run the file again to finish.`);
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="aos-panel aos-stack">
      <div className="aos-eyebrow">Import from LinkedIn</div>
      <p className="aos-small aos-muted">On LinkedIn: Settings, Data privacy, Get a copy of your data, pick Connections only. LinkedIn emails a link. Unzip it and choose Connections.csv here. Running it again later only adds new connections.</p>
      <div className="aos-toolbar">
        <input ref={ref} type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const p = parseLinkedIn(await f.text()); setRows(p); setName(f.name); setErr(p ? '' : 'That does not look like LinkedIn\'s Connections.csv (no "First Name" column).'); } e.target.value = ''; }} />
        <button className="aos-chip" onClick={() => ref.current?.click()} disabled={!!busy}>Choose Connections.csv</button>
        {rows && <span className="aos-small">{name}: {rows.length} connections</span>}
        {rows && rows.length > 0 && <button className="aos-btn aos-btn-sm" disabled={!!busy} onClick={run}>{busy || 'Import'}</button>}
      </div>
      {err && <p className="aos-error aos-small">{err}</p>}
    </section>
  );
}
