// Sends an email through Resend. Env: RESEND_API_KEY, QUOTE_FROM (verified sender; defaults to Resend's test sender).
import type { Email } from '../src/model/quote.js';

const DEFAULT_FROM = 'TreeHouse Studio <onboarding@resend.dev>';

export interface Attachment { filename: string; content: string }

export async function sendMail(to: string[], mail: Email, o: { replyTo?: string; attachments?: Attachment[] } = {}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.QUOTE_FROM || DEFAULT_FROM, to, reply_to: o.replyTo, subject: mail.subject, html: mail.html, text: mail.text, attachments: o.attachments }),
  });
  if (!r.ok) console.error('Resend error', r.status, await r.text().catch(() => ''));
  return r.ok;
}

export const salesTo = () => (process.env.QUOTE_TO ?? '').split(',').map(s => s.trim()).filter(Boolean);
