// "Pedir orçamento": 1) contact (only name + email required), 2) sent, with optional extra details.
import type { Mod } from '../model/catalog';
import { summarize } from '../model/geometry';
import { esc, type FinishId } from '../model/quote';

export interface QuoteHost {
  getMods(): Mod[];
  finish(): FinishId;
  /** id of the catalogue house the plan started from */
  house(): string;
  /** JPEG data URL of the house, or null when 3D is not available */
  capture(): Promise<string | null>;
}

const ENDPOINT = '/api/quote';

async function post(body: unknown): Promise<{ ref?: string; error?: string; fotos?: boolean }> {
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j.error || 'Não foi possível enviar o pedido. Tente de novo dentro de momentos.' };
    return j;
  } catch {
    return { error: 'Sem ligação. Verifique a internet e tente de novo.' };
  }
}

export function setupQuote(host: QuoteHost): void {
  const modal = document.getElementById('modal')!, dlg = document.getElementById('dlg')!;
  const lead = { nome: '', email: '', tel: '', concelho: '', terreno: '', uso: '', ref: '', fotos: false };
  const close = () => { modal.hidden = true; };
  const steps = (n: number) => `<div class="steps"><span class="${n === 1 ? 'on' : ''}">1 · Contacto</span><span class="${n === 2 ? 'on' : ''}">2 · Enviado</span></div>`;
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim();

  /** fotos: opened from "Receber fotos realistas" (the photo box comes ticked and the text speaks of photos) */
  function open(fotos = false): void {
    const mods = host.getMods();
    dlg.className = 'dialog';
    if (!mods.length) {
      dlg.innerHTML = `<h3 id="dlgTitle">A planta está vazia</h3><p>Monte a sua casa primeiro, ou carregue em "Repor Riga T2" para partir da casa do catálogo.</p><div class="row"><button type="button" class="btn primary" id="qClose">Voltar</button></div>`;
      modal.hidden = false; document.getElementById('qClose')!.onclick = close; return;
    }
    const S = summarize(mods);
    dlg.innerHTML = `${steps(1)}<h3 id="dlgTitle">${fotos ? 'Receber fotos realistas' : 'Pedir orçamento'}</h3>
  <p>${fotos ? 'Calculamos fotografias realistas desta casa, com a luz do sol e os materiais reais da Jular, e enviamo-las para o seu email. Um consultor Jular fica também com a sua casa para lhe fazer o orçamento.' : 'Só precisamos de saber como falar consigo. Um consultor Jular analisa a sua casa e trata do resto consigo.'}</p>
  <div class="recap">${S.rows.map(r => `Piso ${r.level}: ${esc(r.items.join(', '))}`).join('\n')}\n${S.area} m² interiores · ${S.deck} m² deck · ${S.floors} piso(s)</div>
  <form id="qForm" novalidate>
    <label>Nome<input id="qNome" required autocomplete="name" maxlength="120" value="${esc(lead.nome)}"></label>
    <label>Email<input id="qEmail" type="email" required autocomplete="email" maxlength="200" value="${esc(lead.email)}"></label>
    <label>Telefone (opcional)<input id="qTel" type="tel" autocomplete="tel" maxlength="40" value="${esc(lead.tel)}"></label>
    <label class="hp" aria-hidden="true">Website<input id="qSite" tabindex="-1" autocomplete="off"></label>
    <label class="check"><input type="checkbox" id="qFotos" ${fotos || lead.fotos ? 'checked' : ''}> Quero receber 3 fotografias realistas desta casa por email.</label>
    <label class="check"><input type="checkbox" id="qRgpd" required> Aceito que a Jular me contacte sobre este pedido e trate estes dados para esse fim.</label>
    <p class="err" id="qErr" role="alert" hidden></p>
    <div class="row"><button type="button" class="btn" id="qBack">Continuar a construir</button><button class="btn primary" id="qSend">Enviar pedido</button></div>
  </form>`;
    modal.hidden = false; (document.getElementById('qNome') as HTMLInputElement).focus();
    document.getElementById('qBack')!.onclick = close;
    const form = document.getElementById('qForm') as HTMLFormElement;
    form.onsubmit = async e => {
      e.preventDefault();
      const err = document.getElementById('qErr')!, btn = document.getElementById('qSend') as HTMLButtonElement;
      Object.assign(lead, { nome: val('qNome'), email: val('qEmail'), tel: val('qTel'), fotos: (document.getElementById('qFotos') as HTMLInputElement).checked });
      const fail = (m: string) => { err.textContent = m; err.hidden = false; btn.disabled = false; btn.textContent = 'Enviar pedido'; };
      if (!lead.nome) return fail('Indique o seu nome.');
      if (!(document.getElementById('qEmail') as HTMLInputElement).checkValidity() || !lead.email) return fail('Indique um email válido.');
      if (!(document.getElementById('qRgpd') as HTMLInputElement).checked) return fail('Para enviarmos o pedido, aceite que a Jular o contacte.');
      err.hidden = true; btn.disabled = true; btn.textContent = 'A enviar…';
      const r = await post({ kind: 'pedido', nome: lead.nome, email: lead.email, tel: lead.tel, rgpd: true, fachada: host.finish(), casa: host.house(), plan: host.getMods(), image: (await host.capture()) ?? undefined, website: val('qSite'), fotos: lead.fotos });
      if (!r.ref) return fail(r.error || 'Não foi possível enviar o pedido.');
      lead.ref = r.ref; sent(!!r.fotos);
    };
  }

  function sent(fotos: boolean): void {
    dlg.className = 'dialog';
    dlg.innerHTML = `${steps(2)}<h3 id="dlgTitle">Pedido enviado</h3>
  <p>Obrigado, ${esc(lead.nome.split(' ')[0] || '')}. Recebemos o seu pedido <b>${esc(lead.ref)}</b>.</p>
  ${fotos ? '<p>As <b>fotografias realistas</b> da sua casa vão ser calculadas e seguem para o seu email, normalmente em menos de uma hora (num dia útil pode demorar até 24 horas).</p>' : ''}
  <p>Um consultor Jular vai estudar a sua planta e contactá-lo em <b>${esc(lead.email)}</b> em até 2 dias úteis. Nessa conversa fecham juntos o que define o preço final: o terreno, os acessos para camião e grua, e os acabamentos.</p>
  <div class="opt"><h4>Quer adiantar? (opcional)</h4><p>Com isto o consultor já chega com respostas.</p>
    <div class="grid2"><label>Concelho do terreno<input id="oConc" maxlength="80" value="${esc(lead.concelho)}"></label>
    <label>Já tem terreno?<select id="oTer"><option value="">—</option><option>Sim</option><option>Não</option><option>À procura</option></select></label></div>
    <label>Para que é a casa?<select id="oUso"><option value="">—</option><option>Habitação própria</option><option>Turismo / alojamento local</option><option>Investimento</option><option>Outro</option></select></label>
    <p class="err" id="oErr" role="alert" hidden></p>
  </div>
  <div class="row"><button type="button" class="btn" id="qDone">Terminar</button><button type="button" class="btn primary" id="qMore">Enviar detalhes</button></div>`;
    (document.getElementById('oTer') as HTMLSelectElement).value = lead.terreno;
    (document.getElementById('oUso') as HTMLSelectElement).value = lead.uso;
    document.getElementById('qDone')!.onclick = close;
    const more = document.getElementById('qMore') as HTMLButtonElement;
    more.onclick = async () => {
      Object.assign(lead, { concelho: val('oConc'), terreno: val('oTer'), uso: val('oUso') });
      if (!lead.concelho && !lead.terreno && !lead.uso) { close(); return; }
      more.disabled = true; more.textContent = 'A enviar…';
      const r = await post({ kind: 'detalhes', ref: lead.ref, email: lead.email, concelho: lead.concelho, terreno: lead.terreno, uso: lead.uso });
      if (r.error) { const e = document.getElementById('oErr')!; e.textContent = r.error; e.hidden = false; more.disabled = false; more.textContent = 'Enviar detalhes'; return; }
      dlg.innerHTML = `<h3 id="dlgTitle">Obrigado</h3><p>O consultor já fica com estes detalhes.</p><div class="row"><button type="button" class="btn primary" id="qClose">Fechar</button></div>`;
      document.getElementById('qClose')!.onclick = close;
    };
  }

  document.getElementById('quote')!.onclick = () => open(false);
  document.getElementById('photo')!.onclick = () => open(true);
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
