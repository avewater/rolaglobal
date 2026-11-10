// Client-safe draft checks, shared by the API (which blocks approval) and the UI (which shows them live).
// Phrases ROLA never uses (brand guardrails, Nov 10 proposal). Checked in code, not just in the prompt.
export const BANNED: { re: RegExp; label: string }[] = [
  { re: /tax[- ]exempt/i, label: '"tax exempt"' },
  { re: /ease (their|your) tax burden/i, label: '"ease their tax burden"' },
  { re: /\bsavings?\b/i, label: '"savings"' },
  { re: /\bdeductions?\b/i, label: '"deductions"' },
  { re: /\bcapacity\b/i, label: '"capacity"' },
  { re: /free pilot/i, label: '"free pilot"' },
  { re: /\$\s?\d|\bpric(e|ing)\b/i, label: 'pricing' },
  { re: /—/, label: 'an em dash' },
];
export const PLACEHOLDER = /\[[^\]]{2,60}\]/;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
const shingles = (s: string) => {
  const w = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(' '));
  return out;
};
export function similarity(a: string, b: string) {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((x) => B.has(x) && n++);
  return n / Math.min(A.size, B.size);
}

// Hard problems block approval. Soft ones are shown as warnings.
export function checkDraft(body: string, opts: { touch: number; currentWork?: string; others?: string[] }) {
  const hard: string[] = [];
  const soft: string[] = [];
  for (const b of BANNED) if (b.re.test(body)) hard.push(`Contains ${b.label}`);
  if (PLACEHOLDER.test(body)) hard.push(`Fill in ${body.match(PLACEHOLDER)![0]}`);
  if (/https?:\/\//i.test(body) && opts.touch === 1) hard.push('Touch 1 has no links');
  if (opts.touch === 1 && opts.currentWork) {
    const first = body.split(/\n/).find((l) => l.trim() && !/^(hi|hey|hello)\b[^.!?]*,?$/i.test(l.trim())) ?? '';
    const cw = new Set(words(opts.currentWork));
    if (cw.size && !words(first).some((w) => cw.has(w))) soft.push("First line does not use Rein's \"What they're working on\" note");
  }
  const sim = Math.max(0, ...(opts.others ?? []).map((o) => similarity(body, o)));
  if (sim >= 0.5) soft.push('Very similar to another draft this week');
  if (body.length > 600 && opts.touch === 1) soft.push('Long for a first LinkedIn message');
  return { hard, soft, flags: [...hard, ...soft].join('\n') };
}

