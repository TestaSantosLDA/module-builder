import { describe, expect, it } from 'vitest';
import { open, seal } from '../api/_fila';
import { parseQuote, photosEmail, salesEmail } from '../src/model/quote';

const plan = [{ id: 1, type: 'quarto', x: 0, y: 0, rot: 0, z: 0 }];
const base = { kind: 'pedido', nome: 'Ana Lima', email: 'ana@exemplo.pt', rgpd: true, fachada: 'madeira', casa: 'riga-t2', plan };

describe('fotos realistas', () => {
  it('the request keeps the photo choice and the sales email mentions it', () => {
    const p = parseQuote({ ...base, fotos: true });
    expect(p.ok && p.value.kind === 'pedido' && p.value.fotos).toBe(true);
    const n = parseQuote({ ...base, fotos: 'sim' });
    expect(n.ok && n.value.kind === 'pedido' && n.value.fotos).toBe(false);
    if (p.ok && p.value.kind === 'pedido') expect(salesEmail(p.value, 'TH-261112-ABCD').html).toMatch(/fotos realistas/);
  });
  it('the client contact is sealed with the token and only opens with it', () => {
    const s = seal({ nome: 'Ana', email: 'ana@exemplo.pt' }, 'segredo');
    expect(s).not.toMatch(/ana@/);
    expect(open(s, 'segredo')).toEqual({ nome: 'Ana', email: 'ana@exemplo.pt' });
    expect(() => open(s, 'outro')).toThrow();
  });
  it('the photo email goes to the team to forward until the domain is verified', () => {
    const team = photosEmail('TH-261112-ABCD', 'Ana Lima', 'ana@exemplo.pt', false);
    expect(team.subject).toMatch(/reencaminhar/); expect(team.html).toMatch(/ana@exemplo.pt/);
    const direct = photosEmail('TH-261112-ABCD', 'Ana <b>Lima</b>', 'ana@exemplo.pt', true);
    expect(direct.subject).not.toMatch(/reencaminhar/); expect(direct.html).not.toMatch(/<b>Lima/);
  });
});
