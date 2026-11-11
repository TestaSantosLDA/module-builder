// POST /api/quote — sends a quote request (or extra details) to the Jular sales team via Resend.
// Env: RESEND_API_KEY, QUOTE_TO (sales address), QUOTE_FROM (verified sender; defaults to Resend's test sender).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { detailsEmail, newRef, parseQuote, salesEmail } from '../src/model/quote.js';

const DEFAULT_FROM = 'TreeHouse Studio <onboarding@resend.dev>';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const key = process.env.RESEND_API_KEY, to = process.env.QUOTE_TO;
  if (!key || !to) return res.status(503).json({ error: 'O envio de pedidos ainda não está configurado.' });

  const parsed = parseQuote(typeof req.body === 'string' ? safeJson(req.body) : req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const q = parsed.value;

  if (q.kind === 'pedido' && q.website) return res.status(200).json({ ref: newRef() }); // bot filled the honeypot: pretend it worked

  const ref = q.kind === 'pedido' ? newRef() : q.ref;
  const mail = q.kind === 'pedido' ? salesEmail(q, ref) : detailsEmail(q);
  const attachments = q.kind === 'pedido'
    ? [
        { filename: `${ref}-planta.json`, content: Buffer.from(JSON.stringify({ ref, casa: q.casa, fachada: q.fachada, plan: q.plan })).toString('base64') },
        ...(q.image ? [{ filename: `${ref}-vista-3d.jpg`, content: q.image.slice(q.image.indexOf(',') + 1) }] : []),
      ]
    : undefined;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.QUOTE_FROM || DEFAULT_FROM, to: to.split(',').map(s => s.trim()), reply_to: q.email, subject: mail.subject, html: mail.html, text: mail.text, attachments }),
  });
  if (!r.ok) {
    console.error('Resend error', r.status, await r.text().catch(() => ''));
    return res.status(502).json({ error: 'Não foi possível enviar o pedido. Tente de novo dentro de momentos.' });
  }
  return res.status(200).json({ ref });
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
