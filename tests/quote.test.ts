import { describe, expect, it } from 'vitest';
import { rigaT2 } from '../src/model/houses';
import { newRef, parseQuote, salesEmail, type QuoteRequest } from '../src/model/quote';

let n = 1;
const plan = rigaT2(() => n++);
const base = { kind: 'pedido', nome: 'Ana Silva', email: 'ana@example.com', rgpd: true, fachada: 'madeira', casa: 'riga-t2', plan };

describe('parseQuote', () => {
  it('accepts name + email + consent', () => {
    const r = parseQuote(base);
    expect(r.ok && r.value.kind === 'pedido' && r.value.fachada).toBe('madeira');
  });
  it('requires name, a valid email and consent', () => {
    expect(parseQuote({ ...base, nome: ' ' })).toMatchObject({ ok: false });
    expect(parseQuote({ ...base, email: 'ana@' })).toMatchObject({ ok: false });
    expect(parseQuote({ ...base, rgpd: false })).toMatchObject({ ok: false });
  });
  it('rejects an empty or invalid plan', () => {
    expect(parseQuote({ ...base, plan: [] })).toMatchObject({ ok: false });
    expect(parseQuote({ ...base, plan: [{ id: 1, type: 'x' }] })).toMatchObject({ ok: false });
  });
  it('drops images that are not small JPEGs', () => {
    const r = parseQuote({ ...base, image: 'data:image/png;base64,AAAA' });
    expect(r.ok && r.value.kind === 'pedido' && r.value.image).toBeUndefined();
  });
  it('accepts follow-up details with a valid reference', () => {
    expect(parseQuote({ kind: 'detalhes', ref: 'TH-261111-AB2C', email: 'ana@example.com', concelho: 'Viseu' })).toMatchObject({ ok: true });
    expect(parseQuote({ kind: 'detalhes', ref: 'x', email: 'ana@example.com' })).toMatchObject({ ok: false });
  });
});

describe('salesEmail', () => {
  it('summarises the house and escapes what the client typed', () => {
    const q = { ...base, nome: '<b>Ana</b>' } as QuoteRequest;
    const m = salesEmail(q, 'TH-261111-AB2C');
    expect(m.subject).toBe('Novo pedido TH-261111-AB2C · 69 m² · 1 piso(s) · <b>Ana</b>');
    expect(m.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(m.html).not.toContain('<b>Ana</b>');
    expect(m.html).toContain('Madeira');
    expect(m.html).toContain('Treehouse Riga T2');
    expect(m.text).toContain('Piso 0: 2 × Deck');
  });
});

describe('newRef', () => {
  it('has the date and 4 characters', () => {
    expect(newRef(new Date('2026-11-11T10:00:00Z'), () => 0)).toBe('TH-261111-AAAA');
    expect(parseQuote({ kind: 'detalhes', ref: newRef(), email: 'a@b.pt' })).toMatchObject({ ok: true });
  });
});
