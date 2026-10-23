// Lista de seleção no estilo do app (substitui o <select> padrão do Windows).
// Uso: const s = criarSeletor(el, { aoMudar: (valor) => ... });
//      s.definir([{ valor, rotulo, bandeira? }], valorAtual);

import { icone } from './icones.js';

// Bandeiras desenhadas em SVG (o Windows não mostra emojis de bandeira)
export const BANDEIRAS = {
  us: `<svg viewBox="0 0 30 20" class="bandeira"><rect width="30" height="20" fill="#b22234"/><path d="M0 3.1h30M0 6.2h30M0 9.2h30M0 12.3h30M0 15.4h30M0 18.5h30" stroke="#fff" stroke-width="1.55"/><rect width="13" height="10.8" fill="#3c3b6e"/><g fill="#fff"><circle cx="2.2" cy="2" r=".7"/><circle cx="6.5" cy="2" r=".7"/><circle cx="10.8" cy="2" r=".7"/><circle cx="4.3" cy="4.4" r=".7"/><circle cx="8.6" cy="4.4" r=".7"/><circle cx="2.2" cy="6.8" r=".7"/><circle cx="6.5" cy="6.8" r=".7"/><circle cx="10.8" cy="6.8" r=".7"/><circle cx="4.3" cy="9.1" r=".7"/><circle cx="8.6" cy="9.1" r=".7"/></g></svg>`,
  br: `<svg viewBox="0 0 30 20" class="bandeira"><rect width="30" height="20" fill="#009c3b"/><path d="M15 2.2 27.4 10 15 17.8 2.6 10z" fill="#ffdf00"/><circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 9.2c3-.9 6.3-.6 8.8.9" stroke="#fff" stroke-width=".9" fill="none"/></svg>`,
};

const abertos = new Set();
document.addEventListener('click', (e) => {
  for (const s of abertos) if (!s.el.contains(e.target)) s.fechar();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const s of abertos) s.fechar();
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function criarSeletor(el, { aoMudar }) {
  let opcoes = [];
  let valor = null;
  let foco = -1;
  el.classList.add('seletor');
  el.innerHTML = `<button type="button" class="seletor-botao"></button><ul class="seletor-lista" role="listbox" hidden></ul>`;
  const botao = el.querySelector('.seletor-botao');
  const lista = el.querySelector('.seletor-lista');

  const item = (o) => `${o.bandeira ? BANDEIRAS[o.bandeira] : ''}<span class="seletor-rotulo">${esc(o.rotulo)}</span>`;

  function render() {
    const atual = opcoes.find((o) => o.valor === valor) || opcoes[0];
    botao.innerHTML = `${atual ? item(atual) : ''}${icone('mais-opcoes')}`;
    lista.innerHTML = opcoes
      .map((o, i) => `<li role="option" data-i="${i}" class="${o.valor === valor ? 'ligado' : ''} ${i === foco ? 'foco' : ''}" aria-selected="${o.valor === valor}">${item(o)}${o.valor === valor ? icone('certo') : ''}</li>`)
      .join('');
  }

  const api = {
    el,
    definir(novas, atual) {
      opcoes = novas;
      valor = atual ?? valor ?? novas[0]?.valor;
      render();
    },
    abrir() {
      lista.hidden = false;
      el.classList.add('aberto');
      foco = Math.max(0, opcoes.findIndex((o) => o.valor === valor));
      abertos.add(api);
      render();
      lista.querySelector('.ligado')?.scrollIntoView({ block: 'nearest' });
    },
    fechar() {
      lista.hidden = true;
      el.classList.remove('aberto');
      abertos.delete(api);
    },
    escolher(i) {
      const o = opcoes[i];
      if (!o) return;
      api.fechar();
      if (o.valor === valor) return;
      valor = o.valor;
      render();
      aoMudar(valor);
    },
  };

  botao.onclick = (e) => {
    e.stopPropagation();
    for (const s of abertos) if (s !== api) s.fechar();
    lista.hidden ? api.abrir() : api.fechar();
  };
  lista.onclick = (e) => {
    const li = e.target.closest('[data-i]');
    if (li) api.escolher(Number(li.dataset.i));
  };
  botao.onkeydown = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
    e.preventDefault();
    if (lista.hidden) return api.abrir();
    if (e.key === 'Enter') return api.escolher(foco);
    foco = (foco + (e.key === 'ArrowDown' ? 1 : -1) + opcoes.length) % opcoes.length;
    render();
  };
  return api;
}
