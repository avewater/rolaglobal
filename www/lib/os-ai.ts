import 'server-only';
import type { Contact } from './os-roles';

export { BANNED, PLACEHOLDER, checkDraft, similarity } from './os-checks';

const SYSTEM = `You write short LinkedIn direct messages for Michael Apan, Head of Research and Partnerships at ROLA Global, to people he is already connected with on LinkedIn.

About ROLA: a research platform on how college athletes who earn NIL income prepare for it, from business basics to foundations and life after their playing careers. ROLA runs free workshops with Philanthropy for Athletes and offers schools a selective research partnership.

Write three messages for one person:
1. Touch 1 (day 0). Goal: get a reply. One real line about them, built on the research note about what they are working on now, then one easy question about their world. No link. No call request. No pitch. Under 60 words.
2. Touch 2 (day 4). Goal: give value. A short note offering one useful thing: write the literal placeholder [workshop date or article link] where it goes. Say no reply is needed. Under 60 words.
3. Touch 3 (day 9 to 10). Goal: close the loop politely. Ask if someone else on their team is the right person for this. Under 45 words.

Rules:
- Sound like a real person who knows them. Warm, plain, specific. Match how well Michael knows them.
- Use the Must mention note if one is given.
- Start Touch 1 with "Hi {first name}," on its own line. Sign each message "Michael" on its own last line.
- Never give tax, legal or insurance advice. Never mention prices, savings, deductions, tax exemption or anyone's tax burden. Never say a department lacks capacity. Never say "free pilot"; say "selective research partnership" if a partnership comes up. Nothing aimed at minors.
- No em dashes. No emoji. No hashtags.
- Only use facts from the notes. Do not invent events, numbers or mutual contacts.

Reply with JSON only: {"touch1": "...", "touch2": "...", "touch3": "..."}`;

export class AiError extends Error {}

export async function draftTouches(lead: Contact, extra: string[] = []) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AiError('AI drafting is not set up yet: the Anthropic API key is missing from the site settings.');
  const notes = [
    `Name: ${lead.name}`,
    lead.title && `Title: ${lead.title}`,
    (lead.organization || lead.institution) && `Organization: ${lead.organization || lead.institution}`,
    lead.rel_strength && `How well Michael knows them: ${lead.rel_strength}`,
    lead.warm_path && `How they are connected: ${lead.warm_path}`,
    `What they are working on now: ${lead.current_work}`,
    lead.fit_reason && `Angle for ROLA: ${lead.fit_reason}`,
    lead.must_mention && `Must mention: ${lead.must_mention}`,
    lead.notes && `Other research notes: ${lead.notes.slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join('\n');
  const user = `Research notes from Rein:\n${notes}${extra.length ? `\n\nYour last draft had these problems. Fix them:\n- ${extra.join('\n- ')}` : ''}`;
  const res = await fetch(`${process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 4000, thinking: { type: 'between_tools' }, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('anthropic', res.status, t.slice(0, 500));
    throw new AiError(res.status === 401 ? 'The Anthropic API key was rejected. Check it in the site settings.' : 'The AI could not write drafts right now. Try again in a minute.');
  }
  const j = await res.json();
  const text: string = (j.content ?? []).map((c: any) => (c.type === 'text' ? c.text : '')).join('');
  const m = text.match(/\{[\s\S]*\}/);
  let out: any;
  try {
    out = JSON.parse(m ? m[0] : text);
  } catch {
    throw new AiError('The AI reply could not be read. Try again.');
  }
  const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s*—\s*/g, ', ').trim().slice(0, 2000) : '');
  const touches = [clean(out.touch1), clean(out.touch2), clean(out.touch3)];
  if (touches.some((x) => !x)) throw new AiError('The AI reply was missing a message. Try again.');
  return touches;
}
