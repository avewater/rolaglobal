import 'server-only';
import type { NextRequest } from 'next/server';
import { COOKIE, verifySession } from './os-auth';
import { OS_TABLES, getRecord, list, str } from './os-airtable';
import { effectivePerms, isRole, type OsUser, type Perm } from './os-roles';

// First line of every protected route. Re-reads the person's row on every call,
// so switching someone off or changing a permission takes effect on their next tap.
export async function getUser(req: NextRequest): Promise<OsUser | null> {
  const session = verifySession(req.cookies.get(COOKIE)?.value);
  if (!session) return null;
  const row = await getRecord(OS_TABLES.reps, session.sub);
  if (!row || row.fields.active !== true) return null;
  const role = row.fields.os_role;
  if (!isRole(role)) return null;
  return {
    id: row.id,
    name: str(row.fields.rep_name) || session.name,
    role,
    perms: effectivePerms(role, list(row.fields.os_grant), list(row.fields.os_revoke)),
  };
}

export const can = (user: OsUser, perm: Perm) => user.perms.includes(perm);
