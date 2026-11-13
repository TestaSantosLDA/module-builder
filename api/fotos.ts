// Realistic photos rendered in Blender on Jular's PC (the worker there polls this endpoint).
//   GET  /api/fotos?fila=1                 waiting requests (no client data)
//   POST /api/fotos?entregar=<ref>         { images: [{ name, data: base64 JPEG }] } → emailed, request removed
//   POST /api/fotos?falhou=<ref>           { erro } → the Jular team is told, request kept
// All need "Authorization: Bearer <FOTOS_TOKEN>" (set in Vercel 2026-11-13; the PC worker reads it from .fotos_token).
// Env: FOTOS_TOKEN, BLOB_READ_WRITE_TOKEN (Vercel Blob), RESEND_API_KEY, QUOTE_TO, QUOTE_FROM,
//      FOTOS_CLIENTE=1 once the sender domain is verified (photos go straight to the client; before that, to QUOTE_TO).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'node:crypto';
import { photosEmail } from '../src/model/quote.js';
import { find, open, pending, remove } from './_fila.js';
import { salesTo, sendMail } from './_mail.js';

const MAX_IMAGES = 4, MAX_B64 = 1_400_000;

function authorised(req: VercelRequest, token: string): boolean {
  const h = String(req.headers.authorization ?? ''), want = `Bearer ${token}`;
  return h.length === want.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(want));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = process.env.FOTOS_TOKEN;
  if (!token || !process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'Fila de fotos não configurada.' });
  if (!authorised(req, token)) return res.status(401).json({ error: 'Não autorizado.' });
  const q = req.query, ref = String(q.entregar ?? q.falhou ?? '');

  if (req.method === 'GET' && q.fila) {
    const jobs = (await pending()).map(({ job: { contacto: _c, ...j } }) => j);
    return res.status(200).json({ jobs });
  }
  if (req.method !== 'POST' || !/^TH-\d{6}-[A-Z0-9]{4}$/.test(ref)) return res.status(400).json({ error: 'Pedido inválido.' });
  const e = await find(ref);
  if (!e) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>;

  if (q.falhou) {
    const erro = String(body.erro ?? '').slice(0, 2000);
    await sendMail(salesTo(), { subject: `Fotos ${ref}: o render falhou`, html: `<p>O render das fotos do pedido ${ref} falhou no PC. O pedido continua na fila.</p><pre>${erro.replace(/</g, '&lt;')}</pre>`, text: `O render das fotos do pedido ${ref} falhou.\n\n${erro}` });
    return res.status(200).json({ ok: true });
  }

  const imgs = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  const attachments = imgs.flatMap((i, n) => {
    const { name, data } = (i ?? {}) as Record<string, unknown>;
    if (typeof data !== 'string' || data.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(data) || !data.startsWith('/9j/')) return []; // base64 JPEG
    const base = String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/jpe?g$/, '').slice(0, 30) || `foto${n + 1}`;
    return [{ filename: `${ref}-${base}.jpg`, content: data }];
  });
  if (!attachments.length) return res.status(400).json({ error: 'Sem imagens JPEG.' });

  const c = open(e.job.contacto, token), direct = process.env.FOTOS_CLIENTE === '1';
  const ok = await sendMail(direct ? [c.email] : salesTo(), photosEmail(ref, c.nome, c.email, direct), { replyTo: direct ? salesTo()[0] : c.email, attachments });
  if (!ok) return res.status(502).json({ error: 'O email não saiu; o pedido fica na fila.' });
  await remove(e.url);
  return res.status(200).json({ ok: true, enviado: direct ? 'cliente' : 'equipa' });
}

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
