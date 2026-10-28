// Client-safe: no secrets here. The UI and the API both import this file so they agree.

export const ROLES = ['Admin', 'Partner', 'VA', 'Facilitator'] as const;
export type Role = (typeof ROLES)[number];

export const PERMS = [
  'today',
  'pipeline',
  'see_contact',
  'athletes',
  'workshops',
  'partnerships',
  'report',
  'foundations',
  'see_revenue',
  'reports',
  'decisions',
  'agents',
  'manage_team',
  'tools',
  'playbook',
] as const;
export type Perm = (typeof PERMS)[number];

export const ROLE_DEFAULTS: Record<Role, Perm[]> = {
  Admin: [...PERMS],
  Partner: ['today', 'pipeline', 'see_contact', 'athletes', 'workshops', 'partnerships', 'report', 'foundations', 'reports', 'tools', 'playbook'],
  VA: ['today', 'pipeline', 'workshops', 'reports', 'tools', 'playbook'],
  Facilitator: ['today', 'athletes', 'workshops', 'tools', 'playbook'],
};

// Which agents' reports each role may read.
export const AGENTS = ['Marcus Vega', 'Danielle Laurent', 'Jordan Blake', 'Simone Carter', 'Rafael Ortega', 'Amara Kofi', 'Teo Walsh'] as const;
export const ROLE_REPORT_AGENTS: Record<Role, readonly string[]> = {
  Admin: AGENTS,
  Partner: AGENTS.filter((a) => a !== 'Teo Walsh'),
  VA: ['Danielle Laurent', 'Jordan Blake'],
  Facilitator: ['Amara Kofi'],
};

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

export function effectivePerms(role: Role, grant: string[] = [], revoke: string[] = []): Perm[] {
  if (role === 'Admin') return [...PERMS];
  const set = new Set<string>([...ROLE_DEFAULTS[role], ...grant]);
  for (const r of revoke) set.delete(r);
  return PERMS.filter((p) => set.has(p));
}

export type SectionKey = 'today' | 'pipeline' | 'schools' | 'reports' | 'decisions' | 'agents' | 'account';
export const SECTIONS: { key: SectionKey; label: string; perm: Perm | null; group: 'Work' | 'Intelligence' | 'Resources' }[] = [
  { key: 'today', label: 'Today', perm: 'today', group: 'Work' },
  { key: 'pipeline', label: 'Pipeline', perm: 'pipeline', group: 'Work' },
  { key: 'schools', label: 'Schools', perm: 'pipeline', group: 'Work' },
  { key: 'reports', label: 'Reports', perm: 'reports', group: 'Intelligence' },
  { key: 'decisions', label: 'Decisions', perm: 'decisions', group: 'Intelligence' },
  { key: 'agents', label: 'Agents', perm: 'agents', group: 'Intelligence' },
  { key: 'account', label: 'Account', perm: null, group: 'Resources' },
];

export function sectionsFor(perms: Perm[]) {
  return SECTIONS.filter((s) => s.perm === null || perms.includes(s.perm));
}

export const PIPELINE_STAGES = ['Research partner identified', 'Outreach sent', 'Response received', 'Meeting booked', 'Partnership active'] as const;
export const SAMPLE_FLOOR = 10;

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
export type Tile = { key: string; label: string; value: string; note?: string; go?: SectionKey; tone: Tone };

export type OsUser = { id: string; name: string; role: Role; perms: Perm[] };

export type Contact = {
  id: string;
  name: string;
  title: string;
  institution: string;
  stage: string;
  owner: string;
  channel: string;
  next_action: string;
  next_action_due: string;
  last_touch: string;
  email?: string;
  phone?: string;
};
export type School = { id: string; name: string; type: string; conference: string; tier: string; core: number; page_public: boolean; floor_crossed_on: string };
export type Report = { id: string; title: string; date: string; agent: string; status: string; body: string };
export type Decision = { id: string; code: string; decision: string; area: string; status: string; outcome: string; opened_on: string; decided_on: string };
export type Agent = { id: string; agent: string; sort: number; discipline: string; heat: string; build_status: string; schedule: string; focus: string };

export type OsData = {
  user: OsUser;
  generatedAt: string;
  tiles: Tile[];
  contacts?: Contact[];
  schools?: School[];
  reports?: Report[];
  decisions?: Decision[];
  agents?: Agent[];
  errors: string[];
};
