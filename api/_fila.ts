// Queue of realistic-photo requests, kept in Vercel Blob (fotos/fila/<ref>-<random>.json).
// The Blender worker on Jular's PC reads it through /api/fotos; the client's name and email are sealed with a key
// derived from FOTOS_TOKEN, so the blob itself never holds them in clear text.
// Files starting with "_" in api/ are not deployed as functions.
import { del, list, put } from '@vercel/blob';
import crypto from 'node:crypto';
import type { Mod } from '../src/model/catalog.js';
import type { FinishId } from '../src/model/quote.js';

export interface Job { ref: string; casa: string; fachada: FinishId; plan: Mod[]; criado: string }
export interface Contact { nome: string; email: string }
interface Stored extends Job { contacto: string }

const PREFIX = 'fotos/fila/';

const key = (token: string) => crypto.createHash('sha256').update('treehouse-fotos:' + token).digest();

export function seal(c: Contact, token: string): string {
  const iv = crypto.randomBytes(12), ci = crypto.createCipheriv('aes-256-gcm', key(token), iv);
  const ct = Buffer.concat([ci.update(JSON.stringify(c), 'utf8'), ci.final()]);
  return Buffer.concat([iv, ci.getAuthTag(), ct]).toString('base64');
}

export function open(s: string, token: string): Contact {
  const b = Buffer.from(s, 'base64'), de = crypto.createDecipheriv('aes-256-gcm', key(token), b.subarray(0, 12));
  de.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([de.update(b.subarray(28)), de.final()]).toString('utf8')) as Contact;
}

export async function enqueue(job: Job, c: Contact, token: string): Promise<void> {
  const body: Stored = { ...job, contacto: seal(c, token) };
  await put(`${PREFIX}${job.ref}.json`, JSON.stringify(body), { access: 'public', addRandomSuffix: true, contentType: 'application/json' });
}

interface Entry { url: string; job: Stored }

/** Waiting requests, oldest first. */
export async function pending(): Promise<Entry[]> {
  const { blobs } = await list({ prefix: PREFIX, limit: 100 });
  blobs.sort((a, b) => +new Date(a.uploadedAt) - +new Date(b.uploadedAt));
  const out: Entry[] = [];
  for (const b of blobs) {
    const r = await fetch(b.url, { cache: 'no-store' });
    if (r.ok) out.push({ url: b.url, job: (await r.json()) as Stored });
  }
  return out;
}

export async function find(ref: string): Promise<Entry | undefined> {
  return (await pending()).find(e => e.job.ref === ref);
}

export const remove = (url: string) => del(url);
