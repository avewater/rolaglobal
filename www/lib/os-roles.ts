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
  'edit_leads',
  'import_leads',
  'accounts',
  'assign_tasks',
] as const;
export type Perm = (typeof PERMS)[number];

export const ROLE_DEFAULTS: Record<Role, Perm[]> = {
  Admin: [...PERMS],
  Partner: ['today', 'accounts', 'pipeline', 'see_contact', 'edit_leads', 'athletes', 'workshops', 'partnerships', 'report', 'foundations', 'reports', 'tools', 'playbook'],
  // VA is the Outreach role (Rein): works the pipeline end to end, no revenue, no import.
  // assign_tasks: Rein can assign account tasks to teammates (Michael, Nov 6).
  VA: ['today', 'accounts', 'assign_tasks', 'pipeline', 'see_contact', 'edit_leads', 'workshops', 'reports', 'tools', 'playbook'],
  Facilitator: ['today', 'accounts', 'athletes', 'workshops', 'tools', 'playbook'],
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

export type SectionKey =
  | 'queue' | 'tasks' | 'accounts' | 'drafts' | 'pipeline'
  | 'today' | 'schools' | 'reports' | 'decisions' | 'agents' | 'import' | 'profile';
export type SectionGroup = 'Work' | 'Overview' | 'Intelligence' | 'Settings';
export const SECTIONS: { key: SectionKey; label: string; perm: Perm | null; group: SectionGroup }[] = [
  { key: 'queue', label: 'My Queue', perm: null, group: 'Work' },
  { key: 'tasks', label: 'Tasks', perm: 'accounts', group: 'Work' },
  { key: 'accounts', label: 'Accounts', perm: 'accounts', group: 'Work' },
  { key: 'drafts', label: 'Drafts', perm: 'accounts', group: 'Work' },
  { key: 'pipeline', label: 'Leads', perm: 'pipeline', group: 'Work' },
  { key: 'today', label: 'Dashboard', perm: 'today', group: 'Overview' },
  { key: 'schools', label: 'Schools', perm: 'pipeline', group: 'Overview' },
  { key: 'reports', label: 'Reports', perm: 'reports', group: 'Intelligence' },
  { key: 'decisions', label: 'Decisions', perm: 'decisions', group: 'Intelligence' },
  { key: 'agents', label: 'Agents', perm: 'agents', group: 'Intelligence' },
  { key: 'import', label: 'Import leads', perm: 'import_leads', group: 'Settings' },
  { key: 'profile', label: 'My profile', perm: null, group: 'Settings' },
];

export function sectionsFor(perms: Perm[]) {
  return SECTIONS.filter((s) => s.perm === null || perms.includes(s.perm));
}

// The 12-stage outreach pipeline. Both brands share the stages; the board filters by brand.
export const LEAD_STAGES = ['New', 'Researched', 'Draft Ready', 'Approved', 'Touch 1', 'Touch 2', 'Touch 3', 'Replied', 'Meeting Booked', 'Closed Won', 'Closed Lost', 'Do Not Contact'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const CLOSED_STAGES: readonly string[] = ['Closed Won', 'Closed Lost', 'Do Not Contact'];
export const REASON_STAGES: readonly string[] = ['Closed Lost', 'Do Not Contact'];
export const isOpenStage = (s: string) => !CLOSED_STAGES.includes(s);
// Stages that send something to the lead. Do Not Contact blocks every one of them.
export const SEND_STAGES: readonly string[] = ['Approved', 'Touch 1', 'Touch 2', 'Touch 3'];
export const DISPOSITION_REASONS = ['Not interested', 'Wrong person', 'No response', 'Not a fit', 'Other'] as const;
export const BRANDS = ['ROLA Global', 'AAVE Water'] as const;
export const GRADES = ['A', 'B', 'C'] as const;
export const SOURCES = ['SAAC', 'Collective', 'Program', 'AD', 'Inbound form', 'Referral', 'LinkedIn', 'Event', 'Other'] as const;
export const OWNERS = ['Michael', 'Rein', 'Sid', 'Hussain'] as const;
export const LOG_TYPES = ['Email logged', 'LinkedIn logged', 'Call logged', 'Reply received'] as const;
export const ACTIVITY_TYPES = ['Stage change', 'Comment', 'Email logged', 'LinkedIn logged', 'Call logged', 'Reply received', 'Note', 'Import'] as const;
// Old 5-stage values, read only so nothing already in Airtable disappears from the board.
export const LEGACY_STAGE: Record<string, LeadStage> = {
  'Research partner identified': 'Researched',
  'Outreach sent': 'Touch 1',
  'Response received': 'Replied',
  'Meeting booked': 'Meeting Booked',
  'Partnership active': 'Closed Won',
};
// Who a signed-in person is in the owner list (Reps name "Rein ..." is owner "Rein").
export const ownerFor = (name: string) => OWNERS.find((o) => name.toLowerCase().startsWith(o.toLowerCase())) || '';
export const SAMPLE_FLOOR = 10;

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
export type Tile = { key: string; label: string; value: string; note?: string; go?: SectionKey; tone: Tone };

export type Profile = { title: string; email: string; phone: string; linkedin: string; instagram: string; x: string; tiktok: string; website: string };
export const PROFILE_KEYS = ['title', 'email', 'phone', 'linkedin', 'instagram', 'x', 'tiktok', 'website'] as const;
export const profileComplete = (p: Profile) => Boolean(p.title && p.email && p.phone);
export type OsUser = { id: string; name: string; role: Role; perms: Perm[]; profile: Profile };

// Accounts: customer profiles. Everything else (tasks, notes, messages, updates) lives inside an account.
// An Entry with a date is a task; without a date it is a note.
// A Message with a date is scheduled; without one it is a draft. The OS never sends messages.
export const ACCOUNT_TYPES = ['Athlete', 'Athletic department', 'Collective', 'Agency', 'Professional organization', 'Nonprofit', 'Brand or sponsor', 'Other'] as const;
export const ACCOUNT_FIELDS_EDIT = ['name', 'account_type', 'brand', 'title', 'organization', 'email', 'phone', 'linkedin', 'instagram', 'x', 'tiktok', 'website', 'about'] as const;
export type Account = {
  id: string;
  name: string;
  account_type: string;
  brand: string;
  title: string;
  organization: string;
  email: string;
  phone: string;
  linkedin: string;
  instagram: string;
  x: string;
  tiktok: string;
  website: string;
  about: string;
  lead: string;
  owner_name: string;
  created_by: string;
  created: string;
};
export const CHANNELS = ['Email', 'LinkedIn', 'Text', 'Instagram', 'Other'] as const;
export type Item = {
  id: string;
  account: string;
  kind: 'Entry' | 'Message' | 'Update';
  title: string;
  body: string;
  channel: string;
  to_name: string;
  subject: string;
  due_date: string;
  due_time: string;
  status: 'Open' | 'Done' | 'Sent';
  assignee: string;
  assignee_name: string;
  created_by: string;
  created_by_rec: string;
  done_at: string;
  done_by: string;
  created: string;
};
export const isTask = (i: Pick<Item, 'kind' | 'due_date'>) => i.kind === 'Entry' && !!i.due_date;
export const itemLabel = (i: Pick<Item, 'kind' | 'due_date'>) =>
  i.kind === 'Update' ? 'Update' : i.kind === 'Message' ? (i.due_date ? 'Scheduled message' : 'Draft message') : i.due_date ? 'Task' : 'Note';
export type Teammate = { id: string; name: string; canAccounts: boolean };

export type Contact = {
  id: string;
  name: string;
  title: string;
  organization: string;
  institution: string;
  stage: string;
  brand: string;
  grade: string;
  owner: string;
  source: string;
  channel: string;
  warm_path: string;
  athlete_reach: number;
  next_action: string;
  next_action_due: string;
  last_touch: string;
  stage_changed_at: string;
  pinned_note: string;
  disposition_reason: string;
  dnc: boolean;
  linkedin_url: string;
  email?: string;
  phone?: string;
};
export type Activity = { id: string; type: string; summary: string; body: string; by: string; at: string; from_stage: string; to_stage: string; mentions: string; lead: string };
export type Mention = Activity & { lead_name: string };
export type School = { id: string; name: string; type: string; conference: string; tier: string; core: number; page_public: boolean; floor_crossed_on: string };
export type Report = { id: string; title: string; date: string; agent: string; status: string; body: string };
export type Decision = { id: string; code: string; decision: string; area: string; status: string; outcome: string; opened_on: string; decided_on: string };
export type Agent = { id: string; agent: string; sort: number; discipline: string; heat: string; build_status: string; schedule: string; focus: string };

export type OsData = {
  user: OsUser;
  generatedAt: string;
  tiles: Tile[];
  contacts?: Contact[];
  mentions?: Mention[];
  accounts?: Account[];
  items?: Item[];
  team?: Teammate[];
  schools?: School[];
  reports?: Report[];
  decisions?: Decision[];
  agents?: Agent[];
  errors: string[];
};
