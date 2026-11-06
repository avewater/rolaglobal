'use client';

// Staff profile: each person edits their own.
import { useState } from 'react';
import { api } from './crm';
import { PROFILE_KEYS, profileComplete, type OsUser, type Profile } from '@/lib/os-roles';

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
