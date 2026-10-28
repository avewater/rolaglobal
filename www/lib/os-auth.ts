import 'server-only';
import crypto from 'node:crypto';
import { isRole, type Role } from './os-roles';

export const COOKIE = 'rola_os';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

type Session = { sub: string; name: string; role: Role; exp: number };

function secret() {
  const s = process.env.OS_SESSION_SECRET || process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('OS_SESSION_SECRET is missing or shorter than 32 characters.');
  return s;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sig = (payload: string) => b64(crypto.createHmac('sha256', secret()).update(payload).digest());

export function signSession(s: Omit<Session, 'exp'>) {
  const payload = b64(JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return `${payload}.${sig(payload)}`;
}

export function verifySession(token: string | undefined): Session | null {
  if (!token || token.length > 2000) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sig(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (!s.sub || !isRole(s.role) || s.exp < Date.now() / 1000) return null;
    return s;
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE,
};
