// Client-safe: scoring used by the API and shown in the triage screen.
const WEIGHTS: [RegExp, number][] = [
  [/\bnil\b|name,? image/i, 4],
  [/\bsaac\b/i, 4],
  [/student[- ]athlete|athlete development|athlete success|athlete wellness/i, 4],
  [/athletic|athletics|\bad\b/i, 3],
  [/collective/i, 3],
  [/compliance/i, 2],
  [/sports? (management|business|admin)/i, 3],
  [/foundation|nonprofit|non-profit|philanthrop/i, 2],
  [/\bagent\b|agency|sports marketing/i, 2],
  [/sport|coach/i, 1],
  [/universit|college|campus|\bncaa\b/i, 1],
];
export function fitScore(title: string, company: string) {
  const t = `${title} ${company}`;
  return WEIGHTS.reduce((n, [re, w]) => n + (re.test(t) ? w : 0), 0);
}
// LinkedIn's export writes dates like "10 Nov 2026". Returns YYYY-MM-DD or the original text.
export function liDate(v: string) {
  const m = v.trim().match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
  if (!m) return v.trim();
  const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()) + 1;
  return mon ? `${m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.trim();
}
