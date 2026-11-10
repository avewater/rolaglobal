'use client';

// Admin-only Team report: accounts tracker and productivity for end of day and end of week (Pacific time).
import { useEffect, useState } from 'react';
import { api } from './crm';
import type { SectionKey } from '@/lib/os-roles';

type Range = 'today' | 'week' | 'lastweek';
type Report = {
  label: string;
  totals: { accounts: number; accounts_new: number; leads: number; leads_open: number; leads_new: number; online_leads_new: number };
  byStage: Record<string, number>;
  people: ({ name: string } & Record<string, number>)[];
  newAccounts: { id: string; name: string; organization: string; type: string; by: string; at: string }[];
};
const COLS: [string, string][] = [
  ['accounts', 'Accounts created'],
  ['added', 'Tasks and notes added'],
  ['tasks_done', 'Tasks completed'],
  ['sent', 'Messages sent'],
  ['outreach_logged', 'Outreach logged'],
  ['stage_moves', 'Stage moves'],
  ['replies', 'Replies logged'],
  ['triaged', 'Connections triaged'],
  ['updates', 'Updates'],
  ['comments', 'Comments'],
];
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' });

export function TeamReport({ go }: { go: (k: SectionKey, sub?: string) => void }) {
  const [range, setRange] = useState<Range>('today');
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    setData(null);
    setErr('');
    api<Report>(`/api/os/team?range=${range}`).then(setData).catch((e) => setErr(e instanceof Error ? e.message : 'Could not load.'));
  }, [range]);

  const t = data?.totals;
  const list = (data?.newAccounts ?? []).filter((a) => !q.trim() || [a.name, a.organization, a.type, a.by].some((v) => v.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="aos-stack-lg">
      <div className="aos-toolbar">
        <div className="aos-seg" role="group" aria-label="Period">
          {([['today', 'End of day'], ['week', 'End of week'], ['lastweek', 'Last week']] as [Range, string][]).map(([v, l]) => (
            <button key={v} aria-pressed={range === v} onClick={() => setRange(v)}>{l}</button>
          ))}
        </div>
        {data && <span className="aos-small aos-muted">{data.label}, Pacific time</span>}
      </div>
      {err && <p className="aos-error">{err}</p>}
      {!data && !err && <p className="aos-muted">Loading</p>}
      {data && t && (
        <>
          <div className="aos-tiles">
            <div className="aos-tile"><span className="aos-tile-label">Total accounts</span><span className="aos-tile-value">{t.accounts}</span></div>
            <div className="aos-tile"><span className="aos-tile-label">Accounts added, {range === 'today' ? 'today' : range === 'week' ? 'this week' : 'last week'}</span><span className="aos-tile-value">{t.accounts_new}</span></div>
            <div className="aos-tile"><span className="aos-tile-label">Open leads (of {t.leads})</span><span className="aos-tile-value">{t.leads_open}</span></div>
            <div className="aos-tile"><span className="aos-tile-label">Leads added ({t.online_leads_new} online)</span><span className="aos-tile-value">{t.leads_new}</span></div>
          </div>

          <section className="aos-stack">
            <div className="aos-eyebrow">By person</div>
            {data.people.length ? (
              <div className="aos-table-wrap">
                <table className="aos-table aos-table-static">
                  <thead><tr><th>Person</th>{COLS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
                  <tbody>
                    {data.people.map((p) => (
                      <tr key={p.name}><td className="aos-row-title">{p.name}</td>{COLS.map(([k]) => <td key={k} className={p[k] ? '' : 'aos-muted'}>{p[k] || 0}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="aos-muted">No activity in this period yet.</p>}
          </section>

          <section className="aos-stack">
            <div className="aos-eyebrow">Pipeline now</div>
            <div className="aos-chips">
              {Object.entries(data.byStage).filter(([, n]) => n > 0).map(([st, n]) => <span key={st} className="aos-pill">{st}: {n}</span>)}
            </div>
          </section>

          <section className="aos-stack">
            <div className="aos-row-head">
              <div className="aos-eyebrow">Accounts added ({data.newAccounts.length})</div>
              <input className="aos-input aos-search" type="search" placeholder="Filter by name, organization, type" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter accounts" />
            </div>
            <p className="aos-small aos-muted">Spot-check that new accounts fit ROLA: athletic departments, collectives, agencies, SAAC, campus and professional organizations, nonprofits that serve athletes.</p>
            {list.length ? (
              <div className="aos-table-wrap">
                <table className="aos-table">
                  <thead><tr><th>Name</th><th>Organization</th><th>Type</th><th>Added by</th><th>When</th></tr></thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} onClick={() => go('accounts', a.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('accounts', a.id)}>
                        <td className="aos-row-title">{a.name}</td><td>{a.organization}</td><td>{a.type || <span className="aos-muted">None</span>}</td><td>{a.by}</td><td>{when(a.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="aos-muted aos-small">None.</p>}
          </section>
        </>
      )}
    </div>
  );
}
