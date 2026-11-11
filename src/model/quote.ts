// Quote request: the payload the site sends and the email the Jular sales team receives.
// Shared by the browser (src/ui/quote.ts) and the serverless function (api/quote.ts).
import type { Mod } from './catalog.js';
import { summarize } from './geometry.js';
import { parsePlan } from './plan.js';
import { DEFAULT_HOUSE, houseById } from './houses.js';

export const FINISH_NAMES = { branco: 'Branco', madeira: 'Madeira', grafite: 'Grafite' } as const;
export type FinishId = keyof typeof FINISH_NAMES;

export interface QuoteRequest {
  kind: 'pedido';
  nome: string;
  email: string;
  tel?: string;
  rgpd: true;
  fachada: FinishId;
  /** catalogue house the plan started from */
  casa: string;
  plan: Mod[];
  /** JPEG data URL of the 3D view, optional */
  image?: string;
  /** honeypot: real people leave it empty */
  website?: string;
}

export interface QuoteDetails {
  kind: 'detalhes';
  ref: string;
  email: string;
  concelho?: string;
  terreno?: string;
  uso?: string;
}

export const MAX_IMAGE_CHARS = 900_000; // ~650 KB JPEG
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseQuote(body: unknown): Parsed<QuoteRequest | QuoteDetails> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Pedido inválido.' };
  const b = body as Record<string, unknown>;
  const email = str(b.email, 200);
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Indique um email válido.' };
  if (b.kind === 'detalhes') {
    const ref = str(b.ref, 40);
    if (!/^TH-\d{6}-[A-Z0-9]{4}$/.test(ref)) return { ok: false, error: 'Referência inválida.' };
    return { ok: true, value: { kind: 'detalhes', ref, email, concelho: str(b.concelho, 80), terreno: str(b.terreno, 40), uso: str(b.uso, 60) } };
  }
  const nome = str(b.nome, 120);
  if (!nome) return { ok: false, error: 'Indique o seu nome.' };
  if (b.rgpd !== true) return { ok: false, error: 'É preciso aceitar o tratamento dos dados.' };
  const plan = parsePlan(b.plan);
  if (!plan || !plan.length) return { ok: false, error: 'A planta está vazia ou inválida.' };
  const fachada = (Object.keys(FINISH_NAMES) as FinishId[]).find(f => f === b.fachada) ?? 'branco';
  let image: string | undefined;
  if (typeof b.image === 'string' && b.image.startsWith('data:image/jpeg;base64,') && b.image.length <= MAX_IMAGE_CHARS) image = b.image;
  const casa = houseById(str(b.casa, 40))?.id ?? DEFAULT_HOUSE;
  return { ok: true, value: { kind: 'pedido', nome, email, tel: str(b.tel, 40), rgpd: true, fachada, casa, plan, image, website: str(b.website, 200) } };
}

/** Request reference, e.g. TH-261111-K3QZ. */
export function newRef(now = new Date(), rand = Math.random): string {
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `TH-${d}-${Array.from({ length: 4 }, () => A[Math.floor(rand() * A.length)]).join('')}`;
}

export const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const row = (k: string, v?: string) => (v ? `<tr><th style="text-align:left;color:#5d6b7a;font-weight:400;padding:5px 6px;border-bottom:1px solid #dde3ea;width:38%">${esc(k)}</th><td style="padding:5px 6px;border-bottom:1px solid #dde3ea">${esc(v)}</td></tr>` : '');
const h5 = (t: string) => `<h3 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#9a6a36;margin:18px 0 6px">${t}</h3>`;
const table = (rows: string) => `<table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table>`;

export interface Email { subject: string; html: string; text: string }

/** Email to the Jular sales team for a new request. */
export function salesEmail(q: QuoteRequest, ref: string): Email {
  const s = summarize(q.plan);
  const subject = `Novo pedido ${ref} · ${s.area} m² · ${s.floors} piso(s) · ${q.nome}`;
  const html = `<div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#1d2733;max-width:640px">
<p>Um cliente montou uma casa no construtor e pediu orçamento. Responder em até 2 dias úteis.</p>
${h5('Cliente')}${table(row('Nome', q.nome) + row('Email', q.email) + row('Telefone', q.tel || 'não indicado'))}
${h5('Casa')}${table(row('Ponto de partida', houseById(q.casa)?.name ?? '-') + s.rows.map(r => row('Piso ' + r.level, r.items.join(', '))).join('') + row('Área interior', s.area + ' m²') + row('Deck', s.deck + ' m²') + row('Portas criadas', String(s.doors)) + row('Fachada', FINISH_NAMES[q.fachada]))}
${s.msgs.length ? `<p style="background:#fff4ef;border-left:3px solid #d9573f;padding:8px 10px;font-size:13px;margin-top:10px"><b>A planta tem avisos:</b> ${esc(s.msgs.join(' '))}</p>` : ''}
<p style="font-size:13px;color:#5d6b7a">Em anexo: ${q.image ? 'vista 3D da casa e ' : ''}a planta (planta.json) para reabrir no construtor.</p>
${h5('Próximos passos sugeridos')}<ol style="margin:0;padding-left:18px"><li>Ligar ao cliente e confirmar terreno, acessos de camião e grua, e acabamentos.</li><li>Validar a planta com a equipa técnica (módulos, cargas, escadas).</li><li>Enviar o orçamento com mapa de medições.</li></ol>
</div>`;
  const text = [`Novo pedido ${ref}`, '', `Nome: ${q.nome}`, `Email: ${q.email}`, `Telefone: ${q.tel || 'não indicado'}`, '',
    ...s.rows.map(r => `Piso ${r.level}: ${r.items.join(', ')}`), `Área interior: ${s.area} m²`, `Deck: ${s.deck} m²`, `Fachada: ${FINISH_NAMES[q.fachada]}`,
    ...(s.msgs.length ? ['', 'Avisos: ' + s.msgs.join(' ')] : [])].join('\n');
  return { subject, html, text };
}

/** Follow-up email when the client adds optional details after sending. */
export function detailsEmail(d: QuoteDetails): Email {
  const subject = `Detalhes do pedido ${d.ref}`;
  const rows = row('Email do cliente', d.email) + row('Concelho do terreno', d.concelho) + row('Tem terreno', d.terreno) + row('Uso da casa', d.uso);
  return {
    subject,
    html: `<div style="font:14px/1.5 Arial,Helvetica,sans-serif;color:#1d2733;max-width:640px"><p>O cliente acrescentou detalhes ao pedido ${esc(d.ref)}.</p>${table(rows)}</div>`,
    text: [`Detalhes do pedido ${d.ref}`, `Email: ${d.email}`, `Concelho: ${d.concelho || '-'}`, `Terreno: ${d.terreno || '-'}`, `Uso: ${d.uso || '-'}`].join('\n'),
  };
}
