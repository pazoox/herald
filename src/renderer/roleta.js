// Roleta: sorteia pessoas da chamada.
// Quem gira manda pra todo mundo da chamada { participantes, qtd, semente }.
// Todos rodam o MESMO sorteador (a partir da semente), então todo mundo vê a
// roda parar no mesmo lugar e o mesmo resultado.

import { icone } from './icones.js';
import { t } from './i18n.js';
import { criarSonsRoleta } from './sons-roleta.js';

// Sorteador previsível: mesma semente => mesma sequência em qualquer PC
function sorteador(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const CORES = ['#6a5a9e', '#b18cff', '#3b3350', '#8f7cd6', '#2d2839', '#a48ef2', '#4f4378', '#c9b8ff'];
const CLARAS = new Set(['#b18cff', '#8f7cd6', '#a48ef2', '#c9b8ff']);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const facilitar = (x) => 1 - (1 - x) ** 4; // começa rápido, para devagar

export function criarRoleta(ctx) {
  // ctx: { eu(), pessoas(), nomeDe(id), avatarHtml(id), enviar(giro), audio(), mudo(), aviso(texto) }
  const sons = criarSonsRoleta(ctx.audio, ctx.mudo);
  const $ = (s) => document.querySelector(s);
  const dlg = $('#dlg-roleta');
  const canvas = $('#roleta-canvas');
  const g = canvas.getContext('2d');
  const R = canvas.width / 2;

  let selecionados = new Set();
  let qtd = 1;
  let girando = false;
  let angulo = 0;
  let fatias = [];
  let vencedores = [];
  let destaque = -1;

  function desenhar() {
    g.clearRect(0, 0, canvas.width, canvas.height);
    const n = Math.max(fatias.length, 1);
    const fatia = (Math.PI * 2) / n;
    fatias.forEach((id, i) => {
      const ini = angulo + i * fatia;
      const cor = i === destaque ? '#d6f36a' : CORES[i % CORES.length];
      g.beginPath();
      g.moveTo(R, R);
      g.arc(R, R, R - 6, ini, ini + fatia);
      g.closePath();
      g.fillStyle = cor;
      g.fill();
      g.strokeStyle = '#0b0a0f';
      g.lineWidth = 4;
      g.stroke();
      // nome ao longo do raio
      g.save();
      g.translate(R, R);
      const meio = ini + fatia / 2;
      // no lado esquerdo da roda, gira o texto 180° pra não ficar de cabeça pra baixo
      const virar = Math.cos(meio) < 0;
      g.rotate(virar ? meio + Math.PI : meio);
      g.textAlign = virar ? 'left' : 'right';
      g.textBaseline = 'middle';
      g.fillStyle = i === destaque || CLARAS.has(cor) ? '#1a0f33' : '#f4f2f8';
      const tam = Math.max(22, Math.min(40, 360 / n));
      g.font = `800 ${tam}px "Manrope Variable", system-ui, sans-serif`;
      let nome = ctx.nomeDe(id);
      while (g.measureText(nome).width > R * 0.62 && nome.length > 3) nome = nome.slice(0, -2) + '…';
      g.fillText(nome, virar ? -(R - 36) : R - 36, 0);
      g.restore();
    });
    if (!fatias.length) {
      g.fillStyle = '#231f2f';
      g.beginPath();
      g.arc(R, R, R - 6, 0, Math.PI * 2);
      g.fill();
    }
    // aro
    g.beginPath();
    g.arc(R, R, R - 4, 0, Math.PI * 2);
    g.strokeStyle = '#b18cff';
    g.lineWidth = 6;
    g.stroke();
  }

  // redesenhar=false mantém a roda como terminou (com o último sorteado destacado)
  function renderLado(redesenhar = true) {
    const pessoas = ctx.pessoas();
    for (const id of [...selecionados]) if (!pessoas.includes(id)) selecionados.delete(id);
    $('#roleta-pessoas').innerHTML = pessoas
      .map((id) => `<button class="roleta-pessoa ${selecionados.has(id) ? 'ligado' : ''}" data-pessoa-roleta="${id}" ${girando ? 'disabled' : ''}>
        ${ctx.avatarHtml(id)}<span>${esc(ctx.nomeDe(id))}${id === ctx.eu() ? ` <small>(${t('you')})</small>` : ''}</span>${selecionados.has(id) ? icone('certo') : ''}</button>`)
      .join('');
    qtd = Math.max(1, Math.min(qtd, Math.max(1, selecionados.size - 1)));
    $('#roleta-qtd').textContent = qtd;
    $('#roleta-menos').disabled = girando || qtd <= 1;
    $('#roleta-mais').disabled = girando || qtd >= selecionados.size - 1;
    const botao = $('#roleta-girar');
    botao.disabled = girando || selecionados.size < 2;
    botao.textContent = girando ? t('Spinning…') : selecionados.size < 2 ? t('Pick at least 2 people') : t('Spin');
    if (!girando && redesenhar) {
      destaque = -1;
      fatias = pessoas.filter((id) => selecionados.has(id));
      desenhar();
    }
  }

  function mostrarResultado(quem) {
    if (!vencedores.length) return ($('#roleta-resultado').innerHTML = quem ? `<p class="roleta-quem">${esc(t('{name} spun the roulette', { name: ctx.nomeDe(quem) }))}</p>` : '');
    const nomes = vencedores.map((id) => ctx.nomeDe(id));
    $('#roleta-resultado').innerHTML = `
      ${quem ? `<p class="roleta-quem">${esc(t('{name} spun the roulette', { name: ctx.nomeDe(quem) }))}</p>` : ''}
      <div class="roleta-vencedores">${vencedores.map((id, i) => `<div class="roleta-vencedor">${ctx.avatarHtml(id)}<b>${esc(ctx.nomeDe(id))}</b><span>#${i + 1}</span></div>`).join('')}</div>`;
    return nomes;
  }

  // Gira até a fatia `alvo` parar embaixo do ponteiro (no topo)
  function rodar(alvo, desvio, duracao) {
    const n = fatias.length;
    const fatia = (Math.PI * 2) / n;
    const base = -Math.PI / 2 - (alvo + 0.5 + desvio) * fatia;
    const voltas = Math.PI * 2 * 6;
    const final = base + Math.PI * 2 * Math.ceil((angulo + voltas - base) / (Math.PI * 2));
    const inicio = angulo;
    sons.arrancada();
    const t0 = performance.now();
    let ultimaFatia = null;
    return new Promise((pronto) => {
      const quadro = (agora) => {
        const p = Math.min(1, (agora - t0) / duracao);
        angulo = inicio + (final - inicio) * facilitar(p);
        // "tique" quando muda o nome embaixo do ponteiro
        const sob = Math.floor((((-Math.PI / 2 - angulo) % (Math.PI * 2)) + Math.PI * 4) % (Math.PI * 2) / fatia);
        if (sob !== ultimaFatia) {
          if (ultimaFatia !== null && p < 0.995) sons.tec();
          ultimaFatia = sob;
        }
        desenhar();
        p < 1 ? requestAnimationFrame(quadro) : pronto();
      };
      requestAnimationFrame(quadro);
    });
  }

  async function animar(giro) {
    girando = true;
    vencedores = [];
    destaque = -1;
    selecionados = new Set(giro.participantes);
    qtd = giro.qtd;
    renderLado();
    fatias = [...giro.participantes];
    mostrarResultado(giro.quem);
    const rng = sorteador(giro.semente);
    for (let k = 0; k < giro.qtd && fatias.length > 1; k++) {
      const alvo = Math.floor(rng() * fatias.length);
      const desvio = (rng() - 0.5) * 0.6;
      destaque = -1;
      await rodar(alvo, desvio, k === 0 ? 5000 : 3500);
      destaque = alvo;
      desenhar();
      vencedores.push(fatias[alvo]);
      mostrarResultado(giro.quem);
      sons.vitoria();
      await espera(1300);
      if (k < giro.qtd - 1) {
        // tira quem já saiu e gira de novo
        fatias.splice(alvo, 1);
        destaque = -1;
        desenhar();
      }
    }
    girando = false;
    const nomes = vencedores.map((id) => ctx.nomeDe(id)).join(', ');
    ctx.aviso(t(vencedores.length > 1 ? '{names} were picked!' : '{names} was picked!', { names: nomes }));
    renderLado(false);
  }

  // eventos da tela
  $('#roleta-pessoas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pessoa-roleta]');
    if (!b || girando) return;
    const id = b.dataset.pessoaRoleta;
    selecionados.has(id) ? selecionados.delete(id) : selecionados.add(id);
    vencedores = [];
    mostrarResultado(null);
    renderLado();
  });
  $('#roleta-menos').onclick = () => { qtd--; renderLado(); };
  $('#roleta-mais').onclick = () => { qtd++; renderLado(); };
  $('#roleta-girar').onclick = () => {
    if (girando || selecionados.size < 2) return;
    const pessoas = ctx.pessoas();
    const giro = {
      participantes: pessoas.filter((id) => selecionados.has(id)),
      qtd,
      semente: crypto.getRandomValues(new Uint32Array(1))[0],
      quem: ctx.eu(),
    };
    ctx.enviar(giro);
    animar(giro);
  };

  return {
    abrir() {
      if (!girando && !selecionados.size) selecionados = new Set(ctx.pessoas());
      if (!dlg.open) dlg.showModal();
      if (!girando) {
        vencedores = [];
        mostrarResultado(null);
      }
      renderLado();
    },
    // giro que veio de outra pessoa da chamada
    receber(giro) {
      if (girando || !Array.isArray(giro.participantes) || giro.participantes.length < 2) return;
      if (!dlg.open) dlg.showModal();
      animar({ ...giro, qtd: Math.max(1, Math.min(Number(giro.qtd) || 1, giro.participantes.length - 1)) });
    },
  };
}
